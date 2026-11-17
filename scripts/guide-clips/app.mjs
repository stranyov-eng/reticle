/*
  Clip scenarios for the listening side: sources, the address table, DMX and
  the HTTP client.

  Each entry sets the scene up — not filmed — and returns the action, which is.
  So a clip opens on an interface that is already doing its job and shows only
  the thing the card is about.
*/
import { clickEl, hoverEl, typeInto, setSel, sleep, hold, glide, W } from './rec.mjs';

/** Switch tab by its label, the way a person would. */
async function tab(page, label) {
  await page.evaluate((l) => {
    const t = [...document.querySelectorAll('.tab')].find((x) => x.textContent.trim().toLowerCase() === l);
    if (t) t.click();
  }, label.toLowerCase());
  await hold(300);
}

/** A source already listening, for clips that are not about starting one. */
async function listening(page, kind, port, universes) {
  await page.evaluate(async ({ kind, port, universes }) => {
    const info = await window.__TAURI__.core.invoke('add_source', {
      cfg: { kind, bind: '192.168.2.2', port, multicast: null, universes: universes || null, label: null },
    });
    // The strip is painted from the event, exactly as it is in the app.
    window.dispatchEvent(new Event('resize'));
    return info;
  }, { kind, port, universes });
  await hold(1200);
}

export default {
  file: 'index.html',

  // The DMX grid is 512 cells of standing digits — roughly fifteen hundred
  // small glyphs in every frame, which costs five times what the other clips
  // do at the same quality, and costs it whether anything moves or not. A
  // looser quantiser brings it back in line; the grid reads by its fill, and
  // the numbers stay legible enlarged.
  crf: { 'dmx-grid': 32 },

  clips: {

    // Opening the strip, choosing a protocol and an adapter, and listening.
    'src-add': async (page) => {
      await tab(page, 'addresses');
      return async () => {
        await clickEl(page, '#addSrcBtn', 700);
        await hold(400);
        await setSel(page, '#fKind', 'osc-udp', 700);
        await sleep(300);
        await typeInto(page, '#fPort', '9000', 500);
        await sleep(300);
        // The adapter, not 0.0.0.0 — the point the card makes.
        await clickEl(page, '#fBind + .combo-btn', 700);
        await hold(500);
        await sleep(900);
        await page.evaluate(() => {
          const item = [...document.querySelectorAll('.combo-item')].find((x) => /192\.168/.test(x.textContent));
          if (item) item.click();
        });
        await hold(400);
        await sleep(500);
        await clickEl(page, '#srcForm button[type="submit"]', 700);
        await hold(2200);
        await sleep(800);
      };
    },

    // The table doing its work: rows, per-slot statistics, values moving.
    'addr-table': async (page) => {
      await tab(page, 'addresses');
      await listening(page, 'osc-udp', 9000);
      return async () => {
        await glide(page, W * 0.35, 330, 900);
        await hold(2500);
        await hoverEl(page, '.addr-table tbody tr:nth-child(3)', 700);
        await hold(1500);
        await sleep(600);
      };
    },

    // Clicking a row to open the detail panel with a graph per argument slot.
    'addr-detail': async (page) => {
      await tab(page, 'addresses');
      await listening(page, 'osc-udp', 9000);
      await hold(1500);
      return async () => {
        await clickEl(page, '.addr-table tbody tr:nth-child(1)', 800);
        await hold(3000);
        await sleep(1200);
      };
    },

    // The universe strip and the channel grid, read as light not numbers.
    'dmx-grid': async (page) => {
      await tab(page, 'dmx');
      await listening(page, 'sacn', 5568, '1-4');
      return async () => {
        await glide(page, W * 0.4, 300, 900);
        await hold(2500);
        await page.evaluate(() => {
          const chip = document.querySelectorAll('.uni-chip')[1];
          if (chip) chip.click();
        });
        await hold(2500);
        await sleep(900);
      };
    },

    // A request, its response, and saving the result.
    'http-send': async (page) => {
      await tab(page, 'http');
      return async () => {
        await setSel(page, '#hMethod', 'GET', 600);
        await sleep(200);
        await typeInto(page, '#hUrl', '127.0.0.1:8080/api/transport', 800, { enter: false });
        await sleep(400);
        await clickEl(page, '#hSend', 700);
        await hold(1400);
        await sleep(1600);
      };
    },
  },
};
