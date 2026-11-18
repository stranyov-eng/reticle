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
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering};
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

/// Said when a filesystem refuses unbuffered access, so the figure is known to
/// be suspect rather than quietly wrong.
const CACHE_NOTE: &str = "cache could not be bypassed — the figure may be inflated";

/// Sector alignment that unbuffered I/O requires: offsets, lengths and the
/// buffer address all have to be multiples of this.
const ALIGN: usize = 4096;

/// Bypass the cache. Without it a second pass over the same file is served
/// from the client's RAM and reports memory bandwidth — 6 GB/s over a 10 GbE
/// link, which is nonsense, but nonsense that looks like a result.
#[cfg(windows)]
const FILE_FLAG_NO_BUFFERING: u32 = 0x2000_0000;
#[cfg(windows)]
const FILE_FLAG_WRITE_THROUGH: u32 = 0x8000_0000;

/// A buffer whose start address is sector-aligned, as unbuffered I/O demands.
///
/// Over-allocates and takes an aligned window inside: all of it stays within
/// one `Vec`, so there is no raw allocation to get wrong.
struct AlignedBuf {
    raw: Vec<u8>,
    start: usize,
    len: usize,
}

impl AlignedBuf {
    fn new(len: usize) -> Self {
        let raw = vec![0u8; len + ALIGN];
        let start = (ALIGN - (raw.as_ptr() as usize % ALIGN)) % ALIGN;
        Self { raw, start, len }
    }

    fn as_mut(&mut self) -> &mut [u8] {
        &mut self.raw[self.start..self.start + self.len]
    }

    fn fill_incompressible(&mut self) {
        let mut seed = 0x2545_F491_4F6C_DD1Du64;
        for chunk in self.as_mut().chunks_mut(8) {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            for (b, s) in chunk.iter_mut().zip(seed.to_le_bytes()) {
                *b = s;
            }
        }
    }
}

/// Open for reading past the cache, falling back to a normal open where the
/// filesystem refuses. The fallback is reported, because a cached number is
/// worth knowing about rather than silently trusting.
///
/// `bypass` turns the flag off deliberately. That is not a worse measurement,
/// it is a different one: on SMB 3.0.2 and later the unbuffered flag travels to
/// the far side as `SMB2_READFLAG_READ_UNBUFFERED`, so the server skips its own
/// cache too and the figure includes its disk. Running the same test both ways
/// is what separates a slow link from a slow array.
fn open_read(path: &Path, bypass: bool) -> std::io::Result<(fs::File, bool)> {
    if !bypass {
        return fs::File::open(path).map(|f| (f, false));
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        match fs::OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_NO_BUFFERING)
            .open(path)
        {
            Ok(f) => return Ok((f, true)),
            Err(_) => return fs::File::open(path).map(|f| (f, false)),
        }
    }
    #[cfg(not(windows))]
    {
        fs::File::open(path).map(|f| (f, false))
    }
}

/// Create for writing past the cache, so the clock measures the server rather
/// than the client's write-behind buffer.
fn create_write(path: &Path, bypass: bool) -> std::io::Result<(fs::File, bool)> {
    if !bypass {
        return fs::File::create(path).map(|f| (f, false));
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        match fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .custom_flags(FILE_FLAG_NO_BUFFERING | FILE_FLAG_WRITE_THROUGH)
            .open(path)
        {
            Ok(f) => return Ok((f, true)),
            Err(_) => return fs::File::create(path).map(|f| (f, false)),
        }
    }
    #[cfg(not(windows))]
    {
        fs::File::create(path).map(|f| (f, false))
    }
}

/// TCP retransmissions, which is the question "is the wire delivering?" asked
/// in a number.
///
/// A link that is merely configured badly moves data slowly and retransmits
/// nothing; a bad transceiver, a dirty strand or a broken offload retransmits
/// constantly. The two look identical in a throughput figure and nothing alike
/// here, which is the whole reason to collect it.
///
/// The counter is machine-wide — Windows exposes no cheap per-connection
/// equivalent — so it is only read as a delta across one target's measurement,
/// where this test is what the machine is doing.
#[cfg(windows)]
mod tcpstat {
    /// `MIB_TCPSTATS`: fifteen DWORDs, of which one is wanted.
    #[repr(C)]
    struct MibTcpStats {
        fields: [u32; 15],
    }

    /// Index of `dwRetransSegs`.
    const RETRANS_SEGS: usize = 11;
    /// `AF_INET`.
    const AF_INET: u32 = 2;

    #[link(name = "iphlpapi")]
    extern "system" {
        fn GetTcpStatisticsEx(stats: *mut MibTcpStats, family: u32) -> u32;
    }

    pub fn retrans_segs() -> Option<u32> {
        let mut stats = MibTcpStats { fields: [0; 15] };
        let rc = unsafe { GetTcpStatisticsEx(&mut stats, AF_INET) };
        (rc == 0).then(|| stats.fields[RETRANS_SEGS])
    }
}

#[cfg(not(windows))]
mod tcpstat {
    pub fn retrans_segs() -> Option<u32> {
        None
    }
}

/// Retransmissions since `before`, or `None` where the counter is unavailable.
///
/// The counter is a 32-bit value that wraps, so the difference is taken with
/// wrapping arithmetic rather than a subtraction that would panic or go
/// negative on a machine that has been up long enough.
fn retrans_delta(before: u32, now: u32) -> u64 {
    now.wrapping_sub(before) as u64
}

fn retrans_since(before: Option<u32>) -> Option<u64> {
    let before = before?;
    Some(retrans_delta(before, tcpstat::retrans_segs()?))
}

/// Round down to a sector boundary.
fn align_down(value: u64) -> u64 {
    value - (value % ALIGN as u64)
}

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
    /// "roundtrip", "read", "write" or "both".
    #[serde(default = "default_mode")]
    pub mode: String,
    /// Whether to ask for unbuffered I/O. Off measures the same path with every
    /// cache in play, and the pair of figures is the diagnosis.
    #[serde(default = "default_bypass")]
    pub bypass_cache: bool,
}

fn default_bypass() -> bool {
    true
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

pub const PHASE_IDLE: u8 = 0;
pub const PHASE_PROBE: u8 = 1;
pub const PHASE_READ: u8 = 2;
pub const PHASE_WRITE: u8 = 3;

/// Live counters for the run in flight.
///
/// A 512 MB read over a slow link takes the better part of a minute, and a
/// table that sits blank for that long is indistinguishable from a hung app.
/// The measuring threads bump these counters; a ticker elsewhere samples them,
/// so reporting costs the measurement nothing and cannot slow it down.
#[derive(Default)]
pub struct Progress {
    /// Target currently being measured.
    pub target: AtomicU32,
    /// Bytes moved so far in the current phase.
    pub done: AtomicU64,
    /// Bytes this phase intends to move. Zero while probing, where there is
    /// nothing to count.
    pub total: AtomicU64,
    pub phase: AtomicU8,
}

/// A sampled view of `Progress`, ready to go to the interface.
#[derive(Serialize, Clone)]
pub struct ProgressSnap {
    pub id: u32,
    pub phase: &'static str,
    pub done: u64,
    pub total: u64,
}

impl Progress {
    /// The order matters. These are four separate stores and the sampler reads
    /// them without a lock, so it can catch the gap between any two. Clearing
    /// the total first means every torn reading is of a phase that has moved
    /// nothing yet — which is harmless — rather than of a fresh target wearing
    /// the previous one's finished counters, which made the bar lurch forward
    /// a whole target and then fall back.
    fn begin(&self, phase: u8, total: u64) {
        self.total.store(0, Ordering::Relaxed);
        self.done.store(0, Ordering::Relaxed);
        self.phase.store(phase, Ordering::Relaxed);
        self.total.store(total, Ordering::Relaxed);
    }

    fn add(&self, bytes: u64) {
        self.done.fetch_add(bytes, Ordering::Relaxed);
    }

    /// Counters are cleared before the target moves, for the same reason: a
    /// reading taken mid-change should show the old target at a standstill,
    /// never the new one already finished.
    pub fn enter(&self, id: u32) {
        self.begin(PHASE_PROBE, 0);
        self.target.store(id, Ordering::Relaxed);
    }

    pub fn finish(&self) {
        self.begin(PHASE_IDLE, 0);
    }

    pub fn snapshot(&self) -> ProgressSnap {
        ProgressSnap {
            id: self.target.load(Ordering::Relaxed),
            phase: match self.phase.load(Ordering::Relaxed) {
                PHASE_PROBE => "probe",
                PHASE_READ => "read",
                PHASE_WRITE => "write",
                _ => "idle",
            },
            done: self.done.load(Ordering::Relaxed),
            total: self.total.load(Ordering::Relaxed),
        }
    }
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
    /// Which file the read was streamed from, relative to the target folder,
    /// and how big it is. Two servers measured against different files are not
    /// comparable, and without this the difference is invisible.
    pub read_file: Option<String>,
    pub read_file_bytes: u64,
    /// TCP retransmissions during each phase. Thousands point at the wire or a
    /// driver; none at all points at configuration.
    pub read_retrans: Option<u64>,
    pub write_retrans: Option<u64>,
    /// Local address the traffic actually left from, and its adapter.
    pub via_ip: Option<String>,
    pub via_adapter: Option<String>,
    /// Machine name behind the address, when the network can tell us.
    pub host_name: Option<String>,
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
            read_file: None,
            read_file_bytes: 0,
            read_retrans: None,
            write_retrans: None,
            via_ip: None,
            host_name: None,
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

/// Machine name behind an address, via reverse DNS.
///
/// On a show network this is how a row stops being `192.168.2.14` and starts
/// being `03-floor`: the names are already there, nobody wants to retype them,
/// and a mistyped label is worse than none.
///
/// Returns `None` when there is no record, which is normal on networks without
/// a DNS server — the address still works, it just stays unlabelled.
pub fn host_name(host: &str) -> Option<String> {
    let ip: std::net::IpAddr = host.parse().ok()?;
    let name = dns_lookup::lookup_addr(&ip).ok()?;

    // A lookup with no record often echoes the address back; that is not a name.
    if name == host || name.is_empty() {
        return None;
    }

    // Strip the domain: on a show network the short name is the useful part.
    Some(name.split('.').next().unwrap_or(&name).to_string())
}

/// Resolve several hosts at once.
///
/// In parallel because a lookup without a record waits for the resolver to give
/// up, and nine of those in a row would stall the interface for seconds.
pub fn resolve_hosts(hosts: Vec<String>) -> Vec<Option<String>> {
    let handles: Vec<_> = hosts
        .into_iter()
        .map(|h| std::thread::spawn(move || host_name(&h)))
        .collect();

    handles
        .into_iter()
        .map(|h| h.join().unwrap_or(None))
        .collect()
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
    /// Set by the read path only: the file the figure came from.
    file: Option<String>,
    file_bytes: u64,
    retrans: Option<u64>,
}

/// Keep both remarks when a measurement has two things to say about itself.
fn merge_note(first: Option<String>, second: Option<String>) -> Option<String> {
    match (first, second) {
        (Some(a), Some(b)) => Some(format!("{a}; {b}")),
        (Some(a), None) => Some(a),
        (None, b) => b,
    }
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
fn measure_read(
    dir: &Path,
    size: u64,
    threads: usize,
    bypass: bool,
    cancel: &Arc<AtomicBool>,
    progress: &Arc<Progress>,
) -> Result<Measured, String> {
    let threads = threads.max(1);
    let mb = |bytes: u64| bytes / (1024 * 1024);

    let (file, file_len) = find_read_source(dir, size)
        .ok_or_else(|| "no files here to read from — try write mode instead".to_string())?;

    // Shown relative to the target folder: the subfolder is half the answer
    // when one server reads at a tenth of the others.
    let shown = file
        .strip_prefix(dir)
        .unwrap_or(&file)
        .to_string_lossy()
        .into_owned();

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

    // Unbuffered I/O only accepts whole sectors, so the volume per stream is
    // trimmed to a multiple of the block size.
    let per_thread = align_down(per_thread - (per_thread % BLOCK as u64)).max(BLOCK as u64);

    progress.begin(PHASE_READ, per_thread * threads as u64);

    let retrans_before = tcpstat::retrans_segs();
    let started = Instant::now();
    let mut handles = Vec::with_capacity(threads);

    for i in 0..threads {
        let path = file.clone();
        let cancel = cancel.clone();
        let progress = progress.clone();
        let offset = align_down(slice * i as u64);

        handles.push(std::thread::spawn(move || -> Result<(u64, bool), String> {
            let (mut f, unbuffered) = open_read(&path, bypass).map_err(|e| e.to_string())?;
            f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;

            let mut buf = AlignedBuf::new(BLOCK);
            let mut done: u64 = 0;

            while done < per_thread {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                // Always a whole block: a short read would be rejected
                // outright when the cache is bypassed.
                match f.read(buf.as_mut()) {
                    Ok(0) => break,
                    Ok(n) => {
                        done += n as u64;
                        progress.add(n as u64);
                    }
                    Err(e) => return Err(e.to_string()),
                }
            }

            Ok((done, unbuffered))
        }));
    }

    let mut out = collect(handles, started, "read", bypass, retrans_before)?;

    // Two things can be worth saying at once: that the file was too small, and
    // that the cache could not be got out of the way.
    out.note = merge_note(note, out.note);
    out.file = Some(shown);
    out.file_bytes = file_len;

    Ok(out)
}

/// Volume per stream, trimmed to whole blocks as unbuffered I/O demands.
fn per_stream(size: u64, threads: usize) -> u64 {
    let raw = (size / threads as u64).max(BLOCK as u64);
    (raw - (raw % BLOCK as u64)).max(BLOCK as u64)
}

/// Where a write test puts its files: one per stream, so the streams never
/// contend for the same file handle.
fn tmp_paths(dir: &Path, threads: usize) -> Vec<PathBuf> {
    (0..threads)
        .map(|i| dir.join(format!("{TMP_PREFIX}-{i}.tmp")))
        .collect()
}

/// Remove whatever a write left behind, success or failure: leftovers in a show
/// folder are worse than a missing measurement.
fn sweep(paths: &[PathBuf]) {
    for path in paths {
        let _ = fs::remove_file(path);
    }
}

/// Join every stream, add up what each moved and stop the clock once the last
/// one is done — not when the first one is.
fn collect(
    handles: Vec<std::thread::JoinHandle<Result<(u64, bool), String>>>,
    started: Instant,
    what: &str,
    wanted_bypass: bool,
    retrans_before: Option<u32>,
) -> Result<Measured, String> {
    let mut bytes = 0u64;
    let mut refused = false;
    let mut failure: Option<String> = None;

    for handle in handles {
        match handle.join().map_err(|_| format!("{what} thread panicked"))? {
            Ok((n, unbuffered)) => {
                bytes += n;
                // Only a refusal is worth saying. Buffered because the operator
                // asked for buffered is not a caveat, it is the test.
                if wanted_bypass && !unbuffered {
                    refused = true;
                }
            }
            Err(e) => {
                failure.get_or_insert(e);
            }
        }
    }

    let seconds = started.elapsed().as_secs_f64();
    let retrans = retrans_since(retrans_before);

    if let Some(e) = failure {
        return Err(e);
    }

    Ok(Measured {
        bytes,
        seconds,
        note: refused.then(|| CACHE_NOTE.to_string()),
        file: None,
        file_bytes: 0,
        retrans,
    })
}

/// Write `per_thread` bytes to each path and leave the files in place: the
/// caller decides whether to read them back before sweeping them.
///
/// Every file is flushed and synced before the clock stops: without that the
/// number would describe the client's write cache, not the server.
fn write_streams(
    paths: &[PathBuf],
    per_thread: u64,
    bypass: bool,
    cancel: &Arc<AtomicBool>,
    progress: &Arc<Progress>,
) -> Result<Measured, String> {
    progress.begin(PHASE_WRITE, per_thread * paths.len() as u64);

    let retrans_before = tcpstat::retrans_segs();
    let started = Instant::now();
    let mut handles = Vec::with_capacity(paths.len());

    for path in paths {
        let path = path.clone();
        let cancel = cancel.clone();
        let progress = progress.clone();

        handles.push(std::thread::spawn(move || -> Result<(u64, bool), String> {
            let (mut f, unbuffered) = create_write(&path, bypass).map_err(|e| e.to_string())?;

            // Incompressible: some arrays and some SMB setups compress in
            // flight, and a buffer of zeroes would measure the compressor.
            // Built per thread so the streams do not share one page.
            let mut buf = AlignedBuf::new(BLOCK);
            buf.fill_incompressible();

            let mut done: u64 = 0;
            while done < per_thread {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                f.write_all(buf.as_mut()).map_err(|e| e.to_string())?;
                done += BLOCK as u64;
                progress.add(BLOCK as u64);
            }

            f.flush().map_err(|e| e.to_string())?;
            f.sync_all().map_err(|e| e.to_string())?;
            Ok((done, unbuffered))
        }));
    }

    collect(handles, started, "write", bypass, retrans_before)
}

/// Read the given files back, one stream per file.
fn read_streams(
    paths: &[PathBuf],
    per_thread: u64,
    bypass: bool,
    cancel: &Arc<AtomicBool>,
    progress: &Arc<Progress>,
) -> Result<Measured, String> {
    progress.begin(PHASE_READ, per_thread * paths.len() as u64);

    let retrans_before = tcpstat::retrans_segs();
    let started = Instant::now();
    let mut handles = Vec::with_capacity(paths.len());

    for path in paths {
        let path = path.clone();
        let cancel = cancel.clone();
        let progress = progress.clone();

        handles.push(std::thread::spawn(move || -> Result<(u64, bool), String> {
            let (mut f, unbuffered) = open_read(&path, bypass).map_err(|e| e.to_string())?;
            let mut buf = AlignedBuf::new(BLOCK);
            let mut done: u64 = 0;

            while done < per_thread {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                match f.read(buf.as_mut()) {
                    Ok(0) => break,
                    Ok(n) => {
                        done += n as u64;
                        progress.add(n as u64);
                    }
                    Err(e) => return Err(e.to_string()),
                }
            }

            Ok((done, unbuffered))
        }));
    }

    collect(handles, started, "read", bypass, retrans_before)
}

/// Write `size` bytes as `threads` temporary files, then delete them.
fn measure_write(
    dir: &Path,
    size: u64,
    threads: usize,
    bypass: bool,
    cancel: &Arc<AtomicBool>,
    progress: &Arc<Progress>,
) -> Result<Measured, String> {
    let threads = threads.max(1);
    let paths = tmp_paths(dir, threads);
    let out = write_streams(&paths, per_stream(size, threads), bypass, cancel, progress);
    sweep(&paths);
    out
}

/// Write temporary files, read them straight back, then delete them.
///
/// Self-contained, which is the point: nothing has to already exist on the far
/// side, and every server is measured against byte-identical files of the same
/// size. The read test on real media can promise none of that — it takes the
/// first file large enough that it finds, so two servers can end up compared
/// against entirely different files on entirely different volumes.
///
/// What it measures is the **path** — NIC, cable, switch, SMB stack — and not
/// the array: data written a second ago is still in the server's own RAM, and
/// no flag a client can set will make the server forget it. For "is this really
/// 10 GbE everywhere" that is the right trade, and arguably the better test,
/// because the disk stops being a variable. For "why does this copy crawl" it
/// is the wrong one, and the read test on real media answers that instead.
fn measure_roundtrip(
    dir: &Path,
    size: u64,
    threads: usize,
    bypass: bool,
    cancel: &Arc<AtomicBool>,
    progress: &Arc<Progress>,
) -> Result<(Measured, Measured), String> {
    let threads = threads.max(1);
    let per_thread = per_stream(size, threads);
    let paths = tmp_paths(dir, threads);

    let write = match write_streams(&paths, per_thread, bypass, cancel, progress) {
        Ok(w) => w,
        Err(e) => {
            sweep(&paths);
            return Err(e);
        }
    };

    let read = read_streams(&paths, per_thread, bypass, cancel, progress);
    sweep(&paths);

    let mut read = read?;
    // Named so the file column does not sit empty, and so it is obvious at a
    // glance that this figure did not come from the show's own media.
    read.file = Some(format!("{TMP_PREFIX}-*.tmp"));
    read.file_bytes = per_thread;

    Ok((write, read))
}

/// What the reachability probe found, carried back from its own thread.
#[derive(Default)]
struct Probe {
    host_name: Option<String>,
    latency_ms: Option<f64>,
    via_ip: Option<String>,
    via_adapter: Option<String>,
    /// The host answered on the file-sharing port — or there was no host to
    /// ask, the path being a local or already-mapped one.
    answered: bool,
    /// The folder is there. Only ever asked when the host answered.
    is_dir: bool,
}

/// Wait for blocking work on a thread of its own, giving up the moment the run
/// is cancelled.
///
/// Reaching a host that is not there is the one part of a run that cannot be
/// cut into cancellable steps: a TCP connect, a reverse lookup and a stat of a
/// UNC path are each a single blocking call inside the kernel, and nothing
/// short of its own timeout returns from one. Doing that work here makes Stop
/// a no-op for as long as it takes — which is exactly how it behaved. Waiting
/// on a channel instead leaves the wait interruptible. The abandoned thread
/// finishes into a dropped receiver and ends on its own.
fn interruptible<T, F>(cancel: &Arc<AtomicBool>, work: F) -> Option<T>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    use std::sync::mpsc::RecvTimeoutError;

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(work());
    });

    loop {
        if cancel.load(Ordering::Relaxed) {
            return None;
        }
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(v) => return Some(v),
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => return None,
        }
    }
}

/// Everything that has to touch the network before measuring can start.
///
/// Ordered so the cheap answer comes first: a host that does not answer on 445
/// has no share to reach, and asking the filesystem anyway only spends the SMB
/// client's own timeout on top of the one already spent.
fn probe_target(path: &str, dir: &Path) -> Probe {
    let mut p = Probe::default();

    match host_of(path) {
        Some(host) => {
            p.latency_ms = latency(&host);
            p.answered = p.latency_ms.is_some();
            // Worth having even for a host that did not answer: which adapter
            // the attempt left from is half the diagnosis.
            if let Some((ip, adapter)) = route_via(&host) {
                p.via_ip = Some(ip);
                p.via_adapter = adapter;
            }
            if p.answered {
                p.host_name = host_name(&host);
            }
        }
        // A drive letter or a local folder: nothing to gate on.
        None => p.answered = true,
    }

    p.is_dir = p.answered && dir.is_dir();
    p
}

/// Run one target. Cheap checks first, so an unreachable share fails in
/// milliseconds instead of after a timeout on a large read.
///
/// `None` means the run was stopped partway: no result is better than a figure
/// taken from an interrupted transfer.
pub fn run_target(
    target: &Target,
    opts: &TestOpts,
    cancel: &Arc<AtomicBool>,
    progress: &Arc<Progress>,
) -> Option<TargetResult> {
    let mut out = TargetResult::blank(target);
    let dir = PathBuf::from(&target.path);

    let probe = {
        let path = target.path.clone();
        let dir = dir.clone();
        interruptible(cancel, move || probe_target(&path, &dir))?
    };

    out.host_name = probe.host_name;
    out.latency_ms = probe.latency_ms;
    out.via_ip = probe.via_ip;
    out.via_adapter = probe.via_adapter;

    if !probe.answered {
        out.error = Some(format!("host did not answer on port {SMB_PORT}"));
        return Some(out);
    }

    if !probe.is_dir {
        out.error = Some("folder is not reachable".to_string());
        return Some(out);
    }

    let size = opts.size_mb.clamp(16, 16 * 1024) * 1024 * 1024;
    let threads = opts.threads.clamp(1, 32);
    let bypass = opts.bypass_cache;
    // The round trip is its own thing: it writes and reads the same files, so
    // it cannot be assembled out of the other two.
    if opts.mode == "roundtrip" {
        match measure_roundtrip(&dir, size, threads, bypass, cancel, progress) {
            Ok((write, read)) => {
                out.write_mbps = Some(mbps(&write));
                out.write_bytes = write.bytes;
                out.write_retrans = write.retrans;
                out.read_mbps = Some(mbps(&read));
                out.read_bytes = read.bytes;
                out.read_retrans = read.retrans;
                out.read_file = read.file;
                out.read_file_bytes = read.file_bytes;
                out.note = merge_note(read.note, write.note);
            }
            Err(e) => out.error = Some(e),
        }
        return finish_target(out, cancel);
    }

    let wants_read = opts.mode != "write";
    let wants_write = opts.mode == "write" || opts.mode == "both";

    if wants_read {
        match measure_read(&dir, size, threads, bypass, cancel, progress) {
            Ok(m) => {
                out.read_mbps = Some(mbps(&m));
                out.read_bytes = m.bytes;
                out.read_retrans = m.retrans;
                out.note = m.note;
                out.read_file = m.file;
                out.read_file_bytes = m.file_bytes;
            }
            Err(e) => out.error = Some(e),
        }
    }

    if wants_write && !cancel.load(Ordering::Relaxed) {
        match measure_write(&dir, size, threads, bypass, cancel, progress) {
            Ok(m) => {
                out.write_mbps = Some(mbps(&m));
                out.write_bytes = m.bytes;
                out.write_retrans = m.retrans;
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

    finish_target(out, cancel)
}

/// Withhold the result of a target that was stopped mid-measurement.
///
/// The worker threads break out of their loop when cancelled, so the bytes and
/// the clock both stop early and the division still yields a number — a
/// plausible one, which is the dangerous kind. A stopped target reports
/// nothing at all.
fn finish_target(out: TargetResult, cancel: &Arc<AtomicBool>) -> Option<TargetResult> {
    if cancel.load(Ordering::Relaxed) {
        None
    } else {
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prog() -> Arc<Progress> {
        Arc::new(Progress::default())
    }

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

    /// Unbuffered I/O rejects anything misaligned, so this is load-bearing:
    /// without it reads fall back to the cache and report memory bandwidth.
    #[test]
    fn buffer_is_sector_aligned() {
        for len in [BLOCK, 64 * 1024, ALIGN] {
            let mut buf = AlignedBuf::new(len);
            let slice = buf.as_mut();
            assert_eq!(slice.len(), len);
            assert_eq!(slice.as_ptr() as usize % ALIGN, 0, "buffer must start on a sector boundary");
        }
    }

    #[test]
    fn offsets_round_down_to_sectors() {
        assert_eq!(align_down(0), 0);
        assert_eq!(align_down(ALIGN as u64), ALIGN as u64);
        assert_eq!(align_down(ALIGN as u64 + 1), ALIGN as u64);
        assert_eq!(align_down(ALIGN as u64 - 1), 0);
        assert_eq!(align_down(10 * ALIGN as u64 + 7), 10 * ALIGN as u64);
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

        let written = measure_write(&dir, size, 2, true, &cancel, &prog()).expect("write should succeed");
        assert!(written.bytes >= size, "all requested bytes should be written");
        assert!(mbps(&written) > 0.0);

        // Write leaves nothing behind, so a read test needs its own file.
        let payload = vec![7u8; (size + 8 * 1024 * 1024) as usize];
        fs::write(dir.join("payload.bin"), &payload).unwrap();

        let read = measure_read(&dir, size, 2, true, &cancel, &prog()).expect("read should succeed");
        assert!(read.bytes > 0);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_test_leaves_nothing_behind() {
        let dir = std::env::temp_dir().join("reticle-netspeed-cleanup");
        fs::create_dir_all(&dir).unwrap();

        let cancel = Arc::new(AtomicBool::new(false));
        measure_write(&dir, 16 * 1024 * 1024, 2, true, &cancel, &prog()).unwrap();

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
        let m = measure_read(&root, 16 * 1024 * 1024, 2, true, &cancel, &prog()).expect("read should work");
        assert!(m.bytes > 0);

        // Which file carried the figure, and where it was: two servers measured
        // against different files are not comparable, and the subfolder is half
        // the explanation.
        let named = m.file.expect("the read should name its source file");
        assert!(named.ends_with("clip.mov"), "got {named}");
        assert!(named.contains("scene01"), "the subfolder should survive: {named}");
        assert!(!named.contains(root.to_string_lossy().as_ref()), "path should be relative: {named}");
        assert_eq!(m.file_bytes, 24 * 1024 * 1024);

        fs::remove_dir_all(&root).ok();
    }

    /// Write, read the same bytes back, and leave nothing behind. The sweep
    /// matters most: these files land in someone's show folder.
    #[test]
    fn round_trip_measures_both_and_cleans_up() {
        let dir = std::env::temp_dir().join("reticle-netspeed-roundtrip");
        fs::create_dir_all(&dir).unwrap();

        let cancel = Arc::new(AtomicBool::new(false));
        let size = 16 * 1024 * 1024;
        let (write, read) = measure_roundtrip(&dir, size, 2, true, &cancel, &prog()).expect("round trip should work");

        // Read back exactly what was written — not a byte less, which is the
        // whole point of reading the file this test just created.
        assert_eq!(write.bytes, read.bytes);
        assert!(write.bytes >= size, "{} bytes written", write.bytes);
        assert!(mbps(&write) > 0.0 && mbps(&read) > 0.0);

        // Named, so the file column says where the figure came from.
        assert!(read.file.expect("the read should name its source").contains(TMP_PREFIX));

        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(leftovers.is_empty(), "left behind: {leftovers:?}");

        fs::remove_dir_all(&dir).ok();
    }

    /// Buffered is a choice, not a failure. Saying "the cache could not be
    /// bypassed" when nobody asked it to be would turn the diagnostic pair of
    /// readings into two readings that both look suspect.
    #[test]
    fn buffered_run_is_not_reported_as_a_failed_bypass() {
        let dir = std::env::temp_dir().join("reticle-netspeed-buffered");
        fs::create_dir_all(&dir).unwrap();

        let cancel = Arc::new(AtomicBool::new(false));
        let (write, read) =
            measure_roundtrip(&dir, 16 * 1024 * 1024, 2, false, &cancel, &prog()).expect("buffered round trip should work");

        assert_eq!(write.note, None, "buffered write should carry no caveat");
        assert_eq!(read.note, None, "buffered read should carry no caveat");
        assert!(write.bytes > 0 && read.bytes == write.bytes);

        fs::remove_dir_all(&dir).ok();
    }

    /// The counter has to actually be readable, or the column would quietly be
    /// empty on every row and look like "no retransmissions".
    #[cfg(windows)]
    #[test]
    fn reads_the_machines_retransmission_counter() {
        let now = tcpstat::retrans_segs().expect("Windows should expose TCP statistics");
        let again = retrans_since(Some(now)).expect("a second reading should work too");
        assert!(again < 100_000, "implausible delta over no time at all: {again}");
    }

    /// The retransmission counter is 32 bits and wraps on a long-running
    /// machine. Subtracting across the wrap must give the real delta, not a
    /// panic in debug or four billion in release.
    #[test]
    fn retransmissions_survive_the_counter_wrapping() {
        assert_eq!(retrans_delta(100, 140), 40);
        assert_eq!(retrans_delta(u32::MAX - 3, 6), 10);
        assert_eq!(retrans_delta(500, 500), 0);
    }

    /// A failed write must not leave its files in the target folder either.
    #[test]
    fn round_trip_sweeps_after_a_failure() {
        let missing = std::env::temp_dir().join("reticle-netspeed-absent-folder");
        fs::remove_dir_all(&missing).ok();

        let cancel = Arc::new(AtomicBool::new(false));
        let err = measure_roundtrip(&missing, 16 * 1024 * 1024, 2, true, &cancel, &prog()).unwrap_err();
        assert!(!err.is_empty());
        assert!(!missing.exists(), "a failed run should not create the folder");
    }

    /// The progress counters must reach the volume actually moved, or the bar
    /// would stall short of the end on every run.
    #[test]
    fn progress_counts_every_byte_read() {
        let root = std::env::temp_dir().join("reticle-netspeed-progress");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("clip.mov"), vec![7u8; 24 * 1024 * 1024]).unwrap();

        let cancel = Arc::new(AtomicBool::new(false));
        let progress = prog();
        let m = measure_read(&root, 16 * 1024 * 1024, 2, true, &cancel, &progress).expect("read should work");

        let snap = progress.snapshot();
        assert_eq!(snap.phase, "read");
        assert_eq!(snap.done, m.bytes);
        // The total is declared before the first block, so a bar can be sized
        // immediately rather than growing its own scale as it goes.
        assert_eq!(snap.total, m.bytes);

        progress.finish();
        assert_eq!(progress.snapshot().phase, "idle");

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
        let err = measure_read(&dir, 512 * 1024 * 1024, 4, true, &cancel, &prog()).unwrap_err();

        assert!(err.contains("MB"), "message should state the size found: {err}");
        assert!(err.contains("streams"), "message should hint at a fix: {err}");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn empty_folder_reports_why() {
        let dir = std::env::temp_dir().join("reticle-netspeed-empty");
        fs::create_dir_all(&dir).unwrap();

        let cancel = Arc::new(AtomicBool::new(false));
        let err = measure_read(&dir, 32 * 1024 * 1024, 2, true, &cancel, &prog()).unwrap_err();
        assert!(err.contains("no files"), "got: {err}");

        fs::remove_dir_all(&dir).ok();
    }
    /// Stop used to be a no-op against a host that is not there: the run sat
    /// inside a blocking connect and a blocking stat, neither of which looks at
    /// the flag. The wait is on a channel now, so the answer comes back in a
    /// tick regardless of what the kernel is still waiting for.
    #[test]
    fn a_stopped_run_gives_up_at_once() {
        let target = Target {
            id: 1,
            // TEST-NET-1: reserved for documentation, routed nowhere.
            path: r"\\192.0.2.1\share".to_string(),
            label: None,
        };
        let opts = TestOpts {
            size_mb: 64,
            threads: 4,
            mode: "read".to_string(),
            bypass_cache: true,
        };
        let cancel = Arc::new(AtomicBool::new(true));

        let started = Instant::now();
        let out = run_target(&target, &opts, &cancel, &prog());

        assert!(out.is_none(), "a stopped target must report nothing");
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "stopping took {:?}, which is a hang by any other name",
            started.elapsed()
        );
    }

    /// A host that does not answer on 445 has no share to reach, and the
    /// filesystem must not be asked anyway: that stat is the long one.
    #[test]
    fn an_unreachable_host_says_so_without_waiting_on_smb() {
        let target = Target {
            id: 1,
            path: r"\\192.0.2.1\share".to_string(),
            label: None,
        };
        let opts = TestOpts {
            size_mb: 64,
            threads: 4,
            mode: "read".to_string(),
            bypass_cache: true,
        };
        let cancel = Arc::new(AtomicBool::new(false));

        let started = Instant::now();
        let out = run_target(&target, &opts, &cancel, &prog()).expect("not stopped, so a result");

        let err = out.error.expect("an unreachable host is an error");
        assert!(err.contains("445"), "the reason should name the port: {err}");
        // The connect itself is allowed three seconds; the SMB client's own
        // timeout on top of that is what this guards against.
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "took {:?} to give up on a host that is not there",
            started.elapsed()
        );
    }

}
