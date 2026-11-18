(function () {
  'use strict';
  var R = window.ROI;
  var app = document.getElementById('app');
  var titleEl = document.getElementById('title');
  var backBtn = document.getElementById('back');
  var banner = document.getElementById('banner');
  var toastEl = document.getElementById('toast');
  var menu = document.getElementById('menu');

  var loaded = R.load();
  var data = loaded.data;
  if (loaded.corrupt) {
    try {
      if (!localStorage.getItem('roi_corrupt_backup')) localStorage.setItem('roi_corrupt_backup', loaded.corrupt);
    } catch (e) { /* ignore */ }
  }
  if (loaded.error) showBanner(loaded.error);

  var yen = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });
  function fmt(n) { return '¥' + yen.format(Math.round(n)); }
  function fmtSigned(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n)); }
  function cls(n) { return n > 0 ? 'good' : n < 0 ? 'bad' : ''; }

  /* ---------- tiny DOM helper (text via textContent, never innerHTML) ---------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  function showBanner(msg) { banner.textContent = msg; banner.hidden = false; }
  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2200);
  }

  function persist() {
    var err = R.save(data);
    if (err) showBanner(err); else if (!loaded.corrupt) banner.hidden = true;
    return !err;
  }

  /* ---------- form helpers ---------- */
  function field(label, input) { return h('label', { class: 'field' }, label, input); }
  function numInput(name, ph) {
    return h('input', { name: name, type: 'number', inputmode: 'decimal', min: '0', step: 'any', placeholder: ph || '', required: true });
  }
  function dateInput(name) { return h('input', { name: name, type: 'date', value: R.today(), required: true }); }
  function val(form, name) { return form.elements[name].value; }

  var filter = 'all';

  // ROI = pay back a purchase through use; Tracking = compare unit cost to a baseline per use.
  function modeToggle(selected) {
    function opt(v, label, hint) {
      return h('label', { class: 'mode' },
        h('input', { type: 'radio', name: 'mode', value: v, checked: selected === v }),
        h('span', null, h('b', { text: label }), h('small', { class: 'muted', text: hint })));
    }
    return h('div', { class: 'modes' },
      opt('roi', 'ROI', 'Bought something; does it pay back? (bike)'),
      opt('track', 'Tracking', 'Cheaper than the alternative? (coffee, home meals)'));
  }
  function wireMode(form) {
    function sync() {
      var m = form.elements.mode.value;
      form.querySelectorAll('[data-for]').forEach(function (el) { el.hidden = el.getAttribute('data-for') !== m; });
    }
    form.querySelectorAll('input[name=mode]').forEach(function (r) { r.addEventListener('change', sync); });
    sync();
  }

  /* ---------- views ---------- */
  function progressBar(c) {
    if (c.progress == null) return null;
    var pct = Math.min(100, Math.round(c.progress * 100));
    return h('div', { class: 'bar' + (c.brokeEven ? ' done' : ''), role: 'progressbar',
      'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' },
      h('i', { style: 'width:' + pct + '%' }));
  }

  function renderList() {
    titleEl.textContent = 'ROI Tracker';
    backBtn.hidden = true;
    app.className = '';
    app.replaceChildren();

    if (data.items.length) {
      var t = R.totals(data);
      app.appendChild(h('div', { class: 'card' },
        h('div', { class: 'muted', text: 'Total net across all items' }),
        h('div', { class: 'big ' + cls(t.net), text: fmtSigned(t.net) }),
        h('div', { class: 'muted', text: fmt(t.value) + ' saved − ' + fmt(t.invested) + ' spent' })));
    }

    if (data.items.length) {
      var tabs = h('div', { class: 'tabs', role: 'tablist' });
      [['all', 'All'], ['roi', 'ROI'], ['track', 'Tracking']].forEach(function (t) {
        tabs.appendChild(h('button', { type: 'button', role: 'tab', class: 'tab' + (filter === t[0] ? ' on' : ''),
          'aria-selected': String(filter === t[0]), text: t[1], onclick: function () { filter = t[0]; renderList(); } }));
      });
      app.appendChild(tabs);
    }

    data.items.filter(function (it) { return filter === 'all' || it.mode === filter; }).forEach(function (it) {
      var c = R.calc(it);
      var sub, right;
      if (it.mode === 'track') {
        var tr = c.track, pend = tr.pendingUses > 0 ? ' · ' + tr.pendingUses + ' pending' : '';
        if (tr.rate != null) {
          right = h('span', { class: 'big ' + (tr.rate <= tr.avgRef ? 'good' : 'bad'), text: fmt(tr.rate) + '/use' });
          sub = tr.countedUses + ' uses · saved ' + fmtSigned(tr.saved) + pend;
        } else {
          right = h('span', { class: 'big muted', text: '–' });
          sub = (tr.canIncludeRunning || tr.canIncludeCapex)
            ? 'Pending ' + fmt(tr.pendingRunning + tr.pendingCapex) + ' · ' + tr.pendingUses + ' uses. Open to include.'
            : 'Log a cost (groceries, beans) and meals to start';
        }
      } else if (c.invested === 0) sub = 'No costs yet';
      else if (c.brokeEven) sub = 'Paid off ✓ ' + c.count + ' uses';
      else sub = Math.round(c.progress * 100) + '% to break-even · ' + fmt(c.remaining) + ' to go';
      app.appendChild(h('a', { class: 'card item', href: '#/item/' + it.id },
        h('div', { class: 'row' },
          h('span', { class: 'name' }, it.name + ' ', h('span', { class: 'tag', text: it.mode === 'track' ? 'Tracking' : 'ROI' })),
          right || h('span', { class: 'big ' + cls(c.net), text: fmtSigned(c.net) })),
        h('div', { class: 'muted', text: sub }),
        it.mode === 'roi' ? progressBar(c) : null));
    });

    if (!data.items.length) {
      app.appendChild(h('div', { class: 'card empty' },
        h('p', { text: 'Track whether something you bought pays for itself.' }),
        h('p', { class: 'muted', text: 'Examples: a bike (saves 170–250 per ride), coffee at home (saves 189 per brew).' })));
    }

    var form = h('form', { onsubmit: onAddItem },
      modeToggle('roi'),
      field('Name', h('input', { name: 'name', required: true, maxlength: '60', placeholder: 'Bike or Coffee' })),
      h('div', { 'data-for': 'roi' },
        field('Quick-tap savings per use (optional, comma separated)',
          h('input', { name: 'presets', placeholder: '170, 250', inputmode: 'text' }))),
      h('div', { 'data-for': 'track', hidden: true },
        field('Reference prices: what one use would cost otherwise (name price, comma separated)',
          h('input', { name: 'refs', placeholder: 'Konbini 550, Restaurant 1200', inputmode: 'text' })),
        h('p', { class: 'muted', text: 'Log groceries or beans as Running costs. Per-use cost is computed over closed batches (each purchase until the next).' })),
      field('First cost (optional)', h('input', { name: 'cost', type: 'number', inputmode: 'decimal', min: '0', step: 'any', placeholder: '45000' })),
      field('First cost type', h('select', { name: 'kind' },
        h('option', { value: 'capex', text: 'Capex (one-off purchase)' }),
        h('option', { value: 'running', text: 'Running (beans, groceries)' }))),
      h('button', { class: 'btn', type: 'submit', text: 'Add item' }));
    wireMode(form);
    app.appendChild(h('details', { class: 'card', open: data.items.length === 0 },
      h('summary', { text: 'Add item' }), form));
  }

  function onAddItem(e) {
    e.preventDefault();
    var f = e.target;
    var mode = val(f, 'mode');
    var presets = [], refs = null;
    if (mode === 'track') {
      refs = R.parseReferences(val(f, 'refs'));
      if (!refs || !refs.length) { toast('Enter reference prices like "Konbini 550"'); return; }
    } else {
      presets = R.parsePresets(val(f, 'presets'));
      if (!presets) { toast('Quick-tap values must be numbers'); return; }
    }
    var it = R.addItem(data, val(f, 'name'), presets, mode, refs);
    var cost = val(f, 'cost');
    if (cost !== '') {
      var amt = Number(cost);
      if (!isFinite(amt) || amt < 0) { R.removeItem(data, it.id); toast('Invalid cost'); return; }
      R.addCost(it, { amount: amt, kind: val(f, 'kind'), note: 'Initial' });
    }
    if (persist()) location.hash = '#/item/' + it.id;
  }

  /* ---------- pop-up sheet for forms (keeps the item screen from scrolling) ---------- */
  var sheet = document.getElementById('sheet');
  document.getElementById('sheet-close').addEventListener('click', function () { sheet.close(); });
  function openSheet(title, node) {
    document.getElementById('sheet-title').textContent = title;
    document.getElementById('sheet-body').replaceChildren(node);
    sheet.showModal();
  }

  function costForm(it, id) {
    var track = it.mode === 'track';
    return h('form', { onsubmit: function (e) {
      e.preventDefault();
      var f = e.target, a = Number(val(f, 'amount'));
      if (!isFinite(a) || a < 0) { toast('Invalid amount'); return; }
      R.addCost(it, { amount: a, kind: val(f, 'kind'), date: val(f, 'date'), note: val(f, 'note') });
      if (persist()) { sheet.close(); toast(track ? 'Cost added (pending)' : 'Cost added'); renderDetail(id); }
    } },
      h('div', { class: 'grid2' }, field('Amount', numInput('amount', '3000')),
        field('Type', (function () {
          var sel = h('select', { name: 'kind' },
            h('option', { value: 'running', text: 'Running (groceries, beans)' }),
            h('option', { value: 'capex', text: 'Capex (one-off purchase)' }));
          sel.value = track ? 'running' : 'capex';
          return sel;
        })())),
      h('div', { class: 'grid2' }, field('Date', dateInput('date')),
        field('Note (optional)', h('input', { name: 'note', maxlength: '80' }))),
      h('button', { class: 'btn', type: 'submit', text: 'Add cost' }));
  }

  function useForm(it, id) {
    var track = it.mode === 'track';
    return h('form', { onsubmit: function (e) {
      e.preventDefault();
      var f = e.target, q = Number(val(f, 'qty') || 1), v, refName = '';
      if (track) {
        var ref = it.references.filter(function (r) { return r.id === val(f, 'ref'); })[0];
        if (!ref) { toast('Pick a reference'); return; }
        v = ref.value; refName = ref.name;
      } else v = Number(val(f, 'value'));
      if (!isFinite(v) || v < 0 || !isFinite(q) || q <= 0) { toast('Check value and quantity'); return; }
      R.addUse(it, { value: v, qty: q, date: val(f, 'date'), note: val(f, 'note'), refName: refName });
      if (persist()) { sheet.close(); toast('Logged ' + q + ' use' + (q === 1 ? '' : 's')); renderDetail(id); }
    } },
      h('div', { class: 'grid2' },
        track ? field('Reference', (function () {
          var sel = h('select', { name: 'ref' });
          it.references.forEach(function (r) { sel.appendChild(h('option', { value: r.id, text: r.name + ' ' + fmt(r.value) })); });
          return sel;
        })()) : field('Savings per use', numInput('value', '189')),
        field('Quantity', h('input', { name: 'qty', type: 'number', inputmode: 'decimal', min: '0.01', step: 'any', value: '1', required: true }))),
      h('div', { class: 'grid2' }, field('Date', dateInput('date')),
        field('Note (optional)', h('input', { name: 'note', maxlength: '80' }))),
      h('button', { class: 'btn', type: 'submit', text: 'Log uses' }));
  }

  function editForm(it, id) {
    var ef = h('form', { onsubmit: function (e) {
      e.preventDefault();
      var f = e.target, m = val(f, 'mode');
      if (m === 'track') {
        var refs = R.parseReferences(val(f, 'refs'));
        if (!refs || !refs.length) { toast('Enter reference prices like "Konbini 550"'); return; }
        R.setReferences(it, refs); it.presets = [];
        if (!it.settles) { it.settles = []; it.settleSeq = 0; }
      } else {
        var p = R.parsePresets(val(f, 'presets'));
        if (!p) { toast('Quick-tap values must be numbers'); return; }
        it.presets = p; it.references = [];
      }
      it.mode = m; it.name = val(f, 'name').trim();
      if (persist()) { sheet.close(); toast('Saved (past entries keep their values)'); renderDetail(id); }
    } },
      modeToggle(it.mode),
      field('Name', h('input', { name: 'name', required: true, maxlength: '60', value: it.name })),
      h('div', { 'data-for': 'roi' },
        field('Quick-tap savings per use (comma separated)', h('input', { name: 'presets', value: it.mode === 'roi' ? it.presets.join(', ') : '' }))),
      h('div', { 'data-for': 'track' },
        field('Reference prices (name price, comma separated)', h('input', { name: 'refs', value: R.refsToText(it.references) }))),
      h('button', { class: 'btn', type: 'submit', text: 'Save changes' }),
      h('button', { class: 'btn danger', type: 'button', text: 'Delete item', onclick: function () {
        if (!confirm('Delete "' + it.name + '" and all its entries?')) return;
        R.removeItem(data, it.id);
        if (persist()) { sheet.close(); location.hash = '#/'; }
      } }));
    wireMode(ef);
    return ef;
  }

  function renderDetail(id) {
    var it = R.findItem(data, id);
    if (!it) { location.hash = '#/'; return; }
    var c = R.calc(it), track = it.mode === 'track';
    titleEl.textContent = it.name;
    backBtn.hidden = false;
    app.className = 'fixed';
    app.replaceChildren();

    function act(fn, msg) {
      var n = fn(it);
      if (n && persist()) { toast(msg); renderDetail(id); }
    }

    /* pinned summary */
    var summary = h('div', { class: 'card' });
    if (track) {
      var tr = c.track, diff = tr.rate != null ? tr.avgRef - tr.rate : 0;
      summary.appendChild(h('div', { class: 'row' }, h('span', { class: 'muted', text: 'Running Unit Cost' }),
        h('span', { class: 'row-tools' },
          tr.canUndo ? h('button', { class: 'mini', type: 'button', text: 'Undo include', onclick: function () {
            var k = R.undoSettle(it); if (k && persist()) { toast('Undid last include (' + k + ')'); renderDetail(id); }
          } }) : null,
          h('span', { class: 'tag', text: 'Tracking' }))));
      summary.appendChild(h('div', { class: 'big ' + (tr.rate != null ? (diff >= 0 ? 'good' : 'bad') : 'muted'), text: tr.rate != null ? fmt(tr.rate) + '/use' : '–' }));
      summary.appendChild(h('div', { class: 'muted', text: tr.rate != null
        ? fmt(Math.abs(diff)) + '/use ' + (diff >= 0 ? 'cheaper' : 'pricier') + ' than avg reference ' + fmt(tr.avgRef)
        : 'Nothing counted yet. Include pending items below.' }));
      summary.appendChild(h('div', { class: 'stats' },
        h('div', null, h('span', { class: 'muted', text: 'Uses counted' }), h('b', { text: String(tr.countedUses) })),
        h('div', null, h('span', { class: 'muted', text: 'Saved' }), h('b', { text: fmtSigned(tr.saved) })),
        h('div', null, h('span', { class: 'muted', text: 'Pending costs' }),
          h('b', { text: fmt(tr.pendingRunning) + ' · ' + tr.pendingUses + ' uses' }),
          tr.runningPreview != null ? h('span', { class: 'muted small', text: '→ ' + fmt(tr.runningPreview) + '/use' }) : null,
          h('button', { class: 'mini solid', type: 'button', text: 'Include', disabled: !tr.canIncludeRunning,
            onclick: function () { act(R.settleRunning, 'Included'); } })),
        h('div', null, h('span', { class: 'muted', text: 'Capex' }),
          h('b', { text: tr.pendingCapex > 0 ? fmt(tr.pendingCapex) + ' pending' : (tr.countedCapex > 0 ? fmt(tr.countedCapex) + ' counted' : '–') }),
          h('button', { class: 'mini solid', type: 'button', text: 'Include', disabled: !tr.canIncludeCapex,
            onclick: function () { act(R.settleCapex, 'Capex included'); } }))));
    } else {
      var status = c.invested === 0 ? 'Add a cost to start' :
        c.brokeEven ? 'Paid off' : Math.round(c.progress * 100) + '% to break-even · ' + fmt(c.remaining) + ' to go';
      summary.appendChild(h('div', { class: 'row' }, h('span', { class: 'muted', text: 'Net' }), h('span', { class: 'tag', text: 'ROI' })));
      summary.appendChild(h('div', { class: 'big ' + cls(c.net), text: fmtSigned(c.net) }));
      summary.appendChild(h('div', { class: 'muted', text: status }));
      summary.appendChild(progressBar(c));
      summary.appendChild(h('div', { class: 'stats' },
        h('div', null, h('span', { class: 'muted', text: 'Saved' }), h('b', { text: fmt(c.value) })),
        h('div', null, h('span', { class: 'muted', text: 'Spent' }), h('b', { text: fmt(c.invested) + (c.capex && c.running ? ' (capex ' + fmt(c.capex) + ')' : '') })),
        h('div', null, h('span', { class: 'muted', text: 'Uses' }), h('b', { text: String(c.count) })),
        h('div', null, h('span', { class: 'muted', text: 'Avg value / use' }), h('b', { text: c.avgValue == null ? '–' : fmt(c.avgValue) }))));
    }
    app.appendChild(summary);

    /* log buttons */
    var logCard = h('div', { class: 'card' });
    var chips = h('div', { class: 'chips' });
    if (track) {
      it.references.forEach(function (r) {
        chips.appendChild(h('button', { class: 'chip', type: 'button', text: r.name + ' ' + fmt(r.value), onclick: function () {
          R.addUse(it, { value: r.value, qty: 1, refName: r.name });
          if (persist()) { toast('Logged vs ' + r.name); renderDetail(id); }
        } }));
      });
      if (!it.references.length) logCard.appendChild(h('p', { class: 'muted', text: 'Add reference prices under Edit.' }));
    } else {
      it.presets.forEach(function (p) {
        chips.appendChild(h('button', { class: 'chip', type: 'button', text: '+' + fmt(p), onclick: function () {
          R.addUse(it, { value: p, qty: 1 });
          if (persist()) { toast('Logged ' + fmt(p)); renderDetail(id); }
        } }));
      });
    }
    if (chips.childNodes.length) logCard.appendChild(chips);
    logCard.appendChild(h('div', { class: 'toolbar' },
      h('button', { class: 'mini', type: 'button', text: '+ Cost', onclick: function () { openSheet('Add a cost', costForm(it, id)); } }),
      h('button', { class: 'mini', type: 'button', text: track ? '+ Several uses' : '+ Custom use', onclick: function () { openSheet('Log uses', useForm(it, id)); } }),
      h('button', { class: 'mini', type: 'button', text: 'Edit', onclick: function () { openSheet('Edit item', editForm(it, id)); } })));
    app.appendChild(logCard);

    /* history: its own scroll panel */
    var entries = [];
    it.costs.forEach(function (x) { entries.push({ t: 'costs', e: x }); });
    it.uses.forEach(function (x) { entries.push({ t: 'uses', e: x }); });
    entries.sort(function (a, b) { return a.e.date < b.e.date ? 1 : a.e.date > b.e.date ? -1 : (a.e.id < b.e.id ? 1 : -1); });
    var list = h('ul', { class: 'hist scroll' });
    entries.forEach(function (x) {
      var e = x.e, isCost = x.t === 'costs';
      var label = isCost ? (e.kind === 'capex' ? 'Capex' : 'Running') : ('Use' + (e.refName ? ' · ' + e.refName : '') + (e.qty !== 1 ? ' ×' + e.qty : ''));
      var pending = track && e.settleId == null;
      list.appendChild(h('li', null,
        h('div', { class: 'grow' }, h('div', { text: label + (e.note ? ' · ' + e.note : '') }),
          h('div', { class: 'muted', text: e.date + (pending ? ' · pending' : '') })),
        h('span', { class: 'amt ' + (isCost ? 'bad' : 'good'), text: (isCost ? '−' : '+') + fmt(isCost ? e.amount : e.value * e.qty) }),
        h('button', { type: 'button', 'aria-label': 'Delete entry', text: '✕', onclick: function () {
          if (!confirm('Delete this entry?')) return;
          R.removeEntry(it, x.t, e.id);
          if (persist()) renderDetail(id);
        } })));
    });
    app.appendChild(h('div', { class: 'card hist-card' }, h('h2', { text: 'History' }),
      entries.length ? list : h('p', { class: 'muted', text: 'Nothing logged yet.' })));
  }

  /* ---------- routing ---------- */
  function route() {
    var m = /^#\/item\/(.+)$/.exec(location.hash);
    if (m) renderDetail(m[1]); else renderList();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  backBtn.addEventListener('click', function () { location.hash = '#/'; });

  /* ---------- backup ---------- */
  document.getElementById('menu-btn').addEventListener('click', function () { menu.showModal(); });
  document.getElementById('menu-close').addEventListener('click', function () { menu.close(); });
  document.getElementById('export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = h('a', { href: URL.createObjectURL(blob), download: 'roi-tracker-backup-' + R.today() + '.json' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    menu.close(); toast('Backup exported');
  });
  document.getElementById('import').addEventListener('change', function (e) {
    var file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var v = null;
      try { v = R.validate(JSON.parse(String(reader.result))); } catch (err) { /* invalid */ }
      if (!v) { toast('Not a valid ROI Tracker backup'); return; }
      if (!confirm('Replace current data with this backup (' + v.items.length + ' items)?')) return;
      data = v; loaded = { corrupt: null };
      if (persist()) { menu.close(); location.hash = '#/'; route(); toast('Backup restored'); }
    };
    reader.onerror = function () { toast('Could not read file'); };
    reader.readAsText(file);
  });

  /* ---------- feedback notes ---------- */
  var fb = R.loadFeedback();
  var fbDlg = document.getElementById('feedback');
  var fbList = document.getElementById('fb-list');
  var fbForm = document.getElementById('fb-form');

  function renderFeedback() {
    fbList.replaceChildren();
    fb.slice().reverse().forEach(function (n) {
      fbList.appendChild(h('li', null,
        h('div', { class: 'grow' },
          h('div', { class: 'note', text: n.text }),
          h('div', { class: 'muted', text: n.kind + ' · ' + n.date })),
        h('button', { type: 'button', 'aria-label': 'Delete note', text: '✕', onclick: function () {
          fb = fb.filter(function (x) { return x.id !== n.id; });
          R.saveFeedback(fb); renderFeedback();
        } })));
    });
    document.getElementById('fb-copy').disabled = !fb.length;
    document.getElementById('fb-clear').disabled = !fb.length;
  }

  document.getElementById('open-feedback').addEventListener('click', function () {
    menu.close(); renderFeedback(); fbDlg.showModal();
  });
  document.getElementById('fb-close').addEventListener('click', function () { fbDlg.close(); });
  fbForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!R.addNote(fb, fbForm.elements.text.value, fbForm.elements.kind.value)) return;
    var err = R.saveFeedback(fb);
    if (err) toast(err);
    fbForm.elements.text.value = '';
    renderFeedback();
  });
  document.getElementById('fb-copy').addEventListener('click', function () {
    var text = R.formatFeedback(fb);
    function download() {
      var blob = new Blob([text], { type: 'text/plain' });
      var a = h('a', { href: URL.createObjectURL(blob), download: 'roi-tracker-feedback-' + R.today() + '.txt' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('Clipboard blocked; downloaded as .txt');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied ' + fb.length + ' notes'); }, download);
    } else download();
  });
  document.getElementById('fb-clear').addEventListener('click', function () {
    if (!confirm('Delete all ' + fb.length + ' notes? Copy them first.')) return;
    fb = []; R.saveFeedback(fb); renderFeedback();
  });

  /* ---------- service worker ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline support optional */ });
    });
  }

  route();
})();
