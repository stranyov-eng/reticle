// node run.mjs [<section>|<clip>] … [--check]
//   section = net           (every clip of that section)
//   clip    = e.g. net-run
//   --check = set the scene up only, write a still to out/chk, record nothing
//
// A section module (./<section>.mjs) exports default { clips: { name: async (page) => act } }:
// the clip function builds the scene (not filmed) and returns the action (filmed).
import fs from 'node:fs';
import path from 'node:path';
import { open, closeAll, startRec, stopRec, snap, OUT } from './rec.mjs';

const SECTIONS = ['net'];
const args = process.argv.slice(2);
const check = args.includes('--check');
const want = args.filter((a) => !a.startsWith('--'));

const mods = {};
for (const s of SECTIONS) {
  const m = (await import(`./${s}.mjs`)).default;
  mods[s] = { file: m.file, clips: m.clips, slow: m.slow || {} };
}

const jobs = [];
for (const w of (want.length ? want : Object.keys(mods))) {
  if (mods[w]) { Object.keys(mods[w].clips).forEach((n) => jobs.push([w, n])); continue; }
  const s = w.split('-')[0];
  if (!mods[s] || !mods[s].clips[w]) { console.log('unknown clip ' + w); continue; }
  jobs.push([s, w]);
}

if (!jobs.length) { console.log('nothing to do'); await closeAll(); process.exit(0); }

const resFile = path.join(OUT, 'results.json');
const results = fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')) : {};

for (const [s, name] of jobs) {
  const m = mods[s];
  const { browser, page } = await open(m.file);
  try {
    const act = await m.clips[name](page);
    await snap(page, name + '-0');
    if (check) {
      console.log(name + ': set-up ok');
    } else {
      const rec = await startRec(page, { slowBy: m.slow[name] || 1 });
      await act();
      results[name] = await stopRec(rec, name);
      await snap(page, name + '-1');
      fs.writeFileSync(resFile, JSON.stringify(results, null, 1));
    }
  } catch (e) {
    console.log(name + ' FAILED: ' + (e.stack || e).toString().split('\n').slice(0, 4).join(' | '));
  }
  await browser.close();
}

await closeAll();
