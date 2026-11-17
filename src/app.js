/* Reticle — the interface.
 *
 * The backend emits snapshots 30 times per second, but the DOM is touched no
 * more than once per frame: snapshots accumulate in the model and repainting
 * happens on requestAnimationFrame. A stream of 6000 messages per second
 * therefore looks as smooth as one of 10.
 */

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

/* ---------- strings ----------
 * Everything the user sees lives here. A language switch, once it exists,
 * changes LANG and calls applyStaticStrings() — no other code needs touching.
 */

const I18N = {
  en: {
    addSource: '+ source',
    pause: 'Pause',
    resume: 'Resume',
    pauseHint: 'Freeze the view — capture keeps running',
    reset: 'Reset',
    resetHint: 'Clear all statistics',
    port: 'Port',
    interface: 'Interface',
    multicast: 'Multicast',
    multicastNone: 'none',
    listen: 'Listen',
    cancel: 'Cancel',
    tabAddresses: 'Addresses',
    tabLog: 'Log',
    filter: 'Filter',
    filterHint: '/cue or part of an address',
    colSrc: 'src',
    colAddress: 'address',
    colType: 'type',
    colValue: 'value',
    colMin: 'min',
    colMax: 'max',
    colAvg: 'avg',
    colHz: 'hz',
    colCount: 'count',
    colDt: 'Δt, ms',
    colDtHint: 'interval between messages: average (min–max)',
    colSilence: 'silence',
    colGraph: 'graph',
    rangeHint: 'Set an expected range to catch values that leave it',
    expected: 'Expected',
    clearRange: 'clear',
    slotIndex: (n) => `slot ${n}`,
    outOfRange: 'out of range',
    colSilenceHint: 'how long this address has been quiet',
    emptyTitle: 'No ports are being listened to.',
    quickStart: 'Listen for OSC on 9000',
    portHint: 'A UDP port has one listener at a time — while Reticle holds it, the intended receiver will not see it.',
    removeSource: 'Remove source',
    uiSize: 'Size',
    sizeS: 'Small',
    sizeM: 'Medium',
    sizeL: 'Large',
    protocol: 'Protocol',
    rawUdp: 'Raw UDP (hex)',
    universes: 'Universes',
    tabDmx: 'DMX',
    tabHttp: 'HTTP',
    tabNet: 'Network',
    netSize: 'Size',
    netThreads: 'Streams',
    netMode: 'Mode',
    netModeRound: 'Write + read back',
    netModeRead: 'Read',
    netModeWrite: 'Write',
    netModeBoth: 'Read + write',
    netRun: 'Run',
    netStop: 'Stop',
    netAdd: '+ target',
    netTarget: 'target',
    netLatency: 'latency',
    netRead: 'read',
    netWrite: 'write',
    netPreset: 'Preset',
    netPresetNone: '— none —',
    netPresetNameHint: 'preset name',
    netPresetSave: 'Save',
    netPresetDelete: 'Delete',
    netPresetSaved: (name, n) => `saved "${name}" with ${n} targets`,
    netPresetLoaded: (name, n) => `loaded "${name}": ${n} targets`,
    netPresetDeleted: (name) => `deleted "${name}"`,
    netPresetNeedName: 'name the preset first',
    netPresetNeedTargets: 'add targets before saving a preset',
    netExport: 'Export report',
    netReportTitle: 'RETICLE — NETWORK REPORT',
    netReportNothing: 'run a test first',
    netReportSummary: (n, lo, hi, spread) => `${n} targets · ${lo}–${hi} MB/s · spread x${spread}`,
    netLink: 'Link',
    netReadOf: (label) => `read · % of ${label}`,
    netWriteOf: (label) => `write · % of ${label}`,
    netStatus: 'status',
    netEmptyTitle: 'No targets yet.',
    netWriteWarning: 'Write mode creates temporary files in each folder and deletes them afterwards.',
    netRoundWarning: 'Writes temporary files, reads them straight back, then deletes them. Every server is measured against identical files — but the server still holds what was just written in its RAM, so this is the speed of the path, not of the array.',
    netRoundBufferedWarning: 'Cache bypass is off while reading back a file this machine wrote a second ago — which it may still be holding in its own RAM, so the read figure can be one that never crossed the network. For the buffered half of a comparison use Read mode against real media instead.',
    netPathHint: '\\\\192.168.2.11\\share\\folder',
    netBrowse: 'Browse',
    netRemove: 'Remove target',
    netRange: 'Add a range',
    netAddRange: 'Add',
    netRangeAdded: (n) => `added ${n}`,
    netRangeSkipped: (added, dupes) => `added ${added}, ${dupes} already in the list`,
    netRangeBadIp: 'both ends must be IPv4 addresses',
    netRangeDifferentSubnet: 'both ends must share the first three octets',
    netRangeBackwards: 'the first address must come before the last',
    netRangeTooMany: (n) => `that is ${n} targets — keep it under 128`,
    netRangeNeedPath: 'add the share path too',
    netExpect: 'Expect',
    netAnyAdapter: 'any adapter',
    netVia: 'via',
    netWrongAdapter: (name) => `went via ${name}, not the one you expected`,
    netQueued: 'queued',
    netMeasuring: 'measuring…',
    netDone: (n) => `${n} measured`,
    netCancelled: 'stopped',
    netFile: 'file read',
    netBypass: 'Bypass cache',
    netBypassHint: 'Ask for unbuffered I/O. On SMB 3.0.2 and later this travels to the server, which then skips its own cache too — so the figure includes the far side\'s disk. Run the same test with it off and the pair of numbers separates a slow link from a slow array.',
    netRetrans: 'retrans',
    netRetransHint: 'TCP segments retransmitted while this target was measured. Machine-wide, so it only means something during a run. Thousands point at the cable, the transceiver or a driver; none at all points at configuration.',
    netRetransSplit: (read, write) => `read ${read} · write ${write}`,
    netBufferedTag: 'buffered',

    netFindings: 'What this looks like',
    netFindAsym: (names, ratio) => `Reads collapse while writes stay normal on ${names} — ${ratio}× apart. Only one direction of the link is in trouble, and on fibre that is a different strand from the one the writes used.`,
    netFindSlowGroup: (names, lo, hi, best) => `${names} read at ${lo}–${hi} MB/s against ${best} elsewhere.`,
    netFindUniform: (n) => `Those ${n} land on nearly the same number despite different latencies. ${n} independent faults would scatter; one shared setting would not — look for what those machines have in common rather than at each one separately.`,
    netFindRetransHigh: (names, n) => `${names} retransmitted ${n} segments during the run. That is the wire or a driver, not a setting: check the port error counters at the switch and the transceiver on the slow side.`,
    netFindRetransNone: 'No retransmissions worth speaking of, so every packet is arriving first time. A clean wire that still crawls points at configuration or at the far side\'s disk, not at the cable.',
    netFindBypassCompare: (names, from, to) => `With the cache in play ${names} read at ${to} MB/s against ${from} unbuffered. The wire can clearly carry it, so what is slow is the unbuffered path — on SMB that means the server\'s own disk read, not the network.`,
    netFindBypassHintTry: 'Run this again with "Bypass cache" off: if the slow ones speed up, the link is fine and the far side\'s disk is the bottleneck.',
    netFindBypassHintRead: 'To try the same targets with the cache in play, switch to Read mode against real media and turn "Bypass cache" off. Doing it in this mode would read back a file this machine just wrote, which it may still hold in RAM — a figure that never crosses the network.',
    netFindOneStream: 'One stream measures one stream. A single SMB connection runs out of a CPU core long before it runs out of 10 GbE — raise it to 4 or 8 before reading anything into these numbers.',
    netFindAllWell: (lo, hi) => `Nothing stands out — ${lo}–${hi} MB/s across the board.`,
    netFileSize: (name, mb) => `${name} — ${mb} MB`,
    netPhaseProbe: 'reaching the host…',
    netPhaseRead: 'reading',
    netPhaseWrite: 'writing',
    netPhaseIdle: 'working…',
    netProgOf: (done, total) => `${done} / ${total} MB`,
    netProgStep: (i, n) => `${i} of ${n}`,
    guide: '? Guide',
    guideHint: 'Open the guide (F1)',
    guideEyebrow: 'Guide',
    guideLead: 'A protocol monitor for AV work: OSC, sACN and raw UDP on several ports at once, an HTTP client for poking show hardware, and throughput testing across file shares. Hover a clip to preview it, click to enlarge.',
    netGroupPreset: 'Preset',
    netGroupTest: 'Measurement',
    netGroupExpect: 'Expected',
    netGroupRun: 'Actions',
    netPasses: 'Passes',
    netPassesHint: 'Sweep the whole row this many times, back to back. A fault that moves between sweeps is a different animal from one that sits still, and one pass cannot tell them apart.',
    netByPass: 'per pass',
    netByPassHint: 'Read speed from each sweep, in order. Averaging them would hide the only thing worth seeing.',
    netPassDetail: (pass, read, write) => `pass ${pass}: read ${read}, write ${write} MB/s`,
    netProgPass: (pass, passes) => `pass ${pass}/${passes}`,
    netDonePasses: (n, passes) => (passes > 1 ? `${n} measured over ${passes} passes` : `${n} measured`),
    netFindWanders: (spans) => `This moves between sweeps: ${spans} MB/s. A fault that comes and goes within one run is not a setting on those machines — a setting does not heal itself thirty seconds later. Look at what they were doing at the time: playback, a render, a backup, anything sharing the array or the uplink.`,
    netOneStream: 'one stream measures a single stream, not the link',
    mbps: (n) => `${Math.round(n)} MB/s`,
    ms: (n) => `${n.toFixed(1)} ms`,
    dmxEmptyTitle: 'No sACN universes seen yet.',
    dmxQuickStart: 'Listen to sACN universes 1–4',
    uniShort: (n) => `U${n}`,
    fps: (n) => `${n} fps`,
    lost: (n) => `${n} lost`,
    channels: (n) => `${n} ch`,
    conflict: 'two senders',
    previewCount: (n) => `${n} preview`,
    senderLine: (name, prio) => `${name || 'unnamed'} · priority ${prio}`,
    send: 'Send',
    sending: 'Sending…',
    insecure: 'Ignore TLS errors',
    headers: 'Headers — one per line, "Name: value"',
    bodyLabel: 'Body',
    responseHeaders: 'Response headers',
    needUrl: 'Enter a URL first',
    saveResponse: 'Save response',
    copyBody: 'Copy body',
    copied: 'copied',
    savedTo: (path) => `saved: ${path}`,
    saveFailed: (err) => `save failed: ${err}`,
    savePreset: 'Save',
    exportPresets: 'Export',
    importPresets: 'Import',
    history: 'History',
    resend: 'Resend',
    historyEmpty: 'Nothing sent yet',
    historyCount: (n) => `(${n})`,
    exported: (n) => `exported ${n} preset${n === 1 ? '' : 's'}`,
    imported: (n) => `imported ${n} preset${n === 1 ? '' : 's'}`,
    nothingToExport: 'no presets to export',
    badPresetFile: 'not a Reticle preset file',
    failedStatus: 'failed',
    presetNameHint: 'preset name',
    presetsEmpty: 'No saved presets yet',
    resendPreset: 'Send this preset',
    editPreset: 'Load into the form without sending',
    deletePreset: 'Delete preset',
    needPresetName: 'Name the preset first',

    addressCount: (n) => `${n} ${n === 1 ? 'address' : 'addresses'}`,
    shownCount: (n) => `${n} shown`,
    bytes: (n) => `<${n} bytes>`,
    logTruncated: (n) => `… ${n} messages not shown (stream is faster than the log can draw)`,
    packets: (n) => `${n} pkt`,
    nonOsc: (n) => `${n} non-OSC`,
    droppedCount: (n) => `${n} dropped`,
    droppingWarning: 'dropping messages — stream is faster than processing',
    msgRate: (n) => `${n} msg/s`,
    unitMs: 'ms',
    unitS: 's',
    unitMin: 'min',
    responseMeta: (ms, size) => `${ms} ms · ${size} bytes`,
    bodyTruncated: 'body truncated for display',
  },
};

let LANG = 'en';
const t = (key, ...args) => {
  const v = I18N[LANG][key];
  return typeof v === 'function' ? v(...args) : v;
};

/** Fill in static labels from the markup via data-i18n. */
function applyStaticStrings() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }

  // Not a static label: which caveat is shown depends on the chosen mode, so it
  // is re-picked here rather than carrying a data-i18n of its own.
  paintNetWarn();
}

/* ---------- state ---------- */

/** After how many silent seconds an address counts as gone quiet. */
const SILENCE_S = 3;
/** How many lines the log keeps — older ones are dropped. */
const LOG_MAX = 500;

const model = new Map();   // key -> snapshot row
const rows = new Map();    // key -> { tr, cells }
let nowUs = 0;
let dirty = false;
let filterText = '';
let paused = false;
let sources = [];
let sourceCount = 0;

const $ = (id) => document.getElementById(id);
const addrBody = $('addrBody');
const logBody = $('logBody');

/* ---------- formatting ---------- */

function fmtNum(n) {
  if (n === null || n === undefined) return '—';
  if (!isFinite(n)) return '—';
  if (Number.isInteger(n)) return String(n);
  const a = Math.abs(n);
  if (a >= 1000) return n.toFixed(1);
  if (a >= 1) return n.toFixed(3);
  return n.toFixed(4);
}

/** Values arrive tagged from the backend: { t: "Float", v: 0.5 }. */
function fmtValue(val) {
  if (!val) return '—';
  switch (val.t) {
    case 'Float': return fmtNum(val.v);
    case 'Int': return String(val.v);
    case 'Str': return JSON.stringify(val.v);
    case 'Bool': return val.v ? 'true' : 'false';
    case 'Blob': return t('bytes', val.v);
    case 'Nil': return 'nil';
    case 'Impulse': return 'impulse';
    case 'Time': return `t${val.v}`;
    default: return '—';
  }
}

function fmtMs(us) {
  if (!us) return '—';
  return (us / 1000).toFixed(1);
}

function fmtSilence(us) {
  const s = us / 1e6;
  if (s < 1) return `${(s * 1000).toFixed(0)} ${t('unitMs')}`;
  if (s < 60) return `${s.toFixed(1)} ${t('unitS')}`;
  return `${Math.floor(s / 60)} ${t('unitMin')}`;
}

/* ---------- expected ranges ----------
 * "I expect 0..1 here" — and anything outside gets flagged. Stored per
 * source+address+slot, because a value only means something inside its slot.
 */

const RANGES_KEY = 'reticle-ranges';

function loadRanges() {
  try {
    const raw = JSON.parse(localStorage.getItem(RANGES_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

let ranges = loadRanges();

const rangeKey = (sourceId, path, slot) => `${sourceId}:${path}:${slot}`;

function setRange(sourceId, path, slot, min, max) {
  const key = rangeKey(sourceId, path, slot);
  if (!Number.isFinite(min) && !Number.isFinite(max)) {
    delete ranges[key];
  } else {
    ranges[key] = { min, max };
  }
  localStorage.setItem(RANGES_KEY, JSON.stringify(ranges));
}

/** Is this slot's latest value outside what was declared? */
function isOutOfRange(row, slot, index) {
  const r = ranges[rangeKey(row.source_id, row.path, index)];
  if (!r) return false;
  const v = slot.last && slot.last.v;
  if (typeof v !== 'number') return false;
  return (Number.isFinite(r.min) && v < r.min) || (Number.isFinite(r.max) && v > r.max);
}

/* ---------- sparklines ---------- */

/** Colours come from the theme, so reading them once per tick is enough —
 *  getComputedStyle per canvas would be wasteful with a hundred rows. */
let palette = null;

function refreshPalette() {
  const s = getComputedStyle(document.documentElement);
  palette = {
    line: s.getPropertyValue('--accent').trim(),
    bad: s.getPropertyValue('--danger').trim(),
    guide: s.getPropertyValue('--dimmer').trim(),
  };
}

/**
 * Draw a value history. When an expected range is given, its bounds are drawn
 * as dashed guides and the trace turns red once it leaves them — that is the
 * whole reason to declare a range.
 */
function drawSpark(canvas, data, range) {
  if (!palette) refreshPalette();

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || Number(canvas.dataset.w) || 88;
  const h = canvas.clientHeight || Number(canvas.dataset.h) || 20;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pts = (data || []).map((v) => (Number.isFinite(v) ? v : null));
  const real = pts.filter((v) => v !== null);
  if (real.length < 2) return;

  let lo = Math.min(...real);
  let hi = Math.max(...real);
  if (range) {
    if (Number.isFinite(range.min)) lo = Math.min(lo, range.min);
    if (Number.isFinite(range.max)) hi = Math.max(hi, range.max);
  }
  if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }

  const px = (i) => (i / (pts.length - 1)) * (w - 1) + 0.5;
  const py = (v) => h - 1.5 - ((v - lo) / (hi - lo)) * (h - 3);

  if (range) {
    ctx.strokeStyle = palette.guide;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    for (const bound of [range.min, range.max]) {
      if (!Number.isFinite(bound)) continue;
      ctx.beginPath();
      ctx.moveTo(0, py(bound));
      ctx.lineTo(w, py(bound));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  const escaped = range && real.some((v) =>
    (Number.isFinite(range.min) && v < range.min) || (Number.isFinite(range.max) && v > range.max));

  ctx.strokeStyle = escaped ? palette.bad : palette.line;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  let started = false;
  pts.forEach((v, i) => {
    if (v === null) { started = false; return; }
    if (!started) { ctx.moveTo(px(i), py(v)); started = true; }
    else ctx.lineTo(px(i), py(v));
  });
  ctx.stroke();
}

/* ---------- address table ---------- */

function makeRow(key) {
  const tr = document.createElement('tr');
  const cells = {};
  const cols = [
    ['src', 'col-src'], ['path', 'col-path'], ['type', 'col-type'],
    ['last', 'num'], ['min', 'num'], ['max', 'num'], ['avg', 'num'],
    ['rate', 'num'], ['count', 'num'], ['dt', 'num'], ['silence', 'num silence'],
    ['spark', 'spark'],
  ];
  for (const [name, cls] of cols) {
    const td = document.createElement('td');
    td.className = cls;
    cells[name] = td;
    tr.appendChild(td);
  }

  // One canvas per row, drawn from the batched history poll below.
  const canvas = document.createElement('canvas');
  canvas.style.width = '88px';
  canvas.style.height = '20px';
  cells.spark.appendChild(canvas);

  const entry = { tr, cells, canvas };
  tr.onclick = () => selectRow(key);
  rows.set(key, entry);
  addrBody.appendChild(tr);
  return entry;
}

/** Multi-slot addresses are drawn line by line inside the cell.
 *  `mark` optionally adds a class per slot — used to flag out-of-range values. */
function fillSlots(td, slots, pick, mark) {
  if (slots.length <= 1) {
    const s = slots[0];
    td.textContent = s ? pick(s) : '—';
    td.classList.toggle('type-changed', !!(s && s.type_changed));
    td.classList.toggle('out-of-range', !!(s && mark && mark(s, 0)));
    return;
  }
  td.textContent = '';
  td.classList.remove('type-changed', 'out-of-range');
  slots.forEach((s, i) => {
    const span = document.createElement('span');
    span.className = 'slot'
      + (s.type_changed ? ' type-changed' : '')
      + (mark && mark(s, i) ? ' out-of-range' : '');
    span.textContent = pick(s);
    td.appendChild(span);
  });
}

function render() {
  dirty = false;

  let visible = 0;
  for (const [key, row] of model) {
    const match = !filterText || row.path.toLowerCase().includes(filterText);
    let entry = rows.get(key);

    if (!match) {
      if (entry) { entry.tr.remove(); rows.delete(key); }
      continue;
    }
    visible++;
    if (!entry) entry = makeRow(key);

    const c = entry.cells;
    c.src.textContent = row.port ?? row.source_id;
    c.path.textContent = row.path;
    fillSlots(c.type, row.slots, (s) => s.type_tag || '—');
    fillSlots(c.last, row.slots, (s) => fmtValue(s.last), (s, i) => isOutOfRange(row, s, i));
    fillSlots(c.min, row.slots, (s) => fmtNum(s.min));
    fillSlots(c.max, row.slots, (s) => fmtNum(s.max));
    fillSlots(c.avg, row.slots, (s) => fmtNum(s.avg));
    c.rate.textContent = row.rate < 0.05 ? '—' : row.rate.toFixed(1);
    c.count.textContent = row.count;

    c.dt.textContent = row.dt_max_us
      ? `${fmtMs(row.dt_avg_us)} (${fmtMs(row.dt_min_us)}–${fmtMs(row.dt_max_us)})`
      : '—';

    const silenceUs = Math.max(0, nowUs - row.last_us);
    c.silence.textContent = fmtSilence(silenceUs);
    entry.tr.classList.toggle('is-silent', silenceUs > SILENCE_S * 1e6);
    entry.tr.classList.toggle('is-selected', key === selectedKey);
  }

  $('sbAddrs').textContent = t('addressCount', model.size);
  $('statNote').textContent = filterText ? t('shownCount', visible) : '';
  $('emptyState').hidden = model.size > 0 || sourceCount > 0;
}

function scheduleRender() {
  if (dirty) return;
  dirty = true;
  requestAnimationFrame(render);
}

/* ---------- detail panel ---------- */

let selectedKey = null;

function selectRow(key) {
  selectedKey = key;
  renderDetail();
  scheduleRender();
}

/** Rebuilt only when the selection changes; values inside are refreshed by the
 *  history poll, so typing in a range field does not fight with a repaint. */
function renderDetail() {
  const panel = $('detail');
  const row = selectedKey && model.get(selectedKey);

  if (!row) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  $('detailPath').textContent = `${row.port ?? row.source_id} · ${row.path}`;

  const box = $('detailSlots');
  box.textContent = '';

  row.slots.forEach((_, i) => {
    const card = document.createElement('div');
    card.className = 'detail-slot';

    const head = document.createElement('div');
    head.className = 'detail-slot-head';

    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = t('slotIndex', i);

    const val = document.createElement('span');
    val.className = 'val';
    val.dataset.role = 'value';

    const mm = document.createElement('span');
    mm.className = 'mm';
    mm.dataset.role = 'minmax';

    head.append(idx, val, mm);

    const canvas = document.createElement('canvas');
    canvas.style.width = '320px';
    canvas.style.height = '68px';
    canvas.dataset.slot = i;

    const rangeRow = document.createElement('div');
    rangeRow.className = 'range-row';

    const label = document.createElement('span');
    label.textContent = t('expected');

    const stored = ranges[rangeKey(row.source_id, row.path, i)] || {};
    const minIn = document.createElement('input');
    minIn.type = 'text';
    minIn.placeholder = 'min';
    minIn.value = Number.isFinite(stored.min) ? stored.min : '';

    const maxIn = document.createElement('input');
    maxIn.type = 'text';
    maxIn.placeholder = 'max';
    maxIn.value = Number.isFinite(stored.max) ? stored.max : '';

    const apply = () => {
      const lo = parseFloat(minIn.value.replace(',', '.'));
      const hi = parseFloat(maxIn.value.replace(',', '.'));
      setRange(row.source_id, row.path, i, lo, hi);
      scheduleRender();
    };
    minIn.onchange = apply;
    maxIn.onchange = apply;

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn';
    clear.textContent = t('clearRange');
    clear.onclick = () => {
      minIn.value = '';
      maxIn.value = '';
      apply();
    };

    rangeRow.append(label, minIn, maxIn, clear);
    card.append(head, canvas, rangeRow);
    box.appendChild(card);
  });

  refreshDetailValues();
}

/** Numbers and traces in the panel, refreshed on the history tick. */
function refreshDetailValues(sparkData) {
  const row = selectedKey && model.get(selectedKey);
  if (!row || $('detail').hidden) return;

  const cards = $('detailSlots').children;
  row.slots.forEach((_, i) => {
    const card = cards[i];
    if (!card) return;

    const out = isOutOfRange(row, slot, i);
    const val = card.querySelector('[data-role="value"]');
    val.textContent = fmtValue(slot.last);
    val.classList.toggle('out-of-range', out);

    card.querySelector('[data-role="minmax"]').textContent =
      `${fmtNum(slot.min)} … ${fmtNum(slot.max)}`;

    if (sparkData && sparkData[i] !== undefined) {
      drawSpark(card.querySelector('canvas'), sparkData[i], ranges[rangeKey(row.source_id, row.path, i)]);
    }
  });
}

$('detailClose').onclick = () => {
  selectedKey = null;
  renderDetail();
  scheduleRender();
};

/* ---------- history polling ----------
 * Sparklines change slowly compared to the numbers, so 5 Hz is plenty — and
 * one batched call keeps a hundred rows from turning into a hundred round
 * trips per frame.
 */

const SPARK_HZ = 5;

setInterval(async () => {
  if (paused) return;
  if (!document.getElementById('view-addrs').classList.contains('is-active')) return;

  refreshPalette();

  // Rows in the table: slot 0 only — a thumbnail cannot show more usefully.
  const visible = [...rows.keys()].slice(0, 200);
  const requests = visible.map((key) => {
    const row = model.get(key);
    return { source_id: row.source_id, path: row.path, slot: 0 };
  });

  // The selected address additionally needs every slot for the detail panel.
  const row = selectedKey && model.get(selectedKey);
  const detailStart = requests.length;
  if (row) {
    row.slots.forEach((_, i) => requests.push({ source_id: row.source_id, path: row.path, slot: i }));
  }
  if (!requests.length) return;

  let data;
  try {
    data = await invoke('sparks', { requests });
  } catch {
    return;
  }

  visible.forEach((key, i) => {
    const entry = rows.get(key);
    const modelRow = model.get(key);
    if (!entry || !modelRow) return;
    drawSpark(entry.canvas, data[i], ranges[rangeKey(modelRow.source_id, modelRow.path, 0)]);
  });

  if (row) refreshDetailValues(data.slice(detailStart));
}, 1000 / SPARK_HZ);

/* ---------- log ---------- */

function appendLog(batch) {
  const frag = document.createDocumentFragment();

  for (const m of batch.messages) {
    const div = document.createElement('div');
    div.className = 'log-row';

    const time = document.createElement('span');
    time.className = 'log-t';
    time.textContent = (m.t_us / 1e6).toFixed(3);

    const src = document.createElement('span');
    src.className = 'log-src';
    src.textContent = portOf(m.source_id);

    const path = document.createElement('span');
    path.className = 'log-path';
    path.textContent = m.path;

    const args = document.createElement('span');
    args.className = 'log-args';
    args.textContent = m.args.map(fmtValue).join('  ');

    div.append(time, src, path, args);
    frag.appendChild(div);
  }

  if (batch.dropped > 0) {
    const note = document.createElement('div');
    note.className = 'log-note';
    note.textContent = t('logTruncated', batch.dropped);
    frag.appendChild(note);
  }

  const atBottom = logBody.scrollTop + logBody.clientHeight >= logBody.scrollHeight - 40;
  logBody.appendChild(frag);

  while (logBody.childElementCount > LOG_MAX) logBody.firstElementChild.remove();
  if (atBottom) logBody.scrollTop = logBody.scrollHeight;
}

/* ---------- sources ---------- */

function portOf(id) {
  const s = sources.find((x) => x.id === id);
  return s ? String(s.local_port) : String(id);
}

function renderSources() {
  const strip = $('srcStrip');
  strip.textContent = '';
  sourceCount = sources.length;

  for (const s of sources) {
    const chip = document.createElement('div');
    chip.className = 'src-chip' + (s.packets === 0 ? ' is-silent' : '');

    const dot = document.createElement('span');
    dot.className = 'dot';

    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = { 'raw-udp': 'raw', sacn: 'sacn' }[s.cfg.kind] ?? 'osc';

    const label = document.createElement('span');
    label.textContent = s.cfg.multicast ? `${s.cfg.multicast}:${s.local_port}` : `:${s.local_port}`;

    const meta = document.createElement('span');
    meta.className = 'meta';
    const bits = [t('packets', s.packets)];
    if (s.invalid > 0) bits.push(t('nonOsc', s.invalid));
    if (s.dropped > 0) bits.push(t('droppedCount', s.dropped));
    meta.textContent = bits.join(' · ');

    const x = document.createElement('span');
    x.className = 'x';
    x.textContent = '×';
    x.title = t('removeSource');
    x.onclick = () => removeSource(s.id);

    chip.append(dot, kind, label, meta, x);
    strip.appendChild(chip);
  }

  $('emptyState').hidden = model.size > 0 || sourceCount > 0;
}

async function refreshSources() {
  sources = await invoke('list_sources');
  renderSources();
}

async function addSource(cfg) {
  $('srcErr').textContent = '';
  try {
    await invoke('add_source', { cfg });
    await refreshSources();
    $('srcForm').hidden = true;
  } catch (e) {
    $('srcErr').textContent = String(e);
    $('srcForm').hidden = false;
  }
}

async function removeSource(id) {
  await invoke('remove_source', { id });
  for (const [key, row] of [...model]) {
    if (row.source_id === id) {
      model.delete(key);
      const entry = rows.get(key);
      if (entry) { entry.tr.remove(); rows.delete(key); }
    }
  }
  await refreshSources();
  scheduleRender();
}

/* ---------- backend events ---------- */

listen('stats', (e) => {
  const snap = e.payload;
  nowUs = snap.now_us;
  for (const row of snap.rows) {
    const prev = model.get(row.key);
    // the port is resolved once, so each repaint does not search the source list
    row.port = prev?.port ?? portOf(row.source_id);
    model.set(row.key, row);
  }
  scheduleRender();
});

listen('log', (e) => {
  if (paused) return;
  appendLog(e.payload);
});

listen('sources', (e) => {
  sources = e.payload;
  renderSources();
  $('sbDropped').textContent = sources.some((s) => s.dropped > 0) ? t('droppingWarning') : '';
});

/* ---------- controls ---------- */

$('addSrcBtn').onclick = () => {
  const f = $('srcForm');
  f.hidden = !f.hidden;
  if (!f.hidden) $('fPort').focus();
};

$('srcCancel').onclick = () => { $('srcForm').hidden = true; };

// For sACN the port and groups are fixed by the standard, so there is nothing
// to type by hand — universe numbers are asked for instead.
$('fKind').onchange = () => {
  const isSacn = $('fKind').value === 'sacn';
  $('fUniversesRow').hidden = !isSacn;
  $('fMulticastRow').hidden = isSacn;
  $('fPort').value = isSacn ? 5568 : 9000;
};

$('srcForm').onsubmit = (e) => {
  e.preventDefault();

  const kind = $('fKind').value;
  const mc = $('fMulticast').value.trim();
  const uni = $('fUniverses').value.trim();

  addSource({
    kind,
    bind: $('fBind').value.trim() || '0.0.0.0',
    port: Number($('fPort').value),
    multicast: kind === 'sacn' ? null : mc || null,
    universes: kind === 'sacn' ? uni || null : null,
    label: null,
  });
};

$('quickStart').onclick = () =>
  addSource({ kind: 'osc-udp', bind: '0.0.0.0', port: 9000, multicast: null, universes: null, label: null });

$('pauseBtn').onclick = async () => {
  paused = !paused;
  await invoke('set_paused', { paused });
  $('pauseBtn').classList.toggle('is-on', paused);
  $('pauseBtn').textContent = paused ? t('resume') : t('pause');
};

$('resetBtn').onclick = async () => {
  await invoke('reset_stats', { sourceId: null });
  model.clear();
  for (const { tr } of rows.values()) tr.remove();
  rows.clear();
  logBody.textContent = '';
  scheduleRender();
};

$('filter').oninput = (e) => {
  filterText = e.target.value.trim().toLowerCase();
  scheduleRender();
};

for (const tab of document.querySelectorAll('.tab')) {
  tab.onclick = () => {
    for (const other of document.querySelectorAll('.tab')) other.classList.toggle('is-active', other === tab);
    for (const view of document.querySelectorAll('.view')) {
      view.classList.toggle('is-active', view.id === 'view-' + tab.dataset.tab);
    }
  };
}

// Silence must keep ticking even when no data arrives — otherwise an address
// that went quiet looks alive until the next snapshot.
setInterval(() => {
  if (!paused && model.size) { nowUs += 500_000; scheduleRender(); }
}, 500);

/* ---------- DMX ---------- */

let universes = [];
let uniSel = null;          // { source_id, universe }
const chCells = [];         // grid cells, created on demand
const uniChips = new Map(); // key -> chip element

const uniKey = (u) => `${u.source_id}:${u.universe}`;

function renderUniStrip() {
  const strip = $('uniStrip');

  // The first universe seen opens immediately — otherwise the tab looks empty
  // while data is already flowing.
  if (!uniSel && universes.length) uniSel = { source_id: universes[0].source_id, universe: universes[0].universe };

  for (const u of universes) {
    const key = uniKey(u);
    let chip = uniChips.get(key);

    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'uni-chip';
      chip.innerHTML = '<span class="uni-n"></span><span class="uni-meta"></span>';
      chip.onclick = () => {
        uniSel = { source_id: u.source_id, universe: u.universe };
        resetGrid();
        renderUniStrip();
      };
      uniChips.set(key, chip);
      strip.appendChild(chip);
    }

    chip.querySelector('.uni-n').textContent = t('uniShort', u.universe);

    const meta = chip.querySelector('.uni-meta');
    meta.textContent = '';
    const bits = [t('fps', u.fps.toFixed(0)), t('channels', u.width)];
    if (u.lost > 0) bits.push(t('lost', u.lost));
    meta.textContent = bits.join(' · ');

    chip.classList.toggle('has-conflict', u.conflict);
    chip.classList.toggle('is-active', !!uniSel && uniSel.source_id === u.source_id && uniSel.universe === u.universe);
  }

  $('dmxEmpty').hidden = universes.length > 0;
}

function renderDmxMeta(row) {
  const meta = $('dmxMeta');
  meta.textContent = '';
  if (!row) return;

  const add = (text, cls) => {
    const s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    meta.appendChild(s);
  };

  add(t('uniShort', row.universe));
  add(t('fps', row.fps.toFixed(1)));
  add(t('channels', row.width));
  if (row.lost > 0) add(t('lost', row.lost), 'bad');
  if (row.preview > 0) add(t('previewCount', row.preview));
  if (row.conflict) add(t('conflict'), 'bad');
  for (const s of row.senders) add(t('senderLine', s.name, s.priority));
}

function resetGrid() {
  $('chGrid').textContent = '';
  chCells.length = 0;
}

/** Cells are created once and only their text changes afterwards — recreating
 *  512 elements 30 times per second is not an option. */
function ensureCells(count) {
  const grid = $('chGrid');
  for (let i = chCells.length; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'ch';

    const n = document.createElement('span');
    n.className = 'ch-n';
    n.textContent = i + 1;

    const v = document.createElement('span');
    v.className = 'ch-v';
    v.textContent = '0';

    const mm = document.createElement('span');
    mm.className = 'ch-mm';
    mm.textContent = '—';

    el.append(n, v, mm);
    grid.appendChild(el);
    chCells.push({ el, v, mm, lastV: -1, lastMM: '' });
  }
}

function updateGrid(frame) {
  ensureCells(frame.width);

  for (let i = 0; i < frame.width; i++) {
    const cell = chCells[i];
    const value = frame.values[i];

    if (cell.lastV !== value) {
      cell.v.textContent = value;
      cell.el.style.setProperty('--v', (value / 255).toFixed(3));
      cell.el.classList.toggle('is-dark', value === 0);
      cell.lastV = value;
    }

    const mm = `${frame.min[i]}–${frame.max[i]}`;
    if (cell.lastMM !== mm) {
      cell.mm.textContent = mm;
      cell.lastMM = mm;
    }
  }
}

listen('dmx', (e) => {
  universes = e.payload;
  renderUniStrip();
  if (uniSel) {
    renderDmxMeta(universes.find((u) => u.source_id === uniSel.source_id && u.universe === uniSel.universe));
  }
});

// The frame is pulled here and only for the open universe: 512 values for every
// universe at once would be megabytes per second for nothing.
setInterval(async () => {
  if (paused || !uniSel) return;
  if (!document.getElementById('view-dmx').classList.contains('is-active')) return;

  const frame = await invoke('dmx_frame', { sourceId: uniSel.source_id, universe: uniSel.universe });
  if (frame) updateGrid(frame);
}, 33);

$('dmxQuickStart').onclick = () =>
  addSource({ kind: 'sacn', bind: '0.0.0.0', port: 5568, multicast: null, universes: '1-4', label: null });

/* ---------- network throughput ----------
 * Measures shares the way a copy tool would use them, rather than raw
 * bandwidth: the overhead of the file protocol is part of what people actually
 * get, and this needs nothing installed on the far side.
 */

const NET_KEY = 'reticle-net-targets';
const NET_LINK_KEY = 'reticle-net-link';

/** Usable megabytes per second per gigabit of link.
 *
 *  Not the arithmetic 125: Ethernet, IP and TCP headers eat a few percent, so
 *  a healthy 10 GbE path delivers around 1175 MB/s rather than 1250. Measuring
 *  against the arithmetic figure would make every perfect link look broken. */
const MBPS_PER_GBIT = 117.5;
/** Below this share of the best result, a row is worth looking at. */
const SLOW_RATIO = 0.7;

let netTargets = [];
let netNextId = 1;
let netBusy = false;
const netRows = new Map();      // id -> { tr, cells }
const netResults = new Map();   // id -> last result

function loadNetTargets() {
  try {
    const raw = JSON.parse(localStorage.getItem(NET_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((t) => t && typeof t.path === 'string') : [];
  } catch {
    return [];
  }
}

function saveNetTargets() {
  localStorage.setItem(NET_KEY, JSON.stringify(netTargets.map(({ id, path }) => ({ id, path }))));
}

function addNetTarget(path = '') {
  netTargets.push({ id: netNextId++, path });
  saveNetTargets();
  renderNetTable();
}

function removeNetTarget(id) {
  netTargets = netTargets.filter((t) => t.id !== id);
  netResults.delete(id);
  const row = netRows.get(id);
  if (row) { row.tr.remove(); netRows.delete(id); }
  saveNetTargets();
  renderNetTable();
}

/* ---------- machine names ----------
 * Reverse DNS turns 192.168.2.14 into 03-floor. Looked up once per address and
 * remembered, because the answer does not change while the app is open and a
 * lookup without a record waits for the resolver to give up.
 */

const hostNames = new Map();   // ip -> name | null (null = asked, nothing there)

function hostOfUnc(path) {
  const m = /^\\\\([^\\/]+)/.exec(path.trim());
  return m ? m[1] : null;
}

function paintHostNames() {
  for (const target of netTargets) {
    const entry = netRows.get(target.id);
    if (!entry) continue;
    const host = hostOfUnc(target.path);
    const name = host ? hostNames.get(host) : null;
    entry.cells.host.textContent = name || '';
  }
}

async function resolveHostNames() {
  const unknown = [...new Set(
    netTargets.map((x) => hostOfUnc(x.path)).filter((h) => h && !hostNames.has(h)),
  )];
  if (!unknown.length) return;

  // Mark as asked up front, so a second render does not queue the same lookups.
  for (const h of unknown) hostNames.set(h, null);

  try {
    const names = await invoke('resolve_hosts', { hosts: unknown });
    unknown.forEach((h, i) => hostNames.set(h, names[i] || null));
    paintHostNames();
  } catch {
    // No resolver on this network is a normal state, not an error worth showing.
  }
}

/* ---------- site presets ----------
 * A preset is the whole setup for one venue: the targets plus the settings
 * they were measured with. Loading it back has to reproduce the same test,
 * otherwise comparing today's numbers with last month's means nothing.
 */

const NET_PRESETS_KEY = 'reticle-net-presets';
/** Which preset is in play, so the app opens where it was left. */
const NET_ACTIVE_KEY = 'reticle-net-active-preset';
/** Test settings, kept apart from presets: changing a dropdown should survive
 *  a restart even when no preset is loaded. */
const NET_OPTS_KEY = 'reticle-net-opts';

function saveNetOpts() {
  localStorage.setItem(NET_OPTS_KEY, JSON.stringify({
    size: $('netSize').value,
    threads: $('netThreads').value,
    mode: $('netMode').value,
    bypass: $('netBypass').checked,
    passes: $('netPasses').value,
    via: $('netVia').value,
  }));
}

function restoreNetOpts() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(NET_OPTS_KEY) || '{}');
  } catch {
    return;
  }

  const set = (id, value) => { if (value !== undefined && value !== null && value !== '') $(id).value = value; };
  set('netSize', saved.size);
  set('netThreads', saved.threads);
  set('netMode', saved.mode);
  // A boolean has no empty value to fall back on, so it is read directly.
  if (typeof saved.bypass === 'boolean') $('netBypass').checked = saved.bypass;
  set('netPasses', saved.passes);
  // The adapter is restored after the interface list arrives, since the
  // option it refers to does not exist yet at this point.
  if (saved.via) restoreNetOpts.pendingVia = saved.via;

  paintNetWarn();
}

function loadNetPresets() {
  try {
    const raw = JSON.parse(localStorage.getItem(NET_PRESETS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((p) => p && typeof p.name === 'string') : [];
  } catch {
    return [];
  }
}

function saveNetPresets(list) {
  localStorage.setItem(NET_PRESETS_KEY, JSON.stringify(list));
}

function renderNetPresetPicker(selected = '') {
  const sel = $('netPreset');
  sel.textContent = '';

  const none = document.createElement('option');
  none.value = '';
  none.textContent = t('netPresetNone');
  sel.appendChild(none);

  for (const preset of loadNetPresets()) {
    const opt = document.createElement('option');
    opt.value = preset.name;
    opt.textContent = `${preset.name} · ${preset.targets.length}`;
    sel.appendChild(opt);
  }

  sel.value = selected;
}

function saveNetPreset() {
  const note = $('netNote');
  const name = $('netPresetName').value.trim() || $('netPreset').value;

  if (!name) { note.textContent = t('netPresetNeedName'); return; }

  const paths = netTargets.map((x) => x.path).filter(Boolean);
  if (!paths.length) { note.textContent = t('netPresetNeedTargets'); return; }

  const preset = {
    name,
    targets: paths,
    size_mb: Number($('netSize').value),
    threads: Number($('netThreads').value),
    mode: $('netMode').value,
    bypass: $('netBypass').checked,
    link: $('netLink').value,
    via: $('netVia').value,
  };

  // Same name overwrites, so refining a venue setup does not breed copies.
  const list = loadNetPresets().filter((p) => p.name !== name);
  list.push(preset);
  saveNetPresets(list);

  renderNetPresetPicker(name);
  localStorage.setItem(NET_ACTIVE_KEY, name);
  saveNetOpts();
  $('netPresetName').value = '';
  note.textContent = t('netPresetSaved', name, paths.length);
}

function applyNetPreset(name) {
  const preset = loadNetPresets().find((p) => p.name === name);
  if (!preset) return;

  // The target list is replaced wholesale: a preset describes one venue, and
  // merging two venues would produce a list that matches neither.
  for (const { tr } of netRows.values()) tr.remove();
  netRows.clear();
  netResults.clear();

  netTargets = preset.targets.map((path) => ({ id: netNextId++, path }));
  saveNetTargets();

  const set = (id, value) => { if (value !== undefined && value !== null) $(id).value = value; };
  set('netSize', preset.size_mb);
  set('netThreads', preset.threads);
  set('netMode', preset.mode);
  set('netLink', preset.link);
  set('netVia', preset.via);
  // Presets saved before this setting existed were all taken unbuffered.
  $('netBypass').checked = preset.bypass !== false;

  paintNetWarn();
  applyLinkChoice();
  renderNetTable();

  localStorage.setItem(NET_ACTIVE_KEY, preset.name);
  saveNetOpts();

  $('netPresetName').value = preset.name;
  $('netNote').textContent = t('netPresetLoaded', preset.name, preset.targets.length);
}

function deleteNetPreset() {
  const name = $('netPreset').value;
  if (!name) return;

  saveNetPresets(loadNetPresets().filter((p) => p.name !== name));
  if (localStorage.getItem(NET_ACTIVE_KEY) === name) localStorage.removeItem(NET_ACTIVE_KEY);
  renderNetPresetPicker('');
  $('netNote').textContent = t('netPresetDeleted', name);
}

/* ---------- adding a range of hosts ----------
 * Nine servers differing by one octet is the normal case on a show network,
 * and typing nine almost identical UNC paths by hand invites a typo that then
 * looks like a dead host.
 */

/** Most targets a single range may add. Past this it is a mistake, not a plan. */
const RANGE_LIMIT = 128;

function parseIp(text) {
  const parts = text.trim().split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

function addNetRange() {
  const note = $('netRangeNote');
  const from = parseIp($('netFrom').value);
  const to = parseIp($('netTo').value);
  const share = $('netSharePath').value.trim().replace(/^[\\/]+/, '');

  const fail = (msg) => { note.textContent = msg; note.classList.add('bad'); };
  note.classList.remove('bad');

  if (!from || !to) return fail(t('netRangeBadIp'));
  if (from.slice(0, 3).join('.') !== to.slice(0, 3).join('.')) return fail(t('netRangeDifferentSubnet'));
  if (from[3] > to[3]) return fail(t('netRangeBackwards'));
  if (!share) return fail(t('netRangeNeedPath'));

  const count = to[3] - from[3] + 1;
  if (count > RANGE_LIMIT) return fail(t('netRangeTooMany', count));

  const prefix = from.slice(0, 3).join('.');
  const existing = new Set(netTargets.map((x) => x.path.toLowerCase()));
  let added = 0;
  let dupes = 0;

  for (let last = from[3]; last <= to[3]; last++) {
    const path = `\\\\${prefix}.${last}\\${share}`;
    if (existing.has(path.toLowerCase())) { dupes++; continue; }
    existing.add(path.toLowerCase());
    netTargets.push({ id: netNextId++, path });
    added++;
  }

  saveNetTargets();
  renderNetTable();
  note.textContent = dupes ? t('netRangeSkipped', added, dupes) : t('netRangeAdded', added);
}

/** Ceiling of the link currently selected, in MB/s. */
function linkCeiling() {
  return Number($('netLink').value || 10) * MBPS_PER_GBIT;
}

function fmtOfLink(mbps) {
  if (!mbps) return '—';
  return `${Math.round((mbps / linkCeiling()) * 100)}%`;
}

/** Re-label the column and recompute the percentages already on screen, so
 *  switching link speed does not require running the test again. */
function applyLinkChoice() {
  const sel = $('netLink');
  const label = sel.options[sel.selectedIndex].textContent;

  // The link is named in the column headers rather than in a column of its
  // own, so both percentages stay next to the numbers they describe.
  $('netReadHead').textContent = t('netReadOf', label);
  $('netWriteHead').textContent = t('netWriteOf', label);
  localStorage.setItem(NET_LINK_KEY, sel.value);

  for (const [id, result] of netResults) {
    const entry = netRows.get(id);
    if (!entry) continue;
    entry.cells.readPct.textContent = result.read_mbps ? fmtOfLink(result.read_mbps) : '';
    entry.cells.writePct.textContent = result.write_mbps ? fmtOfLink(result.write_mbps) : '';
  }
}

/** The caveat that belongs to the chosen mode — a property of the test, not of
 *  any one result, so it is said once above the table rather than per row. */
function paintNetWarn() {
  const mode = $('netMode').value;
  const warn = $('netWarn');
  warn.hidden = mode === 'read';
  warn.classList.toggle('is-trap', mode === 'roundtrip' && !$('netBypass').checked);

  if (mode !== 'roundtrip') {
    warn.textContent = t('netWriteWarning');
    return;
  }

  // Reading back what you just wrote, with the cache left in place, can be
  // served entirely from this machine's own RAM. That number is not wrong by a
  // little, it is a measurement of nothing, so it gets said plainly.
  warn.textContent = $('netBypass').checked ? t('netRoundWarning') : t('netRoundBufferedWarning');
}

/** Keep the tail of a path, which is the part that identifies it. */
function trimPathLeft(text, max) {
  return text.length <= max ? text : `…${text.slice(-(max - 1))}`;
}

function netRowFor(target) {
  let entry = netRows.get(target.id);
  if (entry) return entry;

  const tr = document.createElement('tr');
  const cells = {};

  const pathTd = document.createElement('td');
  pathTd.className = 'path';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = t('netPathHint');
  input.value = target.path;
  input.spellcheck = false;
  input.onchange = () => {
    target.path = input.value.trim();
    saveNetTargets();
  };
  pathTd.appendChild(input);
  cells.input = input;

  // The machine name sits under the path: on a show network it is how people
  // actually refer to a box, and nobody wants to retype it.
  const host = document.createElement('span');
  host.className = 'net-host';
  pathTd.appendChild(host);
  cells.host = host;

  for (const name of ['latency', 'read', 'write', 'via']) {
    const td = document.createElement('td');
    td.className = `num ${name}`;
    td.textContent = '—';
    cells[name] = td;
  }

  // Read and write each carry their own share of the link: with both measured,
  // a single combined percentage described only one of them.
  for (const name of ['read', 'write']) {
    cells[name].textContent = '';
    const value = document.createElement('span');
    value.className = 'v';
    value.textContent = '—';
    const pct = document.createElement('span');
    pct.className = 'pct';
    cells[name].append(value, pct);
    cells[`${name}Value`] = value;
    cells[`${name}Pct`] = pct;
  }

  // Which file the read came from. Not decoration: when one server reads at a
  // tenth of the others with normal writes, the file it happened to pick is the
  // first thing to check — and `find_read_source` takes the first big enough,
  // which on different servers can be a different file entirely.
  const file = document.createElement('td');
  file.className = 'file';
  file.textContent = '—';
  cells.file = file;

  // One figure per sweep, side by side. A fault that moves shows itself here
  // and nowhere else: a single number per row cannot say "23, then 496".
  const byPass = document.createElement('td');
  byPass.className = 'bypass';
  byPass.textContent = '—';
  cells.byPass = byPass;

  // Retransmissions: the one number that tells a broken wire from a bad
  // setting, since a misconfigured link is slow but loses nothing.
  const retrans = document.createElement('td');
  retrans.className = 'num retrans';
  retrans.textContent = '—';
  cells.retrans = retrans;

  const status = document.createElement('td');
  status.className = 'status';
  cells.status = status;

  const acts = document.createElement('td');
  acts.className = 'net-acts-cell';
  const wrap = document.createElement('div');
  wrap.className = 'net-acts';

  const browse = document.createElement('button');
  browse.type = 'button';
  browse.className = 'preset-btn';
  browse.textContent = '…';
  browse.title = t('netBrowse');
  browse.onclick = async () => {
    const picked = await invoke('pick_folder');
    if (!picked) return;
    input.value = picked;
    target.path = picked;
    saveNetTargets();
  };

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'preset-btn is-danger';
  del.textContent = '×';
  del.title = t('netRemove');
  del.onclick = () => removeNetTarget(target.id);

  wrap.append(browse, del);
  acts.appendChild(wrap);

  cells.via.className = 'via';   // left-aligned: it is a name, not a number

  tr.append(pathTd, cells.latency, cells.read, cells.write, file, byPass, retrans, cells.via, status, acts);
  entry = { tr, cells };
  netRows.set(target.id, entry);
  return entry;
}

function renderNetTable() {
  const body = $('netBody');

  for (const target of netTargets) {
    const entry = netRowFor(target);
    body.appendChild(entry.tr);        // appendChild moves, so order follows the list
  }

  // Highlight whoever lags behind the best result of this run: the point is
  // not an absolute number, it is which target is the odd one out.
  const best = Math.max(0, ...[...netResults.values()].map((r) => r.read_mbps || 0));

  for (const [id, result] of netResults) {
    const entry = netRows.get(id);
    if (!entry) continue;
    const slow = best > 0 && result.read_mbps && result.read_mbps < best * SLOW_RATIO;
    entry.cells.read.classList.toggle('slow', !!slow);
  }

  $('netEmpty').hidden = netTargets.length > 0;

  paintHostNames();
  resolveHostNames();
}

function applyNetResult(result) {
  netResults.set(result.id, result);
  const entry = netRows.get(result.id);
  if (!entry) return;

  const c = entry.cells;
  entry.tr.classList.remove('is-running');
  entry.tr.style.removeProperty('--row-prog');

  if (netRunState) {
    netRunState.done.add(result.id);
    if (!netHistory.has(result.id)) netHistory.set(result.id, []);
    netHistory.get(result.id).push({
      pass: netRunState.pass || 1,
      read: result.read_mbps || 0,
      write: result.write_mbps || 0,
      retrans: result.read_retrans,
    });
  }

  c.latency.textContent = result.latency_ms === null || result.latency_ms === undefined
    ? '—' : t('ms', result.latency_ms);

  c.readValue.textContent = result.read_mbps ? t('mbps', result.read_mbps) : '—';
  c.readPct.textContent = result.read_mbps ? fmtOfLink(result.read_mbps) : '';
  c.writeValue.textContent = result.write_mbps ? t('mbps', result.write_mbps) : '—';
  c.writePct.textContent = result.write_mbps ? fmtOfLink(result.write_mbps) : '';

  // Which adapter the traffic really left from. On a machine with a 10 GbE
  // card beside a gigabit dongle this is the difference between a real
  // measurement and a misleading one.
  // Cut from the left: the file name is what identifies it, the folders in
  // front are context that can be read from the tooltip.
  c.file.textContent = result.read_file ? trimPathLeft(result.read_file, 26) : '—';
  c.file.title = result.read_file
    ? t('netFileSize', result.read_file, Math.round(result.read_file_bytes / (1024 * 1024)))
    : '';

  // Every sweep's read speed in order, so a number that moves is read as
  // movement rather than as whatever it happened to be last.
  const history = netHistory.get(result.id) || [];
  const best = Math.max(0, ...[...netResults.values()].map((r) => r.read_mbps || 0));
  c.byPass.textContent = history.length > 1
    ? history.map((h) => Math.round(h.read)).join(' · ')
    : '—';
  c.byPass.title = history
    .map((h) => t('netPassDetail', h.pass, Math.round(h.read), Math.round(h.write)))
    .join('\n');
  c.byPass.classList.toggle('slow', history.length > 1 && wanders(history, best));

  // Both phases are counted; the read one is shown, because that is the
  // direction in question when a read is slow and a write is not.
  const hasRetrans = result.read_retrans !== null && result.read_retrans !== undefined;
  c.retrans.textContent = hasRetrans ? String(result.read_retrans) : '—';
  c.retrans.title = hasRetrans
    ? t('netRetransSplit', result.read_retrans, result.write_retrans ?? 0)
    : '';
  c.retrans.classList.toggle('slow', hasRetrans && result.read_retrans >= FIND.retrans);

  const via = result.via_adapter || result.via_ip;
  c.via.textContent = via || '—';
  c.via.title = result.via_ip || '';

  const expected = $('netVia').value;
  const wrongAdapter = expected && result.via_ip && result.via_ip !== expected;
  c.via.classList.toggle('slow', !!wrongAdapter);

  const trouble = result.error || (wrongAdapter ? t('netWrongAdapter', via) : null);
  c.status.classList.toggle('bad', !!trouble);
  // The cell is one line wide now, so the full wording lives in the tooltip —
  // an error worth showing is an error worth reading in full.
  c.status.textContent = trouble || result.note || '';
  c.status.title = c.status.textContent;

  renderNetTable();
}

/* ---------- findings ----------
 * The table answers "how fast"; these answer "so what". The rules are
 * deliberately few and each one has to be defensible out loud — a tool that
 * guesses confidently is worse than one that stays quiet, because a wrong lead
 * costs an afternoon of pulling good cable.
 */

const FIND = {
  /** Read this many times below write is a one-direction problem. */
  asymmetry: 3,
  /** Below this share of the best read counts as slow. */
  slowShare: 0.5,
  /** Readings this close together are "the same number". */
  spread: 0.15,
  /** Retransmissions in one target's run worth calling out. */
  retrans: 200,
  /** A speed-up this large between buffered and unbuffered is conclusive. */
  bypassGain: 3,
  /** Fastest sweep this many times the slowest, and the fault is moving. */
  wander: 3,
};

/**
 * Did this target's read speed move between sweeps?
 *
 * Only counted when one of the sweeps was actually bad: a target that ran at
 * 480 and then 1400 varies, but it is not a fault, and calling it one would
 * bury the rows that matter.
 */
function wanders(history, best) {
  if (!history || history.length < 2) return false;
  const reads = history.map((h) => h.read).filter((v) => v > 0);
  if (reads.length < 2) return false;

  const lo = Math.min(...reads);
  const hi = Math.max(...reads);
  return lo > 0 && hi / lo >= FIND.wander && best > 0 && lo < best * FIND.slowShare;
}

/** "a", "a and b", "a, b and c" — a list meant to be read, not parsed. */
function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const mbpsRound = (v) => Math.round(v);

/**
 * Turn a finished run into plain statements.
 *
 * Pure on purpose: everything it needs arrives as arguments, so the rules can
 * be exercised against made-up runs without a network.
 */
function diagnose(rows, opts, previous) {
  const out = [];
  const named = (r) => r.name;
  const usable = rows.filter((r) => r.read || r.write);
  if (!usable.length) return out;

  if (Number(opts.threads) === 1) {
    out.push({ tone: 'warn', text: t('netFindOneStream') });
  }

  const reads = usable.filter((r) => r.read).map((r) => r.read);
  const best = Math.max(0, ...reads);
  const slow = usable.filter((r) => r.read && best > 0 && r.read < best * FIND.slowShare);

  // Reads bad, writes fine: the two directions are not the same wire, the same
  // queue or the same offload, and on fibre not even the same strand.
  const lopsided = usable.filter((r) => r.read && r.write && r.write / r.read >= FIND.asymmetry);
  if (lopsided.length) {
    const worst = Math.max(...lopsided.map((r) => r.write / r.read));
    out.push({ tone: 'bad', text: t('netFindAsym', joinNames(lopsided.map(named)), worst.toFixed(0)) });
  }

  // Retransmissions decide which story the rest of the findings tell, so they
  // are weighed before anything is said: pointing at a shared setting while the
  // wire is visibly dropping packets would send someone the wrong way entirely.
  const watched = slow.length ? slow : usable;
  const counted = watched.filter((r) => r.retrans !== null && r.retrans !== undefined);
  const noisy = counted.filter((r) => r.retrans >= FIND.retrans);
  const wireAtFault = noisy.length > 0;

  // A fault that moves between sweeps is the most misleading thing on this
  // page, because every single-pass reading of it is true and useless. It is
  // said before the slow list, so nobody walks off to reconfigure a machine
  // that was fine thirty seconds later.
  const moving = usable.filter((r) => wanders(r.history, best));
  if (moving.length) {
    const spans = moving.map((r) => {
      const reads = r.history.map((h) => h.read).filter((v) => v > 0);
      return `${named(r)} ${mbpsRound(Math.min(...reads))}–${mbpsRound(Math.max(...reads))}`;
    });
    out.push({ tone: 'bad', text: t('netFindWanders', joinNames(spans)) });
  }

  if (slow.length) {
    const lo = Math.min(...slow.map((r) => r.read));
    const hi = Math.max(...slow.map((r) => r.read));
    out.push({
      tone: 'bad',
      text: t('netFindSlowGroup', joinNames(slow.map(named)), mbpsRound(lo), mbpsRound(hi), mbpsRound(best)),
    });

    // Several machines landing on the same figure despite different latencies
    // is the signature of something they share, not of several faults — but
    // only while nothing is being retransmitted, which would explain it better.
    if (!wireAtFault && !moving.length && slow.length >= 2 && hi > 0 && (hi - lo) / hi <= FIND.spread) {
      out.push({ tone: 'hint', text: t('netFindUniform', slow.length) });
    }
  } else if (reads.length) {
    out.push({ tone: 'good', text: t('netFindAllWell', mbpsRound(Math.min(...reads)), mbpsRound(best)) });
  }

  if (wireAtFault) {
    const total = noisy.reduce((sum, r) => sum + r.retrans, 0);
    out.push({ tone: 'bad', text: t('netFindRetransHigh', joinNames(noisy.map(named)), total) });
  } else if (counted.length && slow.length) {
    out.push({ tone: 'hint', text: t('netFindRetransNone') });
  }

  // The decisive comparison, when the same targets have been run both ways —
  // but never for the round trip, where the buffered half can be served from
  // this machine's own RAM and so compares a real figure against a fiction.
  const comparable = opts.mode !== 'roundtrip';
  if (comparable && previous && previous.mode === opts.mode && previous.bypass !== opts.bypass_cache) {
    const gained = usable.filter((r) => {
      const was = previous.reads[r.id];
      return r.read && was && (opts.bypass_cache ? was / r.read : r.read / was) >= FIND.bypassGain;
    });
    if (gained.length) {
      // Always phrased buffered-vs-unbuffered, whichever way round it was run.
      const from = opts.bypass_cache ? gained.map((r) => r.read) : gained.map((r) => previous.reads[r.id]);
      const to = opts.bypass_cache ? gained.map((r) => previous.reads[r.id]) : gained.map((r) => r.read);
      out.push({
        tone: 'hint',
        text: t(
          'netFindBypassCompare',
          joinNames(gained.map(named)),
          mbpsRound(Math.min(...from)),
          mbpsRound(Math.max(...to)),
        ),
      });
    }
  } else if (slow.length && opts.bypass_cache && !wireAtFault) {
    // Pointless advice while packets are being lost: the cache is not what is
    // slowing a link that cannot deliver a packet first time.
    out.push({
      tone: 'hint',
      text: comparable ? t('netFindBypassHintTry') : t('netFindBypassHintRead'),
    });
  }

  return out;
}

/** The rows as the rules want them: names resolved, errors dropped. */
function findingsInput() {
  return netTargets
    .map((target) => ({ target, result: netResults.get(target.id) }))
    .filter(({ result }) => result && !result.error)
    .map(({ target, result }) => ({
      id: target.id,
      name: netLabelFor(target.id),
      read: result.read_mbps || 0,
      write: result.write_mbps || 0,
      retrans: result.read_retrans,
      history: netHistory.get(target.id) || [],
    }));
}

function renderFindings() {
  const box = $('netFindings');
  const rows = findingsInput();
  const found = diagnose(rows, currentNetOpts(), netLastRun);

  box.textContent = '';
  box.hidden = found.length === 0;
  if (!found.length) return;

  const head = document.createElement('h4');
  head.textContent = t('netFindings');
  box.appendChild(head);

  for (const { tone, text } of found) {
    const line = document.createElement('p');
    line.className = `net-finding is-${tone}`;
    line.textContent = text;
    box.appendChild(line);
  }
}

/* ---------- report image ----------
 * Drawn by hand onto a canvas rather than screenshotted or sent through a
 * library: the output stays predictable, carries the test parameters that a
 * screenshot of the table would lose, and the app keeps no extra dependency.
 */

/** Break text into lines that fit, the one thing canvas will not do for you. */
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';

  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }

  if (line) lines.push(line);
  return lines;
}

/** Trim a path from the left: the tail (host and folder) is what identifies it. */
function trimLeft(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 4 && ctx.measureText(`…${cut}`).width > maxWidth) {
    cut = cut.slice(1);
  }
  return `…${cut}`;
}

function drawReport() {
  const rowsData = netTargets
    .map((x) => ({ target: x, result: netResults.get(x.id) }))
    .filter((r) => r.result);

  if (!rowsData.length) return null;

  const style = getComputedStyle(document.documentElement);
  const colour = {
    bg: style.getPropertyValue('--paper').trim(),
    ink: style.getPropertyValue('--ink').trim(),
    dim: style.getPropertyValue('--dim').trim(),
    line: style.getPropertyValue('--line2').trim(),
    accent: style.getPropertyValue('--accent').trim(),
    bad: style.getPropertyValue('--danger').trim(),
    // Machine names get their own colour: --accent equals --ink in the night
    // theme, so the name would be indistinguishable from the path.
    name: style.getPropertyValue('--frame-active').trim(),
  };

  const scale = 2;                    // drawn at 2x so the text stays crisp
  const pad = 28;
  const rowH = 30;
  const headH = 108;
  const findingLineH = 17;
  // The file read is part of the evidence, not a detail: two servers measured
  // against different files are not comparable, and a report that hides which
  // one was used cannot be checked later.
  const cols = { target: pad, latency: 600, read: 690, write: 860, file: 1030, retrans: 1290, via: 1390 };
  const width = 1630;

  // The findings go in the file too. A report that travels to someone who was
  // not standing there needs to say what it means, not only what it measured.
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = '400 12px "Segoe UI", sans-serif';
  // A blank line between statements, so several findings read as several
  // findings rather than one paragraph.
  const findingLines = diagnose(findingsInput(), currentNetOpts(), netLastRun)
    .flatMap(({ text }, i) => (i ? [''] : []).concat(wrapText(measure, text, width - pad * 2)));

  const footH = 52 + (findingLines.length ? 22 + findingLines.length * findingLineH : 0);
  const height = headH + rowsData.length * rowH + footH;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  ctx.fillStyle = colour.bg;
  ctx.fillRect(0, 0, width, height);

  const mono = (size, weight = 400) => `${weight} ${size}px Consolas, "DM Mono", monospace`;
  const sans = (size, weight = 400) => `${weight} ${size}px "Segoe UI", sans-serif`;

  ctx.fillStyle = colour.ink;
  ctx.font = sans(17, 700);
  const title = appVersion ? `${t('netReportTitle')}  ${appVersion}` : t('netReportTitle');
  ctx.fillText(title, pad, 38);

  // Parameters belong in the file: a number without its test settings is
  // not a measurement, it is a rumour.
  const sel = $('netLink');
  const when = new Date().toLocaleString([], { hour12: false });
  const params = [
    when,
    `${$('netSize').value} MB`,
    `${$('netThreads').value} streams`,
    $('netMode').options[$('netMode').selectedIndex].textContent.toLowerCase(),
    sel.options[sel.selectedIndex].textContent,
    // Buffered and unbuffered figures are not comparable, so which one this is
    // belongs on the page rather than in whoever exported it's memory.
    ...($('netBypass').checked ? [] : [t('netBufferedTag')]),
  ].join('  ·  ');

  ctx.fillStyle = colour.dim;
  ctx.font = sans(12);
  ctx.fillText(params, pad, 60);

  ctx.strokeStyle = colour.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, 78.5);
  ctx.lineTo(width - pad, 78.5);
  ctx.stroke();

  ctx.font = sans(11, 500);
  ctx.fillStyle = colour.dim;
  ctx.fillText('TARGET', cols.target, 97);
  ctx.fillText('LATENCY', cols.latency, 97);
  ctx.fillText('READ · % OF LINK', cols.read, 97);
  ctx.fillText('WRITE · % OF LINK', cols.write, 97);
  ctx.fillText('FILE READ', cols.file, 97);
  ctx.fillText('RETRANS', cols.retrans, 97);
  ctx.fillText('VIA', cols.via, 97);

  const best = Math.max(...rowsData.map((r) => r.result.read_mbps || 0));

  rowsData.forEach(({ target, result }, i) => {
    const y = headH + i * rowH + 20;

    ctx.strokeStyle = colour.line;
    ctx.beginPath();
    ctx.moveTo(pad, y + 9.5);
    ctx.lineTo(width - pad, y + 9.5);
    ctx.stroke();

    // The name goes first when known — that is how the box is referred to —
    // and in its own colour, so it reads as a label rather than part of the path.
    ctx.font = mono(13);
    const host = hostOfUnc(target.path);
    const name = result.host_name || (host ? hostNames.get(host) : null);

    let x = cols.target;
    if (name) {
      ctx.fillStyle = colour.name;
      ctx.fillText(name, x, y);
      x += ctx.measureText(name).width + 16;
    }

    ctx.fillStyle = colour.ink;
    ctx.fillText(trimLeft(ctx, target.path, cols.latency - x - 24), x, y);

    ctx.fillStyle = colour.dim;
    ctx.fillText(result.latency_ms ? t('ms', result.latency_ms) : '—', cols.latency, y);

    // Each figure carries its own share of the link, right beside it.
    const slow = best > 0 && result.read_mbps && result.read_mbps < best * SLOW_RATIO;
    // Units spelled out: a bare number in a report is ambiguous a week later.
    const pair = (value, cx, bad) => {
      ctx.font = mono(13, 700);
      ctx.fillStyle = bad ? colour.bad : colour.ink;
      const text = value ? `${Math.round(value)} MB/s` : '—';
      ctx.fillText(text, cx, y);

      if (!value) return;
      ctx.font = mono(11);
      ctx.fillStyle = colour.dim;
      ctx.fillText(fmtOfLink(value), cx + ctx.measureText(text).width + 12, y);
    };

    pair(result.read_mbps, cols.read, slow);
    pair(result.write_mbps, cols.write, false);

    ctx.font = mono(12);
    ctx.fillStyle = colour.dim;
    ctx.fillText(
      result.read_file ? trimLeft(ctx, result.read_file, cols.via - cols.file - 24) : '—',
      cols.file,
      y,
    );

    // Retransmissions earn red at the same threshold as the table: zero and
    // "thousands" mean opposite things and must not read alike.
    const lost = result.read_retrans;
    const hasLost = lost !== null && lost !== undefined;
    ctx.font = mono(13);
    ctx.fillStyle = hasLost && lost >= FIND.retrans ? colour.bad : colour.dim;
    ctx.fillText(hasLost ? String(lost) : '—', cols.retrans, y);

    ctx.font = mono(13);
    ctx.fillStyle = colour.dim;
    ctx.fillText(result.via_adapter || result.via_ip || '—', cols.via, y);

    if (result.error) {
      ctx.fillStyle = colour.bad;
      ctx.font = sans(11);
      ctx.fillText(result.error.slice(0, 90), cols.target, y + 13);
    }
  });

  const speeds = rowsData.map((r) => r.result.read_mbps || r.result.write_mbps).filter(Boolean);
  const summaryY = headH + rowsData.length * rowH + 22;

  if (speeds.length) {
    const lo = Math.round(Math.min(...speeds));
    const hi = Math.round(Math.max(...speeds));
    ctx.fillStyle = colour.accent;
    ctx.font = sans(12, 500);
    ctx.fillText(
      t('netReportSummary', rowsData.length, lo, hi, (hi / lo).toFixed(1)),
      pad,
      summaryY,
    );
  }

  if (findingLines.length) {
    ctx.fillStyle = colour.dim;
    ctx.font = sans(11, 500);
    ctx.fillText(t('netFindings').toUpperCase(), pad, summaryY + 26);

    ctx.font = sans(12);
    ctx.fillStyle = colour.ink;
    findingLines.forEach((line, i) => {
      ctx.fillText(line, pad, summaryY + 46 + i * findingLineH);
    });
  }

  return canvas;
}

async function exportNetReport() {
  const canvas = drawReport();
  if (!canvas) {
    $('netNote').textContent = t('netReportNothing');
    return;
  }

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const data = canvas.toDataURL('image/png').split(',')[1];

  try {
    const path = await invoke('save_binary', {
      dataBase64: data,
      defaultName: `reticle-network-${stamp}.png`,
      extension: 'png',
    });
    if (path) $('netNote').textContent = t('savedTo', path);
  } catch (e) {
    $('netNote').textContent = String(e);
  }
}

/* ---------- progress ----------
 * A 512 MB read over a congested link takes most of a minute, during which a
 * table of dashes looks exactly like a hung app. The backend bumps counters
 * and a ticker samples them, so the bar costs the measurement nothing.
 */

let netRunState = null;   // { ids, mode, done, pass, passes } for the run in flight
/** Resolver for the pass currently in flight, set by runOnePass. */
let netPassDone = null;
/** Furthest the bar has reached in this run, so it can never go backwards. */
let netProgMax = 0;
/** id -> [{ pass, read, write, retrans }], one entry per sweep of the row.
 *  A fault that moves between sweeps is only visible if the sweeps are kept
 *  apart, so nothing here is averaged. */
const netHistory = new Map();
/** The run before this one, so buffered and unbuffered can be compared. Kept in
 *  memory only: a figure from last week is not a comparison, it is a guess. */
let netLastRun = null;

/** The test settings, in the one shape the backend and the findings both use. */
function currentNetOpts() {
  return {
    size_mb: Number($('netSize').value),
    threads: Number($('netThreads').value),
    mode: $('netMode').value,
    bypass_cache: $('netBypass').checked,
  };
}

/** How a machine is best referred to: its name if the network knows one. */
function netLabelFor(id) {
  const target = netTargets.find((x) => x.id === id);
  if (!target) return '';
  const host = hostOfUnc(target.path);
  // The result carries a name too: the test resolves one even when the
  // background lookup for the list has not come back, or never will.
  const fromResult = netResults.get(id)?.host_name;
  return fromResult || (host && hostNames.get(host)) || host || target.path;
}

function netPhaseLabel(phase) {
  if (phase === 'probe') return t('netPhaseProbe');
  if (phase === 'read') return t('netPhaseRead');
  if (phase === 'write') return t('netPhaseWrite');
  return t('netPhaseIdle');
}

function paintNetProgress(snap) {
  if (!netRunState) return;

  const { ids, mode, done } = netRunState;
  const i = ids.indexOf(snap.id);
  if (i < 0) return;

  // Where two phases run, each owns half of a target's share of the bar:
  // otherwise the bar would jump back to zero halfway through every target.
  // Which phase comes second depends on the mode — a round trip writes first.
  const twoPhase = mode === 'both' || mode === 'roundtrip';
  const secondPhase = mode === 'roundtrip' ? 'read' : 'write';
  const span = twoPhase ? 0.5 : 1;
  const base = twoPhase && snap.phase === secondPhase ? 0.5 : 0;
  const within = snap.total > 0 ? Math.min(1, snap.done / snap.total) : 0;

  // The whole run, not the current sweep: without the pass in here the bar ran
  // to the end and snapped back to zero once per sweep.
  const pass = netRunState.pass || 1;
  const passes = netRunState.passes || 1;
  const overall = ((pass - 1) + (i + base + within * span) / ids.length) / passes;

  // Never backwards. The counters are sampled, not transactional, so a reading
  // can catch the moment between one target finishing and the next declaring
  // its size — and progress through a fixed list of targets cannot regress
  // anyway, so clamping loses nothing and removes every such twitch.
  netProgMax = Math.max(netProgMax, overall);
  $('netProgFill').style.setProperty('--net-prog', netProgMax.toFixed(4));

  const mb = (bytes) => Math.round(bytes / (1024 * 1024));
  const detail = snap.total > 0
    ? `${netPhaseLabel(snap.phase)} ${t('netProgOf', mb(snap.done), mb(snap.total))}`
    : netPhaseLabel(snap.phase);

  const sweep = passes > 1 ? `${t('netProgPass', pass, passes)} · ` : '';
  $('netProgText').textContent =
    `${sweep}${t('netProgStep', i + 1, ids.length)} · ${netLabelFor(snap.id)} · ${detail}`;

  // The running row carries its own share as a hairline, so the eye does not
  // have to travel back to the toolbar to see which target is in flight.
  // A sample can land after the result did — the counters are only read every
  // 200 ms — and must not overwrite the finished row's reading with "100%".
  const entry = done.has(snap.id) ? null : netRows.get(snap.id);
  if (entry) {
    entry.tr.style.setProperty('--row-prog', `${(within * 100).toFixed(1)}%`);
    entry.cells.status.textContent = snap.total > 0
      ? `${netPhaseLabel(snap.phase)} ${Math.round(within * 100)}%`
      : netPhaseLabel(snap.phase);
  }
}

function endNetProgress() {
  netRunState = null;
  netProgMax = 0;
  $('netProg').hidden = true;
  $('netProgFill').style.setProperty('--net-prog', '0');
  for (const { tr } of netRows.values()) tr.style.removeProperty('--row-prog');
}

/** One sweep of the row, resolved when the backend says it has finished. */
function runOnePass(targets, opts) {
  return new Promise((resolve) => {
    netPassDone = resolve;
    invoke('net_test', { targets: targets.map(({ id, path }) => ({ id, path })), opts })
      .catch((e) => {
        $('netNote').textContent = String(e);
        netPassDone = null;
        resolve(false);
      });
  });
}

async function runNetTest() {
  const targets = netTargets.filter((x) => x.path);
  if (!targets.length || netBusy) return;

  netBusy = true;
  $('netRun').disabled = true;
  $('netStop').disabled = false;

  for (const target of targets) {
    const entry = netRows.get(target.id);
    if (entry) {
      entry.cells.status.textContent = t('netQueued');
      entry.cells.status.classList.remove('bad');
    }
  }

  const opts = currentNetOpts();
  const passes = Math.max(1, Number($('netPasses').value) || 1);

  $('netFindings').hidden = true;
  netHistory.clear();
  netProgMax = 0;
  $('netProgFill').style.setProperty('--net-prog', '0');
  $('netProg').hidden = false;

  // Passes run back to back rather than as one longer measurement: a fault
  // that moves between sweeps is a different animal from one that sits still,
  // and averaging them together would hide exactly the thing worth seeing.
  let completed = 0;
  for (let pass = 1; pass <= passes; pass++) {
    netRunState = {
      ids: targets.map((x) => x.id), mode: opts.mode, done: new Set(), pass, passes,
    };
    $('netProgText').textContent = t('netProgStep', 1, targets.length);

    const finished = await runOnePass(targets, opts);
    if (!finished) break;
    completed = pass;
  }

  netBusy = false;
  $('netRun').disabled = false;
  $('netStop').disabled = true;
  endNetProgress();
  $('netNote').textContent = completed < passes
    ? t('netCancelled')
    : t('netDonePasses', netResults.size, completed);

  // Read while the previous run is still the previous run, then become it.
  renderFindings();
  netLastRun = {
    mode: opts.mode,
    bypass: opts.bypass_cache,
    reads: Object.fromEntries(findingsInput().map((r) => [r.id, r.read])),
  };
}

listen('nettest-start', (e) => {
  const entry = netRows.get(e.payload);
  if (!entry) return;
  entry.tr.classList.add('is-running');
  entry.cells.status.textContent = t('netMeasuring');
});

listen('nettest-progress', (e) => paintNetProgress(e.payload));

listen('nettest-result', (e) => applyNetResult(e.payload));

listen('nettest-done', (e) => {
  // One pass of possibly several: the run is wound up by runNetTest, which is
  // the only place that knows whether another sweep is still to come.
  const resolve = netPassDone;
  netPassDone = null;
  if (resolve) resolve(!e.payload);
});

$('netRun').onclick = runNetTest;
$('netStop').onclick = () => invoke('net_test_cancel');
$('netAdd').onclick = () => addNetTarget();
$('netAddFirst').onclick = () => addNetTarget();
$('netAddRange').onclick = addNetRange;
$('netExport').onclick = exportNetReport;
$('netPresetSave').onclick = saveNetPreset;
$('netPresetDelete').onclick = deleteNetPreset;
$('netPreset').onchange = () => applyNetPreset($('netPreset').value);
$('netPresetName').onkeydown = (e) => { if (e.key === 'Enter') saveNetPreset(); };

// Enter in any of the range fields adds the range — it is a form in spirit.
for (const id of ['netFrom', 'netTo', 'netSharePath']) {
  $(id).onkeydown = (e) => { if (e.key === 'Enter') addNetRange(); };
}

// One stream measures one stream: on a 10 GbE link that ceiling sits near
// 500 MB/s and looks exactly like a slow network. Worth saying out loud.
$('netThreads').onchange = () => {
  $('netNote').textContent = Number($('netThreads').value) === 1 ? t('netOneStream') : '';
};

// Both of these change which caveat applies, so both repaint it. The loop
// below wraps these handlers rather than replacing them.
$('netMode').onchange = paintNetWarn;
$('netBypass').onchange = paintNetWarn;

$('netLink').onchange = applyLinkChoice;

// Every setting is remembered as it changes, so the next launch starts where
// the last one stopped rather than at defaults.
for (const id of ['netSize', 'netThreads', 'netMode', 'netVia', 'netBypass', 'netPasses']) {
  const el = $(id);
  const previous = el.onchange;
  el.onchange = (e) => {
    if (previous) previous(e);
    saveNetOpts();
  };
}

/* ---------- interface size ---------- */

// The value is already applied by the inline script in <head>; here we only
// sync the selector and remember the choice.
const uiSize = $('uiSize');
uiSize.value = document.documentElement.dataset.size || 'm';
uiSize.onchange = () => {
  document.documentElement.dataset.size = uiSize.value;
  localStorage.setItem('reticle-ui-size', uiSize.value);
};

/* ---------- HTTP ---------- */

/** Headers are edited as text: "Name: value" per line. */
function parseHeaders(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf(':');
    if (i === -1) continue;
    out.push([s.slice(0, i).trim(), s.slice(i + 1).trim()]);
  }
  return out;
}

/** The scheme is filled in for you: "127.0.0.1:8080" is exactly what people
 *  copy out of a config, and demanding "http://" helps nobody. */
function normalizeUrl(raw) {
  const s = raw.trim();
  if (!s) return s;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'http://' + s;
}

/* ---------- combobox ----------
 * Hand-rolled rather than <datalist>: the native one filters options by what is
 * already typed, so with 0.0.0.0 in the field no other interface showed up.
 * Here the arrow always reveals the full list, while typing filters it.
 */

function attachCombo(input, itemsFn) {
  const wrap = document.createElement('span');
  wrap.className = 'combo';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const arrow = document.createElement('button');
  arrow.type = 'button';
  arrow.className = 'combo-btn';
  arrow.textContent = '▾';
  wrap.appendChild(arrow);

  const list = document.createElement('div');
  list.className = 'combo-list';
  list.hidden = true;
  wrap.appendChild(list);

  function render(filter) {
    const items = itemsFn();
    const needle = (filter || '').trim().toLowerCase();
    const shown = needle
      ? items.filter((i) => i.value.toLowerCase().includes(needle) || (i.label || '').toLowerCase().includes(needle))
      : items;

    list.textContent = '';
    if (!shown.length) {
      list.hidden = true;
      return;
    }

    for (const item of shown) {
      const row = document.createElement('div');
      row.className = 'combo-item';

      const value = document.createElement('span');
      value.className = 'combo-value';
      value.textContent = item.value;
      row.appendChild(value);

      if (item.label) {
        const label = document.createElement('span');
        label.className = 'combo-label';
        label.textContent = item.label;
        row.appendChild(label);
      }

      // mousedown rather than click: blur would close the list before a click lands
      row.onmousedown = (e) => {
        e.preventDefault();
        input.value = item.value;
        list.hidden = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };

      list.appendChild(row);
    }
    list.hidden = false;
  }

  arrow.onclick = () => (list.hidden ? render('') : (list.hidden = true));
  input.addEventListener('input', () => render(input.value));
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') list.hidden = true;
  });

  return { render };
}

/* ---------- recent addresses ---------- */

const URLS_KEY = 'reticle-http-urls';
/** Nobody scans a longer dropdown — retyping is faster. */
const URL_HISTORY = 7;

function loadUrls() {
  try {
    const raw = JSON.parse(localStorage.getItem(URLS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function rememberUrl(url) {
  if (!url) return;
  const list = [url, ...loadUrls().filter((u) => u !== url)].slice(0, URL_HISTORY);
  localStorage.setItem(URLS_KEY, JSON.stringify(list));
}

/* ---------- network interfaces ---------- */

let interfaces = [];

/** Fill the "expect this adapter" picker. 0.0.0.0 is not an adapter, so it is
 *  left out: here the question is which card the traffic really used. */
function fillViaPicker() {
  const sel = $('netVia');
  const keep = sel.value;
  sel.textContent = '';

  const any = document.createElement('option');
  any.value = '';
  any.textContent = t('netAnyAdapter');
  sel.appendChild(any);

  for (const iface of interfaces.filter((i) => i.ip !== '0.0.0.0')) {
    const opt = document.createElement('option');
    opt.value = iface.ip;
    opt.textContent = `${iface.name} · ${iface.ip}`;
    sel.appendChild(opt);
  }

  // A choice made before the list existed is applied once it does.
  sel.value = restoreNetOpts.pendingVia || keep;
  restoreNetOpts.pendingVia = null;
}

async function loadInterfaces() {
  try {
    interfaces = await invoke('list_interfaces');
  } catch {
    // Even when adapters cannot be enumerated these two always make sense —
    // without them the field would offer no hints at all.
    interfaces = [
      { ip: '0.0.0.0', name: 'all interfaces' },
      { ip: '127.0.0.1', name: 'localhost' },
    ];
  }
  fillViaPicker();
}

/* ---------- request history ---------- */

const HISTORY_KEY = 'reticle-http-history';
const HISTORY_MAX = 30;
/** Bodies are trimmed: history records that a request happened, not a payload. */
const HISTORY_BODY_MAX = 64 * 1024;

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function pushHistory(entry) {
  const list = [entry, ...loadHistory()].slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    // Storage overflowed — keep the fresher half and retry.
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX / 2)));
  }
  renderHistory();
}

/** Body preview on one line: newlines and indentation are collapsed, otherwise
 *  formatted JSON turns a history row into mush. */
function bodyPreview(body) {
  if (!body) return '';
  return body.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function applyRequest(r) {
  $('hMethod').value = r.method;
  $('hUrl').value = r.url;
  $('hHeaders').value = r.headers || '';
  $('hBody').value = r.body || '';
  $('hInsecure').checked = !!r.insecure;
}

function renderHistory() {
  const box = $('historyList');
  const list = loadHistory();
  box.textContent = '';
  $('histCount').textContent = list.length ? t('historyCount', list.length) : '';

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'preset-empty';
    empty.textContent = t('historyEmpty');
    box.appendChild(empty);
    return;
  }

  for (const item of list) {
    const row = document.createElement('div');
    row.className = 'hist-row';
    // Clicking a row fills the form. Sending needs the explicit button —
    // otherwise browsing history could easily repeat a POST.
    row.onclick = () => applyRequest(item);

    const time = document.createElement('span');
    time.className = 'hist-t';
    // 24-hour clock: 4:12:10 PM does not fit the column and wraps to two lines.
    time.textContent = new Date(item.at).toLocaleTimeString([], { hour12: false });

    const method = document.createElement('span');
    method.className = 'hist-m';
    method.textContent = item.method;

    const url = document.createElement('span');
    url.className = 'hist-url';
    url.textContent = item.url;
    url.title = item.url;

    const body = document.createElement('span');
    body.className = 'hist-body';
    body.textContent = bodyPreview(item.body);
    if (item.body) body.title = item.body.slice(0, 2000);

    const status = document.createElement('span');
    status.className = 'hist-status ' + (item.status ? statusClass(item.status) : 'bad');
    status.textContent = item.status ? `${item.status} · ${item.ms} ms` : t('failedStatus');

    const resend = document.createElement('button');
    resend.type = 'button';
    resend.className = 'hist-resend';
    resend.textContent = '↻';
    resend.title = t('resend');
    resend.onclick = (e) => {
      e.stopPropagation();
      applyRequest(item);
      sendRequest();
    };

    row.append(time, method, url, body, status, resend);
    box.appendChild(row);
  }
}

/* ---------- request presets ---------- */

const PRESETS_KEY = 'reticle-http-presets';
/** Format marker — so an import does not read a foreign JSON as presets. */
const PRESET_FORMAT = 'reticle-presets';

function loadPresets() {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    // Broken JSON must not break the tab — start from an empty list instead.
    return [];
  }
}

function savePresets(list) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
}

function applyPreset(p) {
  $('hMethod').value = p.method;
  $('hUrl').value = p.url;
  $('hHeaders').value = p.headers || '';
  $('hBody').value = p.body || '';
  $('hInsecure').checked = !!p.insecure;
  $('presetName').value = p.name;
}

function renderPresets() {
  const strip = $('presetStrip');
  strip.textContent = '';
  const list = loadPresets();

  if (!list.length) {
    const empty = document.createElement('span');
    empty.className = 'preset-empty';
    empty.textContent = t('presetsEmpty');
    strip.appendChild(empty);
    return;
  }

  for (const p of list) {
    const chip = document.createElement('div');
    chip.className = 'preset-chip';

    const method = document.createElement('span');
    method.className = 'm';
    method.textContent = p.method;

    const name = document.createElement('span');
    name.className = 'n';
    name.textContent = p.name;

    // Three explicit actions instead of one click that sent immediately:
    // repeating a POST by accident is far too easy otherwise.
    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'preset-btn';
    send.textContent = '↻';
    send.title = t('resendPreset');
    send.onclick = () => {
      applyPreset(p);
      sendRequest();
    };

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'preset-btn';
    edit.textContent = '✎';
    edit.title = t('editPreset');
    // Load into the form and stop there — nothing leaves the app.
    edit.onclick = () => applyPreset(p);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'preset-btn is-danger';
    del.textContent = '×';
    del.title = t('deletePreset');
    del.onclick = () => {
      savePresets(loadPresets().filter((i) => i.name !== p.name));
      renderPresets();
    };

    chip.append(method, name, send, edit, del);
    strip.appendChild(chip);
  }
}

$('presetSave').onclick = () => {
  const name = $('presetName').value.trim();
  if (!name) {
    $('presetName').focus();
    showHttpError(t('needPresetName'));
    $('hResult').hidden = false;
    return;
  }

  const preset = {
    name,
    method: $('hMethod').value,
    url: normalizeUrl($('hUrl').value),
    headers: $('hHeaders').value,
    body: $('hBody').value,
    insecure: $('hInsecure').checked,
  };

  // A preset with the same name is overwritten — otherwise duplicates pile up.
  const list = loadPresets().filter((p) => p.name !== name);
  list.push(preset);
  savePresets(list);
  renderPresets();
};

/* ---------- saving the response ---------- */

/** The last response in full — saving uses this, not what is on screen. */
let lastResponse = null;

/** Extension comes from content-type, or from the shape of the body. */
function guessExtension(contentType, body) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('json')) return 'json';
  if (ct.includes('html')) return 'html';
  if (ct.includes('xml')) return 'xml';
  if (ct.includes('csv')) return 'csv';
  if (ct.includes('javascript')) return 'js';
  if (ct.includes('css')) return 'css';
  if (ct.includes('plain')) return 'txt';

  const head = body.trimStart()[0];
  if (head === '{' || head === '[') return 'json';
  if (head === '<') return 'html';
  return 'txt';
}

/** File name from the last path segment, so not everything is called response. */
function suggestName(url, ext) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || u.hostname;
    const clean = last.replace(/\.[^.]*$/, '').replace(/[^a-z0-9._-]/gi, '-');
    return `${clean || 'response'}.${ext}`;
  } catch {
    return `response.${ext}`;
  }
}

function saveNote(text) {
  const note = $('hSaveNote');
  note.textContent = text;
  // The note lives a few seconds: it reports an action, not a state.
  clearTimeout(saveNote.timer);
  saveNote.timer = setTimeout(() => { note.textContent = ''; }, 4000);
}

$('hSave').onclick = async () => {
  if (!lastResponse) return;

  const ext = guessExtension(lastResponse.content_type, lastResponse.body);
  // JSON is saved in the same readable shape it is shown in.
  const content = ext === 'json' && lastResponse.json_pretty ? lastResponse.json_pretty : lastResponse.body;

  try {
    const path = await invoke('save_text', {
      content,
      defaultName: suggestName(lastResponse.url, ext),
      extension: ext,
    });
    if (path) saveNote(t('savedTo', path));
  } catch (e) {
    saveNote(t('saveFailed', String(e)));
  }
};

$('hCopy').onclick = async () => {
  if (!lastResponse) return;
  const text = lastResponse.json_pretty ?? lastResponse.body;
  try {
    await navigator.clipboard.writeText(text);
    saveNote(t('copied'));
  } catch (e) {
    saveNote(String(e));
  }
};

/* ---------- preset exchange ---------- */

function presetNote(text) {
  const note = $('presetNote');
  note.textContent = text;
  clearTimeout(presetNote.timer);
  presetNote.timer = setTimeout(() => { note.textContent = ''; }, 4000);
}

$('presetExport').onclick = async () => {
  const presets = loadPresets();
  if (!presets.length) {
    presetNote(t('nothingToExport'));
    return;
  }

  const payload = JSON.stringify({ format: PRESET_FORMAT, version: 1, presets }, null, 2);

  try {
    const path = await invoke('save_text', {
      content: payload,
      defaultName: 'reticle-presets.json',
      extension: 'json',
    });
    if (path) presetNote(t('exported', presets.length));
  } catch (e) {
    presetNote(String(e));
  }
};

$('presetImport').onclick = async () => {
  try {
    const text = await invoke('open_text', { extension: 'json' });
    if (!text) return;

    const data = JSON.parse(text);
    if (data?.format !== PRESET_FORMAT || !Array.isArray(data.presets)) {
      presetNote(t('badPresetFile'));
      return;
    }

    // Only entries with a name and a URL are taken: a foreign file can be anything.
    const incoming = data.presets.filter((p) => p && typeof p.name === 'string' && typeof p.url === 'string');
    const names = new Set(incoming.map((p) => p.name));
    const merged = [...loadPresets().filter((p) => !names.has(p.name)), ...incoming];

    savePresets(merged);
    renderPresets();
    presetNote(t('imported', incoming.length));
  } catch (e) {
    presetNote(String(e));
  }
};

function statusClass(code) {
  if (code < 300) return 'ok';
  if (code < 400) return 'warn';
  return 'bad';
}

function showHttpError(message) {
  const status = $('hStatus');
  status.textContent = '';
  const span = document.createElement('span');
  span.className = 'code bad';
  span.textContent = message;
  status.appendChild(span);
  $('hHeadersOut').hidden = true;
  $('hBodyOut').textContent = '';
  // Nothing to save — hide the buttons so the previous response cannot be saved.
  $('hActions').hidden = true;
  lastResponse = null;
}

async function sendRequest() {
  // Show the final URL in the field, so the added scheme is not a surprise.
  const url = normalizeUrl($('hUrl').value);
  $('hUrl').value = url;

  const btn = $('hSend');
  const status = $('hStatus');

  $('hResult').hidden = false;
  if (!url) { showHttpError(t('needUrl')); return; }

  rememberUrl(url);

  btn.disabled = true;
  btn.textContent = t('sending');

  // Headers and body go into history as text, exactly as they sit in the fields,
  // so resending repeats the request verbatim.
  const sent = {
    at: Date.now(),
    method: $('hMethod').value,
    url,
    headers: $('hHeaders').value,
    body: ($('hBody').value || '').slice(0, HISTORY_BODY_MAX),
    insecure: $('hInsecure').checked,
  };

  try {
    const res = await invoke('http_request', {
      req: {
        method: sent.method,
        url,
        headers: parseHeaders(sent.headers),
        body: $('hBody').value || null,
        timeout_s: 30,
        insecure: sent.insecure,
      },
    });

    pushHistory({ ...sent, status: res.status, ms: res.ms });

    // Keep the whole response: saving uses it rather than what is displayed.
    lastResponse = { ...res, url };
    $('hActions').hidden = false;

    status.textContent = '';

    const code = document.createElement('span');
    code.className = 'code ' + statusClass(res.status);
    code.textContent = `${res.status} ${res.status_text}`.trim();

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = t('responseMeta', res.ms, res.size);

    status.append(code, meta);

    if (res.content_type) {
      const ct = document.createElement('span');
      ct.className = 'meta';
      ct.textContent = res.content_type;
      status.appendChild(ct);
    }
    if (res.truncated) {
      const cut = document.createElement('span');
      cut.className = 'meta';
      cut.textContent = t('bodyTruncated');
      status.appendChild(cut);
    }

    $('hHeadersOut').hidden = false;
    $('hHeadersBody').textContent = res.headers.map(([k, v]) => `${k}: ${v}`).join('\n');
    // json_pretty arrives pre-formatted from Rust — no parsing in the UI
    $('hBodyOut').textContent = res.json_pretty ?? res.body;
  } catch (err) {
    // Failed attempts belong in history too: a request that was failing
    // yesterday is a fact worth seeing rather than recalling.
    pushHistory({ ...sent, status: null, ms: 0 });
    showHttpError(String(err));
  } finally {
    btn.disabled = false;
    btn.textContent = t('send');
  }
}

$('httpForm').onsubmit = (e) => {
  e.preventDefault();
  sendRequest();
};

// The scheme is also completed on blur, so it shows before sending, not after.
$('hUrl').onblur = () => {
  const v = normalizeUrl($('hUrl').value);
  if (v) $('hUrl').value = v;
};

attachCombo($('fBind'), () => interfaces.map((i) => ({ value: i.ip, label: i.name })));
attachCombo($('hUrl'), () => loadUrls().map((u) => ({ value: u })));

netTargets = loadNetTargets();
netNextId = netTargets.length ? Math.max(...netTargets.map((x) => x.id)) + 1 : 1;
$('netLink').value = localStorage.getItem(NET_LINK_KEY) || '10';
restoreNetOpts();
applyLinkChoice();

// Open on the preset that was last in play. The target list is restored from
// its own storage, so the preset is only selected in the picker rather than
// re-applied — re-applying would throw away any targets added since.
renderNetPresetPicker(localStorage.getItem(NET_ACTIVE_KEY) || '');

applyStaticStrings();

/** Which build this is, shown by the wordmark and carried into the report. */
let appVersion = '';
invoke('app_version')
  .then((v) => {
    appVersion = v || '';
    // Text only — the chip's state dot is a sibling and must survive.
    $('appVersionText').textContent = appVersion;
  })
  .catch(() => { /* outside the app shell there is no version to show */ });
renderPresets();
renderHistory();
renderNetTable();
loadInterfaces();
refreshSources();
