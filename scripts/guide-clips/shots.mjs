// node shots.mjs [<tab> …]
//   tab = addresses | dmx | log | http | network | guide   (default: all)
//
// A still of each tab at 1920×1200, into out/chk/tab-<name>.png. Uses the
// clip recorder's own browser and fixture, so the app is filmed with live
// traffic and the shots are reproducible — and headless, which means they do
// not depend on any window being visible.
import { open, closeAll, snap } from './rec.mjs';

const TABS = ['addresses', 'dmx', 'log', 'http', 'network', 'guide'];
const args = process.argv.slice(2);
const want = args.filter((a) => !a.startsWith('--'));
const list = want.length ? want : TABS;
// --day films the light theme; the shots are named apart so both survive.
const theme = args.includes('--day') ? 'day' : null;
const suffix = theme ? '-day' : '';

const { browser, page } = await open('index.html', theme ? { theme } : {});

// Both protocols listening, so every tab has something to show.
await page.evaluate(async () => {
  const add = (cfg) => window.__TAURI__.core.invoke('add_source', { cfg });
  await add({ kind: 'osc-udp', bind: '192.168.2.2', port: 9000, multicast: null, universes: null, label: null });
  await add({ kind: 'sacn', bind: '192.168.2.2', port: 5568, multicast: null, universes: '1-4', label: null });
});
await page.waitForTimeout(2500);

for (const name of list) {
  if (name === 'guide') {
    await page.evaluate(() => document.getElementById('guideBtn').click());
    await page.waitForTimeout(1200);
  } else {
    await page.evaluate(() => { const o = document.getElementById('guideOverlay'); if (o) o.classList.remove('open'); });
    await page.evaluate((n) => {
      const t = [...document.querySelectorAll('.tab')].find((x) => x.textContent.trim().toLowerCase() === n);
      if (t) t.click();
    }, name);
    await page.waitForTimeout(900);

    // The network tab is empty until it has targets; a design review of an
    // empty table shows nothing worth reviewing.
    if (name === 'network') {
      await page.evaluate(() => {
        document.getElementById('netFrom').value = '192.168.2.11';
        document.getElementById('netTo').value = '192.168.2.16';
        document.getElementById('netSharePath').value = 'd3 Projects\\Demo_Show_v01\\objects';
        document.getElementById('netAddRange').click();
        document.getElementById('netRun').click();
      });
      await page.waitForTimeout(9000);
    }
  }

  await snap(page, 'tab-' + name + suffix);
  console.log('tab-' + name + suffix + '.png');
}

await browser.close();
await closeAll();
