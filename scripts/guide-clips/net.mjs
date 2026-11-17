/*
  Clip scenarios for the Network section.

  Each entry sets the scene up — not filmed — and returns the action, which is.
  So a clip opens on a tidy interface and shows only the thing it is about,
  rather than the operator getting there.
*/
import { clickEl, hoverEl, typeInto, setSel, sleep, hold, glide, W } from './rec.mjs';

/** Open the Network tab and give the page a moment to settle. */
async function netTab(page) {
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('.tab')].find((t) => /network/i.test(t.textContent));
    if (tab) tab.click();
  });
  await hold(300);
}

/** Wait for the run to actually finish — the findings appear when it has. */
async function waitForFindings(page) {
  await page.waitForFunction(
    () => { const f = document.getElementById('netFindings'); return f && !f.hidden; },
    { timeout: 90000 },
  );
  await page.evaluate(() => document.getElementById('netFindings').scrollIntoView({ block: 'center' }));
}

/** Targets already in the table, for clips that are not about adding them. */
async function seedTargets(page, from = 11, to = 15) {
  await page.evaluate(({ from, to }) => {
    document.getElementById('netFrom').value = `192.168.2.${from}`;
    document.getElementById('netTo').value = `192.168.2.${to}`;
    document.getElementById('netSharePath').value = 'd3 Projects\\Demo_Show_v01\\objects';
    document.getElementById('netAddRange').click();
    document.getElementById('netFrom').value = '';
    document.getElementById('netTo').value = '';
    document.getElementById('netSharePath').value = '';
  }, { from, to });
  await hold(400);
}

export default {
  file: 'index.html',
  clips: {

    // Nine servers from two fields and a share path.
    'net-range': async (page) => {
      await netTab(page);
      return async () => {
        await typeInto(page, '#netFrom', '192.168.2.11', 600, { enter: false });
        await sleep(200);
        await typeInto(page, '#netTo', '192.168.2.19', 600, { enter: false });
        await sleep(200);
        await typeInto(page, '#netSharePath', 'd3 Projects\\Demo_Show_v01\\objects', 700, { enter: false });
        await sleep(400);
        await clickEl(page, '#netAddRange', 700);
        await hold(900);
        await sleep(700);
      };
    },

    // The modes, and the warning that the buffered round trip can measure RAM.
    'net-mode': async (page) => {
      await netTab(page);
      await seedTargets(page);
      return async () => {
        await hoverEl(page, '#netMode', 700);
        await sleep(300);
        await setSel(page, '#netMode', 'read', 800);
        await sleep(700);
        await setSel(page, '#netMode', 'roundtrip', 800);
        await sleep(900);
        // Turning the bypass off here is the trap — the warning turns red.
        await clickEl(page, '#netBypass', 700);
        await hold(400);
        await sleep(1400);
        await clickEl(page, '#netBypass', 600);
        await sleep(700);
      };
    },

    // The run itself: progress, rows filling in, and the findings that follow.
    'net-run': async (page) => {
      await netTab(page);
      await seedTargets(page, 11, 16);
      return async () => {
        await clickEl(page, '#netRun', 700);
        // The cursor steps out of the way, then the clip waits on the run
        // actually finishing rather than on a guessed number of seconds — a
        // fixed wait is either padding at the end or a cut-off run.
        await glide(page, W * 0.72, 250, 900);
        await waitForFindings(page);
        await hold(900);
        await sleep(900);
      };
    },

    // Several sweeps, and the column that shows a figure moving between them.
    'net-passes': async (page) => {
      await netTab(page);
      await seedTargets(page, 11, 13);
      return async () => {
        await hoverEl(page, '#netPasses', 700);
        await sleep(300);
        await setSel(page, '#netPasses', '3', 800);
        await sleep(600);
        await clickEl(page, '#netRun', 700);
        await glide(page, W * 0.72, 250, 900);
        await waitForFindings(page);
        await sleep(900);
      };
    },
  },
};
