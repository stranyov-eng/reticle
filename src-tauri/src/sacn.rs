//! sACN (ANSI E1.31) — DMX over the network.
//!
//! Only the data packet (VECTOR_E131_DATA_PACKET) is parsed. Synchronisation
//! and discovery are skipped for now: a monitor cares about the data, the
//! sequence numbers, and who is sending them.

use crate::dmx::DmxPacket;
use crate::signal::{Message, Parsed, Value};

/// The ACN identifier — it separates the packet from any other UDP noise.
const ACN_ID: &[u8; 12] = b"ASC-E1.17\0\0\0";

const VECTOR_ROOT_E131_DATA: u32 = 0x0000_0004;
const VECTOR_E131_DATA_PACKET: u32 = 0x0000_0002;
const VECTOR_DMP_SET_PROPERTY: u8 = 0x02;

/// Minimum length of a data packet: all three layers with no channels at all.
const MIN_LEN: usize = 126;

/// Multicast group of a universe: 239.255.{high byte}.{low byte}.
pub fn multicast_group(universe: u16) -> std::net::Ipv4Addr {
    std::net::Ipv4Addr::new(239, 255, (universe >> 8) as u8, (universe & 0xff) as u8)
}

pub fn parse_packet(buf: &[u8], source_id: u32, from: &str, t_us: u64, out: &mut Parsed) -> bool {
    if buf.len() < MIN_LEN || &buf[4..16] != ACN_ID {
        return false;
    }
    if u32::from_be_bytes([buf[18], buf[19], buf[20], buf[21]]) != VECTOR_ROOT_E131_DATA {
        return false;
    }
    if u32::from_be_bytes([buf[40], buf[41], buf[42], buf[43]]) != VECTOR_E131_DATA_PACKET {
        return false;
    }
    if buf[117] != VECTOR_DMP_SET_PROPERTY {
        return false;
    }

    let mut cid = [0u8; 16];
    cid.copy_from_slice(&buf[22..38]);

    // Source name is 64 bytes, null-padded.
    let name_end = buf[44..108].iter().position(|&b| b == 0).unwrap_or(64);
    let source_name = String::from_utf8_lossy(&buf[44..44 + name_end]).trim().to_string();

    let priority = buf[108];
    let sequence = buf[111];
    let options = buf[112];
    let universe = u16::from_be_bytes([buf[113], buf[114]]);

    // The count includes the start byte; channels follow it.
    let value_count = u16::from_be_bytes([buf[123], buf[124]]) as usize;
    let start_code = buf[125];

    // A non-zero start code carries something other than levels (RDM and
    // friends) — that must never land in the channel grid.
    if start_code != 0 {
        return false;
    }

    let available = buf.len().saturating_sub(126);
    let channels = value_count.saturating_sub(1).min(available).min(512);
    let values = buf[126..126 + channels].to_vec();

    out.dmx.push(DmxPacket {
        source_id,
        universe,
        priority,
        sequence,
        cid,
        source_name: source_name.clone(),
        values,
        preview: options & 0x80 != 0,
        t_us,
    });

    // The log gets the packet header: 512 values are unreadable there, but the
    // rate, the priority and the universe width are useful.
    out.messages.push(Message {
        source_id,
        path: format!("universe/{}", universe),
        args: vec![
            Value::Int(priority as i64),
            Value::Int(channels as i64),
            Value::Str(source_name),
        ],
        t_us,
        from: from.to_string(),
    });

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a valid data packet with the given channels.
    fn build(universe: u16, sequence: u8, channels: &[u8]) -> Vec<u8> {
        let mut b = vec![0u8; 126];
        b[0..2].copy_from_slice(&0x0010u16.to_be_bytes());
        b[4..16].copy_from_slice(ACN_ID);
        b[18..22].copy_from_slice(&VECTOR_ROOT_E131_DATA.to_be_bytes());
        b[22..38].copy_from_slice(&[0xab; 16]);
        b[40..44].copy_from_slice(&VECTOR_E131_DATA_PACKET.to_be_bytes());

        let name = b"grandMA\0";
        b[44..44 + name.len()].copy_from_slice(name);

        b[108] = 100;
        b[111] = sequence;
        b[113..115].copy_from_slice(&universe.to_be_bytes());
        b[117] = VECTOR_DMP_SET_PROPERTY;
        b[118] = 0xa1;
        b[123..125].copy_from_slice(&((channels.len() + 1) as u16).to_be_bytes());
        b[125] = 0; // start code
        b.extend_from_slice(channels);
        b
    }

    #[test]
    fn parses_data_packet() {
        let buf = build(7, 42, &[0, 128, 255]);
        let mut out = Parsed::default();
        assert!(parse_packet(&buf, 1, "10.0.0.9:5568", 0, &mut out));

        assert_eq!(out.dmx.len(), 1);
        let p = &out.dmx[0];
        assert_eq!(p.universe, 7);
        assert_eq!(p.sequence, 42);
        assert_eq!(p.priority, 100);
        assert_eq!(p.source_name, "grandMA");
        assert_eq!(p.values, vec![0, 128, 255]);
        assert!(!p.preview);

        assert_eq!(out.messages.len(), 1, "the log receives the packet header");
        assert_eq!(out.messages[0].path, "universe/7");
    }

    #[test]
    fn rejects_non_sacn() {
        let mut out = Parsed::default();
        assert!(!parse_packet(&[0u8; 200], 1, "x", 0, &mut out));
        assert!(out.dmx.is_empty());
    }

    #[test]
    fn rejects_short_packet() {
        let mut out = Parsed::default();
        assert!(!parse_packet(b"too short", 1, "x", 0, &mut out));
    }

    /// Packets with a non-zero start code do not carry levels and must not be
    /// displayed as channels.
    #[test]
    fn rejects_non_zero_start_code() {
        let mut buf = build(1, 1, &[1, 2, 3]);
        buf[125] = 0xcc;
        let mut out = Parsed::default();
        assert!(!parse_packet(&buf, 1, "x", 0, &mut out));
    }

    #[test]
    fn marks_preview_packets() {
        let mut buf = build(1, 1, &[5]);
        buf[112] = 0x80;
        let mut out = Parsed::default();
        parse_packet(&buf, 1, "x", 0, &mut out);
        assert!(out.dmx[0].preview, "the preview flag must survive");
    }

    /// A sender may lie in the count field — never read past the buffer.
    #[test]
    fn survives_lying_value_count() {
        let mut buf = build(1, 1, &[1, 2, 3]);
        buf[123..125].copy_from_slice(&513u16.to_be_bytes());
        let mut out = Parsed::default();
        assert!(parse_packet(&buf, 1, "x", 0, &mut out));
        assert_eq!(out.dmx[0].values.len(), 3, "only what actually arrived is taken");
    }

    #[test]
    fn maps_universe_to_multicast_group() {
        assert_eq!(multicast_group(1).to_string(), "239.255.0.1");
        assert_eq!(multicast_group(256).to_string(), "239.255.1.0");
    }
}
