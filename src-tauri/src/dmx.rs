//! DMX state: universes, channels, senders.
//!
//! Why DMX does not go through the shared aggregator: it has no addresses —
//! it has a fixed 512 channels per universe. A 512-byte array is computed and
//! shipped an order of magnitude cheaper than a HashMap of strings, and the UI
//! shows a grid rather than a list.
//!
//! Everything else (sockets, channel, ticker) is shared with OSC.

use std::collections::HashMap;

use serde::Serialize;

pub const CHANNELS: usize = 512;

/// One parsed DMX data packet.
pub struct DmxPacket {
    pub source_id: u32,
    pub universe: u16,
    pub priority: u8,
    pub sequence: u8,
    /// Sender identifier from the protocol — it reveals two consoles pushing
    /// the same universe.
    pub cid: [u8; 16],
    pub source_name: String,
    /// Channel values from the first one; shorter than 512 when the sender
    /// transmits a partial universe.
    pub values: Vec<u8>,
    /// Packet is flagged as preview — those never reach the output.
    pub preview: bool,
    pub t_us: u64,
}

struct SenderMeta {
    name: String,
    priority: u8,
    count: u64,
    last_us: u64,
}

struct UniverseState {
    values: [u8; CHANNELS],
    min: [u8; CHANNELS],
    max: [u8; CHANNELS],
    /// Before the first packet min/max are meaningless — reported as "no data".
    seen: bool,
    /// How many channels are actually being sent.
    width: usize,
    count: u64,
    count_at_tick: u64,
    fps: f32,
    /// Preview packets: sent for checking, never driving real output.
    preview: u64,
    last_us: u64,
    last_sequence: Option<u8>,
    /// Gaps in packet numbering — a direct sign of network loss.
    lost: u64,
    senders: HashMap<[u8; 16], SenderMeta>,
}

impl UniverseState {
    fn new(t_us: u64) -> Self {
        Self {
            values: [0; CHANNELS],
            min: [255; CHANNELS],
            max: [0; CHANNELS],
            seen: false,
            width: 0,
            count: 0,
            count_at_tick: 0,
            fps: 0.0,
            preview: 0,
            last_us: t_us,
            last_sequence: None,
            lost: 0,
            senders: HashMap::new(),
        }
    }
}

/// A row in the universe list.
#[derive(Serialize, Clone)]
pub struct UniverseRow {
    pub source_id: u32,
    pub universe: u16,
    pub width: usize,
    pub count: u64,
    pub lost: u64,
    pub preview: u64,
    pub fps: f32,
    pub last_us: u64,
    pub senders: Vec<SenderRow>,
    /// Several senders on one universe — almost always an accident rather than
    /// a plan.
    pub conflict: bool,
}

#[derive(Serialize, Clone)]
pub struct SenderRow {
    pub cid: String,
    pub name: String,
    pub priority: u8,
    pub count: u64,
    pub last_us: u64,
}

/// One universe frame for the channel grid.
#[derive(Serialize, Clone)]
pub struct DmxFrame {
    pub source_id: u32,
    pub universe: u16,
    pub width: usize,
    pub values: Vec<u8>,
    pub min: Vec<u8>,
    pub max: Vec<u8>,
    pub count: u64,
    pub lost: u64,
    pub preview: u64,
    pub fps: f32,
    pub last_us: u64,
}

#[derive(Default)]
pub struct DmxTracker {
    universes: HashMap<(u32, u16), UniverseState>,
}

impl DmxTracker {
    pub fn ingest(&mut self, p: &DmxPacket) {
        let st = self
            .universes
            .entry((p.source_id, p.universe))
            .or_insert_with(|| UniverseState::new(p.t_us));

        // Packet numbers wrap inside a single byte: we expect previous + 1, and
        // anything else is loss. Zero means "do not count", per the standard.
        if let Some(prev) = st.last_sequence {
            let expected = prev.wrapping_add(1);
            if p.sequence != expected && p.sequence != 0 {
                st.lost += p.sequence.wrapping_sub(expected) as u64;
            }
        }
        st.last_sequence = Some(p.sequence);

        if p.preview {
            st.preview += 1;
        }

        st.count += 1;
        st.last_us = p.t_us;
        st.width = st.width.max(p.values.len());

        for (i, &v) in p.values.iter().take(CHANNELS).enumerate() {
            st.values[i] = v;
            if !st.seen {
                st.min[i] = v;
                st.max[i] = v;
            } else {
                if v < st.min[i] {
                    st.min[i] = v;
                }
                if v > st.max[i] {
                    st.max[i] = v;
                }
            }
        }
        st.seen = true;

        let sender = st.senders.entry(p.cid).or_insert_with(|| SenderMeta {
            name: p.source_name.clone(),
            priority: p.priority,
            count: 0,
            last_us: p.t_us,
        });
        sender.count += 1;
        sender.last_us = p.t_us;
        sender.priority = p.priority;
        if sender.name != p.source_name {
            sender.name = p.source_name.clone();
        }
    }

    /// Recompute rates and return the universe list.
    pub fn snapshot(&mut self, dt_s: f32) -> Vec<UniverseRow> {
        let mut rows: Vec<UniverseRow> = self
            .universes
            .iter_mut()
            .map(|((source_id, universe), st)| {
                let fresh = st.count - st.count_at_tick;
                let raw = if dt_s > 0.0 { fresh as f32 / dt_s } else { 0.0 };
                st.fps += (raw - st.fps) * 0.3;
                st.count_at_tick = st.count;

                let mut senders: Vec<SenderRow> = st
                    .senders
                    .iter()
                    .map(|(cid, m)| SenderRow {
                        cid: format_cid(cid),
                        name: m.name.clone(),
                        priority: m.priority,
                        count: m.count,
                        last_us: m.last_us,
                    })
                    .collect();
                senders.sort_by(|a, b| b.count.cmp(&a.count));

                UniverseRow {
                    source_id: *source_id,
                    universe: *universe,
                    width: st.width,
                    count: st.count,
                    lost: st.lost,
                    preview: st.preview,
                    fps: st.fps,
                    last_us: st.last_us,
                    conflict: senders.len() > 1,
                    senders,
                }
            })
            .collect();

        rows.sort_by_key(|r| (r.source_id, r.universe));
        rows
    }

    pub fn frame(&self, source_id: u32, universe: u16) -> Option<DmxFrame> {
        let st = self.universes.get(&(source_id, universe))?;
        let width = st.width.max(1);

        Some(DmxFrame {
            source_id,
            universe,
            width,
            values: st.values[..width].to_vec(),
            min: st.min[..width].to_vec(),
            max: st.max[..width].to_vec(),
            count: st.count,
            lost: st.lost,
            preview: st.preview,
            fps: st.fps,
            last_us: st.last_us,
        })
    }

    pub fn reset(&mut self, source_id: Option<u32>) {
        match source_id {
            Some(id) => self.universes.retain(|(sid, _), _| *sid != id),
            None => self.universes.clear(),
        }
    }
}

fn format_cid(cid: &[u8; 16]) -> String {
    cid.iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet(seq: u8, values: Vec<u8>) -> DmxPacket {
        DmxPacket {
            source_id: 1,
            universe: 1,
            priority: 100,
            sequence: seq,
            cid: [7; 16],
            source_name: "console".into(),
            values,
            preview: false,
            t_us: 0,
        }
    }

    #[test]
    fn tracks_min_max_per_channel() {
        let mut t = DmxTracker::default();
        t.ingest(&packet(1, vec![10, 200, 0]));
        t.ingest(&packet(2, vec![50, 100, 0]));

        let f = t.frame(1, 1).expect("the universe should appear");
        assert_eq!(f.values, vec![50, 100, 0], "values are the latest received");
        assert_eq!(f.min, vec![10, 100, 0]);
        assert_eq!(f.max, vec![50, 200, 0]);
        assert_eq!(f.count, 2);
    }

    #[test]
    fn counts_lost_packets() {
        let mut t = DmxTracker::default();
        t.ingest(&packet(1, vec![0]));
        // 2 and 3 were lost on the way
        t.ingest(&packet(4, vec![0]));

        let f = t.frame(1, 1).unwrap();
        assert_eq!(f.lost, 2, "exactly two packets went missing between 1 and 4");
    }

    #[test]
    fn sequence_wraps_around() {
        let mut t = DmxTracker::default();
        t.ingest(&packet(255, vec![0]));
        t.ingest(&packet(0, vec![0]));
        t.ingest(&packet(1, vec![0]));

        let f = t.frame(1, 1).unwrap();
        assert_eq!(f.lost, 0, "255 -> 0 is a wrap, not a loss");
    }

    #[test]
    fn flags_two_senders_on_one_universe() {
        let mut t = DmxTracker::default();
        t.ingest(&packet(1, vec![0]));

        let mut other = packet(2, vec![0]);
        other.cid = [9; 16];
        other.source_name = "second console".into();
        t.ingest(&other);

        let rows = t.snapshot(1.0);
        assert_eq!(rows.len(), 1);
        assert!(rows[0].conflict, "two sources on a universe is a conflict");
        assert_eq!(rows[0].senders.len(), 2);
    }
}
