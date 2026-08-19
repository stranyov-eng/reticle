//! Protocol-independent data representation.
//!
//! Everything arriving from any source (OSC today, Art-Net / MIDI later) is
//! reduced to a `Message`. The aggregator and the UI downstream do not know
//! which protocol produced a value — that is exactly what lets new protocols
//! plug in without touching the statistics.

use serde::Serialize;

use crate::dmx::DmxPacket;

/// What came out of a single packet.
///
/// Two outputs, because data comes in two shapes: addressed messages (OSC) and
/// channel frames (DMX). A parser fills whichever fits, and the socket layer
/// hands both onwards the same way.
#[derive(Default)]
pub struct Parsed {
    pub messages: Vec<Message>,
    pub dmx: Vec<DmxPacket>,
}

impl Parsed {
    pub fn clear(&mut self) {
        self.messages.clear();
        self.dmx.clear();
    }
}

/// A single value inside a message.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "t", content = "v")]
pub enum Value {
    Float(f64),
    Int(i64),
    Str(String),
    Bool(bool),
    /// Binary data — only the length is kept; the bytes themselves are of no
    /// use to the statistics.
    Blob(usize),
    Nil,
    Impulse,
    /// OSC timetag, as received.
    Time(u64),
}

impl Value {
    /// Numeric view for min/max/avg. `None` means this slot carries no numeric
    /// statistics (strings, blobs, impulse).
    pub fn as_num(&self) -> Option<f64> {
        match self {
            Value::Float(f) => Some(*f),
            Value::Int(i) => Some(*i as f64),
            Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
            _ => None,
        }
    }

    /// Short type tag — the same alphabet OSC uses, so a type change on an
    /// address is visible at a glance.
    pub fn type_tag(&self) -> &'static str {
        match self {
            Value::Float(_) => "f",
            Value::Int(_) => "i",
            Value::Str(_) => "s",
            Value::Bool(_) => "b",
            Value::Blob(_) => "blob",
            Value::Nil => "N",
            Value::Impulse => "I",
            Value::Time(_) => "t",
        }
    }
}

/// One parsed message.
#[derive(Clone, Debug, Serialize)]
pub struct Message {
    pub source_id: u32,
    pub path: String,
    pub args: Vec<Value>,
    /// Microseconds since app start — monotonic, unlike wall-clock time.
    pub t_us: u64,
    /// Sender, `ip:port`.
    pub from: String,
}
