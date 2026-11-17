// node install.mjs <clip> … | --all
//
// Copies the recorded .mp4 + .webp from out/ into src/help/, then writes each
// clip's real length into its card in src/_guide.js. The length is written
// rather than typed because a hand-kept duration drifts from the file the
// moment a clip is re-shot, and a wrong one is worse than none: it is the
// label people read before deciding whether to watch.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(HERE, 'out');
const HELP_DIR = path.join(ROOT, 'src', 'help');
const GUIDE = path.join(ROOT, 'src', '_guide.js');

const args = process.argv.slice(2);
const results = JSON.parse(fs.readFileSync(path.join(OUT, 'results.json'), 'utf8'));
const want = args.includes('--all') ? Object.keys(results) : args.filter((a) => !a.startsWith('--'));

if (!want.length) {
  console.log('usage: node install.mjs <clip> … | --all');
  process.exit(2);
}

fs.mkdirSync(HELP_DIR, { recursive: true });
let guide = fs.readFileSync(GUIDE, 'utf8');
let wrote = 0;

for (const name of want) {
  const mp4 = path.join(OUT, name + '.mp4');
  const webp = path.join(OUT, name + '.webp');
  if (!fs.existsSync(mp4)) { console.log(name + ': no recording in out/ — record it first'); continue; }

  fs.copyFileSync(mp4, path.join(HELP_DIR, name + '.mp4'));
  if (fs.existsSync(webp)) fs.copyFileSync(webp, path.join(HELP_DIR, name + '.webp'));

  const secs = Math.round((results[name] && results[name].dur) || 0);
  const dur = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');

  // Only the dur of a card that already names this clip is touched — the clip
  // itself is wired to its card by hand, once, where the wording lives.
  const re = new RegExp("(clip: 'help/" + name + "\\.mp4', dur: ')[^']*(')", 'g');
  if (re.test(guide)) {
    guide = guide.replace(re, '$1' + dur + '$2');
    wrote++;
    console.log(name + ': installed, ' + dur);
  } else {
    console.log(name + ": installed — but no card references help/" + name + ".mp4 yet");
  }
}

if (wrote) fs.writeFileSync(GUIDE, guide);
console.log(wrote + ' duration(s) written into src/_guide.js');
