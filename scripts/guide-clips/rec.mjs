// Guide-clip recorder for the stranyov.pro tools — the Projection Calc recorder's method
// (C:/Projects/Website/projcalc-n-clips/scripts/guide-clips/rec.mjs): Chromium, a drawn cursor, a CDP
// screencast with real frame times → a constant 30 fps mp4 → the site's clip files (tools/help/README.md:
// 1920×1200 H.264 mp4 + a .webp poster 0.5 s before the end).
// The page is laid out at 1920×1200 CSS px (a common screen: the tool strip fits one row) and filmed 1:1.
// All coordinates the clip scripts use are CSS px (1920×1200).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
// Playwright isn't a dependency of the site: it comes from $PLAYWRIGHT_DIR, this repo's node_modules, or the
// Projection Calc checkout that has it (npm i there brings it; 'npx playwright install chromium' once).
function playwright() {
  const tries = [process.env.PLAYWRIGHT_DIR, 'playwright', 'C:/Projects/Website/projcalc-n-clips/node_modules/playwright'].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch (e) {} }
  throw new Error('Playwright not found — set PLAYWRIGHT_DIR to a node_modules/playwright folder');
}
const { chromium } = playwright();
export const launchChromium = (o) => chromium.launch(o);   // for reel.mjs (its title cards)

export const W = 1920, H = 1200;          // CSS px: the page is laid out like a 1920 × 1200 screen (the tool strip in one row) …
export const OW = 1920, OH = 1200;       // … and filmed 1:1 into the 1920×1200 frame
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
const { serve } = await import('./serve.mjs');
export const OUT = path.join(HERE, 'out');
export const ASSETS = path.join(HERE, 'assets');
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(ASSETS, { recursive: true });

// Before any page script: the drawn cursor; a stand-in save dialog and no open dialog (Open falls back to
// an <input type=file>, which a clip can film); downloads caught and shown as a card with the
// file's name, size and — for text files — its first lines (the file itself never reaches a screencast);
// window.print shows a stand-in.
const INIT = `(() => {
  // Save: a stand-in for the system save dialog (as in Chrome, the project is written into a file; the
  // download card shows it). Open: no picker, so the tools use an <input type=file> (chooseFile answers it).
  try { delete window.showOpenFilePicker; } catch (e) {}
  window.showOpenFilePicker = undefined;
  window.showSaveFilePicker = async (o) => {
    const name = (o && o.suggestedName) || 'project.stv';
    return { kind: 'file', name, queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      createWritable: async () => { const parts = []; return { write: async (d) => { parts.push(d); }, abort: async () => {},
        close: async () => { const b = new Blob(parts); window.__dls.push({ name, size: b.size, text: null, blob: b }); window.__dlCard(name, b.size, null); } }; } };
  };
  const mk = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div'); c.id = '__cur';
    c.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);';
    c.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M3 2 L3 19 L7.5 14.8 L10.6 21.5 L13.4 20.3 L10.4 13.7 L16.5 13.7 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    const st = document.createElement('style');
    st.textContent = '@keyframes __rip{from{opacity:.55;transform:translate(-50%,-50%) scale(.3)}to{opacity:0;transform:translate(-50%,-50%) scale(1)}}.__rip{position:fixed;width:44px;height:44px;border-radius:50%;border:2px solid #ffd06b;pointer-events:none;z-index:2147483646;animation:__rip .45s ease-out forwards}'
      + '@keyframes __in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}';
    document.documentElement.appendChild(st);
  };
  const move = (e) => { mk(); document.getElementById('__cur').style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; };
  addEventListener('mousemove', move, true);
  addEventListener('pointermove', move, true);
  addEventListener('mousedown', (e) => { mk(); const r = document.createElement('div'); r.className = '__rip'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 500); }, true);

  // downloads → a card
  const blobs = new Map(), oURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { const u = oURL(b); if (b instanceof Blob) blobs.set(u, b); return u; };
  window.__dls = [];
  const kb = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  window.__dlCard = (name, size, text) => {
    const root = getComputedStyle(document.documentElement), v = (k, d) => root.getPropertyValue(k).trim() || d;
    document.getElementById('__dl')?.remove();
    const card = document.createElement('div'); card.id = '__dl';
    const pos = window.__dlPos || { right: 28, bottom: 28 };
    card.style.cssText = 'position:fixed;z-index:2147483644;' + Object.entries(pos).map(([k, x]) => k + ':' + x + 'px').join(';') + ';width:' + (text ? 520 : 330) + 'px;background:' + v('--panel', '#1d1d1f') + ';border:1px solid ' + v('--line2', '#444') + ';border-radius:6px;box-shadow:0 14px 40px rgba(0,0,0,.55);pointer-events:none;animation:__in .25s ease-out;overflow:hidden';
    const head = '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;font:600 12px/1.3 ' + v('--font', 'sans-serif') + ';color:' + v('--ink', '#eee') + '"><span style="display:inline-flex;width:22px;height:22px;border-radius:50%;align-items:center;justify-content:center;background:' + v('--frame-active', '#ffd06b') + ';color:#1d1d1f;font-size:12px">↓</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + name.replace(/</g, '&lt;') + '</span><span style="font:11px ' + v('--mono', 'monospace') + ';color:' + v('--dimmer', '#999') + '">' + kb(size) + '</span></div>';
    let body = '';
    if (text) {
      const lines = text.split(/\\r?\\n/).slice(0, window.__dlLines || 11).map((l) => l.length > 86 ? l.slice(0, 85) + '…' : l);
      body = '<pre style="margin:0;padding:10px 14px 12px;border-top:1px solid ' + v('--line', '#333') + ';font:10.5px/1.55 ' + v('--mono', 'monospace') + ';color:' + v('--dim', '#bbb') + ';white-space:pre;overflow:hidden">' + lines.join('\\n').replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>';
    }
    card.innerHTML = head + body;
    document.body.appendChild(card);
    clearTimeout(window.__dlT); window.__dlT = setTimeout(() => card.remove(), window.__dlHold || 6000);
  };
  const oClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!this.hasAttribute('download')) return oClick.call(this);
    const name = this.download || 'download', href = this.href, b = blobs.get(href);
    const done = (size, text) => { window.__dls.push({ name, size, text }); window.__dlCard(name, size, text); };
    const isText = /\\.(csv|xml|txt|json|jsx|tsv|md|stv)$/i.test(name);
    if (b) { if (isText && b.size < 2e6 && !/\\.stv$/i.test(name)) b.text().then((t) => done(b.size, t)); else done(b.size, null); }
    else if (href.startsWith('data:')) done(Math.round((href.length - href.indexOf(',') - 1) * 0.75), null);
    else done(0, null);
  };
  window.print = () => { window.__printed = (window.__printed || 0) + 1; };
})();`;

let server = null, base = '';
/**
 * The app's own interface, filmed as a page.
 *
 * Reticle's front end is ordinary HTML that talks to Rust through
 * `window.__TAURI__`. fixture.js puts a scripted stand-in there before any page
 * script runs, so the interface behaves exactly as it does in the app while the
 * data is fixed and repeatable — which is what a clip needs, and what a real
 * network could never give twice running.
 */
export async function open(_file, { theme } = {}) {
  if (!server) { server = await serve(path.join(ROOT, 'src')); base = 'http://127.0.0.1:' + server.port; }
  const browser = await chromium.launch({ headless: true, args: ['--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: OW / W, colorScheme: 'dark', locale: 'en-US' });
  await context.addInitScript(INIT);
  await context.addInitScript({ path: path.join(HERE, 'fixture.js') });
  if (theme) await context.addInitScript((t) => { try { localStorage.setItem('stranyov-theme', t); } catch (e) {} }, theme);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.goto(base + '/index.html');
  await page.waitForTimeout(1200);
  await placeCursor(page, W * 0.6, H * 0.45);
  return { browser, context, page };
}
export async function closeAll() { if (server) { server.close(); server = null; } }

// pauses and cursor moves run at PACE while recording; hold() is the app's own work (real time)
export const PACE = 0.6;
let pace = 1, slow = 1;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms * pace));
export const hold = (ms) => new Promise((r) => setTimeout(r, ms));
let cur = { x: W / 2, y: H / 2 };
let moving = null;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export async function glide(page, x, y, ms = 650) {
  const n = Math.max(5, Math.round(ms * pace / 33)), x0 = cur.x, y0 = cur.y, t0 = Date.now() / 1000;
  for (let i = 1; i <= n; i++) { const e = ease(i / n); await page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e); await sleep(ms / n); }
  if (moving && Math.hypot(x - x0, y - y0) > 40) moving.push([t0 + 0.05, Date.now() / 1000 - 0.05]);
  cur = { x, y };
}
export async function placeCursor(page, x, y) { await page.mouse.move(x, y); cur = { x, y }; }
export const cursorAt = () => ({ ...cur });
export async function click(page, x, y, ms, mods = [], { button = 'left', count = 1 } = {}) {
  await glide(page, x, y, ms); await sleep(120);
  for (const m of mods) await page.keyboard.down(m);
  for (let i = 0; i < count; i++) { await page.mouse.down({ button, clickCount: i + 1 }); await sleep(60); await page.mouse.up({ button, clickCount: i + 1 }); if (i + 1 < count) await sleep(60); }
  for (const m of mods) await page.keyboard.up(m);
}
// the first VISIBLE match of a selector
export async function box(page, sel) {
  const b = await page.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }, sel);
  if (!b) throw new Error('no visible ' + sel);
  return { x: b[0], y: b[1], w: b[2], h: b[3], cx: b[0] + b[2] / 2, cy: b[1] + b[3] / 2 };
}
export async function center(page, sel) { const b = await box(page, sel); return [b.cx, b.cy]; }
export async function clickEl(page, sel, ms, mods, opts) { const [x, y] = await center(page, sel); await click(page, x, y, ms, mods, opts); }
export async function hoverEl(page, sel, ms = 600) { const [x, y] = await center(page, sel); await glide(page, x, y, ms); }
// scroll an element into view inside its panel before filming it (not filmed: call in set-up, or it jumps)
export async function reveal(page, sel) { await page.evaluate((sel) => { const e = document.querySelector(sel); if (e) e.scrollIntoView({ block: 'center' }); }, sel); }
// a calm, eased drag
export async function drag(page, x0, y0, x1, y1, ms = 900, { button = 'left', mods = [] } = {}) {
  await glide(page, x0, y0); await sleep(120);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.down({ button });
  const n = Math.max(6, Math.round(ms * pace / 33)), t0 = Date.now() / 1000;
  for (let i = 1; i <= n; i++) { const e = ease(i / n); await page.mouse.move(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e); await sleep(ms / n); }
  await sleep(80); await page.mouse.up({ button });
  for (const m of mods) await page.keyboard.up(m);
  if (moving) moving.push([t0 + 0.05, Date.now() / 1000 - 0.05]);
  cur = { x: x1, y: y1 };
}
export async function wheel(page, x, y, dy, steps = 8, ms = 45) { await glide(page, x, y, 400); for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await sleep(ms); } }

// a key shown as a keycap at the bottom left (a screencast shows no keyboard)
export async function keyShow(page, label) {
  await page.evaluate((label) => {
    let bar = document.getElementById('__keys');
    if (!bar) { bar = document.createElement('div'); bar.id = '__keys'; bar.style.cssText = 'position:fixed;z-index:2147483641;left:28px;bottom:40px;display:flex;gap:8px;pointer-events:none'; document.body.appendChild(bar); }
    const cap = document.createElement('div'); cap.textContent = label;
    cap.style.cssText = 'min-width:40px;height:40px;padding:0 11px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font:600 17px/1 ' + (getComputedStyle(document.documentElement).getPropertyValue('--font').trim() || 'sans-serif') + ';color:#1d1d1f;background:#ffd06b;border-radius:7px;box-shadow:0 3px 0 #b8902f;transition:opacity .4s';
    bar.appendChild(cap); while (bar.children.length > 6) bar.firstChild.remove();
    setTimeout(() => { cap.style.opacity = '0'; setTimeout(() => cap.remove(), 450); }, 2000);
  }, label);
}
// press a key, showing it ("Control+D" shows "Ctrl + D")
export async function key(page, k, label, ms = 380) {
  await keyShow(page, label || k.replace('Control', 'Ctrl').replace(/\+/g, ' + '));
  await page.keyboard.press(k); await sleep(ms);
}
export async function typeText(page, text, perChar = 95) { for (const ch of text) { await page.keyboard.type(ch); await sleep(perChar); } }
export async function typeInto(page, sel, text, ms, { enter = true, select = true } = {}) {
  await clickEl(page, sel, ms); await sleep(150);
  if (select) { await page.keyboard.press('Control+A'); await sleep(120); }
  await typeText(page, text);
  if (enter) await page.keyboard.press('Enter');
}
// a range slider dragged from its value to another
export async function slideTo(page, sel, value, ms = 1100) {
  const r = await page.evaluate(({ sel, value }) => { const s = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length); const b = s.getBoundingClientRect(), num = (a, d) => (s.getAttribute(a) === null || s.getAttribute(a) === '' ? d : +s.getAttribute(a)), min = num('min', 0), max = num('max', 100), f = (x) => b.left + 8 + (b.width - 16) * ((x - min) / (max - min)); return [f(+s.value), f(value), b.top + b.height / 2]; }, { sel, value });
  await drag(page, r[0], r[2], r[1], r[2], ms);
}
// a <select>: the system list never reaches a screencast, so a copy in the tools' dropdown look opens under it
export async function setSel(page, sel, value, ms = 700) {
  await page.evaluate((sel) => { document.querySelector(sel).addEventListener('mousedown', (e) => e.preventDefault(), { capture: true, once: true }); }, sel);
  await clickEl(page, sel, ms);
  const opt = await page.evaluate(({ sel, value }) => {
    const s = document.querySelector(sel), r = s.getBoundingClientRect(), root = getComputedStyle(document.documentElement), v = (k, d) => root.getPropertyValue(k).trim() || d;
    const bx = document.createElement('div'); bx.id = '__fakeSelect';
    const rowH = 22, items = [];
    [...s.children].forEach((c) => { if (c.tagName === 'OPTGROUP') { items.push({ g: c.label }); [...c.children].forEach((o) => items.push({ o })); } else items.push({ o: c }); });
    const h = items.length * rowH + 8, below = r.bottom + 4 + h < innerHeight;
    bx.style.cssText = 'position:fixed;z-index:2147483640;left:' + r.left + 'px;top:' + (below ? r.bottom + 4 : Math.max(8, r.top - 4 - h)) + 'px;min-width:' + Math.max(r.width, 180) + 'px;padding:4px 0;background:' + v('--panel', '#1d1d1f') + ';border:1px solid ' + v('--line2', '#444') + ';border-radius:' + v('--radius', '3px') + ';box-shadow:0 10px 30px rgba(0,0,0,.5);font:11px/' + rowH + 'px ' + v('--mono', 'monospace') + ';color:' + v('--ink', '#eee') + ';pointer-events:auto;cursor:default';
    // it takes the click itself: nothing under the stand-in list may get it
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) => bx.addEventListener(t, (e) => { e.stopPropagation(); e.preventDefault(); }, true));
    let target = null;
    items.forEach((it) => {
      const row = document.createElement('div');
      if (it.g) { row.textContent = it.g; row.style.cssText = 'padding:0 10px;height:' + rowH + 'px;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:' + v('--dimmer', '#888'); }
      else { row.textContent = it.o.text; row.style.cssText = 'padding:0 16px;white-space:nowrap;height:' + rowH + 'px' + (it.o.selected ? ';color:' + v('--frame-active', '#ffd06b') : ''); if (it.o.value === value) { row.dataset.target = '1'; target = row; } }
      bx.appendChild(row);
    });
    document.body.appendChild(bx);
    const t = (target || bx).getBoundingClientRect();
    return [t.left + Math.min(80, t.width / 2), t.top + t.height / 2];
  }, { sel, value });
  await sleep(450);
  await glide(page, opt[0], opt[1], 600);
  await page.evaluate(() => { const t = document.querySelector('#__fakeSelect [data-target]'); if (t) t.style.background = 'rgba(255,208,107,.22)'; });
  await sleep(300);
  await page.mouse.down(); await sleep(60); await page.mouse.up();
  await page.evaluate(({ sel, value }) => {
    document.getElementById('__fakeSelect')?.remove();
    const s = document.querySelector(sel);
    if (s.value !== value) { s.value = value; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }
  }, { sel, value });
}
// the file chip that rides on the cursor
async function chipOn(page, name) {
  await page.evaluate((name) => {
    const chip = document.createElement('div'); chip.id = '__chip';
    chip.style.cssText = 'position:fixed;z-index:2147483645;left:0;top:0;padding:6px 12px 6px 28px;font:600 12px/1.2 ' + (getComputedStyle(document.documentElement).getPropertyValue('--font').trim() || 'sans-serif') + ';color:#1d1d1f;background:#ffd06b;border-radius:5px;box-shadow:0 4px 14px rgba(0,0,0,.45);pointer-events:none;opacity:.95;transform:translate(-300px,-300px)';
    chip.innerHTML = '<svg width="13" height="16" viewBox="0 0 13 16" style="position:absolute;left:9px;top:4px"><path d="M1 1h7l4 4v10H1z" fill="#fff" stroke="#1d1d1f" stroke-width="1.2"/></svg>' + name;
    document.body.appendChild(chip);
    window.__chipMove = (e) => { chip.style.transform = 'translate(' + (e.clientX + 14) + 'px,' + (e.clientY + 16) + 'px)'; };
    addEventListener('mousemove', window.__chipMove, true);
  }, name);
}
async function chipOff(page) { await page.evaluate(() => { removeEventListener('mousemove', window.__chipMove, true); document.getElementById('__chip')?.remove(); }); }
// a file as an in-page DataTransfer: file = a path on disk, or { expr } an in-page expression giving a File
async function fileHandle(page, file) {
  if (typeof file === 'string') {
    const name = path.basename(file), b64 = fs.readFileSync(file).toString('base64');
    const mime = /\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : /\.svg$/i.test(name) ? 'image/svg+xml' : /\.webp$/i.test(name) ? 'image/webp' : /\.wav$/i.test(name) ? 'audio/wav' : /\.csv$/i.test(name) ? 'text/csv' : /\.xml$/i.test(name) ? 'text/xml' : '';
    return page.evaluateHandle(({ name, b64, mime }) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const d = new DataTransfer(); d.items.add(new File([u], name, { type: mime })); return d; }, { name, b64, mime });
  }
  return page.evaluateHandle(async (expr) => { const f = await (0, eval)(expr); const d = new DataTransfer(); d.items.add(f); return d; }, file.expr);
}
// a file dragged in from outside the browser: the chip rides on the cursor from `from` to `to`, then the
// target gets the real dragenter / dragover / drop. target: a selector (default: whatever is under `to`).
export async function dropFile(page, file, to, { from = [24, H * 0.75], target = null, ms = 1300 } = {}) {
  const dt = await fileHandle(page, file);
  const name = await page.evaluate((d) => d.files[0].name, dt);
  await chipOn(page, name);
  await placeCursor(page, from[0], from[1]); await sleep(300);
  await glide(page, to[0], to[1], ms);
  const at = { clientX: to[0], clientY: to[1], dataTransfer: dt };
  if (target) { for (const ev of ['dragenter', 'dragover']) await page.dispatchEvent(target, ev, at); await sleep(600); await page.dispatchEvent(target, 'drop', at); }
  else await page.evaluate(async ({ x, y, d }) => { const el = document.elementFromPoint(x, y); const fire = (t) => el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: d })); fire('dragenter'); fire('dragover'); await new Promise((r) => setTimeout(r, 600)); fire('drop'); }, { x: to[0], y: to[1], d: dt });
  await chipOff(page);
}
// a button that opens the system file dialog: clicked, the dialog is answered with `file` (the dialog itself
// can't be filmed — a chip with the file's name flies to the button instead)
export async function chooseFile(page, sel, file, ms = 800) {
  const [x, y] = await center(page, sel);
  await chipOn(page, path.basename(file));
  await glide(page, x, y, ms); await sleep(150);
  const fc = page.waitForEvent('filechooser', { timeout: 8000 });
  await page.mouse.down(); await sleep(60); await page.mouse.up();
  const chooser = await fc;
  await sleep(350);
  await chooser.setFiles(file);
  await chipOff(page);
}
// the downloads a clip caused
export const downloads = (page) => page.evaluate(() => window.__dls.map((d) => ({ name: d.name, size: d.size, lines: d.text ? d.text.split(/\r?\n/).length : 0 })));
// where the download card shows (CSS px from the window edges) and how long
export const dlCardAt = (page, pos, holdMs) => page.evaluate(({ pos, holdMs }) => { window.__dlPos = pos; if (holdMs) window.__dlHold = holdMs; }, { pos, holdMs });

// ── recording
export async function startRec(page, { slowBy = 1 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => { frames.push({ t: f.metadata.timestamp, data: f.data }); try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) {} });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: OW, maxHeight: OH, everyNthFrame: 1 });
  slow = slowBy; pace = PACE * slow; moving = [];
  return { cdp, frames, t0: Date.now() / 1000 };
}
export async function stopRec(rec, name, { tail = 1.2, crf = 26 } = {}) {
  await sleep(tail * 1000); pace = 1;
  const tEnd = Date.now() / 1000;
  await rec.cdp.send('Page.stopScreencast');
  const dir = path.join(OUT, '_frames', name);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const fr = rec.frames.filter((f) => f.t >= rec.t0 - 0.05);
  if (!fr.length) throw new Error('no frames');
  let list = '';
  fr.forEach((f, i) => {
    const file = path.join(dir, String(i).padStart(5, '0') + '.jpg');
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    const next = i + 1 < fr.length ? fr[i + 1].t : tEnd;
    list += "file '" + file.replace(/\\/g, '/') + "'\nduration " + Math.max(0.001, next - f.t).toFixed(4) + '\n';
  });
  list += "file '" + path.join(dir, String(fr.length - 1).padStart(5, '0') + '.jpg').replace(/\\/g, '/') + "'\n";
  fs.writeFileSync(path.join(dir, 'list.txt'), list);
  const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error'].concat(args));
  const raw = path.join(OUT, name + '.raw.mp4'), mp4 = path.join(OUT, name + '.mp4'), webp = path.join(OUT, name + '.webp');
  ff(['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-vf', 'fps=30,scale=' + OW + ':' + OH, '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-pix_fmt', 'yuv420p', raw]);
  // the site's clip files (tools/help/optimize-clip.sh): 1920×1200 H.264, silent, faststart, CRF 26 · poster 0.5 s before the end
  ff(['-i', raw, '-vf', 'fps=30', '-an', '-c:v', 'libx264', '-crf', String(crf), '-preset', 'slow', '-movflags', '+faststart', '-pix_fmt', 'yuv420p', mp4]);
  ff(['-sseof', '-0.5', '-i', mp4, '-frames:v', '1', '-c:v', 'libwebp', '-q:v', '80', webp]);
  // a contact sheet to look at: 9 frames across the clip
  const dur = tEnd - fr[0].t;
  ff(['-i', mp4, '-vf', 'fps=' + (9 / Math.max(1, dur)).toFixed(3) + ',scale=640:-1,tile=3x3', '-frames:v', '1', path.join(OUT, 'sheet-' + name + '.png')]);
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(raw, { force: true });
  // stalls: the longest gap between frames while the cursor travelled (smooth ≈ 1/30 s; over 0.15 s shows)
  let worst = 0, stalls = 0;
  for (let i = 1; i < fr.length; i++) { const a = fr[i - 1].t, b = fr[i].t; if ((moving || []).some(([s, e]) => a >= s && b <= e)) { worst = Math.max(worst, b - a); if (b - a > 0.15) stalls++; } }
  moving = null;
  const fileDur = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', mp4]).toString().trim();
  const out = { name, frames: fr.length, dur: +fileDur.toFixed(1), kb: Math.round(fs.statSync(mp4).size / 1024), worstGapMs: Math.round(worst * 1000), stalls };
  console.log(`${name}: ${out.frames} frames, ${out.dur} s, ${out.kb} KB, worst gap ${out.worstGapMs} ms${stalls ? ', ' + stalls + ' stall(s) — re-shoot' : ''}`);
  return out;
}
export async function snap(page, name) { fs.mkdirSync(path.join(OUT, 'chk'), { recursive: true }); await page.screenshot({ path: path.join(OUT, 'chk', name + '.png') }); }
