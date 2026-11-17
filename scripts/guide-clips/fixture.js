/*
  The stand-in for the Rust side, injected before any page script runs.

  Reticle's interface talks to the backend only through `window.__TAURI__`, so
  replacing that one object gives the real interface with scripted data. A clip
  needs the same numbers every take — a live network cannot give that twice
  running, and a guide whose figures change between recordings teaches nothing.

  Everything here is invented. The shape of the result is the one the Network
  tab exists for — four servers reading at a twentieth of the others while
  every write is normal — but the venue, the machines and the project are made
  up, because a guide ships to anyone and a client's rig is not ours to show.
*/
(() => {
  'use strict';

  const handlers = new Map();
  const emit = (name, payload) => {
    for (const cb of handlers.get(name) || []) { try { cb({ payload }); } catch (e) {} }
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Named after surfaces, the way a rig usually is — and after no rig in
  // particular. [name, latency ms, read MB/s, write MB/s]
  const SERVERS = [
    ['01-stage-left', 0.8, 39, 854],
    ['02-stage-right', 0.8, 31, 610],
    ['03-floor', 1.0, 864, 874],
    ['04-ceiling', 1.4, 33, 663],
    ['05-rear-wall', 2.2, 29, 718],
    ['06-portal-l', 0.9, 845, 720],
    ['07-portal-r', 1.2, 899, 506],
    ['08-gauze', 2.6, 856, 877],
    ['09-director', 0.9, 888, 686],
  ];

  const ADAPTERS = [
    { name: 'Ethernet 3', ip: '192.168.2.2' },
    { name: 'Wi-Fi', ip: '10.0.0.44' },
    { name: 'Loopback', ip: '127.0.0.1' },
  ];

  /** One sweep of the row, paced so a clip can watch it rather than blink. */
  async function runTest(targets, opts) {
    const total = Number(opts.size_mb) * 1024 * 1024;
    const phases = opts.mode === 'roundtrip' ? ['write', 'read']
      : opts.mode === 'both' ? ['read', 'write']
      : [opts.mode];

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const [name, latency, read, write] = SERVERS[i % SERVERS.length];

      emit('nettest-start', target.id);
      emit('nettest-progress', { id: target.id, phase: 'probe', done: 0, total: 0 });
      await wait(110);

      // Four steps a phase is enough for the bar to read as moving. A real
      // 512 MB sweep takes the better part of a minute per server; a clip that
      // waited that out would be a clip nobody watches.
      for (const phase of phases) {
        for (let step = 1; step <= 4; step++) {
          emit('nettest-progress', { id: target.id, phase, done: (total / 4) * step, total });
          await wait(60);
        }
      }

      emit('nettest-result', {
        id: target.id,
        path: target.path,
        label: null,
        read_mbps: read,
        write_mbps: write,
        latency_ms: latency,
        read_bytes: total,
        write_bytes: total,
        read_file: 'reticle-speedtest-*.tmp',
        read_file_bytes: total / Number(opts.threads || 4),
        read_retrans: 0,
        write_retrans: 0,
        via_ip: '192.168.2.2',
        via_adapter: 'Ethernet 3',
        host_name: name,
        error: null,
        note: null,
      });
      await wait(80);
    }

    emit('nettest-done', false);
  }

  /* ---------- live traffic ----------
   * A source that is listening has to look like one: rows appearing, values
   * moving, a rate that settles. All of it is generated here, deterministically
   * enough that two takes of the same clip tell the same story.
   */

  const SOURCES = [];
  let tick = 0, ticker = null;

  // One OSC sender's worth of addresses, the shape a tracking system or a
  // console actually puts on the wire.
  const ADDRESSES = [
    { path: '/track/1/pos', slots: ['f', 'f', 'f'] },
    { path: '/track/2/pos', slots: ['f', 'f', 'f'] },
    { path: '/track/1/size', slots: ['f'] },
    { path: '/cue/current', slots: ['i'] },
    { path: '/cue/name', slots: ['s'] },
    { path: '/master/level', slots: ['f'] },
    { path: '/transport/playing', slots: ['b'] },
  ];

  const CUE_NAMES = ['ACT 1 — OPEN', 'ACT 1 — BUILD', 'ACT 2 — REVEAL'];
  const wave = (i, k, n) => (Math.sin((tick / 18) + i * 1.3 + k * 0.7) + 1) / 2 * n;

  function valueFor(tag, i, k) {
    if (tag === 'f') return { t: 'Float', v: +(wave(i, k, 1)).toFixed(3) };
    if (tag === 'i') return { t: 'Int', v: 1 + (Math.floor(tick / 40) % 3) };
    if (tag === 's') return { t: 'Str', v: CUE_NAMES[Math.floor(tick / 40) % 3] };
    return { t: 'Bool', v: true };
  }

  function statsSnapshot(sourceId) {
    const nowUs = 2_000_000 + tick * 33_333;
    const rows = ADDRESSES.map((a, i) => {
      const slots = a.slots.map((tag, k) => {
        const last = valueFor(tag, i, k);
        const num = typeof last.v === 'number' ? last.v : null;
        return {
          type_tag: tag, type_changed: false, last,
          min: num === null ? null : 0, max: num === null ? null : 1,
          avg: num === null ? null : 0.5,
        };
      });
      return {
        key: sourceId + '|' + a.path, source_id: sourceId, path: a.path,
        count: 40 + tick, last_us: nowUs, first_us: 2_000_000,
        rate: 60, dt_min_us: 15_000, dt_max_us: 19_000, dt_avg_us: 16_667,
        slots,
      };
    });
    return { rows, now_us: nowUs, total_addrs: rows.length };
  }

  function logBatch(sourceId) {
    const a = ADDRESSES[tick % ADDRESSES.length];
    return {
      messages: [{
        source_id: sourceId, path: a.path,
        args: a.slots.map((tag, k) => valueFor(tag, tick % ADDRESSES.length, k)),
        t_us: 2_000_000 + tick * 33_333, from: '192.168.2.40:51002',
      }],
      dropped: 0,
    };
  }

  /** A chase across the universe, so the grid reads as light rather than data.
   *  Unhurried because a real one is; it does not help the file size, which is
   *  set by the 512 cells of standing digits rather than by what moves. */
  const dmxValues = (universe) => Array.from({ length: 512 }, (_, ch) => {
    const head = Math.round(tick * 1.1 + universe * 40) % 512;
    const d = Math.min(Math.abs(ch - head), 512 - Math.abs(ch - head));
    return d < 40 ? Math.round(255 * (1 - d / 40)) : (ch % 16 === 0 ? 40 : 0);
  });

  const universeRows = (sourceId) => [1, 2, 3, 4].map((u) => ({
    source_id: sourceId, universe: u, width: 512,
    count: 200 + tick, lost: u === 3 ? 2 : 0, preview: 0, fps: u === 2 ? 25.0 : 44.0,
    last_us: 2_000_000 + tick * 33_333,
    senders: u === 4
      ? [{ cid: 'a1', name: 'Console A', priority: 100, count: 120 + tick, last_us: 2_000_000 },
         { cid: 'b2', name: 'Console B', priority: 100, count: 80 + tick, last_us: 2_000_000 }]
      : [{ cid: 'a1', name: 'Console A', priority: 100, count: 200 + tick, last_us: 2_000_000 }],
    conflict: u === 4,
  }));

  function startTraffic() {
    if (ticker) return;
    ticker = setInterval(() => {
      tick++;
      const osc = SOURCES.find((s) => s.cfg.kind === 'osc-udp');
      const sacn = SOURCES.find((s) => s.cfg.kind === 'sacn');
      if (osc) { emit('stats', statsSnapshot(osc.id)); emit('log', logBatch(osc.id)); }
      if (sacn) emit('dmx', universeRows(sacn.id));
      emit('sources', SOURCES.map((s) => ({ ...s, packets: 200 + tick * 7, messages: 400 + tick * 9 })));
    }, 33);
  }

  const COMMANDS = {
    app_version: () => '0.11.0',
    list_interfaces: () => ADAPTERS,
    list_sources: () => SOURCES,
    sparks: ({ requests }) => (requests || []).map((r, i) =>
      Array.from({ length: 60 }, (_, n) => (Math.sin(n / 7 + i) + 1) / 2)),
    add_source: ({ cfg }) => {
      const info = {
        id: SOURCES.length + 1, cfg, local_port: cfg.port, status: 'listening',
        error: null, packets: 0, messages: 0, invalid: 0, dropped: 0,
      };
      SOURCES.push(info);
      startTraffic();
      return info;
    },
    remove_source: ({ id }) => {
      const i = SOURCES.findIndex((s) => s.id === id);
      if (i >= 0) SOURCES.splice(i, 1);
      emit('sources', SOURCES);
      return null;
    },
    dmx_frame: ({ universe }) => {
      const sacn = SOURCES.find((s) => s.cfg.kind === 'sacn');
      if (!sacn) return null;
      const values = dmxValues(universe);
      return {
        source_id: sacn.id, universe, width: 512, values,
        min: values.map((v) => Math.max(0, v - 30)),
        max: values.map((v) => Math.min(255, v + 30)),
        count: 200 + tick, lost: 0, preview: 0, fps: 44.0,
        last_us: 2_000_000 + tick * 33_333,
      };
    },
    http_request: ({ req }) => {
      const body = JSON.stringify({
        status: 'ok',
        transport: { playing: true, position: '00:01:12:04' },
        track: { name: 'ACT 1 — OPEN', loop: false },
      });
      return {
        status: 200, status_text: 'OK',
        headers: [['content-type', 'application/json'], ['server', 'd3/26.1']],
        body, json_pretty: JSON.stringify(JSON.parse(body), null, 2),
        content_type: 'application/json', size: body.length, truncated: false, ms: 14,
      };
    },
    pick_folder: () => null,
    save_text: () => null,
    save_binary: () => null,
    open_text: () => null,
    reset_stats: () => null,
    set_paused: () => null,
    net_test_cancel: () => null,
    // Names are what people call these boxes; the guide should show them, not
    // a column of raw addresses.
    resolve_hosts: ({ hosts }) => hosts.map((h) => {
      const last = Number(String(h).split('.').pop());
      const row = SERVERS[last - 11];
      return row ? row[0] : null;
    }),
    net_test: ({ targets, opts }) => { runTest(targets, opts); return null; },
  };

  window.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => (COMMANDS[cmd] ? COMMANDS[cmd](args || {}) : null),
    },
    event: {
      listen: async (name, cb) => {
        if (!handlers.has(name)) handlers.set(name, []);
        handlers.get(name).push(cb);
        return () => {};
      },
    },
  };
})();
