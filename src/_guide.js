/*
  The in-app guide: Reticle's features, written once, rendered by the same
  _help.js the stranyov.pro tools use. F1 opens it.

  A feature may carry a clip — `clip: 'help/net-mode.mp4', dur: '0:08'` — filmed
  against the interface itself, so it can be re-shot whenever the interface
  changes. A feature without one is text, and the panel reads the same either
  way: nothing here waits on a recording.

  `common` is deliberately left out. StranyovHelp.COMMON describes the web
  tools — .stv projects, folding side panels, browser reloads — none of which
  exist here, and a guide that documents absent features is worse than a short
  one. Reticle's own reference sections sit at the end instead.
*/
(function () {
  'use strict';

  var HELP = {
    sections: [

      { label: 'Listening', features: [
        {
          title: 'Add a source',
          hero: true,
          blurb: 'A source is one socket: a protocol, a port and the adapter to listen on. "+ source" opens the strip at the top; several sources run at once, each with its own protocol and port, and the address table merges them — the SRC column says which one a row arrived on. A UDP port has exactly one listener at a time, so while Reticle holds it the intended receiver will not see that traffic. That is a property of UDP, not of this app.'
        },
        {
          title: 'Pick the interface, not 0.0.0.0',
          blurb: 'With 0.0.0.0 the multicast subscription goes to whichever adapter the routing table happens to pick — on a machine with a 10 GbE card beside a gigabit dongle that is a lottery, and a quiet table is the usual symptom. The dropdown lists the real adapters with their addresses; the arrow always shows the whole list, whatever is typed in the field.'
        },
        {
          title: 'OSC over UDP',
          blurb: 'Bundles are flattened, so a bundle of ten messages becomes ten rows rather than one. Arrays are flattened into slots too. Anything that is not valid OSC is rejected rather than guessed at — if nothing appears, switch that source to Raw UDP and see whether anything is arriving at all.'
        },
        {
          title: 'sACN (E1.31)',
          blurb: 'Ask for universe numbers — "1-4,10" — not a multicast group. The 239.255.x.x groups and port 5568 are defined by the standard, so Reticle derives them; unicast to the same port is accepted as well. Packets from other protocols, and any non-zero start code, are rejected rather than drawn as if they were levels.'
        },
        {
          title: 'Raw UDP',
          blurb: 'Answers one question: is anything arriving on this port at all? Each datagram becomes a row with its size, hex and ASCII. When the OSC parser stays quiet this is how you tell a silent sender from one that is sending something else entirely.'
        }
      ]},

      { label: 'Addresses', features: [
        {
          title: 'The table, not the log',
          hero: true,
          blurb: 'Protokol\'s main view is a message log, which answers "what arrived just now". On site the question is usually "what range does this value move in" and "why did it stop" — so the address table is the main view here and the log is secondary. One row per address, updated 30 times a second however fast the traffic is.'
        },
        {
          title: 'Statistics per slot',
          blurb: 'An address carrying three floats gets three independent sets of min / max / average. Aggregating them together would be meaningless: on /pos the X and Z of one message have nothing to do with each other. Click a row to open the detail panel and see each slot on its own.'
        },
        {
          title: 'Silence detection',
          blurb: 'An address that has stopped sending is highlighted, with how long it has been quiet. This is the fastest answer to "why isn\'t it moving" — and the one thing a scrolling log cannot show you, because the thing you are looking for is the absence of lines.'
        },
        {
          title: 'Real jitter',
          blurb: 'The interval between messages — minimum, average and maximum — so you can see that the "60 Hz" stream is actually running at 43, or that it is averaging 60 while stalling for 200 ms every few seconds.'
        },
        {
          title: 'Type changes',
          blurb: 'An address that suddenly sends an int where it used to send a float is flagged. That is almost always an integration bug, and one that takes an hour to find by hand.'
        },
        {
          title: 'Expected ranges',
          blurb: 'Declare that a slot should stay within 0..1 and anything leaving it turns red — in the table, in the detail panel, and on the graph where the bounds are drawn as dashed guides. Ranges are per slot, because on /pos with three floats X may live in -1..1 while Z runs 0..10.'
        },
        {
          title: 'Sparklines',
          blurb: 'A history thumbnail on each row, and a larger graph per argument slot in the detail panel. History is fetched in one batched call at 5 Hz rather than a request per row per frame, so a table of 200 addresses costs the same as a table of five.'
        }
      ]},

      { label: 'DMX', features: [
        {
          title: 'Universe strip and channel grid',
          hero: true,
          blurb: 'Each cell carries the channel number, the current value and min-max over time, and the fill follows brightness — so the grid reads as a lighting picture rather than a table of numbers. Only the universe currently open is pulled from the backend; the rest cost nothing.'
        },
        {
          title: 'Packet loss',
          blurb: 'Counted from gaps in the sequence numbers, handling the 255 to 0 wrap. A sender that leaves the sequence at zero is not counted at all, because zero means "not using sequence numbers", not "lost everything".'
        },
        {
          title: 'Frames per second, per universe',
          blurb: 'Immediately shows a console sending 25 where it should send 44 — or one universe lagging behind the others out of the same desk.'
        },
        {
          title: 'Two senders on one universe',
          blurb: 'Senders are tracked by CID with their priority, and when more than one claims the same universe it is flagged explicitly. Two consoles fighting over a universe produces lighting that looks merely "glitchy" until someone names it.'
        }
      ]},

      { label: 'HTTP', features: [
        {
          title: 'A REST client that is not the browser',
          hero: true,
          blurb: 'GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS with arbitrary headers and body. Requests are issued from the Rust side rather than the webview, so there is no CORS, any header is allowed, and a self-signed certificate can be accepted with a checkbox — which is what most show hardware offers.'
        },
        {
          title: 'Presets',
          blurb: 'Three explicit actions per preset: send, load into the form without sending, and delete. Separate on purpose — firing a request the moment you click the thing you meant to edit is a bad surprise. Export and import as JSON so a set can be handed to a colleague.'
        },
        {
          title: 'History',
          blurb: 'The last 30 requests with the start of the body, the status and the timing; resend in one click. The body preview matters: two POSTs to the same URL are otherwise indistinguishable in a list.'
        },
        {
          title: 'Save the response',
          blurb: 'The file format is picked from the content-type, and JSON is saved formatted rather than as one line.'
        },
        {
          title: 'Careful with exports',
          blurb: 'Exported presets carry their headers verbatim, Authorization included. Check before sharing a set.'
        }
      ]},

      { label: 'Network', features: [
        {
          title: 'Is every one of these links really what it should be?',
          hero: true,
          blurb: 'Targets are file shares — added one at a time, or as a range: give the first and last address plus the share path and every host in between appears at once. Each row reports read and write speed, latency, the share of the selected link speed, which file the read came from, TCP retransmissions, and which local adapter the traffic actually left by. Targets are measured one after another, never together: nine servers tested at once would share one uplink and every number would be wrong.'
        },
        {
          title: 'Write, read back, delete',
          blurb: 'The default mode. It writes its own files, reads those same files straight back, then removes them — so every server is measured against byte-identical data of the same size. Reading whatever media is already there cannot promise that: the test takes the first file large enough that it finds, so two servers can end up compared against different files on different volumes, and a server whose file sits on a slow disk looks exactly like a server with a bad link.'
        },
        {
          title: 'Bypass cache — a switch, not a policy',
          blurb: 'On SMB 3.0.2 and later the unbuffered flag travels to the far side as SMB2_READFLAG_READ_UNBUFFERED, so the server skips its own cache too and the figure includes its disk. Turn it off and every cache is in play. Running the same targets both ways is the measurement that separates a slow link from a slow array — a server that crawls unbuffered and flies buffered has a disk problem, not a link problem.'
        },
        {
          title: 'Not with the round trip',
          blurb: 'With the cache left in place, reading back a file written a second ago can be served from this machine\'s own RAM — a number that never crossed the network, sitting beside numbers that did. The app says so in red when that combination is selected. For the buffered half of a comparison use Read mode against real media instead.'
        },
        {
          title: 'Retransmissions',
          blurb: 'A link that is merely configured badly moves data slowly and loses nothing; a bad transceiver, a dirty strand or a broken offload retransmits constantly. The two are indistinguishable in a throughput figure and obvious side by side. The counter is machine-wide — Windows exposes no cheap per-connection equivalent — so it is only read as a delta across one target\'s run, which is the only time it means anything.'
        },
        {
          title: 'Several passes',
          blurb: 'Sweep the row more than once and every sweep\'s read speed is kept separately, never averaged. If the same servers are slow on every pass it is configuration; if the slow ones move around it is contention or something intermittent — different problems with different culprits, and one pass cannot tell them apart.'
        },
        {
          title: 'What this looks like',
          blurb: 'Under the table, in sentences: which targets are slow, whether the two directions disagree, what the retransmissions imply, and what to try next. The rules are few and each has to be defensible out loud — a tool that guesses confidently is worse than one that stays quiet, because a wrong lead costs an afternoon of pulling good cable. They also refuse to contradict each other: nothing suggests hunting for a shared setting while the wire is visibly dropping packets.'
        },
        {
          title: 'Which adapter it really used',
          blurb: 'Detected by connecting a UDP socket to the target and reading back the source address the kernel chose — no packet is sent, but the routing decision is the same one SMB will make. An application cannot choose the adapter, Windows decides by routing metric, but it can tell you when the wrong one was used. On a machine with a 10 GbE card beside a gigabit dongle that is an easy and invisible mistake.'
        },
        {
          title: 'Export report',
          blurb: 'Renders the table to PNG carrying the test parameters — size, streams, mode, link, the app version and the timestamp — plus the findings in full. A throughput figure without the conditions that produced it is not a measurement, and a report that travels to someone who was not standing there needs to say what it means.'
        },
        {
          title: 'Presets per venue',
          blurb: 'A preset stores the targets and the settings they were measured with, because comparing today\'s figure with last month\'s only means something if the test was the same. The app opens on the last preset used.'
        }
      ]},

      { label: 'Checking the tool', type: 'ref', rows: [
        { k: 'Why bother', v: 'A figure from this app can end up as the reason somebody is told their network is misconfigured. Before that happens it is worth confirming with code from outside this repository.' },
        { k: 'scripts/smb-check.ps1', v: 'Measures the same shares using robocopy and the system clock alone. Writes an incompressible file and times it, then reads an existing file back and times that — existing, because a file this machine wrote a second ago is still in this machine\'s RAM. -Repeat separates a server that is always slow from one that is sometimes slow.' },
        { k: 'cargo run --example netprobe', v: 'Runs the Network tab\'s own measurement without the window — the same code the interface calls. Pointed at the same file, the same volume, one stream and buffered, it and a plain FileStream loop do identical work, so any gap between them is the measurement rather than the network.' },
        { k: 'Interleave them', v: 'Run the two tools alternately per server, not one after the other. When a fault wanders, figures taken minutes apart prove nothing.' },
        { k: 'Same answer, different tools', v: 'That means the network. A disagreement means this app, and is worth reporting.' }
      ]},

      { label: 'Worth knowing', type: 'ref', rows: [
        { k: 'One listener per UDP port', v: 'While Reticle holds a port the intended receiver will not see that traffic. Multicast groups are shared between listeners; unicast is not.' },
        { k: 'Port sharing', v: 'Enabled for multicast only. For unicast, SO_REUSEADDR on Windows would mean silently intercepting someone else\'s traffic, so the app reports "port in use" instead.' },
        { k: 'Dropped data is shown', v: 'If a stream outruns processing, the loss counter is visible rather than silently swallowed. A monitor that hides its own losses is worse than none.' },
        { k: 'Write mode leaves nothing', v: 'Temporary files are created in the target folder and removed afterwards, including when a run fails — leftovers in a show folder are worse than a missing measurement. The data written is incompressible, so an array or link that compresses in flight cannot flatter the result.' },
        { k: 'Single-stream ceiling', v: 'One SMB stream tops out near 400-600 MB/s on a 10 GbE link: it runs out of one CPU core and round-trip latency long before it runs out of wire. Measuring single-threaded reports that ceiling as if it were the network — comparing 1 stream against 8 tells them apart.' },
        { k: 'macOS 15+', v: 'Asks for local network permission. Without it the socket receives nothing, silently.' }
      ]},

      { label: 'Keyboard', type: 'ref', rows: [
        { k: 'F1', v: 'Open this guide.' },
        { k: 'Esc', v: 'Close the guide, or the enlarged clip if one is open.' },
        { k: 'Click a row', v: 'In the address table: open the detail panel with a graph per argument slot.' },
        { k: 'Hover a clip', v: 'Plays it from the start; leaving holds the last frame — the result. Click to enlarge.' }
      ]}
    ]
  };

  function init() {
    var overlay = document.getElementById('guideOverlay');
    if (!overlay || !window.StranyovHelp) return;

    // Rendered once, on first open rather than at startup: the panel is a few
    // hundred nodes that most sessions never look at.
    var rendered = false;
    function open() {
      if (!rendered) {
        StranyovHelp.render(HELP, { nav: 'kbNav', content: 'kbContent', common: false });
        rendered = true;
      }
      overlay.classList.add('open');
    }
    function close() { overlay.classList.remove('open'); }

    var btn = document.getElementById('guideBtn');
    if (btn) btn.addEventListener('click', open);

    var x = document.getElementById('guideClose');
    if (x) x.addEventListener('click', close);

    // Only a click on the backdrop itself closes — a click that started inside
    // the panel and ended on the backdrop (a drag over text) must not.
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'F1') { e.preventDefault(); overlay.classList.contains('open') ? close() : open(); return; }
      // The clip lightbox has its own Esc; let it go first.
      if (e.key === 'Escape' && overlay.classList.contains('open') && !document.querySelector('.kb-lightbox.open')) close();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
