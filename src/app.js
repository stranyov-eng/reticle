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

  row.slots.forEach((slot, i) => {
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
  row.slots.forEach((slot, i) => {
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

applyStaticStrings();
renderPresets();
renderHistory();
loadInterfaces();
refreshSources();
