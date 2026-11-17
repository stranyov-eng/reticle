// Copyright (c) 2026 Iurii Stranev (Yuri Stranyov) · stranyov.pro. All rights reserved. Terms: https://stranyov.pro/tools/terms
(window.STRANYOV_MODULES = window.STRANYOV_MODULES || {})["_help.js"] = "sv:9d1f5b30"; // module signature — reported with feedback
/*
  Shared help / knowledge-base renderer for the stranyov.pro tools.
  ----------------------------------------------------------------------------
  ONE renderer for both places the help is shown, so they can never drift:
    - every tool's About panel (#aboutModal → #kbNav + #kbContent), fed by the tool's own
      `const HELP = { sections: [...] }` manifest (the single source of the help text);
    - the standalone User Guide (tools/guide.html), which build-guide.js bakes from those
      same six HELP manifests and renders per tab with this file at runtime.
  Styles live in _help.css (also shared by every tool + the guide).

    StranyovHelp.render(HELP, { nav: 'kbNav', content: 'kbContent' })   // ids or elements (these are the defaults)

  HELP shape:
    { sections: [
        { label, features: [ { title, blurb, clip?, dur?, key?, hero? }, ... ] },   // feature cards
        { label, type: 'ref', rows: [ { k, v }, ... ] }                              // key → value table
    ] }
  - a feature WITH `clip` ('help/xxx.mp4'; the .webp poster derived by swapping the
    extension) is a video card: hover plays it from 0, leaving holds the last frame, click
    opens it large in the lightbox (#kbLightbox — created on demand if the page has none);
  - features WITHOUT `clip` are headline rows across the full width (a title, its text beside it) — a
    run of them between the video grids, in the manifest's order (no empty video box / play button);
  - `hero: true` puts that feature full-width above the section's cards;
  - `type: 'ref'` sections render as a two-column table and get one nav link each.
  Text is trusted, hand-written markup from the manifests (inserted as HTML).

  Shared sections: what works the same in every tool (save / open, the reserved keys, folding,
  the bottom block) and in every canvas tool (selection, Delete, undo, nudge, zoom, the tool strip)
  is written once, here, in StranyovHelp.COMMON. A tool lists the ones that apply in its HELP —
  `common: ['every', 'canvas']` — and render() appends them after the tool's own sections, so its
  own Keyboard table holds only what is particular to it. The guide shows them once, on its
  Shortcuts tab (render with { common: false } on the tool tabs).

  render() can be called again on the same nav/content (the guide does, per tab): the
  content is replaced, and the nav / lightbox / Esc listeners are only ever bound once.
*/
(function (g) {
  'use strict';

  var wired = typeof WeakSet === 'function' ? new WeakSet() : null;
  function once(el) { // true the first time a given element is seen
    if (!el) return false;
    if (wired) { if (wired.has(el)) return false; wired.add(el); return true; }
    if (el.__kbWired) return false; el.__kbWired = true; return true;
  }
  function $el(x) { return typeof x === 'string' ? document.getElementById(x) : x; }

  var COMMON = {
    every: { label: 'Every tool', type: 'ref', rows: [
      { k: 'Ctrl+S', v: 'Save the project (.stv) — the first time asks where, then saves into the same file. After renaming the project it asks first: a new file, or overwrite (browsers that can\'t write files download a copy).' },
      { k: 'Ctrl+Shift+S', v: 'Save as — the project to a new .stv file.' },
      { k: 'Ctrl+O', v: 'Open a .stv project. Each tool also opens its own older .json files.' },
      { k: 'Ctrl+R / Ctrl+D', v: 'Never reload the page or open a bookmark dialog, even while typing — where there is a selection, Ctrl+R renames it and Ctrl+D duplicates it.' },
      { k: 'F1', v: 'Open this help.' },
      { k: 'Esc', v: 'Close the open window, menu or dialog first.' },
      { k: 'Hover ~0.5 s', v: 'A tooltip says what any button, field or label does.' },
      { k: 'Fold sections', v: 'Click a section heading to fold or unfold it — folded, it shows a short summary of its settings. Remembered in this browser.' },
      { k: 'Fold side panels', v: 'The tab on the inner edge of a side panel folds it to a narrow rail for more room; click it again to bring the panel back. On a narrow screen the panels stack around the work area instead.' },
      { k: 'Bottom of a panel', v: 'The same order in every tool: Download → the other exports → Save / Open project → Defaults or Clear all → Send to Slice Planner (the wide button, where the tool has one).' }
    ]},
    canvas: { label: 'Canvas tools', type: 'ref', rows: [
      { k: 'Click · Ctrl · Shift', v: 'Click selects; Ctrl/⌘-click adds or removes one; Shift-click takes the range from the last one — on the canvas and in its list alike. A click on a canvas scrolls its row into view in the list.' },
      { k: 'Drag empty canvas', v: 'Marquee: box-select everything it touches.' },
      { k: 'Ctrl+A', v: 'Select everything on the active work area (each tool says what that is).' },
      { k: 'Esc', v: 'Leave Draw; otherwise clear the selection.' },
      { k: 'Delete / Backspace', v: 'Remove the selection — straight after any click, a ticked checkbox or a pressed button doesn\'t hold on to the key.' },
      { k: 'Row buttons', v: '✕, M (mute) and the padlock on a selected row act on the whole selection, not only that row.' },
      { k: 'Edit several', v: 'With several selected, a field you type in the inspector goes to all of them.' },
      { k: 'Ctrl+Z / Ctrl+Shift+Z', v: 'Undo / redo the last ~100 changes in this tab (Ctrl+Y redoes too) — same as the arrows at the left of the tool strip.' },
      { k: 'Ctrl+D', v: 'Duplicate the selection in place, offset down-right.' },
      { k: 'Arrow keys', v: 'Nudge the selection 1 px — hold Shift for 10 px.' },
      { k: '[ / ]', v: 'Move the selection to the previous / next item.' },
      { k: 'V / R', v: 'Select / Draw, where the tool draws — Draw stays on for the next one until V, Esc or Select. Works on any keyboard layout.' },
      { k: 'Alt (dragging)', v: 'Flip Snap for that one drag.' },
      { k: 'Scroll wheel', v: 'Zoom under the cursor; the % in the tool strip follows the active canvas.' },
      { k: 'Middle-drag', v: 'Pan the canvas.' },
      { k: 'Double-click', v: 'On empty canvas: fit it back in the window — same as View → Fit.' },
      { k: 'Math in fields', v: 'Type 1920+200 or 3840/2 in any number field and press Enter.' },
      { k: 'Wheel over a field', v: 'Over a focused number field: ±1 per notch, Shift for ±10.' },
      { k: 'Tool strip', v: 'Over the canvas, left to right: Undo / Redo · View (Fit, 1:1, − % +) · Select / Draw · Snap · Align / Distribute · Repeat · Match · Arrange, and the selection readout (how many, and their size) at the right end.' }
    ]}
  };
  // the shared sections a HELP asks for, after its own
  function withCommon(help) {
    var keys = (help && help.common) || [];
    if (!keys.length) return help;
    return { sections: (help.sections || []).concat(keys.map(function (k) { return COMMON[k]; }).filter(Boolean)) };
  }

  // Clip versions — written by scripts/guide-clips/install.mjs: a hash of each clip's .mp4 + .webp. tools/help is
  // served immutable (a year), so a re-shot clip needs a new URL, or every browser that saw it keeps the old one.
  var CLIP_V = /*clip-v*/{"det-color":"710575d2","det-d3":"0a3b4d57","det-distinctive":"be2243a6","det-draw":"afff15cd","det-panzoom":"6d0c4aee","det-region":"e200e98c","det-resolume":"b4855477","det-tolerance":"35b81916","gen-adjust":"bbdce284","gen-background":"d18f7472","gen-blend":"37f3901b","gen-canvas":"87eefd00","gen-colors":"1207a1aa","gen-d3":"29619d2b","gen-dome":"f7ff1853","gen-edit":"773003e9","gen-elements":"62b8fea1","gen-export":"4e670e30","gen-led":"d5853d72","gen-logo":"862e38ec","gen-mask":"7ccb5969","gen-meter":"99dc1a03","gen-png":"7b016220","gen-proj-resolume":"8f5eaa71","gen-projection":"05451e64","gen-repeat":"1ff502d9","gen-resolume":"386c3503","gen-resolution":"48eb6ecc","gen-snap":"0f22c1a3","ltc-decode":"c2687379","ltc-jam":"67037b72","ltc-live":"0e4b1fb2","ltc-scrub":"415da8fb","ltc-start":"86d2cbfe","ltc-wav":"4ad4ddf3","pln-assign":"298adc82","pln-duplicate":"ce144a4e","pln-fromgen":"b3355b9b","pln-import":"bdbfb9fc","pln-layout":"83923d62","pln-position":"77efbf90","pln-screens":"faf0523b","spec-edit":"fbf94732","spec-export":"f60e8fcb","spec-logo":"259e3ca8","spec-names":"7c66fe11","spec-screens":"df1c7c96","spec-stage":"7993088f","tools-reel":"f9338530","uv-assign":"320e8631","uv-export":"fba7e06f","uv-fill":"f0dfa688","uv-guide":"73da1db5","uv-import":"13fbfd4d","uv-link":"cab55b2f","uv-overview":"a252338a","uv-regions":"286bf910"}/*/clip-v*/;
  function clipUrl(mp4, ext) {
    var v = CLIP_V[mp4.replace(/^.*\//, '').replace(/\.mp4$/, '')], u = ext ? mp4.replace(/\.mp4$/, ext) : mp4;
    return v ? u + '?v=' + v : u;
  }
  function clipHtml(f) {
    var mp4 = clipUrl(f.clip), poster = clipUrl(f.clip, '.webp');
    return '<div class="kb-clip" data-has-clip="1">' +
      '<video class="kb-vid" muted loop playsinline preload="none" poster="' + poster + '"><source src="' + mp4 + '" type="video/mp4"></video>' +
      '<div class="play"><span>▶</span></div><div class="dur">' + (f.dur || '0:05') + '</div></div>';
  }
  function metaHtml(f) {
    return '<div class="kb-meta"><h3>' + f.title + (f.key ? ' <span class="kb-key">' + f.key + '</span>' : '') + '</h3><p>' + f.blurb + '</p></div>';
  }

  // HELP → { nav, content } HTML strings (pure — no DOM).
  function markup(help) {
    var navH = '', contentH = '';
    ((help && help.sections) || []).forEach(function (sec, si) {
      var sid = 'kbsec' + si;
      contentH += '<h2 class="kb-sec-title" id="' + sid + '">' + sec.label + '</h2>';
      if (sec.type === 'ref') {
        navH += '<a class="reflink" data-t="' + sid + '">' + sec.label + '</a>';
        contentH += '<div class="kb-ref">' + (sec.rows || []).map(function (r) {
          return '<div class="kb-ref-row"><span class="kb-k">' + r.k + '</span><span class="kb-v">' + r.v + '</span></div>';
        }).join('') + '</div>';
      } else {
        var feats = sec.features || [];
        navH += '<div class="grp">' + sec.label + '</div>';
        feats.forEach(function (f) { navH += '<a data-t="' + sid + '">' + f.title + '</a>'; });
        var hero = null, rest = [];
        feats.forEach(function (f) { if (f.hero && !hero) hero = f; else rest.push(f); });
        if (hero) contentH += hero.clip ? '<div class="kb-hero">' + clipHtml(hero) + metaHtml(hero) + '</div>'
                                        : '<div class="kb-hero kb-text">' + metaHtml(hero) + '</div>';
        // in the manifest's order: a run of clip cards is a grid of video cards; a run of text-only ones is a
        // list of headline rows across the full width (a text card in a video grid sat in a half-empty box)
        var runs = [];
        rest.forEach(function (f) { var k = f.clip ? 'v' : 't', last = runs[runs.length - 1]; if (last && last.k === k) last.items.push(f); else runs.push({ k: k, items: [f] }); });
        runs.forEach(function (r) {
          contentH += r.k === 'v'
            ? '<div class="kb-cards">' + r.items.map(function (f) { return '<div class="kb-feat">' + clipHtml(f) + metaHtml(f) + '</div>'; }).join('') + '</div>'
            : '<div class="kb-rows">' + r.items.map(function (f) { return '<div class="kb-row">' + metaHtml(f) + '</div>'; }).join('') + '</div>';
        });
      }
    });
    return { nav: navH, content: contentH };
  }

  // ── lightbox (click a clip → enlarge + play) ──
  var lb = null, lbv = null;
  function closeLb() { if (!lb) return; lb.classList.remove('open'); lbv.pause(); }
  function ensureLb() {
    lb = document.getElementById('kbLightbox');
    if (!lb) {
      lb = document.createElement('div');
      lb.className = 'kb-lightbox'; lb.id = 'kbLightbox';
      lb.innerHTML = '<button class="lb-close" id="lbClose">✕</button><video id="lbVideo" controls loop muted playsinline></video>';
      document.body.appendChild(lb);
    }
    lbv = lb.querySelector('video');
    if (once(lb)) {
      lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
      var x = lb.querySelector('.lb-close'); if (x) x.addEventListener('click', closeLb);
    }
    if (once(document)) {
      // capture phase + stop: Esc closes the lightbox only, not the About modal underneath it
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && lb && lb.classList.contains('open')) { closeLb(); e.stopImmediatePropagation(); }
      }, true);
    }
  }
  function openLb(mp4) {
    ensureLb();
    lbv.innerHTML = '<source src="' + mp4 + '" type="video/mp4">';
    lbv.load(); lb.classList.add('open'); lbv.currentTime = 0;
    var p = lbv.play(); if (p) p.catch(function () {});
  }

  function render(help, opts) {
    opts = opts || {};
    var nav = $el(opts.nav || 'kbNav'), content = $el(opts.content || 'kbContent');
    if (!nav || !content || !help) return;
    var m = markup(opts.common === false ? help : withCommon(help));
    nav.innerHTML = m.nav;
    content.innerHTML = m.content;
    var firstA = nav.querySelector('a'); if (firstA) firstA.classList.add('active');

    // nav: active state + smooth scroll to the section (delegated — bound once per nav element)
    if (once(nav)) nav.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[data-t]') : null;
      if (!a || !nav.contains(a)) return;
      nav.querySelectorAll('a').forEach(function (x) { x.classList.remove('active'); });
      a.classList.add('active');
      var el = document.getElementById(a.dataset.t);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // clips: hover → play from 0; leave → hold on the last frame (the result); click → lightbox
    var clips = content.querySelectorAll('.kb-clip[data-has-clip]');
    if (clips.length) ensureLb();
    clips.forEach(function (c) {
      var v = c.querySelector('video'); if (!v) return;
      var s = v.querySelector('source'), src = s ? s.getAttribute('src') : '';
      c.addEventListener('mouseenter', function () { try { v.currentTime = 0; var p = v.play(); if (p) p.catch(function () {}); } catch (e) {} });
      c.addEventListener('mouseleave', function () { v.pause(); try { var d = v.duration; v.currentTime = (d && isFinite(d)) ? Math.max(0, d - 0.05) : 0; } catch (e) {} });
      c.addEventListener('click', function () { openLb(src); });
      v.addEventListener('playing', function () { c.classList.add('playing'); });
      v.addEventListener('pause', function () { c.classList.remove('playing'); });
    });
  }

  g.StranyovHelp = { render: render, markup: markup, COMMON: COMMON };
})(window);
