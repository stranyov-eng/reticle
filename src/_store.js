/*
  Settings that outlive the webview.

  Presets, targets, test options, the theme and the font size are all kept in
  `localStorage` — which is quick, synchronous and exactly what the interface
  wants to read at startup. It is also a folder inside WebView2's browser
  profile, and that is a cache directory by nature: an uninstall that ticks
  "delete application data" takes it, a cleanup tool takes it, no backup ever
  sees it, it cannot be carried to another machine, and it is keyed by origin —
  so a build running from the dev server keeps a second, invisible set of the
  same presets. A venue's nine paths are worth more than that.

  So the file this app owns is the record, and localStorage is the cache in
  front of it. Every write to a key of ours goes to both. At startup the file
  is read first and the cache is filled from it, before any page script runs —
  which is why app.js is loaded from here rather than from a tag in the page.
*/
(function () {
  'use strict';

  // Ours: the app's own keys and the shared theme key. Anything else in the
  // profile belongs to someone else and is left alone.
  var MINE = /^(reticle|stranyov)-/;

  // Loaded once the record has been read, in this order.
  var SCRIPTS = ['app.js', '_help.js', '_guide.js'];

  var invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;

  // Bound before the patch below, so the restore does not re-save what it has
  // just read back from the file.
  var rawSet = localStorage.setItem.bind(localStorage);

  function snapshot() {
    var out = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (MINE.test(k)) out[k] = localStorage.getItem(k);
    }
    return out;
  }

  // Coalesced: saving a preset writes three keys in a row, and that is one
  // save, not three. Short enough that an app killed by an installer moments
  // later has still written.
  var pending = null;
  function save() {
    if (!invoke) return;
    clearTimeout(pending);
    pending = setTimeout(function () {
      try {
        invoke('save_settings', { text: JSON.stringify(snapshot(), null, 2) }).catch(function () {});
      } catch (e) { /* no backend: the cache is all there is */ }
    }, 250);
  }

  var set = localStorage.setItem.bind(localStorage);
  var remove = localStorage.removeItem.bind(localStorage);

  // Defined rather than assigned: a plain assignment lands as an enumerable
  // own property, and Object.keys(localStorage) would then list "setItem"
  // beside the stored keys as though someone had saved one.
  function hide(name, fn) {
    Object.defineProperty(localStorage, name, { value: fn, writable: true, configurable: true, enumerable: false });
  }
  hide('setItem', function (k, v) { set(k, v); if (MINE.test(k)) save(); });
  hide('removeItem', function (k) { remove(k); if (MINE.test(k)) save(); });

  /** Theme and size are read before this script runs, so they need re-applying. */
  function reapply() {
    var root = document.documentElement;

    var size = localStorage.getItem('reticle-ui-size');
    if (size) root.dataset.size = size;

    var theme = localStorage.getItem('stranyov-theme') === 'day' ? 'day' : 'night';
    if (root.getAttribute('data-theme') !== theme) {
      root.setAttribute('data-theme', theme);
      var label = document.getElementById('themeLabel');
      if (label) label.textContent = theme === 'night' ? 'Night' : 'Day';
    }
  }

  function boot() {
    for (var i = 0; i < SCRIPTS.length; i++) {
      var el = document.createElement('script');
      el.src = SCRIPTS[i];
      // Appended scripts default to async, which would run them in whatever
      // order they finish loading. These have an order.
      el.async = false;
      document.body.appendChild(el);
    }
  }

  if (!invoke) { boot(); return; }

  invoke('load_settings')
    .then(function (text) {
      if (!text) {
        // No file yet: this is the first run that has one. Whatever the
        // webview is already holding becomes the record.
        save();
        return;
      }
      var saved = JSON.parse(text);
      for (var k in saved) {
        if (Object.prototype.hasOwnProperty.call(saved, k) && MINE.test(k)) rawSet(k, saved[k]);
      }
      reapply();
    })
    .catch(function () { /* unreadable or not valid JSON: the cache stands */ })
    .then(boot, boot);
})();
