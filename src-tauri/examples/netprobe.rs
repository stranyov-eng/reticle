//! Reticle's throughput measurement without the window around it.
//!
//! Exists so the app's figures can be checked against another tool on the same
//! shares, back to back, without anyone clicking anything. It calls exactly the
//! code the interface calls — `netspeed::run_target` — so a disagreement with
//! `scripts/smb-check.ps1` is a disagreement about the measurement itself and
//! not about some separate copy of it written for the occasion.
//!
//! ```text
//! cargo run --release --example netprobe -- --size 512 --threads 4 --mode roundtrip \
//!     "\\192.168.2.11\share\objects" "\\192.168.2.12\share\objects"
//! ```

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use reticle_lib::netspeed::{self, Progress, Target, TestOpts};

fn main() {
    let mut size_mb = 512u64;
    let mut threads = 4usize;
    let mut mode = "roundtrip".to_string();
    let mut bypass = true;
    let mut passes = 1usize;
    let mut paths: Vec<String> = Vec::new();

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--size" => size_mb = args.next().and_then(|v| v.parse().ok()).unwrap_or(size_mb),
            "--threads" => threads = args.next().and_then(|v| v.parse().ok()).unwrap_or(threads),
            "--mode" => mode = args.next().unwrap_or(mode),
            "--passes" => passes = args.next().and_then(|v| v.parse().ok()).unwrap_or(passes),
            "--buffered" => bypass = false,
            other => paths.push(other.to_string()),
        }
    }

    if paths.is_empty() {
        eprintln!("usage: netprobe [--size MB] [--threads N] [--mode roundtrip|read|write|both] [--passes N] [--buffered] <unc path>...");
        std::process::exit(2);
    }

    let opts = TestOpts {
        size_mb,
        threads,
        mode,
        bypass_cache: bypass,
    };

    println!(
        "# reticle netprobe · {} MB · {} streams · {} · {}",
        size_mb,
        threads,
        opts.mode,
        if bypass { "unbuffered" } else { "buffered" }
    );
    println!("pass\tserver\tread_mbps\twrite_mbps\tretrans\tfile");

    let cancel = Arc::new(AtomicBool::new(false));
    let progress = Arc::new(Progress::default());

    for pass in 1..=passes {
        for (i, path) in paths.iter().enumerate() {
            let target = Target {
                id: i as u32,
                path: path.clone(),
                label: None,
            };

            progress.enter(target.id);
            let r = netspeed::run_target(&target, &opts, &cancel, &progress);

            let host = netspeed::host_of(path).unwrap_or_else(|| path.clone());
            let show = |v: Option<f64>| match v {
                Some(x) => format!("{}", x.round() as i64),
                None => "-".to_string(),
            };

            println!(
                "{}\t{}\t{}\t{}\t{}\t{}",
                pass,
                host,
                show(r.read_mbps),
                show(r.write_mbps),
                r.read_retrans.map(|v| v.to_string()).unwrap_or_else(|| "-".into()),
                r.error.as_deref().unwrap_or(r.read_file.as_deref().unwrap_or("")),
            );
        }
    }

    progress.finish();
}
