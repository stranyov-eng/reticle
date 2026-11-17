# Reticle

A protocol monitor for AV work. Listens on several ports at once and shows not
just the stream of messages, but **statistics per address** — min, max, average,
rate, jitter and how long an address has been silent.

Supports OSC, sACN (E1.31) with a DMX channel grid, raw UDP for diagnostics, an
HTTP client for poking REST endpoints, and throughput testing across file
shares.

## Download

**[Latest release →](https://github.com/stranyov-eng/reticle/releases/latest)**

Windows x64:

| | |
|---|---|
| `Reticle_x.y.z_x64-setup.exe` | Installer, ~3.6 MB — the usual choice |
| `Reticle_x.y.z_x64_en-US.msi` | MSI, ~5 MB — for policy deployment |

The build is unsigned, so on first launch Windows shows SmartScreen: click
**More info** → **Run anyway**. WebView2 is required and ships with Windows 10
and 11, so in practice nothing else is needed.

macOS and Linux builds are not published yet — see the roadmap.

## Why not just use Protokol

Protokol's main view is a message log. That answers "what arrived just now".

On site the question is usually different: *what range does this value move in*,
and *why did it stop coming*. So Reticle's main view is an **address table**,
and the log is secondary.

## Features

**Per-slot statistics.** An OSC address carrying three floats gets three
independent sets of min/max/average — aggregating them together would be
meaningless.

**Silence detection.** An address that stops sending is highlighted. This is the
fastest answer to "why isn't it moving".

**Real jitter.** Interval between messages (min/average/max), so you can see that
the "60 Hz" stream is actually running at 43.

**Type change flags.** An address that suddenly sends an int where it used to
send a float is almost always an integration bug — and one that takes an hour to
find by hand.

**Expected ranges.** Declare that a slot should stay within `0..1`, and anything
leaving it turns red — in the table, in the detail panel and on the graph, where
the bounds are drawn as dashed guides. Ranges are per slot, because on `/pos`
with three floats X may live in `-1..1` while Z runs `0..10`.

**Sparklines.** A history thumbnail per row, and a larger graph per argument slot
in the detail panel that opens on click. History is fetched in one batched call
at 5 Hz — a request per row per frame would put that cost on the UI thread.

**Multi-port.** Several sources at once, each with its own protocol, port and
interface.

**No dropped data hidden.** If the stream outruns processing, the loss counter is
visible rather than silently swallowed.

## Protocols

The protocol is chosen per source. Parsers are resolved in `parser_for`
(`sources.rs`) — adding Art-Net means writing a module with the same signature
and adding one line; sockets and statistics stay untouched.

| Protocol | Status | Table row |
|---|---|---|
| `osc-udp` | done | OSC address, one slot per argument |
| `sacn` | done | DMX tab: universes and channel grid |
| `raw-udp` | done | sender; slots: packet size, hex, ASCII |
| Art-Net | planned | same view as sACN |

Raw mode answers one question: *is anything arriving on this port at all?* When
the OSC parser stays quiet, you can't tell whether the sender is silent or
sending something else entirely.

## DMX / sACN

A `sacn` source asks for universe numbers (`1-4,10`) rather than a multicast
group — the `239.255.x.x` groups and port 5568 are defined by the standard and
derived automatically. Unicast to the same port is accepted too.

The DMX tab shows a universe strip and a channel grid. Each cell carries the
channel number, the current value and min–max over time; cell fill follows
brightness, so the grid reads as a lighting picture rather than a table of
numbers.

Beyond values it reports:

- **packet loss** — from gaps in sequence numbers, handling the 255 → 0 wrap;
- **fps per universe** — immediately shows a console sending 25 instead of 44;
- **senders with priority**, and a explicit flag when two of them fight over one
  universe.

DMX does not go through the address aggregator: 512 fixed channels are cheaper
as an array, and they would be unreadable in an address table. Sockets, channel
and ticker are shared with OSC. The UI pulls the channel frame itself, and only
for the universe currently open.

## Network throughput

Answers a question a protocol monitor normally cannot: *is every one of these
servers actually getting the link it should?*

Targets are file shares, added one by one or as a range — give the first and
last address plus the share path, and all the hosts in between appear at once.
Each row reports read speed, write speed, latency, the share of the selected
link speed, **which file the read came from** and **which local adapter the
traffic actually left from**.

Deliberate choices:

- **Reads and writes bypass the cache.** Without that, a second pass over the
  same file is served from the client's RAM and reports memory bandwidth —
  6 GB/s over a 10 GbE link, which is nonsense that nevertheless looks like a
  result. The cost is sector alignment: offsets, lengths and the buffer address
  must all be multiples of 4096, and there are tests guarding that. Where a
  filesystem refuses unbuffered access, the run still happens and says so.
- **Several streams by default.** A single SMB stream tops out near 400–600 MB/s
  on a 10 GbE link — it runs out of one CPU core and round-trip latency long
  before it runs out of wire. Measuring single-threaded reports that ceiling as
  if it were the network. Comparing 1 stream against 8 tells the two apart.
- **The file read is named.** A read test streams from the first file large
  enough that it finds, which on different servers can be a different file —
  one of them possibly on a slow volume or badly fragmented. Two figures
  produced from two different files are not comparable, and without naming the
  file there is no way to tell that apart from a network fault. The name is in
  the table and in the exported report.
- **Progress is shown while a run is in flight.** A 512 MB read over a
  congested link takes most of a minute, and a table of dashes for that long is
  indistinguishable from a hung app. The measuring threads only bump counters;
  a ticker samples them five times a second, so reporting cannot slow down the
  thing being measured.
- **Machines are named, not just addressed.** Reverse DNS turns `192.168.2.14`
  into `03-ACT-2`, looked up in parallel as targets are added. No resolver on
  the network simply means no label, which is not an error.
- **Presets per venue.** A preset stores the targets *and* the settings they
  were measured with, because comparing today's figure with last month's only
  means something if the test was the same. The app opens on the last one used.
- **One target at a time.** Nine servers measured simultaneously would share one
  uplink and every number would be wrong.
- **SMB, not raw bandwidth.** Copy tools move data over SMB, and the protocol's
  overhead is part of what you actually get — plus this needs nothing installed
  on the far side, unlike iperf3.
- **Link speed is selectable** (1 … 100 GbE), and the percentages recompute
  without re-running the test.

Write mode creates temporary files in the target folder and removes them
afterwards, including when a run fails. The data written is incompressible, so
an array or link that compresses in flight cannot flatter the result.

**Export report** renders the table to PNG, carrying the test parameters —
size, streams, mode, link, timestamp — because a throughput figure without the
conditions that produced it is not a measurement.

Which adapter was used is detected by connecting a UDP socket to the target and
reading back the source address the kernel chose: no packet is sent, but the
routing decision is the same one SMB will make. An application cannot *choose*
the adapter — Windows decides by routing metric — but it can tell you when the
wrong one was used, which on a machine with a 10 GbE card beside a gigabit
dongle is an easy and invisible mistake.

## HTTP

GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS with arbitrary headers and
body. Requests are issued from Rust rather than the webview, so there is no CORS,
any header is allowed, and self-signed certificates can be accepted with a
checkbox.

- **Presets** — three explicit actions per preset: send, load into the form
  without sending, delete. Export and import as JSON so a set can be handed to a
  colleague.
- **History** — last 30 requests with body preview, status and timing; resend in
  one click.
- **Save response** — file format is picked from `content-type`, JSON is saved
  formatted.

Note: exported presets carry headers verbatim, `Authorization` included. Check
before sharing.

## Building from source

```bash
npm install
npm run tauri dev
```

Build:

```bash
npm run tauri build
```

Produces three artifacts:

| File | What it is |
|---|---|
| `src-tauri/target/release/reticle.exe` | portable, installs nothing |
| `…/bundle/nsis/Reticle_x.y.z_x64-setup.exe` | regular installer |
| `…/bundle/msi/Reticle_x.y.z_x64_en-US.msi` | for policy deployment |

Builds are unsigned: on first launch Windows shows SmartScreen
("More info" → "Run anyway").

## Testing without hardware

Traffic generators are included:

```bash
node scripts/osc-blast.mjs 9000 60 100   # port, Hz, address count
node scripts/sacn-blast.mjs 1-4 44       # universes, Hz
```

The OSC one above produces roughly 6000 messages per second — deliberately, to
prove the interface does not choke. The sACN one sweeps all 512 channels and
skips a sequence number every five seconds so the loss counter can be seen
working.

## Architecture

```
sockets (one task per source) ──► channel ──► collector ──► aggregator
                                                               │
                                              ticker 30 Hz ────┘──► UI
```

Three decisions hold the whole thing together:

**Aggregation in Rust, not in the UI.** The interface receives snapshots of
changed rows 30 times per second, not a message stream. UI load is identical at
10 and at 6000 messages per second.

**Statistics per slot, not per address.** Otherwise min/max mean nothing for
multi-argument addresses.

**Protocol-independent aggregator.** Everything OSC-specific ends in `osc.rs`;
downstream only `Message` and `Value` exist. Art-Net, MIDI and sACN plug in as
new source types and inherit all statistics for free.

### Files

| File | Responsibility |
|---|---|
| `src-tauri/src/signal.rs` | `Message` / `Value` — the shared language of all protocols |
| `src-tauri/src/osc.rs` | OSC parsing, bundle flattening |
| `src-tauri/src/sacn.rs` | E1.31 parsing |
| `src-tauri/src/dmx.rs` | Universe state: channels, losses, senders |
| `src-tauri/src/raw.rs` | Raw UDP as hex |
| `src-tauri/src/sources.rs` | Source pool: sockets, multicast, counters |
| `src-tauri/src/stats.rs` | Aggregator: min/max/avg/rate/jitter, sparklines |
| `src-tauri/src/http.rs` | HTTP client |
| `src-tauri/src/netspeed.rs` | Share throughput: multi-stream read/write, route lookup |
| `src-tauri/src/lib.rs` | State, commands, 30 Hz ticker |
| `src/` | Interface. Design layer (`_tokens.css`, `_components.css`) comes from stranyov.pro/tools |

## Behaviour worth knowing

- **A UDP port has one listener at a time.** While Reticle holds it, the intended
  receiver will not see it. That is a property of UDP, not of this app. Multicast
  groups are shared between listeners; unicast is not.
- **Port sharing is enabled for multicast only.** For unicast, `SO_REUSEADDR` on
  Windows would mean silently intercepting someone else's traffic, so the app
  reports "port in use" instead.
- **Pick the interface explicitly.** With `0.0.0.0` the multicast subscription
  goes to whichever adapter the routing table picks — on a machine with several
  adapters that is a lottery.
- **macOS 15+ asks for local network permission.** Without it the socket receives
  nothing, silently.

## Tests

```bash
cd src-tauri && cargo test
```

Covered: OSC parsing and types, garbage rejection, bundle flattening, per-slot
min/max/avg, type-change detection, E1.31 parsing, rejection of foreign packets
and non-zero start codes, resistance to a lying length field, DMX loss counting
with sequence wrap, two-sender detection, real socket bind with datagram
receipt, and refusal on a busy port.

## Icon

Source is [`app-icon.svg`](app-icon.svg). After editing:

```bash
npx tauri icon app-icon.svg
```

**Careful:** one rebuild after this is not enough. Cargo does not treat icon
files as a build-script dependency, so the old icon silently stays in the exe.
Force the build script to re-run:

```bash
cargo clean -p reticle
```

Verify by extracting the icon from the built exe, not by the command exiting
successfully.

## Roadmap

- [x] Sparklines and a detail panel per address
- [x] Expected value ranges with out-of-range highlighting
- [ ] Art-Net
- [ ] OSC out, stream recording and replay
- [ ] MIDI (`midir`)
- [ ] Language switch (strings live in `I18N` in `app.js`)
- [ ] macOS build

## License

[MIT](LICENSE) © Iurii Stranev
