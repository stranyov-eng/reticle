// node scripts/ui-audit.mjs
//
// Drives the whole interface headlessly against the clip fixture and checks
// what it finds. Written as assertions rather than screenshots because a
// screenshot only catches what someone remembers to look at, and because this
// has to be runnable after every change without anyone watching.
//
// Exits non-zero if anything failed, so it can gate a build.
import { open, closeAll } from './guide-clips/rec.mjs';

const fails = [];
let checks = 0;

function ok(name, condition, detail) {
  checks++;
  if (condition) return;
  fails.push(name + (detail ? ' — ' + detail : ''));
}

const { browser, page } = await open('index.html');
const $ = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);

// A thrown exception usually shows as nothing at all — the loop it was in
// simply stops and the panel it was filling quietly freezes. The first run of
// this audit printed five of them to the console and passed anyway, so they
// are a failure in their own right.
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

/* ---------- tabs and tab-specific chrome ---------- */

const TABS = ['addresses', 'dmx', 'log', 'http', 'network'];
for (const name of TABS) {
  await $((n) => {
    const t = [...document.querySelectorAll('.tab')].find((x) => x.textContent.trim().toLowerCase() === n);
    if (t) t.click();
  }, name);
  await wait(200);

  const state = await $(() => ({
    active: [...document.querySelectorAll('.view')].filter((v) => v.classList.contains('is-active')).map((v) => v.id),
    filterShown: !document.querySelector('.filter').hidden,
    formShown: !document.getElementById('srcForm').hidden,
    // The status bar must sit on the last line of the window, not float
    // halfway up it — the symptom of a layout that stopped stretching.
    barBottom: Math.round(document.querySelector('.statusbar').getBoundingClientRect().bottom),
    winH: window.innerHeight,
  }));

  ok(`${name}: exactly one view active`, state.active.length === 1, state.active.join(','));
  ok(`${name}: add-source form stays closed`, !state.formShown);
  ok(`${name}: status bar at the bottom`, Math.abs(state.barBottom - state.winH) <= 2,
    `bottom ${state.barBottom} of ${state.winH}`);

  const wantsFilter = name === 'addresses' || name === 'log';
  ok(`${name}: filter ${wantsFilter ? 'shown' : 'hidden'}`, state.filterShown === wantsFilter);
}

/* ---------- adding a source through the form ---------- */

await $(() => {
  [...document.querySelectorAll('.tab')].find((x) => x.textContent.trim().toLowerCase() === 'addresses').click();
  document.getElementById('addSrcBtn').click();
});
await wait(200);
ok('add-source: the button opens the form', await $(() => !document.getElementById('srcForm').hidden));

await $(() => {
  document.getElementById('fKind').value = 'osc-udp';
  document.getElementById('fKind').dispatchEvent(new Event('change'));
  document.getElementById('fPort').value = '9000';
  document.getElementById('srcForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
});
await wait(1500);

ok('add-source: the form closes once accepted', await $(() => document.getElementById('srcForm').hidden));
ok('add-source: a chip appears in the strip', await $(() => document.querySelectorAll('.src-chip').length === 1));
ok('addresses: rows arrive', await $(() => document.querySelectorAll('.addr-table tbody tr').length > 0));

/* ---------- the address table ---------- */

const addr = await $(() => {
  const ths = [...document.querySelectorAll('.addr-table thead th')];
  return {
    clipped: ths.filter((t) => t.scrollWidth > t.clientWidth).map((t) => t.textContent),
    widths: ths.map((t) => Math.round(t.getBoundingClientRect().width)),
    overflow: document.querySelector('.addr-table').getBoundingClientRect().width > window.innerWidth + 1,
  };
});
ok('addresses: no header is cut off', addr.clipped.length === 0, addr.clipped.join(', '));
ok('addresses: table fits the window', !addr.overflow);
ok('addresses: every column has width', addr.widths.every((w) => w > 20), addr.widths.join(','));

// Column widths must not move while values change — the whole point of the
// fixed layout.
const before = await $(() => [...document.querySelectorAll('.addr-table thead th')].map((t) => Math.round(t.getBoundingClientRect().width)).join(','));
await wait(1200);
const after = await $(() => [...document.querySelectorAll('.addr-table thead th')].map((t) => Math.round(t.getBoundingClientRect().width)).join(','));
ok('addresses: columns hold still as values change', before === after, `${before} -> ${after}`);

// Filtering
await $(() => { const f = document.getElementById('filter'); f.value = '/cue'; f.dispatchEvent(new Event('input')); });
await wait(600);
const filtered = await $(() => [...document.querySelectorAll('.addr-table tbody tr td.col-path')].map((c) => c.textContent).filter(Boolean));
ok('addresses: the filter filters', filtered.length > 0 && filtered.every((p) => p.includes('/cue')), filtered.join(' '));
await $(() => { const f = document.getElementById('filter'); f.value = ''; f.dispatchEvent(new Event('input')); });
await wait(400);

// The detail panel
await $(() => document.querySelector('.addr-table tbody tr').click());
await wait(700);
ok('addresses: a row opens the detail panel', await $(() => !document.querySelector('.detail').hidden));
await $(() => { const d = document.querySelector('.detail'); if (d) d.hidden = true; });

/* ---------- DMX ---------- */

await $(async () => {
  await window.__TAURI__.core.invoke('add_source', { cfg: { kind: 'sacn', bind: '192.168.2.2', port: 5568, multicast: null, universes: '1-4', label: null } });
  [...document.querySelectorAll('.tab')].find((x) => x.textContent.trim().toLowerCase() === 'dmx').click();
});
await wait(1500);

const dmx = await $(() => ({
  chips: document.querySelectorAll('.uni-chip').length,
  cells: document.querySelectorAll('.ch').length,
  conflict: document.querySelectorAll('.uni-chip.has-conflict').length,
}));
ok('dmx: a chip per universe', dmx.chips === 4, String(dmx.chips));
ok('dmx: the grid has 512 cells', dmx.cells === 512, String(dmx.cells));
ok('dmx: the two-sender universe is flagged', dmx.conflict === 1, String(dmx.conflict));

await $(() => document.querySelectorAll('.uni-chip')[2].click());
await wait(800);
ok('dmx: selecting another universe keeps the grid', await $(() => document.querySelectorAll('.ch').length === 512));

/* ---------- HTTP ---------- */

await $(() => [...document.querySelectorAll('.tab')].find((x) => x.textContent.trim().toLowerCase() === 'http').click());
await wait(300);
await $(() => {
  document.getElementById('hUrl').value = '127.0.0.1:8080/api/transport';
  document.getElementById('httpForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
});
await wait(1200);

const http = await $(() => ({
  shown: !document.getElementById('hResult').hidden,
  status: (document.getElementById('hStatus') || {}).textContent || '',
  body: (document.getElementById('hBodyOut') || {}).textContent || '',
  url: document.getElementById('hUrl').value,
  history: document.querySelectorAll('.hist-row').length,
}));
ok('http: a response appears', http.shown);
ok('http: the status is shown', /200/.test(http.status), http.status.trim());
ok('http: the body is formatted', http.body.includes('"transport"'), http.body.slice(0, 40));
ok('http: a bare host gets a scheme', http.url.startsWith('http://'), http.url);
ok('http: the request lands in history', http.history === 1, String(http.history));

/* ---------- Network ---------- */

await $(() => [...document.querySelectorAll('.tab')].find((x) => x.textContent.trim().toLowerCase() === 'network').click());
await wait(300);
await $(() => {
  document.getElementById('netFrom').value = '192.168.2.11';
  document.getElementById('netTo').value = '192.168.2.14';
  document.getElementById('netSharePath').value = 'd3 Projects\\Demo_Show_v01\\objects';
  document.getElementById('netAddRange').click();
});
await wait(600);
ok('network: a range adds every host in it', await $(() => document.querySelectorAll('.net-table tbody tr').length === 4));

await $(() => document.getElementById('netRun').click());
await wait(600);
const running = await $(() => ({
  progShown: !document.getElementById('netProg').hidden,
  runDisabled: document.getElementById('netRun').disabled,
  stopEnabled: !document.getElementById('netStop').disabled,
}));
ok('network: the progress bar appears', running.progShown);
ok('network: Run is disabled while running', running.runDisabled);
ok('network: Stop is enabled while running', running.stopEnabled);

await page.waitForFunction(() => { const f = document.getElementById('netFindings'); return f && !f.hidden; }, { timeout: 60000 });
const done = await $(() => ({
  findings: document.querySelectorAll('.net-finding').length,
  rowsWithRead: [...document.querySelectorAll('.net-table td.read .v')].filter((v) => /MB/.test(v.textContent)).length,
  prog: document.getElementById('netProg').hidden,
  runEnabled: !document.getElementById('netRun').disabled,
  clippedHeaders: [...document.querySelectorAll('.net-table thead th')].filter((t) => t.scrollWidth > t.clientWidth).map((t) => t.textContent),
}));
ok('network: findings are written', done.findings > 0, String(done.findings));
ok('network: every row reports a read', done.rowsWithRead === 4, String(done.rowsWithRead));
ok('network: the progress bar goes away', done.prog);
ok('network: Run is enabled again', done.runEnabled);
ok('network: no header is cut off', done.clippedHeaders.length === 0, done.clippedHeaders.join(', '));

// The report draws without throwing, and carries the version.
const report = await $(() => {
  try {
    const c = drawReport();
    return { w: c.width, h: c.height };
  } catch (e) { return { error: String(e) }; }
});
ok('network: the report renders', report.w > 0 && report.h > 0, report.error || '');

/* ---------- guide ---------- */

await $(() => document.getElementById('guideBtn').click());
await wait(900);
const guide = await $(() => ({
  open: document.getElementById('guideOverlay').classList.contains('open'),
  nav: document.querySelectorAll('#kbNav a').length,
  cards: document.querySelectorAll('#kbContent .kb-meta h3').length,
  clips: document.querySelectorAll('.kb-clip[data-has-clip]').length,
  zeroDur: [...document.querySelectorAll('.kb-clip .dur')].filter((d) => d.textContent === '0:00').length,
}));
ok('guide: F1 panel opens', guide.open);
ok('guide: the nav is built', guide.nav > 20, String(guide.nav));
ok('guide: cards are built', guide.cards > 20, String(guide.cards));
ok('guide: clips are wired', guide.clips > 0, String(guide.clips));
ok('guide: no clip is left unlabelled', guide.zeroDur === 0, String(guide.zeroDur));

await $(() => document.getElementById('guideOverlay').classList.remove('open'));

/* ---------- themes and text sizes ---------- */

for (const theme of ['day', 'night']) {
  for (const size of ['s', 'm', 'l']) {
    await $(({ theme, size }) => {
      document.documentElement.setAttribute('data-theme', theme);
      document.documentElement.dataset.size = size;
      document.body.offsetHeight;
    }, { theme, size });
    await wait(150);

    for (const name of TABS) {
      await $((n) => {
        const t = [...document.querySelectorAll('.tab')].find((x) => x.textContent.trim().toLowerCase() === n);
        if (t) t.click();
      }, name);
      await wait(120);

      const bad = await $(() => {
        const cut = [...document.querySelectorAll('.view.is-active table thead th, .view.is-active .bar-group-lbl, .log-head span')]
          .filter((e) => e.scrollWidth > e.clientWidth + 1)
          .map((e) => e.textContent.trim());
        const doc = document.documentElement;
        return { cut, sideScroll: doc.scrollWidth > doc.clientWidth + 1 };
      });
      ok(`${theme}/${size}/${name}: nothing cut off`, bad.cut.length === 0, bad.cut.join(', '));
      ok(`${theme}/${size}/${name}: no sideways scroll`, !bad.sideScroll);
    }
  }
}

/* ---------- paths the happy run does not touch ---------- */

// HTTP presets: save, load, delete.
await $(() => [...document.querySelectorAll('.tab')].find((x) => x.textContent.trim().toLowerCase() === 'http').click());
await wait(200);
await $(() => {
  document.getElementById('presetName').value = 'audit';
  document.getElementById('presetSave').click();
});
await wait(400);
ok('http: a preset is saved', await $(() => document.querySelectorAll('.preset-chip').length === 1));

await $(() => {
  const chip = document.querySelector('.preset-chip');
  const load = [...chip.querySelectorAll('button')].find((b) => /edit|load|✎/i.test(b.title + b.textContent));
  if (load) load.click();
});
await wait(400);
ok('http: loading a preset does not throw', errors.length === 0, errors.join(' | '));

await $(() => {
  const chip = document.querySelector('.preset-chip');
  const del = [...chip.querySelectorAll('button')].find((b) => b.classList.contains('is-danger'));
  if (del) del.click();
});
await wait(400);
ok('http: a preset is deleted', await $(() => document.querySelectorAll('.preset-chip').length === 0));

// Resending from history.
await $(() => {
  const resend = document.querySelector('.hist-resend');
  if (resend) resend.click();
});
await wait(1000);
ok('http: history resend works', await $(() => document.querySelectorAll('.hist-row').length >= 1));

// Network presets.
await $(() => [...document.querySelectorAll('.tab')].find((x) => x.textContent.trim().toLowerCase() === 'network').click());
await wait(200);
await $(() => {
  document.getElementById('netPresetName').value = 'audit venue';
  document.getElementById('netPresetSave').click();
});
await wait(400);
ok('network: a preset is saved', await $(() => [...document.querySelectorAll('#netPreset option')].some((o) => o.value === 'audit venue')));

await $(() => { const s = document.getElementById('netPreset'); s.value = 'audit venue'; s.dispatchEvent(new Event('change')); });
await wait(600);
ok('network: a preset loads its targets', await $(() => document.querySelectorAll('.net-table tbody tr').length === 4));
await $(() => document.getElementById('netPresetDelete').click());
await wait(300);

// Stopping a run part way.
//
// The press and the reading happen in one evaluate, so what is checked is the
// state the button leaves behind rather than whatever the run reached next.
await $(() => document.getElementById('netRun').click());
await wait(900);
const stopping = await $(() => {
  document.getElementById('netStop').click();
  return {
    disabled: document.getElementById('netStop').disabled,
    text: document.getElementById('netProgText').textContent,
  };
});
ok('network: Stop says it was asked', stopping.disabled && /stopping/i.test(stopping.text), stopping.text);

await page.waitForFunction(() => !document.getElementById('netRun').disabled, { timeout: 30000 });
ok('network: Stop ends the run', await $(() => document.getElementById('netProg').hidden));
ok(
  'network: a stopped run leaves no row claiming to be busy',
  await $(() => ![...document.querySelectorAll('.net-table tbody tr')]
    .some((tr) => tr.classList.contains('is-running') || /queued|measuring/i.test(tr.textContent))),
);
ok(
  'network: the targets it never reached say so',
  await $(() => [...document.querySelectorAll('.net-table tbody tr')]
    .some((tr) => /not measured/i.test(tr.textContent))),
);

// Pause, reset, and removing a source.
await $(() => [...document.querySelectorAll('.tab')].find((x) => x.textContent.trim().toLowerCase() === 'addresses').click());
await wait(200);
await $(() => document.getElementById('pauseBtn').click());
await wait(600);
const paused = await $(() => document.querySelectorAll('.addr-table tbody tr').length);
await wait(700);
ok('addresses: pause freezes the table', await $((n) => document.querySelectorAll('.addr-table tbody tr').length === n, paused));
await $(() => document.getElementById('pauseBtn').click());
await wait(400);

await $(() => document.getElementById('resetBtn').click());
await wait(400);
ok('addresses: reset does not throw', errors.length === 0, errors.join(' | '));

await $(() => { const x = document.querySelector('.src-chip button'); if (x) x.click(); });
await wait(600);
ok('sources: a chip can be closed', await $(() => document.querySelectorAll('.src-chip').length === 1));

/* ---------- nothing may have thrown ---------- */

ok('no uncaught errors anywhere in the run', errors.length === 0, errors.slice(0, 4).join(' | '));

await browser.close();
await closeAll();

console.log(`\n${checks - fails.length}/${checks} checks passed`);
if (fails.length) {
  console.log('\nFAILED:');
  for (const f of fails) console.log('  · ' + f);
  process.exit(1);
}
