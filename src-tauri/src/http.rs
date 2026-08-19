//! HTTP client.
//!
//! Requests are issued from Rust rather than the webview — hence no CORS, any
//! method and header available, and a media server with a self-signed
//! certificate is reachable. Exactly what a browser-based tool cannot do.

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// Bodies larger than this are not handed to the UI: there is no point, and it
/// could freeze the window.
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

#[derive(Deserialize)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    /// Headers as string pairs — easier to edit that way in the UI.
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub timeout_s: Option<u64>,
    /// Skip certificate validation. Normal for local self-signed servers.
    #[serde(default)]
    pub insecure: bool,
}

#[derive(Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    /// The body recognised as JSON and re-formatted with indentation.
    pub json_pretty: Option<String>,
    pub content_type: Option<String>,
    /// Full response size in bytes, even when the body was truncated.
    pub size: usize,
    pub truncated: bool,
    pub ms: u64,
}

fn client(insecure: bool) -> Result<reqwest::Client, String> {
    // The regular client is reused: it keeps a connection pool, so repeat
    // requests to the same host do not pay for the handshake again.
    static SAFE: OnceLock<reqwest::Client> = OnceLock::new();

    if insecure {
        return reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .map_err(|e| e.to_string());
    }

    if let Some(c) = SAFE.get() {
        return Ok(c.clone());
    }
    let c = reqwest::Client::builder().build().map_err(|e| e.to_string())?;
    Ok(SAFE.get_or_init(|| c).clone())
}

pub async fn send(req: HttpRequest) -> Result<HttpResponse, String> {
    let method: reqwest::Method = req
        .method
        .parse()
        .map_err(|_| format!("unknown HTTP method: {}", req.method))?;

    let mut builder = client(req.insecure)?
        .request(method, &req.url)
        .timeout(Duration::from_secs(req.timeout_s.unwrap_or(30)));

    for (k, v) in &req.headers {
        if k.trim().is_empty() {
            continue;
        }
        builder = builder.header(k.trim(), v.trim());
    }

    if let Some(body) = req.body.filter(|b| !b.is_empty()) {
        builder = builder.body(body);
    }

    let started = Instant::now();
    let res = builder.send().await.map_err(describe_error)?;
    let status = res.status();

    let headers: Vec<(String, String)> = res
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("<not text>").to_string()))
        .collect();

    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let bytes = res.bytes().await.map_err(describe_error)?;
    let ms = started.elapsed().as_millis() as u64;

    let size = bytes.len();
    let truncated = size > MAX_BODY_BYTES;
    let slice = if truncated { &bytes[..MAX_BODY_BYTES] } else { &bytes[..] };
    let body = String::from_utf8_lossy(slice).to_string();

    // Pretty JSON is produced here: in the UI that would be extra work on the
    // main thread, while this side is parsing the response anyway.
    let json_pretty = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| serde_json::to_string_pretty(&v).ok());

    Ok(HttpResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        body,
        json_pretty,
        content_type,
        size,
        truncated,
        ms,
    })
}

/// Raw network errors read poorly — the common cases get translated.
fn describe_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        return "request timed out".to_string();
    }
    if e.is_connect() {
        return format!("could not connect — {}", root_cause(&e));
    }
    if e.is_builder() {
        return format!("bad request — {}", root_cause(&e));
    }
    root_cause(&e)
}

fn root_cause(e: &dyn std::error::Error) -> String {
    let mut cur: &dyn std::error::Error = e;
    while let Some(src) = cur.source() {
        cur = src;
    }
    cur.to_string()
}
