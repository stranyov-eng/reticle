//! Source pool.
//!
//! Every source owns its socket and its task; all of them write into one
//! channel. That way adding a second port (or Art-Net later) touches nothing
//! else.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use socket2::{Domain, Protocol, Socket, Type};
use tokio::sync::{mpsc, oneshot};

use crate::signal::Parsed;
use crate::{osc, raw, sacn};

/// Parsing of a single datagram. Every protocol is reduced to this signature,
/// so adding Art-Net means writing a module and adding one line to
/// `parser_for` — sockets and statistics stay untouched.
type ParseFn = fn(&[u8], u32, &str, u64, &mut Parsed) -> bool;

fn parser_for(kind: &str) -> Option<ParseFn> {
    match kind {
        "osc-udp" => Some(osc::parse_packet),
        "raw-udp" => Some(raw::parse_packet),
        "sacn" => Some(sacn::parse_packet),
        _ => None,
    }
}

/// Parse a universe list such as "1-4,10" into numbers.
///
/// Listening to hundreds of groups at once is pointless and expensive, so the
/// list is capped.
const MAX_UNIVERSES: usize = 128;

fn parse_universes(spec: &str) -> Result<Vec<u16>, String> {
    let mut out = Vec::new();

    for part in spec.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let (from, to) = match part.split_once('-') {
            Some((a, b)) => (a.trim(), b.trim()),
            None => (part, part),
        };
        let from: u16 = from.parse().map_err(|_| format!("bad universe: {part}"))?;
        let to: u16 = to.parse().map_err(|_| format!("bad universe: {part}"))?;
        if from == 0 || to == 0 || from > to {
            return Err(format!("bad universe range: {part}"));
        }
        for u in from..=to {
            if !out.contains(&u) {
                out.push(u);
            }
            if out.len() > MAX_UNIVERSES {
                return Err(format!("too many universes at once (limit {MAX_UNIVERSES})"));
            }
        }
    }

    Ok(out)
}

/// Which multicast groups the source subscribes to.
fn groups_for(cfg: &SourceCfg) -> Result<Vec<Ipv4Addr>, String> {
    if let Some(g) = &cfg.multicast {
        let addr: Ipv4Addr = g.parse().map_err(|_| "invalid multicast group".to_string())?;
        return Ok(vec![addr]);
    }

    // For sACN the group follows from the universe number, so there is no
    // reason to type it by hand.
    if cfg.kind == "sacn" {
        if let Some(spec) = &cfg.universes {
            return Ok(parse_universes(spec)?.into_iter().map(sacn::multicast_group).collect());
        }
    }

    Ok(Vec::new())
}

/// Kernel receive buffer. The default is small, and on a traffic burst packets
/// are dropped silently — the worst kind of failure for a monitor.
const RECV_BUFFER_BYTES: usize = 4 * 1024 * 1024;

/// Largest possible UDP datagram.
const MAX_DATAGRAM: usize = 65_536;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SourceCfg {
    /// Protocol id, resolved by `parser_for`.
    #[serde(default = "default_kind")]
    pub kind: String,
    #[serde(default = "default_bind")]
    pub bind: String,
    pub port: u16,
    /// Multicast group, when listening to one instead of unicast.
    #[serde(default)]
    pub multicast: Option<String>,
    /// For sACN: which universes to listen to, "1-4,10". Groups are derived.
    #[serde(default)]
    pub universes: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
}

fn default_kind() -> String {
    "osc-udp".to_string()
}

fn default_bind() -> String {
    "0.0.0.0".to_string()
}

/// Per-source counters, kept apart from address statistics because they answer
/// a different question: "is anything reaching this port at all".
#[derive(Default)]
pub struct SourceCounters {
    pub packets: AtomicU64,
    pub messages: AtomicU64,
    /// Packets that did not parse as the selected protocol.
    pub invalid: AtomicU64,
    /// Messages discarded because the channel was full.
    pub dropped: AtomicU64,
}

#[derive(Clone, Serialize)]
pub struct SourceInfo {
    pub id: u32,
    pub cfg: SourceCfg,
    pub local_port: u16,
    pub status: String,
    pub error: Option<String>,
    pub packets: u64,
    pub messages: u64,
    pub invalid: u64,
    pub dropped: u64,
}

pub struct SourceHandle {
    pub id: u32,
    pub cfg: SourceCfg,
    /// The port actually taken. Differs from the requested one when 0 was asked.
    pub local_port: u16,
    pub counters: Arc<SourceCounters>,
    stop: Option<oneshot::Sender<()>>,
}

impl SourceHandle {
    pub fn info(&self) -> SourceInfo {
        SourceInfo {
            id: self.id,
            cfg: self.cfg.clone(),
            local_port: self.local_port,
            status: "bound".to_string(),
            error: None,
            packets: self.counters.packets.load(Ordering::Relaxed),
            messages: self.counters.messages.load(Ordering::Relaxed),
            invalid: self.counters.invalid.load(Ordering::Relaxed),
            dropped: self.counters.dropped.load(Ordering::Relaxed),
        }
    }

    /// Stop the source task. The socket closes with it.
    pub fn stop(&mut self) {
        if let Some(tx) = self.stop.take() {
            let _ = tx.send(());
        }
    }
}

/// Open a socket for the given config.
///
/// Port sharing is enabled for multicast only, where it is the normal mode.
/// For unicast on Windows `SO_REUSEADDR` would mean silently intercepting
/// someone else's traffic — better to report "port in use" honestly.
fn bind_socket(cfg: &SourceCfg) -> std::io::Result<std::net::UdpSocket> {
    let iface: Ipv4Addr = cfg
        .bind
        .parse()
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid interface address"))?;

    let groups = groups_for(cfg)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;

    let sock = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;

    if !groups.is_empty() {
        sock.set_reuse_address(true)?;
        #[cfg(unix)]
        sock.set_reuse_port(true)?;
    }

    // Multicast on Windows requires binding to the unspecified address,
    // otherwise the group subscription does not take effect.
    let addr = if groups.is_empty() {
        SocketAddr::new(IpAddr::V4(iface), cfg.port)
    } else {
        SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), cfg.port)
    };
    sock.bind(&addr.into())?;

    for group in &groups {
        sock.join_multicast_v4(group, &iface)?;
    }

    // A failure here is not fatal: the kernel may clamp the size, which is no
    // reason to refuse listening.
    let _ = sock.set_recv_buffer_size(RECV_BUFFER_BYTES);
    sock.set_nonblocking(true)?;

    Ok(sock.into())
}

/// Bring a source up and start its task.
pub fn spawn(id: u32, cfg: SourceCfg, tx: mpsc::Sender<Parsed>, start: std::time::Instant) -> std::io::Result<SourceHandle> {
    let parse = parser_for(&cfg.kind).ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("unknown protocol: {}", cfg.kind),
        )
    })?;

    let std_sock = bind_socket(&cfg)?;
    let local_port = std_sock.local_addr()?.port();
    let sock = tokio::net::UdpSocket::from_std(std_sock)?;

    let counters = Arc::new(SourceCounters::default());
    let (stop_tx, mut stop_rx) = oneshot::channel();

    let task_counters = counters.clone();
    tokio::spawn(async move {
        let mut buf = vec![0u8; MAX_DATAGRAM];
        let mut parsed = Parsed::default();

        loop {
            tokio::select! {
                _ = &mut stop_rx => break,
                recv = sock.recv_from(&mut buf) => {
                    let (len, from) = match recv {
                        Ok(v) => v,
                        // One faulty datagram is no reason to drop the source.
                        Err(_) => continue,
                    };

                    task_counters.packets.fetch_add(1, Ordering::Relaxed);
                    let t_us = start.elapsed().as_micros() as u64;

                    parsed.clear();
                    let ok = parse(&buf[..len], id, &from.to_string(), t_us, &mut parsed);
                    if !ok {
                        task_counters.invalid.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }

                    let produced = (parsed.messages.len() + parsed.dmx.len()) as u64;
                    task_counters.messages.fetch_add(produced, Ordering::Relaxed);

                    // Better to drop a message and count the drop than to stall
                    // socket reads and lose them silently inside the kernel.
                    if tx.try_send(std::mem::take(&mut parsed)).is_err() {
                        task_counters.dropped.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        }
    });

    Ok(SourceHandle {
        id,
        cfg,
        local_port,
        counters,
        stop: Some(stop_tx),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    /// End-to-end check: the socket opened, a datagram arrived, OSC parsed.
    /// Port zero is requested so the OS hands out a free one and the test does
    /// not collide with anything already running on the machine.
    #[tokio::test]
    async fn binds_and_receives() {
        let (tx, mut rx) = mpsc::channel(16);
        let cfg = SourceCfg {
            kind: "osc-udp".into(),
            bind: "127.0.0.1".into(),
            port: 0,
            multicast: None,
            universes: None,
            label: None,
        };

        let handle = spawn(1, cfg, tx, Instant::now()).expect("source should come up");
        let port = handle.local_port;
        assert!(port > 0, "the OS should have handed out a port");

        let packet = rosc::encoder::encode(&rosc::OscPacket::Message(rosc::OscMessage {
            addr: "/test/value".into(),
            args: vec![rosc::OscType::Float(0.75)],
        }))
        .unwrap();

        let sender = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
        sender.send_to(&packet, ("127.0.0.1", port)).await.unwrap();

        let batch = tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .expect("the message should arrive within two seconds")
            .expect("the channel should stay open");

        assert_eq!(batch.messages.len(), 1);
        assert_eq!(batch.messages[0].path, "/test/value");
        assert_eq!(batch.messages[0].source_id, 1);
    }

    /// A busy unicast port must fail honestly instead of silently hijacking
    /// someone else's traffic.
    #[tokio::test]
    async fn reports_busy_port() {
        let (tx, _rx) = mpsc::channel(16);
        let cfg = SourceCfg {
            kind: "osc-udp".into(),
            bind: "127.0.0.1".into(),
            port: 0,
            multicast: None,
            universes: None,
            label: None,
        };

        let first = spawn(1, cfg.clone(), tx.clone(), Instant::now()).unwrap();
        let taken = SourceCfg { port: first.local_port, ..cfg };

        let second = spawn(2, taken, tx, Instant::now());
        assert!(second.is_err(), "a second bind on the same port must fail");
    }
}
