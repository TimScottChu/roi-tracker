/* ROI Tracker core: data model, math, storage, import/export validation.
   Pure functions + localStorage under the `roi_` prefix (merge-safe). */
(function (root) {
  'use strict';

  var KEY = 'roi_data_v1';
  var VERSION = 1;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // Local date (JST-safe): never use toISOString for "today".
  function today(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function isDate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  function num(x) {
    return typeof x === 'number' && isFinite(x);
  }

  function emptyData() {
    return { version: VERSION, items: [] };
  }

  /* ---------- math ---------- */

  // Net = sum(use value * qty) - sum(all costs). One formula for every item.
  function calc(item) {
    var costs = item.costs || [];
    var uses = item.uses || [];
    var capex = 0, running = 0, value = 0, count = 0;
    costs.forEach(function (c) {
      if (c.kind === 'capex') capex += c.amount; else running += c.amount;
    });
    uses.forEach(function (u) {
      value += u.value * u.qty;
      count += u.qty;
    });
    var invested = capex + running;
    return {
      capex: capex,
      running: running,
      invested: invested,
      value: value,
      count: count,
      net: value - invested,
      progress: invested > 0 ? value / invested : null,
      remaining: Math.max(0, invested - value),
      brokeEven: invested > 0 && value >= invested,
      avgValue: count > 0 ? value / count : null,
      // actual running cost per use (coffee brew, home meal)
      runningPerUse: count > 0 && running > 0 ? running / count : null,
      // Tracking mode: how much cheaper than the baseline each use is (negative = pricier)
      vsBaseline: item.baseline != null && count > 0 && running > 0 ? item.baseline - running / count : null
    };
  }

  function totals(data) {
    var t = { net: 0, value: 0, invested: 0 };
    data.items.forEach(function (it) {
      var c = calc(it);
      t.net += c.net; t.value += c.value; t.invested += c.invested;
    });
    return t;
  }

  /* ---------- validation (used on load and import) ---------- */

  function cleanItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || !raw.id) return null;
    if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
    var item = { id: raw.id, name: raw.name.trim(), mode: raw.mode === 'track' ? 'track' : 'roi',
      baseline: num(raw.baseline) && raw.baseline >= 0 ? raw.baseline : null, presets: [], costs: [], uses: [] };
    if (Array.isArray(raw.presets)) {
      raw.presets.forEach(function (p) {
        if (num(p) && p >= 0) item.presets.push(p);
      });
    }
    if (!Array.isArray(raw.costs) || !Array.isArray(raw.uses)) return null;
    for (var i = 0; i < raw.costs.length; i++) {
      var c = raw.costs[i];
      if (!c || typeof c.id !== 'string' || !num(c.amount) || c.amount < 0 ||
          !isDate(c.date) || (c.kind !== 'capex' && c.kind !== 'running')) return null;
      item.costs.push({ id: c.id, date: c.date, amount: c.amount, kind: c.kind,
        note: typeof c.note === 'string' ? c.note : '' });
    }
    for (var j = 0; j < raw.uses.length; j++) {
      var u = raw.uses[j];
      if (!u || typeof u.id !== 'string' || !num(u.value) || u.value < 0 ||
          !num(u.qty) || u.qty <= 0 || !isDate(u.date)) return null;
      item.uses.push({ id: u.id, date: u.date, value: u.value, qty: u.qty,
        note: typeof u.note === 'string' ? u.note : '' });
    }
    return item;
  }

  // Returns a clean data object, or null if the input is not valid.
  function validate(raw) {
    if (!raw || typeof raw !== 'object' || raw.version !== VERSION ||
        !Array.isArray(raw.items)) return null;
    var out = emptyData();
    var seen = {};
    for (var i = 0; i < raw.items.length; i++) {
      var it = cleanItem(raw.items[i]);
      if (!it || seen[it.id]) return null;
      seen[it.id] = true;
      out.items.push(it);
    }
    return out;
  }

  /* ---------- storage ---------- */

  function load(storage) {
    storage = storage || root.localStorage;
    var txt;
    try { txt = storage.getItem(KEY); } catch (e) { return { data: emptyData(), error: 'Storage unavailable' }; }
    if (!txt) return { data: emptyData(), error: null };
    try {
      var v = validate(JSON.parse(txt));
      if (v) return { data: v, error: null };
    } catch (e) { /* fall through */ }
    return { data: emptyData(), error: 'Saved data unreadable. Not overwritten until you change something; export first if needed.', corrupt: txt };
  }

  function save(data, storage) {
    storage = storage || root.localStorage;
    try { storage.setItem(KEY, JSON.stringify(data)); return null; }
    catch (e) { return 'Could not save (storage full or blocked)'; }
  }

  /* ---------- mutations (return new state; caller saves) ---------- */

  // mode: 'roi' (pay back a purchase) or 'track' (compare unit cost to a baseline per use)
  function addItem(data, name, presets, mode, baseline) {
    var track = mode === 'track';
    var it = { id: uid(), name: name.trim(), mode: track ? 'track' : 'roi',
      baseline: track && baseline != null ? baseline : null,
      presets: track ? (baseline != null ? [baseline] : []) : (presets || []), costs: [], uses: [] };
    data.items.push(it);
    return it;
  }

  function findItem(data, id) {
    for (var i = 0; i < data.items.length; i++) if (data.items[i].id === id) return data.items[i];
    return null;
  }

  function addCost(item, o) {
    item.costs.push({ id: uid(), date: o.date || today(), amount: o.amount, kind: o.kind, note: o.note || '' });
  }

  function addUse(item, o) {
    item.uses.push({ id: uid(), date: o.date || today(), value: o.value, qty: o.qty || 1, note: o.note || '' });
  }

  function removeEntry(item, listName, id) {
    item[listName] = item[listName].filter(function (e) { return e.id !== id; });
  }

  function removeItem(data, id) {
    data.items = data.items.filter(function (i) { return i.id !== id; });
  }

  // Parse "170, 250" -> [170, 250]; returns null if any token is invalid.
  function parsePresets(text) {
    var toks = String(text || '').split(/[,\s]+/).filter(Boolean);
    var out = [];
    for (var i = 0; i < toks.length; i++) {
      var n = Number(toks[i]);
      if (!isFinite(n) || n < 0) return null;
      out.push(n);
    }
    return out;
  }


  /* ---------- feedback notes (separate key; not part of the Backup JSON) ---------- */

  var FKEY = 'roi_feedback_v1';

  function loadFeedback(storage) {
    storage = storage || root.localStorage;
    try {
      var arr = JSON.parse(storage.getItem(FKEY) || '[]');
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (n) {
        return n && typeof n.id === 'string' && typeof n.text === 'string' && n.text &&
          isDate(n.date) && (n.kind === 'idea' || n.kind === 'bug');
      });
    } catch (e) { return []; }
  }

  function saveFeedback(list, storage) {
    storage = storage || root.localStorage;
    try { storage.setItem(FKEY, JSON.stringify(list)); return null; }
    catch (e) { return 'Could not save note (storage full or blocked)'; }
  }

  function addNote(list, text, kind) {
    var t = String(text || '').trim();
    if (!t) return null;
    var n = { id: uid(), date: today(), kind: kind === 'bug' ? 'bug' : 'idea', text: t };
    list.push(n);
    return n;
  }

  // Paste-ready batch for Claude.
  function formatFeedback(list) {
    if (!list.length) return '';
    var lines = ['# ROI Tracker feedback (' + today() + ')', ''];
    list.forEach(function (n) {
      lines.push('- [' + n.kind + '] ' + n.date + ': ' + n.text.replace(/\r?\n/g, '\n  '));
    });
    return lines.join('\n') + '\n';
  }

  var api = {
    KEY: KEY, VERSION: VERSION, uid: uid, today: today, emptyData: emptyData,
    calc: calc, totals: totals, validate: validate, load: load, save: save,
    addItem: addItem, findItem: findItem, addCost: addCost, addUse: addUse,
    removeEntry: removeEntry, removeItem: removeItem, parsePresets: parsePresets,
    FKEY: FKEY, loadFeedback: loadFeedback, saveFeedback: saveFeedback, addNote: addNote, formatFeedback: formatFeedback
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ROI = api;
})(typeof window !== 'undefined' ? window : globalThis);
