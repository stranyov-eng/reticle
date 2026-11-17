//! Throughput probe for file shares.
//!
//! Measures what a copy tool would actually get, because that is the question
//! people have: FreeFileSync and friends move data over SMB, and SMB overhead
//! is part of the answer. A raw bandwidth test like iperf3 answers a different
//! question and needs a daemon on every host; this needs only a share you can
//! already reach.
//!
//! Two deliberate choices:
//!
//! * **Several streams.** One SMB stream tops out around 400–600 MB/s on a
//!   10 GbE link — it runs out of a single core and round-trip latency long
//!   before it runs out of wire. Measuring single-threaded reports that ceiling
//!   as if it were the network.
//! * **One target at a time.** Nine servers tested at once would share one
//!   uplink and every number would be wrong.

use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{TcpStream, ToSocketAddrs, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// Block size for every read and write. Large enough that SMB round trips stop
/// dominating, small enough to stay responsive to cancellation.
const BLOCK: usize = 4 * 1024 * 1024;

/// Prefix for the files a write test creates. Recognisable on purpose: if a run
/// is killed mid-flight, it is obvious what the leftovers are and who made them.
const TMP_PREFIX: &str = "reticle-speedtest";

/// SMB port, used for the latency probe.
const SMB_PORT: u16 = 445;

#[derive(Clone, Debug, Deserialize)]
pub struct Target {
    pub id: u32,
    /// UNC folder, e.g. `\\192.168.2.11\d3 Projects\show\objects`.
    pub path: String,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct TestOpts {
    #[serde(default = "default_size")]
    pub size_mb: u64,
    #[serde(default = "default_threads")]
    pub threads: usize,
    /// "read", "write" or "both".
    #[serde(default = "default_mode")]
    pub mode: String,
}

fn default_size() -> u64 {
    512
}

fn default_threads() -> usize {
    4
}

fn default_mode() -> String {
    "read".to_string()
}

#[derive(Serialize, Clone)]
pub struct TargetResult {
    pub id: u32,
    pub path: String,
    pub label: Option<String>,
    pub read_mbps: Option<f64>,
    pub write_mbps: Option<f64>,
    pub latency_ms: Option<f64>,
    /// Bytes actually moved, so a shortened run is visible rather than silently
    /// scaled.
    pub read_bytes: u64,
    pub write_bytes: u64,
    /// Local address the traffic actually left from, and its adapter.
    pub via_ip: Option<String>,
    pub via_adapter: Option<String>,
    pub error: Option<String>,
    /// Why a number is lower than asked for, when it is.
    pub note: Option<String>,
}

impl TargetResult {
    fn blank(t: &Target) -> Self {
        Self {
            id: t.id,
            path: t.path.clone(),
            label: t.label.clone(),
            read_mbps: None,
            write_mbps: None,
            latency_ms: None,
            read_bytes: 0,
            write_bytes: 0,
            via_ip: None,
            via_adapter: None,
            error: None,
            note: None,
        }
    }
}

/// Host part of a UNC path: `\\host\share\...` → `host`.
pub fn host_of(unc: &str) -> Option<String> {
    let rest = unc.strip_prefix(r"\\").or_else(|| unc.strip_prefix("//"))?;
    let host = rest.split(['\\', '/']).next()?;
    if host.is_empty() {
        None
    } else {
        Some(host.to_string())
    }
}

/// Time to open a TCP connection to the file-sharing port.
///
/// Not ICMP on purpose: a ping says the host is up, this says the service
/// answers — and raw sockets would need privileges the app should not ask for.
fn latency(host: &str) -> Option<f64> {
    let addr = (host, SMB_PORT).to_socket_addrs().ok()?.next()?;
    let started = Instant::now();
    TcpStream::connect_timeout(&addr, Duration::from_secs(3)).ok()?;
    Some(started.elapsed().as_secs_f64() * 1000.0)
}

/// Which local address — and therefore which adapter — traffic to this host
/// will leave from.
///
/// A connected UDP socket sends nothing, but the kernel still resolves the
/// route to pick a source address, and that is exactly the answer. It matters
/// because an app cannot choose the adapter for a file share: Windows decides
/// by routing metric, and on a machine with a 10 GbE card next to a gigabit
/// dongle the wrong one is an easy mistake to make — and an invisible one.
pub fn route_via(host: &str) -> Option<(String, Option<String>)> {
    let addr = (host, SMB_PORT).to_socket_addrs().ok()?.next()?;
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect(addr).ok()?;
    let local = sock.local_addr().ok()?.ip().to_string();

    let adapter = if_addrs::get_if_addrs()
        .ok()?
        .into_iter()
        .find(|i| i.ip().to_string() == local)
        .map(|i| i.name);

    Some((local, adapter))
}

/// Stop scanning after this many entries. A show folder can hold tens of
/// thousands of files, and the search must not outlast the measurement.
const MAX_SCAN: usize = 20_000;

/// Find a file to stream a read test from.
///
/// Walks subfolders, because media rarely sits at the top level of a project
/// folder, and stops at the first file large enough — which on a show drive is
/// usually the first clip it meets. Whatever was biggest is returned if nothing
/// reaches the target, so the caller can explain the shortfall with numbers.
fn find_read_source(dir: &Path, want: u64) -> Option<(PathBuf, u64)> {
    let mut best: Option<(PathBuf, u64)> = None;
    let mut stack = vec![dir.to_path_buf()];
    let mut seen = 0usize;

    while let Some(current) = stack.pop() {
        let Ok(listing) = fs::read_dir(&current) else {
            continue;
        };

        for entry in listing.flatten() {
            seen += 1;
            if seen > MAX_SCAN {
                return best;
            }

            let Ok(meta) = entry.metadata() else {
                continue;
            };

            if meta.is_dir() {
                stack.push(entry.path());
                continue;
            }

            let len = meta.len();
            if len >= want {
                return Some((entry.path(), len));
            }
            if best.as_ref().map_or(true, |(_, b)| len > *b) {
                best = Some((entry.path(), len));
            }
        }
    }

    best
}

#[derive(Debug)]
struct Measured {
    bytes: u64,
    seconds: f64,
    note: Option<String>,
}

fn mbps(m: &Measured) -> f64 {
    if m.seconds <= 0.0 {
        return 0.0;
    }
    (m.bytes as f64 / (1024.0 * 1024.0)) / m.seconds
}

/// Read `size` bytes from one file, split across `threads` streams starting at
/// different offsets.
///
/// Different offsets matter: hammering the same region would be served from the
/// server's RAM cache and measure memory rather than the path to it.
fn measure_read(dir: &Path, size: u64, threads: usize, cancel: &Arc<AtomicBool>) -> Result<Measured, String> {
    let threads = threads.max(1);
    let mb = |bytes: u64| bytes / (1024 * 1024);

    let (file, file_len) = find_read_source(dir, size)
        .ok_or_else(|| "no files here to read from — try write mode instead".to_string())?;

    let mut note = None;

    // Each stream gets its own slice of the file; if the file is too small for
    // the requested volume, the run shrinks rather than re-reading cache.
    let mut per_thread = size / threads as u64;
    let slice = file_len / threads as u64;
    if per_thread > slice {
        per_thread = slice;
        note = Some(format!(
            "largest file is {} MB, so only {} MB was read",
            mb(file_len),
            mb(slice * threads as u64).max(1)
        ));
    }

    // Below one block there is nothing left to time: say what was found and
    // what would work, rather than just refusing.
    if per_thread < BLOCK as u64 {
        return Err(format!(
            "largest file here is {} MB — too small for {} streams. Use fewer streams, a smaller size, or point at a folder with media",
            mb(file_len),
            threads
        ));
    }

    let started = Instant::now();
    let mut handles = Vec::with_capacity(threads);

    for i in 0..threads {
        let path = file.clone();
        let cancel = cancel.clone();
        let offset = slice * i as u64;

        handles.push(std::thread::spawn(move || -> Result<u64, String> {
            let mut f = fs::File::open(&path).map_err(|e| e.to_string())?;
            f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;

            let mut buf = vec![0u8; BLOCK];
            let mut done: u64 = 0;

            while done < per_thread {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                let want = ((per_thread - done) as usize).min(BLOCK);
                match f.read(&mut buf[..want]) {
                    Ok(0) => break,
                    Ok(n) => done += n as u64,
                    Err(e) => return Err(e.to_string()),
                }
            }

            Ok(done)
        }));
    }

    let mut bytes = 0u64;
    for h in handles {
        bytes += h.join().map_err(|_| "read thread panicked".to_string())??;
    }

    Ok(Measured {
        bytes,
        seconds: started.elapsed().as_secs_f64(),
        note,
    })
}

/// Write `size` bytes as `threads` temporary files, then delete them.
///
/// Every file is flushed and synced before the clock stops: without that the
/// number would describe the client's write cache, not the server.
fn measure_write(dir: &Path, size: u64, threads: usize, cancel: &Arc<AtomicBool>) -> Result<Measured, String> {
    let threads = threads.max(1);
    let per_thread = (size / threads as u64).max(BLOCK as u64);

    // Not compressible: some arrays and some SMB setups compress in flight, and
    // a buffer of zeroes would measure the compressor.
    let mut block = vec![0u8; BLOCK];
    let mut seed = 0x2545_F491_4F6C_DD1Du64;
    for chunk in block.chunks_mut(8) {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        for (b, s) in chunk.iter_mut().zip(seed.to_le_bytes()) {
            *b = s;
        }
    }
    let block = Arc::new(block);

    let started = Instant::now();
    let mut handles = Vec::with_capacity(threads);

    for i in 0..threads {
        let path = dir.join(format!("{TMP_PREFIX}-{i}.tmp"));
        let cancel = cancel.clone();
        let block = block.clone();

        handles.push(std::thread::spawn(move || -> (Result<u64, String>, PathBuf) {
            let run = || -> Result<u64, String> {
                let mut f = fs::File::create(&path).map_err(|e| e.to_string())?;
                let mut done: u64 = 0;

                while done < per_thread {
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }
                    let want = ((per_thread - done) as usize).min(BLOCK);
                    f.write_all(&block[..want]).map_err(|e| e.to_string())?;
                    done += want as u64;
                }

                f.flush().map_err(|e| e.to_string())?;
                f.sync_all().map_err(|e| e.to_string())?;
                Ok(done)
            };

            let outcome = run();
            (outcome, path)
        }));
    }

    let mut bytes = 0u64;
    let mut failure: Option<String> = None;

    for h in handles {
        let (outcome, path) = h.join().map_err(|_| "write thread panicked".to_string())?;
        // Clean up whatever was created, including after a failure: leftovers
        // in a show folder are worse than a missing measurement.
        let _ = fs::remove_file(&path);
        match outcome {
            Ok(n) => bytes += n,
            Err(e) => {
                failure.get_or_insert(e);
            }
        }
    }

    if let Some(e) = failure {
        return Err(e);
    }

    Ok(Measured {
        bytes,
        seconds: started.elapsed().as_secs_f64(),
        note: None,
    })
}

/// Run one target. Cheap checks first, so an unreachable share fails in
/// milliseconds instead of after a timeout on a large read.
pub fn run_target(target: &Target, opts: &TestOpts, cancel: &Arc<AtomicBool>) -> TargetResult {
    let mut out = TargetResult::blank(target);
    let dir = PathBuf::from(&target.path);

    if let Some(host) = host_of(&target.path) {
        out.latency_ms = latency(&host);
        if let Some((ip, adapter)) = route_via(&host) {
            out.via_ip = Some(ip);
            out.via_adapter = adapter;
        }
    }

    if !dir.is_dir() {
        out.error = Some("folder is not reachable".to_string());
        return out;
    }

    let size = opts.size_mb.clamp(16, 16 * 1024) * 1024 * 1024;
    let threads = opts.threads.clamp(1, 32);
    let wants_read = opts.mode != "write";
    let wants_write = opts.mode == "write" || opts.mode == "both";

    if wants_read {
        match measure_read(&dir, size, threads, cancel) {
            Ok(m) => {
                out.read_mbps = Some(mbps(&m));
                out.read_bytes = m.bytes;
                out.note = m.note;
            }
            Err(e) => out.error = Some(e),
        }
    }

    if wants_write && !cancel.load(Ordering::Relaxed) {
        match measure_write(&dir, size, threads, cancel) {
            Ok(m) => {
                out.write_mbps = Some(mbps(&m));
                out.write_bytes = m.bytes;
            }
            Err(e) => {
                let msg = format!("write: {e}");
                out.error = Some(match out.error.take() {
                    Some(prev) => format!("{prev}; {msg}"),
                    None => msg,
                });
            }
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_host_from_unc() {
        assert_eq!(host_of(r"\\192.168.2.11\share\deep\path").as_deref(), Some("192.168.2.11"));
        assert_eq!(host_of(r"\\server01\d3 Projects").as_deref(), Some("server01"));
        assert_eq!(host_of("//10.0.0.5/share").as_deref(), Some("10.0.0.5"));
    }

    /// The route lookup must name a real local address: the whole point is
    /// telling a 10 GbE card from a gigabit dongle.
    #[test]
    fn resolves_route_to_a_local_address() {
        let (ip, _adapter) = route_via("127.0.0.1").expect("loopback should resolve");
        assert_eq!(ip, "127.0.0.1");

        let locals: Vec<String> = if_addrs::get_if_addrs()
            .unwrap()
            .into_iter()
            .map(|i| i.ip().to_string())
            .collect();
        assert!(locals.contains(&ip), "source address should belong to this machine");
    }

    #[test]
    fn rejects_non_unc_paths() {
        assert_eq!(host_of(r"D:\local\folder"), None);
        assert_eq!(host_of(r"\\"), None);
        assert_eq!(host_of(""), None);
    }

    /// A local round trip proves the measurement path itself works: write,
    /// read back, clean up.
    #[test]
    fn measures_a_local_folder() {
        let dir = std::env::temp_dir().join("reticle-netspeed-test");
        fs::create_dir_all(&dir).unwrap();

        let cancel = Arc::new(AtomicBool::new(false));
        let size = 32 * 1024 * 1024;

        let written = measure_write(&dir, size, 2, &cancel).expect("write should succeed");
        assert!(written.bytes >= size, "all requested bytes should be written");
        assert!(mbps(&written) > 0.0);

        // Write leaves nothing behind, so a read test needs its own file.
        let payload = vec![7u8; (size + 8 * 1024 * 1024) as usize];
        fs::write(dir.join("payload.bin"), &payload).unwrap();

        let read = measure_read(&dir, size, 2, &cancel).expect("read should succeed");
        assert!(read.bytes > 0);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_test_leaves_nothing_behind() {
        let dir = std::env::temp_dir().join("reticle-netspeed-cleanup");
        fs::create_dir_all(&dir).unwrap();

        let cancel = Arc::new(AtomicBool::new(false));
        measure_write(&dir, 16 * 1024 * 1024, 2, &cancel).unwrap();

        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains(TMP_PREFIX))
            .collect();

        assert!(leftovers.is_empty(), "temporary files must be removed");
        fs::remove_dir_all(&dir).ok();
    }

    /// Media lives in subfolders of a project folder, not at its top level —
    /// the original version missed exactly this and reported "too small".
    #[test]
    fn finds_media_inside_subfolders() {
        let root = std::env::temp_dir().join("reticle-netspeed-nested");
        let deep = root.join("scene01").join("renders");
        fs::create_dir_all(&deep).unwrap();

        // A small file at the top, the real one buried two levels down.
        fs::write(root.join("notes.txt"), b"small").unwrap();
        fs::write(deep.join("clip.mov"), vec![3u8; 24 * 1024 * 1024]).unwrap();

        let found = find_read_source(&root, 16 * 1024 * 1024).expect("should find the clip");
        assert_eq!(found.0.file_name().unwrap(), "clip.mov");

        let cancel = Arc::new(AtomicBool::new(false));
        let m = measure_read(&root, 16 * 1024 * 1024, 2, &cancel).expect("read should work");
        assert!(m.bytes > 0);

        fs::remove_dir_all(&root).ok();
    }

    /// When nothing is big enough, the message must carry the numbers — the
    /// old wording left no way to tell what to do about it.
    #[test]
    fn explains_when_files_are_too_small() {
        let dir = std::env::temp_dir().join("reticle-netspeed-tiny");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("tiny.bin"), vec![1u8; 1024]).unwrap();

        let cancel = Arc::new(AtomicBool::new(false));
        let err = measure_read(&dir, 512 * 1024 * 1024, 4, &cancel).unwrap_err();

        assert!(err.contains("MB"), "message should state the size found: {err}");
        assert!(err.contains("streams"), "message should hint at a fix: {err}");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn empty_folder_reports_why() {
        let dir = std::env::temp_dir().join("reticle-netspeed-empty");
        fs::create_dir_all(&dir).unwrap();

        let cancel = Arc::new(AtomicBool::new(false));
        let err = measure_read(&dir, 32 * 1024 * 1024, 2, &cancel).unwrap_err();
        assert!(err.contains("no files"), "got: {err}");

        fs::remove_dir_all(&dir).ok();
    }
}
