/*
  The stand-in for the Rust side, injected before any page script runs.

  Reticle's interface talks to the backend only through `window.__TAURI__`, so
  replacing that one object gives the real interface with scripted data. A clip
  needs the same numbers every take — a live network cannot give that twice
  running, and a guide whose figures change between recordings teaches nothing.

  The numbers below are a real run, kept because they are the case the Network
  tab exists for: four servers reading at a twentieth of the others while every
  write is normal.
*/
(() => {
  'use strict';

  const handlers = new Map();
  const emit = (name, payload) => {
    for (const cb of handlers.get(name) || []) { try { cb({ payload }); } catch (e) {} }
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const SERVERS = [
    ['00-dir', 0.8, 39, 854],
    ['01-act-1-us-walls', 0.8, 31, 610],
    ['02-act-2-floor-1', 1.0, 864, 874],
    ['03-act-3-floor-2', 1.4, 33, 663],
    ['04-act-4-arch', 2.2, 29, 718],
    ['05-act-5-gauze', 0.9, 845, 720],
    ['06-us-1-us-walls', 1.2, 899, 506],
    ['07-us-2-floor', 2.6, 856, 877],
    ['08-us-3-arch-gauze', 0.9, 888, 686],
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

  const COMMANDS = {
    app_version: () => '0.11.0',
    list_interfaces: () => ADAPTERS,
    list_sources: () => [],
    sparks: () => ({}),
    dmx_frame: () => null,
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
