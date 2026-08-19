//! Statistics aggregator.
//!
//! Keeps one row per (source, address) and one sub-row per argument slot: for
//! `/pos` carrying three floats the statistics are computed for each of the
//! three, not for the address as a whole.
//!
//! The key idea of the whole app: aggregation lives here, and snapshots go to
//! the UI at a fixed rate. A stream of 6000 msg/s therefore loads the UI
//! exactly as much as a stream of 10 msg/s.

use std::collections::HashMap;

use serde::Serialize;

use crate::signal::{Message, Value};

/// Ring length for the sparkline. Served on request rather than in snapshots —
/// otherwise a hundred addresses inflate every snapshot by an order of
/// magnitude.
const SPARK_LEN: usize = 120;

/// Rate smoothing: the raw per-tick value jitters too much to read.
const RATE_SMOOTHING: f32 = 0.3;

#[derive(Clone)]
pub struct SlotStat {
    type_tag: &'static str,
    /// The address sent a different type than before — almost always an
    /// integration bug.
    type_changed: bool,
    last: Value,
    min: f64,
    max: f64,
    sum: f64,
    num_count: u64,
    spark: Vec<f32>,
    spark_pos: usize,
}

impl SlotStat {
    fn new() -> Self {
        Self {
            type_tag: "",
            type_changed: false,
            last: Value::Nil,
            min: f64::INFINITY,
            max: f64::NEG_INFINITY,
            sum: 0.0,
            num_count: 0,
            spark: vec![f32::NAN; SPARK_LEN],
            spark_pos: 0,
        }
    }

    fn push(&mut self, v: &Value) {
        let tag = v.type_tag();
        if !self.type_tag.is_empty() && self.type_tag != tag {
            self.type_changed = true;
        }
        self.type_tag = tag;

        if let Some(n) = v.as_num() {
            if n < self.min {
                self.min = n;
            }
            if n > self.max {
                self.max = n;
            }
            self.sum += n;
            self.num_count += 1;
            self.spark[self.spark_pos] = n as f32;
            self.spark_pos = (self.spark_pos + 1) % SPARK_LEN;
        }
        self.last = v.clone();
    }

    /// Sparkline in chronological order (the ring is unrolled).
    fn spark_ordered(&self) -> Vec<f32> {
        let (tail, head) = self.spark.split_at(self.spark_pos);
        head.iter().chain(tail.iter()).copied().collect()
    }
}

pub struct AddrStat {
    source_id: u32,
    path: String,
    count: u64,
    /// Counter at the previous tick — the rate is derived from it.
    count_at_tick: u64,
    rate: f32,
    first_us: u64,
    last_us: u64,
    /// Intervals between messages: they reveal the sender's real jitter.
    dt_min: u64,
    dt_max: u64,
    dt_sum: u64,
    dt_count: u64,
    slots: Vec<SlotStat>,
    dirty: bool,
}

impl AddrStat {
    fn new(source_id: u32, path: String, t_us: u64) -> Self {
        Self {
            source_id,
            path,
            count: 0,
            count_at_tick: 0,
            rate: 0.0,
            first_us: t_us,
            last_us: t_us,
            dt_min: u64::MAX,
            dt_max: 0,
            dt_sum: 0,
            dt_count: 0,
            slots: Vec::new(),
            dirty: true,
        }
    }
}

/// A row of the address table — what travels to the UI.
#[derive(Serialize, Clone)]
pub struct AddrRow {
    pub key: String,
    pub source_id: u32,
    pub path: String,
    pub count: u64,
    pub last_us: u64,
    pub first_us: u64,
    pub rate: f32,
    pub dt_min_us: u64,
    pub dt_max_us: u64,
    pub dt_avg_us: u64,
    pub slots: Vec<SlotRow>,
}

#[derive(Serialize, Clone)]
pub struct SlotRow {
    pub type_tag: String,
    pub type_changed: bool,
    pub last: Value,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub avg: Option<f64>,
}

#[derive(Serialize, Clone)]
pub struct Snapshot {
    /// Changed rows only — the UI merges them into its table.
    pub rows: Vec<AddrRow>,
    /// Current time, so the UI can compute "silent for N seconds" itself
    /// without extra fields.
    pub now_us: u64,
    pub total_addrs: usize,
}

#[derive(Default)]
pub struct Aggregator {
    /// Nested map, so lookups by &str allocate nothing on the hot path.
    by_source: HashMap<u32, HashMap<String, AddrStat>>,
}

impl Aggregator {
    pub fn ingest(&mut self, m: &Message) {
        let table = self.by_source.entry(m.source_id).or_default();

        let stat = match table.get_mut(m.path.as_str()) {
            Some(s) => s,
            None => table
                .entry(m.path.clone())
                .or_insert_with(|| AddrStat::new(m.source_id, m.path.clone(), m.t_us)),
        };

        // Intervals start from the second message — the first has no previous.
        if stat.count > 0 {
            let dt = m.t_us.saturating_sub(stat.last_us);
            if dt < stat.dt_min {
                stat.dt_min = dt;
            }
            if dt > stat.dt_max {
                stat.dt_max = dt;
            }
            stat.dt_sum += dt;
            stat.dt_count += 1;
        }

        stat.count += 1;
        stat.last_us = m.t_us;
        stat.dirty = true;

        for (i, v) in m.args.iter().enumerate() {
            if stat.slots.len() <= i {
                stat.slots.resize(i + 1, SlotStat::new());
            }
            stat.slots[i].push(v);
        }
    }

    /// Collect a snapshot of changed rows and recompute rates.
    ///
    /// `dt_s` — seconds elapsed since the previous tick.
    pub fn snapshot(&mut self, dt_s: f32, now_us: u64) -> Snapshot {
        let mut rows = Vec::new();
        let mut total = 0usize;

        for table in self.by_source.values_mut() {
            total += table.len();
            for stat in table.values_mut() {
                let fresh = stat.count - stat.count_at_tick;
                let raw_rate = if dt_s > 0.0 { fresh as f32 / dt_s } else { 0.0 };
                let prev_rate = stat.rate;
                stat.rate += (raw_rate - stat.rate) * RATE_SMOOTHING;
                stat.count_at_tick = stat.count;

                // A row that went quiet is sent once more so its rate can reach
                // zero on screen. After that it drops out of snapshots.
                if !stat.dirty && prev_rate < 0.01 {
                    continue;
                }
                stat.dirty = false;

                rows.push(AddrRow {
                    key: format!("{}:{}", stat.source_id, stat.path),
                    source_id: stat.source_id,
                    path: stat.path.clone(),
                    count: stat.count,
                    last_us: stat.last_us,
                    first_us: stat.first_us,
                    rate: stat.rate,
                    dt_min_us: if stat.dt_min == u64::MAX { 0 } else { stat.dt_min },
                    dt_max_us: stat.dt_max,
                    dt_avg_us: if stat.dt_count > 0 {
                        stat.dt_sum / stat.dt_count
                    } else {
                        0
                    },
                    slots: stat
                        .slots
                        .iter()
                        .map(|s| SlotRow {
                            type_tag: s.type_tag.to_string(),
                            type_changed: s.type_changed,
                            last: s.last.clone(),
                            min: (s.num_count > 0).then_some(s.min),
                            max: (s.num_count > 0).then_some(s.max),
                            avg: (s.num_count > 0).then(|| s.sum / s.num_count as f64),
                        })
                        .collect(),
                });
            }
        }

        Snapshot {
            rows,
            now_us,
            total_addrs: total,
        }
    }

    /// Value history of one slot — for the sparkline and the watch panel.
    pub fn spark(&self, source_id: u32, path: &str, slot: usize) -> Option<Vec<f32>> {
        self.by_source
            .get(&source_id)?
            .get(path)?
            .slots
            .get(slot)
            .map(|s| s.spark_ordered())
    }

    /// Reset statistics: everything, or one source.
    pub fn reset(&mut self, source_id: Option<u32>) {
        match source_id {
            Some(id) => {
                self.by_source.remove(&id);
            }
            None => self.by_source.clear(),
        }
    }
}
