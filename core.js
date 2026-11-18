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
    var out = {
      capex: capex,
      running: running,
      invested: invested,
      value: value,
      count: count,
      net: value - invested,
      progress: invested > 0 ? value / invested : null,
      remaining: Math.max(0, invested - value),
      brokeEven: invested > 0 && value >= invested,
      avgValue: count > 0 ? value / count : null
    };
    // What counts toward totals: ROI items use everything; Tracking items use counted entries only.
    out.settledValue = value; out.settledCost = invested; out.settledNet = out.net;
    if (item.mode === 'track') {
      var t = trackStats(item);
      out.track = t;
      out.settledValue = t.countedValue;
      out.settledCost = t.countedCost;
      out.settledNet = t.countedValue - t.countedCost;
    }
    return out;
  }

  // Tracking items: entries are pending until you press Include. Running Unit Cost =
  // counted costs (running + capex) / counted uses. Including is manual, so a fresh grocery
  // run never distorts the number until you choose to count it.
  function trackStats(item) {
    var t = { countedRunning: 0, countedCapex: 0, countedUses: 0, countedValue: 0,
      pendingRunning: 0, pendingCapex: 0, pendingUses: 0, pendingValue: 0 };
    (item.costs || []).forEach(function (c) {
      var counted = c.settleId != null;
      if (c.kind === 'capex') { if (counted) t.countedCapex += c.amount; else t.pendingCapex += c.amount; }
      else { if (counted) t.countedRunning += c.amount; else t.pendingRunning += c.amount; }
    });
    (item.uses || []).forEach(function (u) {
      if (u.settleId != null) { t.countedUses += u.qty; t.countedValue += u.value * u.qty; }
      else { t.pendingUses += u.qty; t.pendingValue += u.value * u.qty; }
    });
    t.countedCost = t.countedRunning + t.countedCapex;
    t.rate = t.countedUses > 0 ? t.countedCost / t.countedUses : null;      // Running Unit Cost
    t.avgRef = t.countedUses > 0 ? t.countedValue / t.countedUses : null;   // avg reference price
    t.saved = t.countedValue - t.countedCost;
    // What the rate would be after pressing Include on the running side
    var d = t.countedUses + t.pendingUses;
    t.runningPreview = d > 0 && (t.pendingRunning > 0 || t.pendingUses > 0) ? (t.countedCost + t.pendingRunning) / d : null;
    t.canIncludeRunning = t.pendingRunning > 0 || t.pendingUses > 0;
    t.canIncludeCapex = t.pendingCapex > 0;
    t.canUndo = (item.settles || []).length > 0;
    return t;
  }

  /* ---------- Include / Undo (Tracking) ---------- */

  function nextSettleId(item) {
    item.settleSeq = (item.settleSeq || 0) + 1;
    return item.settleSeq;
  }

  // Count all pending running costs and pending uses. Returns how many entries changed.
  function settleRunning(item) {
    var pend = [];
    item.costs.forEach(function (c) { if (c.kind === 'running' && c.settleId == null) pend.push(c); });
    item.uses.forEach(function (u) { if (u.settleId == null) pend.push(u); });
    if (!pend.length) return 0;
    var id = nextSettleId(item);
    pend.forEach(function (e) { e.settleId = id; });
    item.settles = (item.settles || []).concat([{ id: id, kind: 'running' }]);
    return pend.length;
  }

  // Count all pending capex (cost side only; uses unchanged).
  function settleCapex(item) {
    var pend = item.costs.filter(function (c) { return c.kind === 'capex' && c.settleId == null; });
    if (!pend.length) return 0;
    var id = nextSettleId(item);
    pend.forEach(function (e) { e.settleId = id; });
    item.settles = (item.settles || []).concat([{ id: id, kind: 'capex' }]);
    return pend.length;
  }

  // Revert the most recent Include. Returns the kind that was undone, or null.
  function undoSettle(item) {
    var st = item.settles || [];
    if (!st.length) return null;
    var last = st[st.length - 1];
    item.costs.forEach(function (c) { if (c.settleId === last.id) c.settleId = null; });
    item.uses.forEach(function (u) { if (u.settleId === last.id) u.settleId = null; });
    item.settles = st.slice(0, -1);
    return last.kind;
  }

  function totals(data) {
    var t = { net: 0, value: 0, invested: 0 };
    data.items.forEach(function (it) {
      var c = calc(it);
      t.value += c.settledValue; t.invested += c.settledCost;
    });
    t.net = t.value - t.invested;
    return t;
  }

  /* ---------- validation (used on load and import) ---------- */

  function cleanSettle(x) {
    return typeof x === 'number' && isFinite(x) && x > 0 && Math.floor(x) === x ? x : null;
  }

  function cleanItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || !raw.id) return null;
    if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
    var mode = raw.mode === 'track' ? 'track' : 'roi';
    var item = { id: raw.id, name: raw.name.trim(), mode: mode, references: [], presets: [], costs: [], uses: [] };
    if (mode === 'roi') {
      if (Array.isArray(raw.presets)) {
        raw.presets.forEach(function (p) {
          if (num(p) && p >= 0) item.presets.push(p);
        });
      }
    } else {
      if (Array.isArray(raw.references)) {
        for (var k = 0; k < raw.references.length; k++) {
          var r = raw.references[k];
          if (!r || typeof r.id !== 'string' || !r.id || typeof r.name !== 'string' || !r.name.trim() ||
              !num(r.value) || r.value < 0) return null;
          item.references.push({ id: r.id, name: r.name.trim().slice(0, 30), value: r.value });
        }
      }
      // v2.1 and earlier: a single `baseline` becomes the first reference
      if (!item.references.length && num(raw.baseline) && raw.baseline >= 0) {
        item.references.push({ id: 'ref-baseline', name: 'Baseline', value: raw.baseline });
      }
    }
    if (!Array.isArray(raw.costs) || !Array.isArray(raw.uses)) return null;
    for (var i = 0; i < raw.costs.length; i++) {
      var c = raw.costs[i];
      if (!c || typeof c.id !== 'string' || !num(c.amount) || c.amount < 0 ||
          !isDate(c.date) || (c.kind !== 'capex' && c.kind !== 'running')) return null;
      item.costs.push({ id: c.id, date: c.date, amount: c.amount, kind: c.kind,
        note: typeof c.note === 'string' ? c.note : '', settleId: cleanSettle(c.settleId) });
    }
    for (var j = 0; j < raw.uses.length; j++) {
      var u = raw.uses[j];
      if (!u || typeof u.id !== 'string' || !num(u.value) || u.value < 0 ||
          !num(u.qty) || u.qty <= 0 || !isDate(u.date)) return null;
      item.uses.push({ id: u.id, date: u.date, value: u.value, qty: u.qty,
        note: typeof u.note === 'string' ? u.note : '',
        refName: typeof u.refName === 'string' ? u.refName.slice(0, 30) : '', settleId: cleanSettle(u.settleId) });
    }
    if (mode === 'track') {
      var maxId = 0;
      item.costs.concat(item.uses).forEach(function (e) { if (e.settleId > maxId) maxId = e.settleId; });
      item.settles = [];
      if (Array.isArray(raw.settles)) {
        raw.settles.forEach(function (x) {
          if (x && cleanSettle(x.id) != null && (x.kind === 'running' || x.kind === 'capex')) {
            item.settles.push({ id: x.id, kind: x.kind }); if (x.id > maxId) maxId = x.id;
          }
        });
      }
      item.settleSeq = Math.max(maxId, cleanSettle(raw.settleSeq) || 0);
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

  // mode: 'roi' (pay back a purchase) or 'track' (cost per use vs reference prices).
  // refs (track only): [{ name, value }]
  function addItem(data, name, presets, mode, refs) {
    var track = mode === 'track';
    var it = { id: uid(), name: name.trim(), mode: track ? 'track' : 'roi',
      references: track ? (refs || []).map(function (r) { return { id: uid(), name: r.name, value: r.value }; }) : [],
      presets: track ? [] : (presets || []), costs: [], uses: [] };
    if (track) { it.settles = []; it.settleSeq = 0; }
    data.items.push(it);
    return it;
  }

  function findItem(data, id) {
    for (var i = 0; i < data.items.length; i++) if (data.items[i].id === id) return data.items[i];
    return null;
  }

  function addCost(item, o) {
    item.costs.push({ id: uid(), date: o.date || today(), amount: o.amount, kind: o.kind, note: o.note || '', settleId: null });
  }

  function addUse(item, o) {
    item.uses.push({ id: uid(), date: o.date || today(), value: o.value, qty: o.qty || 1, note: o.note || '',
      refName: o.refName || '', settleId: null });
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


  // "Konbini 550, Restaurant 1200" -> [{name, value}]; a lone number becomes "Baseline". null if invalid.
  function parseReferences(text) {
    var toks = String(text || '').replace(/[¥￥]/g, '').split(/[,\n]+/)
      .map(function (t) { return t.trim(); }).filter(Boolean);
    var out = [];
    for (var i = 0; i < toks.length; i++) {
      var m = /^(.*?)[\s:=]*(\d+(?:\.\d+)?)$/.exec(toks[i]);
      if (!m) return null;
      var name = m[1].trim();
      if (!name) name = toks.length === 1 ? 'Baseline' : 'Reference ' + (i + 1);
      out.push({ name: name.slice(0, 30), value: Number(m[2]) });
    }
    return out;
  }

  function refsToText(refs) {
    return (refs || []).map(function (r) { return r.name + ' ' + r.value; }).join(', ');
  }

  // Replace an item's references, keeping ids for names that already existed.
  function setReferences(item, parsed) {
    var old = {};
    (item.references || []).forEach(function (r) { old[r.name] = r.id; });
    item.references = parsed.map(function (r) { return { id: old[r.name] || uid(), name: r.name, value: r.value }; });
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
    settleRunning: settleRunning, settleCapex: settleCapex, undoSettle: undoSettle,
    parseReferences: parseReferences, refsToText: refsToText, setReferences: setReferences,
    FKEY: FKEY, loadFeedback: loadFeedback, saveFeedback: saveFeedback, addNote: addNote, formatFeedback: formatFeedback
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ROI = api;
})(typeof window !== 'undefined' ? window : globalThis);
