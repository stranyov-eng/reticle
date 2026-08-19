/*
  Shared day/night toggle for all stranyov.pro tools.
  One localStorage key across the whole site — switching theme in one tool
  keeps it when you navigate to another via the Tools dropdown.

  Markup expected somewhere on the page:
    <div class="theme-toggle">
      <span id="themeLabel">Day</span>
      <div class="theme-switch" id="themeSwitch"></div>
    </div>

  This script is intentionally NOT deferred/async: placed in <head>, it runs
  before the body paints, so it sets data-theme immediately (no flash of the
  wrong theme). The click handler is wired after DOMContentLoaded once the
  switch element exists.
*/
(function () {
  var STORAGE_KEY = 'stranyov-theme';
  var root = document.documentElement;

  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    var lbl = document.getElementById('themeLabel');
    if (lbl) lbl.textContent = t === 'night' ? 'Night' : 'Day';
    // keep the mobile browser UI (address bar) matching the theme
    var tc = document.querySelector('meta[name="theme-color"]');
    if (tc) {
      var paper = getComputedStyle(root).getPropertyValue('--paper').trim();
      if (paper) tc.setAttribute('content', paper);
    }
    try { localStorage.setItem(STORAGE_KEY, t); } catch (e) {}
  }

  var forced = new URLSearchParams(location.search).get('theme');
  var stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  // Only 'day'/'night' are valid CSS keys — a stray ?theme=dark or a corrupted stored value would
  // set data-theme to something no rule matches (unthemed page), so anything else falls back to night.
  applyTheme((forced || stored) === 'day' ? 'day' : 'night');

  document.addEventListener('DOMContentLoaded', function () {
    var sw = document.getElementById('themeSwitch');
    if (!sw) return;
    // a11y: the switch is a bare <div>; make it a real keyboard-operable control so
    // screen-reader + keyboard users can toggle the theme and hear its state.
    if (!sw.hasAttribute('role')) sw.setAttribute('role', 'switch');
    if (!sw.hasAttribute('tabindex')) sw.setAttribute('tabindex', '0');
    if (!sw.hasAttribute('aria-label')) sw.setAttribute('aria-label', 'Toggle day / night theme');
    function syncAria() { sw.setAttribute('aria-checked', root.getAttribute('data-theme') === 'day' ? 'true' : 'false'); }
    function toggle() {
      applyTheme(root.getAttribute('data-theme') === 'night' ? 'day' : 'night');
      syncAria();
    }
    sw.addEventListener('click', toggle);
    sw.addEventListener('keydown', function (e) {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Spacebar') { e.preventDefault(); toggle(); }
    });
    syncAria();
    // re-apply now that #themeLabel exists, in case it wasn't there at parse time
    applyTheme(root.getAttribute('data-theme'));
  });
})();

/*
  Force TEXT presentation for the few UI icon glyphs that some platforms
  (notably iOS Safari) otherwise draw as full-colour emoji — which looks broken
  next to the rest of the monochrome UI. We append a VS15 text-presentation
  selector (U+FE0E) after each affected codepoint. The set is deliberately narrow:
  only the icon symbols we actually use that have an emoji presentation —
  ↖↗↘↙ (U+2196–2199), ▶ (U+25B6), ✏ (U+270F), ⚠ (U+26A0). Text-default glyphs
  (arrows ←↑→↓, ✕, box-drawing, geometric shapes) are left untouched.
  Idempotent (skips glyphs already followed by a variation selector) and re-runs
  on dynamically inserted nodes so JS-rendered icons are covered too.
*/
(function () {
  var RE = /([↖-↙▶✏⚠])(?![\uFE0E\uFE0F])/g;
  // progressive enhancement for engines that support it (Chrome/Firefox); older
  // Safari ignores it, which is why the U+FE0E pass below is the real fix.
  try { document.documentElement.style.setProperty('font-variant-emoji', 'text'); } catch (e) {}

  function fixNode(t) {
    var v = t.nodeValue;
    if (!v) return;
    var nv = v.replace(RE, "$1\uFE0E");
    if (nv !== v) t.nodeValue = nv;
  }
  function fixTree(root) {
    if (!root) return;
    if (root.nodeType === 3) { fixNode(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    // Cheap early-out: the observer fires on every list re-render (detector/planner/uv rebuild rows via
    // innerHTML), almost none of which contain a target glyph. One regex scan of the subtree text skips
    // the full TreeWalker walk in that common case.
    var tc = root.textContent;
    if (!tc || tc.search(RE) === -1) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n, list = [];
    while ((n = w.nextNode())) list.push(n);
    list.forEach(fixNode);
  }
  function start() {
    fixTree(document.body);
    try {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) fixTree(added[j]);
        }
      }).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
