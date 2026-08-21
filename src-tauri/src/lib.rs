//! Reticle — a protocol monitor.
//!
//! Data flow:
//!
//! ```text
//! sockets (one task per source) ──► channel ──► collector ──► aggregator
//!                                                                 │
//!                                             ticker 30 Hz ───────┘──► UI
//! ```
//!
//! The UI receives snapshots at a fixed rate, not a message stream: interface
//! load does not depend on whether 10 or 6000 messages arrive per second.

mod dmx;
mod http;
mod osc;
mod raw;
mod sacn;
mod signal;
mod sources;
mod stats;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{Emitter, Manager};
use tokio::sync::mpsc;

use dmx::DmxTracker;
use signal::{Message, Parsed};
use sources::{SourceCfg, SourceHandle, SourceInfo};
use stats::Aggregator;

/// 30 Hz: the eye does not read faster anyway, and the load is half of 60.
const TICK_MS: u64 = 33;
/// How many messages go to the log per tick. The rest counts as skipped — the
/// log physically cannot show 6000 lines per second, and pretending otherwise
/// would be a lie.
const LOG_PER_TICK: usize = 300;
/// Capacity of the channel between sockets and the collector.
const CHANNEL_CAP: usize = 8192;

struct Inner {
    next_id: u32,
    sources: HashMap<u32, SourceHandle>,
    agg: Aggregator,
    /// DMX lives apart from the aggregator: 512 fixed channels are cheaper as
    /// an array than as a dictionary of addresses.
    dmx: DmxTracker,
    /// Messages accumulated since the previous tick.
    pending: Vec<Message>,
    /// How many messages did not make it into the log.
    log_dropped: u64,
    /// Freeze: capture continues, UI updates stop.
    paused: bool,
}

pub struct AppState {
    inner: Mutex<Inner>,
    tx: mpsc::Sender<Parsed>,
    start: Instant,
}

#[derive(Serialize, Clone)]
struct LogBatch {
    messages: Vec<Message>,
    dropped: u64,
}

#[tauri::command]
async fn add_source(state: tauri::State<'_, AppState>, cfg: SourceCfg) -> Result<SourceInfo, String> {
    let (id, tx, start) = {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.next_id += 1;
        (inner.next_id, state.tx.clone(), state.start)
    };

    let handle = sources::spawn(id, cfg, tx, start).map_err(|e| describe_bind_error(&e))?;
    let info = handle.info();

    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    inner.sources.insert(id, handle);
    Ok(info)
}

/// Bind errors are the most common thing a user sees, so they are translated
/// into human wording instead of an OS code.
fn describe_bind_error(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::AddrInUse => {
            "port is already in use — a UDP port has one listener at a time".to_string()
        }
        std::io::ErrorKind::PermissionDenied => "no permission to bind this port".to_string(),
        std::io::ErrorKind::AddrNotAvailable => "no such network interface".to_string(),
        _ => e.to_string(),
    }
}

#[tauri::command]
async fn remove_source(state: tauri::State<'_, AppState>, id: u32) -> Result<(), String> {
    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    if let Some(mut h) = inner.sources.remove(&id) {
        h.stop();
    }
    inner.agg.reset(Some(id));
    inner.dmx.reset(Some(id));
    Ok(())
}

#[tauri::command]
async fn list_sources(state: tauri::State<'_, AppState>) -> Result<Vec<SourceInfo>, String> {
    let inner = state.inner.lock().map_err(|e| e.to_string())?;
    let mut list: Vec<SourceInfo> = inner.sources.values().map(|h| h.info()).collect();
    list.sort_by_key(|s| s.id);
    Ok(list)
}

#[tauri::command]
async fn reset_stats(state: tauri::State<'_, AppState>, source_id: Option<u32>) -> Result<(), String> {
    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    inner.agg.reset(source_id);
    inner.dmx.reset(source_id);
    Ok(())
}

#[tauri::command]
async fn set_paused(state: tauri::State<'_, AppState>, paused: bool) -> Result<(), String> {
    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    inner.paused = paused;
    Ok(())
}

#[tauri::command]
async fn get_spark(
    state: tauri::State<'_, AppState>,
    source_id: u32,
    path: String,
    slot: usize,
) -> Result<Option<Vec<f32>>, String> {
    let inner = state.inner.lock().map_err(|e| e.to_string())?;
    Ok(inner.agg.spark(source_id, &path, slot))
}

#[derive(serde::Deserialize)]
struct SparkRequest {
    source_id: u32,
    path: String,
    slot: usize,
}

/// How many sparklines one call may ask for. Beyond that the table is far past
/// what a person reads anyway, and the payload stops being cheap.
const MAX_SPARKS: usize = 256;

/// Value history for many slots at once.
///
/// Batched deliberately: asking per row would mean a hundred round trips per
/// frame, and that cost lands on the UI thread.
#[tauri::command]
async fn sparks(
    state: tauri::State<'_, AppState>,
    requests: Vec<SparkRequest>,
) -> Result<Vec<Option<Vec<f32>>>, String> {
    let inner = state.inner.lock().map_err(|e| e.to_string())?;
    Ok(requests
        .iter()
        .take(MAX_SPARKS)
        .map(|r| inner.agg.spark(r.source_id, &r.path, r.slot))
        .collect())
}

#[derive(Serialize)]
struct Interface {
    name: String,
    ip: String,
}

/// Network interfaces of the machine — for the dropdown when adding a source.
///
/// On site a machine usually has several adapters, and the multicast
/// subscription goes to whichever address is chosen — so choosing blind is not
/// an option.
#[tauri::command]
async fn list_interfaces() -> Result<Vec<Interface>, String> {
    let mut out = vec![
        Interface { name: "all interfaces".into(), ip: "0.0.0.0".into() },
        Interface { name: "localhost".into(), ip: "127.0.0.1".into() },
    ];

    let addrs = if_addrs::get_if_addrs().map_err(|e| e.to_string())?;
    let mut found: Vec<Interface> = addrs
        .into_iter()
        .filter_map(|a| match a.ip() {
            std::net::IpAddr::V4(v4) if !v4.is_loopback() => {
                Some(Interface { name: a.name, ip: v4.to_string() })
            }
            _ => None,
        })
        .collect();

    // Addresses like 169.254.x mean "DHCP did not answer"; they are almost
    // never the right ones, so they sink to the bottom of the list.
    found.sort_by_key(|i| (i.ip.starts_with("169.254."), i.ip.clone()));
    out.append(&mut found);

    Ok(out)
}

/// One universe frame for the channel grid. The UI pulls it itself and only
/// for the universe currently open — pushing 512 values for all of them makes
/// no sense.
#[tauri::command]
async fn dmx_frame(
    state: tauri::State<'_, AppState>,
    source_id: u32,
    universe: u16,
) -> Result<Option<dmx::DmxFrame>, String> {
    let inner = state.inner.lock().map_err(|e| e.to_string())?;
    Ok(inner.dmx.frame(source_id, universe))
}

/// Save text to a file through the system dialog.
///
/// The dialog is shown from Rust and the write goes through plain `std::fs` —
/// that way no filesystem plugin with its access scopes is needed: the app
/// writes exactly where the user pointed, and nowhere else.
///
/// Returns the path, or `None` when the dialog was dismissed.
#[tauri::command]
async fn save_text(
    app: tauri::AppHandle,
    content: String,
    default_name: String,
    extension: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();

    app.dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter(extension.to_uppercase(), &[extension.as_str()])
        .add_filter("All files", &["*"])
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    let Some(path) = rx.await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };

    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;

    Ok(Some(path.display().to_string()))
}

/// Read a text file chosen in the system dialog.
///
/// Symmetric to `save_text`: only what the user pointed at is read. `None`
/// means the dialog was dismissed.
#[tauri::command]
async fn open_text(
    app: tauri::AppHandle,
    extension: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();

    app.dialog()
        .file()
        .add_filter(extension.to_uppercase(), &[extension.as_str()])
        .add_filter("All files", &["*"])
        .pick_file(move |path| {
            let _ = tx.send(path);
        });

    let Some(path) = rx.await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };

    let path = path.into_path().map_err(|e| e.to_string())?;
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;

    Ok(Some(text))
}

/// HTTP requests leave from Rust, bypassing the webview: hence no CORS, and any
/// header or method is available.
#[tauri::command]
async fn http_request(req: http::HttpRequest) -> Result<http::HttpResponse, String> {
    http::send(req).await
}

/// Feeds everything arriving from the sockets into the aggregator and the log
/// buffer.
async fn collector(app: tauri::AppHandle, mut rx: mpsc::Receiver<Parsed>) {
    while let Some(batch) = rx.recv().await {
        let state = app.state::<AppState>();
        let Ok(mut inner) = state.inner.lock() else {
            continue;
        };
        for p in &batch.dmx {
            inner.dmx.ingest(p);
        }

        for m in batch.messages {
            inner.agg.ingest(&m);
            if inner.pending.len() < LOG_PER_TICK {
                inner.pending.push(m);
            } else {
                inner.log_dropped += 1;
            }
        }
    }
}

/// The single place the UI receives data from.
async fn ticker(app: tauri::AppHandle) {
    let mut last = Instant::now();
    let mut tick: u32 = 0;

    loop {
        tokio::time::sleep(Duration::from_millis(TICK_MS)).await;

        let dt_s = last.elapsed().as_secs_f32();
        last = Instant::now();

        let state = app.state::<AppState>();
        let payload = {
            let Ok(mut inner) = state.inner.lock() else {
                continue;
            };
            if inner.paused {
                // While paused the buffer is cleared, so unpausing does not
                // dump everything into the log at once.
                inner.pending.clear();
                None
            } else {
                let now_us = state.start.elapsed().as_micros() as u64;
                let snap = inner.agg.snapshot(dt_s, now_us);
                let universes = inner.dmx.snapshot(dt_s);
                let messages = std::mem::take(&mut inner.pending);
                let dropped = std::mem::take(&mut inner.log_dropped);
                Some((snap, universes, LogBatch { messages, dropped }))
            }
        };

        if let Some((snap, universes, log)) = payload {
            let _ = app.emit("stats", snap);
            if !universes.is_empty() {
                let _ = app.emit("dmx", universes);
            }
            if !log.messages.is_empty() || log.dropped > 0 {
                let _ = app.emit("log", log);
            }
        }

        // Source counters change slowly — twice a second is plenty.
        tick = tick.wrapping_add(1);
        if tick % 15 == 0 {
            let list = {
                let Ok(inner) = state.inner.lock() else {
                    continue;
                };
                let mut l: Vec<SourceInfo> = inner.sources.values().map(|h| h.info()).collect();
                l.sort_by_key(|s| s.id);
                l
            };
            let _ = app.emit("sources", list);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (tx, rx) = mpsc::channel::<Parsed>(CHANNEL_CAP);

    let state = AppState {
        inner: Mutex::new(Inner {
            next_id: 0,
            sources: HashMap::new(),
            agg: Aggregator::default(),
            dmx: DmxTracker::default(),
            pending: Vec::new(),
            log_dropped: 0,
            paused: false,
        }),
        tx,
        start: Instant::now(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(move |app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(collector(handle.clone(), rx));
            tauri::async_runtime::spawn(ticker(handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            add_source,
            remove_source,
            list_sources,
            reset_stats,
            set_paused,
            get_spark,
            sparks,
            dmx_frame,
            list_interfaces,
            save_text,
            open_text,
            http_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
