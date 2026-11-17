# Guide clips

Every card in the F1 guide can carry a short silent looping clip —
`src/help/<clip>.mp4` (1920×1200 H.264) with its `.webp` poster, named in the
card: `clip: 'help/net-run.mp4', dur: '0:12'`. They are **recorded by script,
not by hand**, so a clip can be re-shot the moment the interface changes. Same
method, and the same recorder, as the stranyov.pro tools.

## How it films a desktop app

Reticle's interface is ordinary HTML that reaches Rust only through
`window.__TAURI__`. `fixture.js` puts a scripted stand-in there before any page
script runs, so the recorder films the real interface while the data is fixed
and repeatable. A live network could not give the same numbers twice running,
and a guide whose figures change between takes teaches nothing.

The figures in the fixture are a real run, kept because it is the case the
Network tab exists for: four servers reading at a twentieth of the others while
every write is normal.

## Setup (once per machine)

- **Playwright + Chromium** — not a dependency of this app. `rec.mjs` takes it
  from `$PLAYWRIGHT_DIR`, this repo's `node_modules`, or the Projection Calc
  checkout that has it. Then `npx playwright install chromium` once.
- **ffmpeg and ffprobe** on PATH (`winget install Gyan.FFmpeg`).

## Record

```bash
node scripts/guide-clips/run.mjs net-run            # one clip
node scripts/guide-clips/run.mjs net                # every clip of a section
node scripts/guide-clips/run.mjs                    # all of them
node scripts/guide-clips/run.mjs net-run --check    # set-up only: a still in out/chk
```

Output lands in `out/` (git-ignored): `<clip>.mp4` and `.webp`,
`sheet-<clip>.png` — nine frames across the clip, **look at it** — plus
`chk/<clip>-0.png` and `-1.png` for the first and last state, and
`results.json` with the length, size and the worst gap between frames. A gap
over 150 ms is reported as a stall: re-shoot when the machine is quiet, and run
one recorder at a time.

## Install

```bash
node scripts/guide-clips/install.mjs net-run        # or --all
```

Copies the `.mp4` and `.webp` into `src/help/` and writes each clip's real
length into its card's `dur` in `src/_guide.js`. A card is wired to its clip by
hand, once, where its wording lives; after that the duration keeps itself
honest.

## Adding a clip

1. Add a scenario to the section module (`net.mjs`, or a new one listed in
   `run.mjs`). The function sets the scene up — that part is **not** filmed —
   and returns the action, which is. So a clip opens on a tidy interface and
   shows only the thing it is about.
2. `--check` until the still looks right.
3. Record, look at the contact sheet, then install.
4. Name the clip in its card in `src/_guide.js`.

A card without a clip renders as text and reads perfectly well, so nothing in
the guide ever waits on a recording.
