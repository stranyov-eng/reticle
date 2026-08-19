/*
  Shared tiny helpers for the stranyov.pro tools.
  ----------------------------------------------------------------------------
  Plain globals (no module), loaded via <script src> in <head> so they exist
  before each tool's own inline script runs. The inline scripts are obfuscated
  with renameGlobals:false, so calls to these keep their bare names and resolve
  to the globals defined here.

  Only genuinely shared helpers live here — where a tool's copy had really
  drifted in behaviour (e.g. its own notify() timing or uid() format), that copy
  stays inline in the tool.
*/
(function (g) {
  'use strict';

  // Clamp a number to [lo, hi]. Shared so tools stop re-declaring their own
  // (uv had clampi/clamp01; others inlined Math.max/Math.min). Does not round.
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Down-right offset (px) for a duplicated/pasted item, so the copy is visibly
  // nudged off its original instead of landing exactly on top. Shared so every
  // tool offsets by the same amount.
  var DUP_OFFSET = 30;

  // Canonical getElementById shorthand — available in every tool that loads
  // _util. New code should use $('id'); older tools also keep a local v() that
  // now delegates here, so both names resolve to one implementation.
  function $(id) { return document.getElementById(id); }

  // Numeric value of an input by id, with a fallback when empty / NaN. (Shared —
  // was duplicated byte-for-byte as num() in generator and planner.)
  function num(id, def) { var el = $(id); var n = parseFloat(el && el.value); return isNaN(n) ? def : n; }

  // One CSV/TSV line → array of cells, honouring quoted fields ("a, b" and ""
  // escapes). Shared so a tool doesn't fall back to a naive line.split(',') that
  // breaks on any name containing the delimiter. (Column mapping stays per-tool.)
  function parseCsvLine(line, delimiter) {
    delimiter = delimiter || ',';
    var cells = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQ) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === delimiter) { cells.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  }

  // Canonical HTML escaper for user-controlled strings (slice/screen names)
  // before innerHTML / attribute / title interpolation. (XML export escaping is
  // separate — see escXml in _export.js.)
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Evaluate a tiny arithmetic expression typed into a numeric field
  // ("1920/2", "100+50"). Returns a number rounded to 3 dp, or null.
  function mathEval(expr) {
    const clean = String(expr).replace(/[^0-9+\-*/.() ]/g, '').trim();
    if (!clean) return null;
    try {
      const result = Function('"use strict"; return (' + clean + ')')();
      return isFinite(result) ? Math.round(result * 1000) / 1000 : null;
    } catch (e) { return null; }
  }

  // Resolve the expression in a text/number field and coerce it back to a
  // number input, firing input+change so the tool's listeners pick it up.
  function applyMath(inp) {
    const result = mathEval(inp.value);
    if (result !== null) {
      inp.type = 'number';
      inp.value = result;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      inp.type = 'number';
    }
  }

  // Trigger a client-side download of string/blob content. Appends the anchor
  // to the document first (most robust across browsers) then cleans up.
  function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Shift/Ctrl/Cmd-aware multi-select over an ordered list. `selectedIds` is a
  // Set the caller owns, `orderArr` is the items in display order (each with an
  // .id), and `anchor` is a {id} the caller keeps for shift-range anchoring.
  function applyMultiSelect(selectedIds, orderArr, id, e, anchor) {
    if (e.shiftKey && anchor.id != null) {
      const ids = orderArr.map(x => x.id);
      const a = ids.indexOf(anchor.id), b = ids.indexOf(id);
      if (a !== -1 && b !== -1) {
        selectedIds.clear();
        const lo = Math.min(a, b), hi = Math.max(a, b);
        for (let i = lo; i <= hi; i++) selectedIds.add(ids[i]);
        return;
      }
      // anchor no longer exists (e.g. it was deleted) → fall through to a plain
      // single-select of the clicked item instead of doing nothing.
    }
    if (e.ctrlKey || e.metaKey) {
      if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
      anchor.id = id;
    } else {
      if (selectedIds.size === 1 && selectedIds.has(id)) selectedIds.clear();
      else { selectedIds.clear(); selectedIds.add(id); }
      anchor.id = id;
    }
  }

  // Scroll-to-nudge a number input: wheel = ±step (Shift = ×10), clamped to the
  // field's min/max and rounded to its step, then fires 'input'. Only acts when
  // the field is focused, so scrolling the page over it never changes the value.
  function wireInputWheel(inp) {
    inp.addEventListener('wheel', function (e) {
      if (inp.type !== 'number' || inp.disabled || inp.readOnly) return;
      if (document.activeElement !== inp) return;
      e.preventDefault();
      e.stopPropagation();
      const stepBase = parseFloat(inp.step) || 1;
      const step = e.shiftKey ? stepBase * 10 : stepBase;
      const min = inp.min !== '' ? parseFloat(inp.min) : -Infinity;
      const max = inp.max !== '' ? parseFloat(inp.max) :  Infinity;
      let val = parseFloat(inp.value) || 0;
      val += e.deltaY < 0 ? step : -step;
      val = Math.max(min, Math.min(max, val));
      val = stepBase >= 1 ? Math.round(val) : Math.round(val / stepBase) * stepBase;
      if (stepBase < 1) val = parseFloat(val.toFixed(3)); // trim float noise (20.499999)
      inp.value = val;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, { passive: false });
  }

  // Wire a number field for expression math ("1920/2", "100+50") + scroll-to-nudge.
  // Chrome rejects operator characters in a type=number input, so on the first
  // operator keypress the field is switched to type=text, evaluated with applyMath
  // on Enter/blur, then coerced back to a number. wireInputWheel adds the shared
  // wheel-nudge. One implementation for every tool so the number-field UX is
  // identical everywhere. (A leading "-" typed right after focusing starts a new
  // negative number instead of appending to the old value — Chrome doesn't expose
  // selectionStart on type=number, so we track first-keystroke-since-focus instead.)
  function attachMathInput(inp) {
    if (!inp) return;
    let freshFocus = true, lastMouseDownDetail = 0;
    inp.addEventListener('mousedown', function (e) { lastMouseDownDetail = e.detail; if (e.detail >= 2) freshFocus = true; });
    inp.addEventListener('focus', function () { freshFocus = lastMouseDownDetail !== 1; lastMouseDownDetail = 0; });
    inp.addEventListener('keydown', function (e) {
      if (e.key === '-' && freshFocus && inp.value.trim() !== '') inp.value = '';
      freshFocus = false;
      var isOp = ['+', '*', '/', '(', ')'].indexOf(e.key) >= 0 || (e.key === '-' && inp.value.trim() !== '');
      if (isOp && inp.type === 'number') { inp.type = 'text'; var len = inp.value.length; try { inp.setSelectionRange(len, len); } catch (_) {} }
      if (e.key === 'Enter' && inp.type === 'text') { e.preventDefault(); applyMath(inp); }
    });
    inp.addEventListener('blur', function () { if (inp.type === 'text') applyMath(inp); });
    wireInputWheel(inp);
  }

  // snapRect + the full snapping model moved to _snap.js (StranyovSnap).

  // Shared toast. Writes msg into the tool's #notif element (styled/positioned
  // by _components.css; a tool can offset it via --notif-bottom / --notif-z),
  // shows it, and auto-hides after `ms`. Re-reads #notif each call so it works
  // even if the element is added late. One timer, shared across calls.
  let _notifTimer = null;
  function notify(msg, ms) {
    const n = document.getElementById('notif');
    if (!n) return;
    // a11y: announce toasts to assistive tech (set once, idempotent).
    if (!n.getAttribute('aria-live')) { n.setAttribute('role', 'status'); n.setAttribute('aria-live', 'polite'); }
    n.textContent = msg;
    n.classList.add('show');
    clearTimeout(_notifTimer);
    _notifTimer = setTimeout(function () { n.classList.remove('show'); }, ms || 2400);
  }

  // Styled replacement for window.confirm(): a modal reusing the shared .modal-overlay look,
  // so destructive actions (Reset / Clear) match the rest of the app instead of a browser chrome
  // dialog. Returns a Promise<boolean> — true on confirm, false on cancel / close / Esc / backdrop.
  // opts: { eyebrow, title, message (\n → line breaks), confirm, cancel, danger }
  var _confirmEl = null;
  var _confirmPending = null; // cancel-fn of an in-flight dialog (single reused overlay)
  function confirmModal(opts) {
    opts = opts || {};
    // Single overlay is reused, so a second call opened before the first resolves would
    // overwrite the first's onclick handlers (its Promise would hang forever) and stack a
    // second capture keydown listener. Auto-cancel any in-flight dialog first: this resolves
    // its Promise (false) and removes its listener before we rebind for the new one.
    if (_confirmPending) _confirmPending();
    if (!_confirmEl) {
      var ov = document.createElement('div');
      ov.className = 'modal-overlay';
      ov.id = 'confirmModal';
      ov.innerHTML =
        '<div class="modal" style="max-width:440px">' +
          '<div class="modal-header">' +
            '<div><div class="kb-eyebrow" data-c="eyebrow"></div><div class="modal-title" data-c="title"></div></div>' +
            '<button class="modal-close" type="button" aria-label="Close" data-c="x">✕</button>' +
          '</div>' +
          '<div class="confirm-body"><p class="confirm-msg" data-c="msg"></p></div>' +
          '<div class="confirm-actions">' +
            '<button type="button" class="confirm-btn" data-c="cancel"></button>' +
            '<button type="button" class="confirm-btn confirm-primary" data-c="ok"></button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(ov);
      _confirmEl = ov;
    }
    var ov = _confirmEl, q = function (s) { return ov.querySelector('[data-c="' + s + '"]'); };
    q('eyebrow').textContent = opts.eyebrow || 'Confirm';
    q('title').textContent = opts.title || 'Are you sure?';
    q('msg').textContent = opts.message || '';
    q('ok').textContent = opts.confirm || 'Confirm';
    q('cancel').textContent = opts.cancel || 'Cancel';
    q('ok').className = 'confirm-btn ' + (opts.danger ? 'confirm-danger' : 'confirm-primary');
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) {
        if (done) return; done = true;
        if (_confirmPending === cancelSelf) _confirmPending = null;
        ov.classList.remove('open');
        document.removeEventListener('keydown', onKey, true);
        resolve(v);
      }
      function cancelSelf() { finish(false); }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          // Enter activates the FOCUSED control (native dialog semantics) — so tabbing to Cancel
          // and pressing Enter cancels, instead of always confirming a destructive action.
          var a = document.activeElement;
          finish(!(a === q('cancel') || a === q('x')));
        }
      }
      _confirmPending = cancelSelf;
      q('ok').onclick = function () { finish(true); };
      q('cancel').onclick = function () { finish(false); };
      q('x').onclick = function () { finish(false); };
      ov.onclick = function (e) { if (e.target === ov) finish(false); };
      document.addEventListener('keydown', onKey, true); // capture: beat the tools' own Esc handlers
      ov.classList.add('open');
      setTimeout(function () { q('ok').focus(); }, 30);
    });
  }

  // Live-mirror an object's fields into UI inputs — used during a canvas drag/resize to keep the
  // Size/Pos panel (or list-row) fields tracking the drag in place, without a full panel re-render.
  // Shared so every tool (and any future one) gets the same feel by just passing its field map:
  //   mirrorFields({ x:'plX', y:'plY', w:'plW', h:'plH' }, zone)   // fixed input ids
  //   mirrorFields({ x: rowXInput, y: rowYInput }, slice)          // element refs (e.g. list rows)
  // Map keys are the OBJECT's properties; values are an input element or its id. Missing → skipped.
  function mirrorFields(map, obj) {
    if (!map || !obj) return;
    for (var k in map) {
      var el = map[k]; if (typeof el === 'string') el = document.getElementById(el);
      if (el && obj[k] != null) el.value = obj[k];
    }
  }

  g.DUP_OFFSET = DUP_OFFSET;
  g.confirmModal = confirmModal;
  g.clamp = clamp;
  g.$ = $;
  g.num = num;
  g.parseCsvLine = parseCsvLine;
  g.escHtml = escHtml;
  g.mathEval = mathEval;
  g.applyMath = applyMath;
  g.attachMathInput = attachMathInput;
  g.downloadFile = downloadFile;
  g.applyMultiSelect = applyMultiSelect;
  g.wireInputWheel = wireInputWheel;
  g.notify = notify;
  g.mirrorFields = mirrorFields;
})(window);
