//! Raw UDP: show everything arriving on a port without trying to understand it.
//!
//! It answers exactly one question — "is anything reaching this port at all?".
//! When the OSC parser stays quiet you cannot tell whether the sender is silent
//! or sending something else entirely. Raw mode settles that in a second.
//!
//! A table row is per sender rather than per address: raw data has no
//! addresses, but you can see who is sending, how often, and at what size.

use crate::signal::{Message, Parsed, Value};

/// How many bytes to show as hex. Beyond that, an ellipsis: a log line should
/// not sprawl across the whole screen.
const HEX_PREVIEW: usize = 32;

pub fn parse_packet(buf: &[u8], source_id: u32, from: &str, t_us: u64, out: &mut Parsed) -> bool {
    let mut hex = String::with_capacity(HEX_PREVIEW * 3 + 4);
    for (i, b) in buf.iter().take(HEX_PREVIEW).enumerate() {
        if i > 0 {
            hex.push(' ');
        }
        hex.push_str(&format!("{:02x}", b));
    }
    if buf.len() > HEX_PREVIEW {
        hex.push_str(" …");
    }

    out.messages.push(Message {
        source_id,
        path: from.to_string(),
        // The first slot is numeric so packet size gets real statistics:
        // min/max immediately show whether the stream is fixed-length.
        args: vec![Value::Int(buf.len() as i64), Value::Str(hex), Value::Str(ascii_preview(buf))],
        t_us,
        from: from.to_string(),
    });

    true
}

/// Printable characters as-is, everything else as a dot — same as any hex
/// editor.
fn ascii_preview(buf: &[u8]) -> String {
    buf.iter()
        .take(HEX_PREVIEW)
        .map(|&b| if (0x20..0x7f).contains(&b) { b as char } else { '.' })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describes_any_packet() {
        let mut out = Parsed::default();
        assert!(parse_packet(b"AB\x00\xff", 1, "10.0.0.5:1234", 0, &mut out));

        assert_eq!(out.messages.len(), 1);
        assert_eq!(out.messages[0].path, "10.0.0.5:1234", "one row per sender");
        assert_eq!(out.messages[0].args[0], Value::Int(4), "first slot is packet size");
        assert_eq!(out.messages[0].args[1], Value::Str("41 42 00 ff".into()));
        assert_eq!(out.messages[0].args[2], Value::Str("AB..".into()));
    }

    #[test]
    fn truncates_long_packets() {
        let mut out = Parsed::default();
        let big = vec![0u8; 100];
        parse_packet(&big, 1, "x", 0, &mut out);

        let Value::Str(hex) = &out.messages[0].args[1] else { panic!("expected a string") };
        assert!(hex.ends_with('…'), "a long packet must be truncated");
        assert_eq!(out.messages[0].args[0], Value::Int(100), "but the size shown stays full");
    }
}
