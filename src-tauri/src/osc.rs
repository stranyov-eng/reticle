//! OSC parsing, reduced to the protocol-independent `Message`.
//!
//! Everything OSC-specific ends here. Further down the pipeline (aggregator,
//! log, UI) only `Message` and `Value` exist.

use rosc::{OscPacket, OscType};

use crate::signal::{Message, Parsed, Value};

/// Parse one UDP packet. A bundle may contain several messages, hence a list.
///
/// Returns `false` when the packet is not valid OSC: the caller counts those
/// separately, so "garbage is landing on this port" becomes visible in the UI.
pub fn parse_packet(buf: &[u8], source_id: u32, from: &str, t_us: u64, out: &mut Parsed) -> bool {
    match rosc::decoder::decode_udp(buf) {
        Ok((_, packet)) => {
            flatten(packet, source_id, from, t_us, out);
            true
        }
        Err(_) => false,
    }
}

/// Unfold a packet recursively: bundles can nest.
fn flatten(packet: OscPacket, source_id: u32, from: &str, t_us: u64, out: &mut Parsed) {
    match packet {
        OscPacket::Message(m) => {
            let mut args = Vec::with_capacity(m.args.len());
            for a in m.args {
                push_value(a, &mut args);
            }
            out.messages.push(Message {
                source_id,
                path: m.addr,
                args,
                t_us,
                from: from.to_string(),
            });
        }
        OscPacket::Bundle(b) => {
            for p in b.content {
                flatten(p, source_id, from, t_us, out);
            }
        }
    }
}

/// Type conversion. Arrays are flattened into a plain list of slots — three
/// numbers on three rows read better in the table than one packed cell.
fn push_value(a: OscType, out: &mut Vec<Value>) {
    match a {
        OscType::Int(i) => out.push(Value::Int(i as i64)),
        OscType::Long(i) => out.push(Value::Int(i)),
        OscType::Float(f) => out.push(Value::Float(f as f64)),
        OscType::Double(f) => out.push(Value::Float(f)),
        OscType::String(s) => out.push(Value::Str(s)),
        OscType::Bool(b) => out.push(Value::Bool(b)),
        OscType::Blob(b) => out.push(Value::Blob(b.len())),
        OscType::Char(c) => out.push(Value::Str(c.to_string())),
        OscType::Nil => out.push(Value::Nil),
        OscType::Inf => out.push(Value::Impulse),
        OscType::Time(t) => out.push(Value::Time(((t.seconds as u64) << 32) | t.fractional as u64)),
        OscType::Color(c) => out.push(Value::Str(format!("#{:02x}{:02x}{:02x}{:02x}", c.red, c.green, c.blue, c.alpha))),
        OscType::Midi(m) => out.push(Value::Str(format!("{:02x} {:02x} {:02x} {:02x}", m.port, m.status, m.data1, m.data2))),
        OscType::Array(arr) => {
            for inner in arr.content {
                push_value(inner, out);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats::Aggregator;
    use rosc::{OscMessage, OscPacket, OscType};

    fn encode(addr: &str, args: Vec<OscType>) -> Vec<u8> {
        rosc::encoder::encode(&OscPacket::Message(OscMessage {
            addr: addr.to_string(),
            args,
        }))
        .expect("packet should encode")
    }

    #[test]
    fn parses_message_and_types() {
        let buf = encode("/cue/1/level", vec![OscType::Float(0.25), OscType::Int(7)]);
        let mut out = Parsed::default();
        assert!(parse_packet(&buf, 1, "127.0.0.1:9000", 0, &mut out));

        assert_eq!(out.messages.len(), 1);
        assert_eq!(out.messages[0].path, "/cue/1/level");
        assert_eq!(out.messages[0].args.len(), 2);
        assert_eq!(out.messages[0].args[0], Value::Float(0.25));
        assert_eq!(out.messages[0].args[1], Value::Int(7));
    }

    #[test]
    fn rejects_garbage() {
        let mut out = Parsed::default();
        assert!(!parse_packet(b"not an osc packet at all", 1, "x", 0, &mut out));
        assert!(out.messages.is_empty());
    }

    /// The app's core scenario: a series of floats arrives on an address, and
    /// the table must end up with correct min / max / avg and count.
    #[test]
    fn tracks_min_max_avg_per_slot() {
        let mut agg = Aggregator::default();
        let mut out = Parsed::default();

        for (i, v) in [0.5f32, -1.5, 2.0, 0.0].iter().enumerate() {
            out.clear();
            let buf = encode("/pos", vec![OscType::Float(*v), OscType::Float(10.0)]);
            parse_packet(&buf, 1, "127.0.0.1:9000", (i as u64) * 1000, &mut out);
            for m in &out.messages {
                agg.ingest(m);
            }
        }

        let snap = agg.snapshot(1.0, 4000);
        let row = snap.rows.iter().find(|r| r.path == "/pos").expect("address should be in the snapshot");

        assert_eq!(row.count, 4);
        assert_eq!(row.slots.len(), 2, "two arguments mean two independent slots");

        assert_eq!(row.slots[0].min, Some(-1.5));
        assert_eq!(row.slots[0].max, Some(2.0));
        assert_eq!(row.slots[0].avg, Some(0.25));

        // The second slot never changes — min and max must coincide.
        assert_eq!(row.slots[1].min, Some(10.0));
        assert_eq!(row.slots[1].max, Some(10.0));

        // Intervals: messages arrived exactly 1000 us apart.
        assert_eq!(row.dt_min_us, 1000);
        assert_eq!(row.dt_max_us, 1000);
        assert_eq!(row.dt_avg_us, 1000);
    }

    /// A type change on an address is the integration bug people otherwise
    /// hunt by hand.
    #[test]
    fn flags_type_change() {
        let mut agg = Aggregator::default();
        let mut out = Parsed::default();

        for args in [vec![OscType::Float(1.0)], vec![OscType::Int(1)]] {
            out.clear();
            let buf = encode("/level", args);
            parse_packet(&buf, 1, "x", 0, &mut out);
            for m in &out.messages {
                agg.ingest(m);
            }
        }

        let snap = agg.snapshot(1.0, 0);
        let row = &snap.rows[0];
        assert!(row.slots[0].type_changed, "f -> i change must be flagged");
    }

    /// A bundle must decompose into separate messages.
    #[test]
    fn flattens_bundles() {
        let bundle = OscPacket::Bundle(rosc::OscBundle {
            timetag: rosc::OscTime { seconds: 0, fractional: 0 },
            content: vec![
                OscPacket::Message(OscMessage { addr: "/a".into(), args: vec![OscType::Int(1)] }),
                OscPacket::Message(OscMessage { addr: "/b".into(), args: vec![OscType::Int(2)] }),
            ],
        });
        let buf = rosc::encoder::encode(&bundle).unwrap();

        let mut out = Parsed::default();
        assert!(parse_packet(&buf, 1, "x", 0, &mut out));
        assert_eq!(out.messages.len(), 2);
        assert_eq!(out.messages[0].path, "/a");
        assert_eq!(out.messages[1].path, "/b");
    }
}
