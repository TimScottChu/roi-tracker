const assert = require('assert');
const R = require('../core.js');
const mem = () => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = v; }, _s: s }; };

// Bike: 45k capex + 1.2k pump, rides of 170/250
let d = R.emptyData();
const bike = R.addItem(d, 'Bike', [170, 250]);
R.addCost(bike, { amount: 45000, kind: 'capex' });
R.addCost(bike, { amount: 1200, kind: 'capex' });
R.addUse(bike, { value: 170 }); R.addUse(bike, { value: 250 }); R.addUse(bike, { value: 250, qty: 2 });
let c = R.calc(bike);
assert.strictEqual(c.invested, 46200);
assert.strictEqual(c.value, 920);
assert.strictEqual(c.net, 920 - 46200);
assert.strictEqual(c.count, 4);
assert(Math.abs(c.progress - 920 / 46200) < 1e-12);
assert.strictEqual(c.brokeEven, false);
assert.strictEqual(c.track, undefined);

// Coffee: beans 1500 yen, 10 brews at 189 baseline
const coffee = R.addItem(d, 'Coffee', [], 'track', [{ name: 'Cafe', value: 189 }]);
assert.strictEqual(coffee.mode, 'track'); assert.strictEqual(coffee.references[0].value, 189); assert.deepStrictEqual(coffee.presets, []);
assert.strictEqual(bike.mode, 'roi'); assert.deepStrictEqual(bike.references, []);
R.addCost(coffee, { amount: 1500, kind: 'running' });
for (let i = 0; i < 10; i++) R.addUse(coffee, { value: 189 });
c = R.calc(coffee);
// Running costs and uses count immediately: 1500 / 10 uses
assert.strictEqual(c.track.rate, 150); assert.strictEqual(c.track.uses, 10);
assert.strictEqual(c.track.avgRef, 189); assert.strictEqual(c.track.saved, 390);
assert.strictEqual(c.settledNet, 390);
assert.strictEqual(c.net, 1890 - 1500);
assert.strictEqual(c.brokeEven, true);

// Empty item
const e = R.addItem(d, 'Empty', []);
c = R.calc(e);
assert.strictEqual(c.net, 0); assert.strictEqual(c.progress, null); assert.strictEqual(c.avgValue, null);

// Totals
assert.strictEqual(R.totals(d).net, (920 - 46200) + 390);

// Delete entry
R.removeEntry(bike, 'costs', bike.costs[1].id);
assert.strictEqual(R.calc(bike).invested, 45000);

// Storage roundtrip + validation
const st = mem();
assert.strictEqual(R.save(d, st), null);
const back = R.load(st);
assert.strictEqual(back.error, null);
assert.deepStrictEqual(back.data, d);
// Corrupt data is detected, not thrown
st.setItem(R.KEY, '{bad');
const bad = R.load(st);
assert(bad.error && bad.corrupt === '{bad' && bad.data.items.length === 0);
// Invalid shapes rejected
assert.strictEqual(R.validate({ version: 2, items: [] }), null);
assert.strictEqual(R.validate({ version: 1, items: [{ id: 'a', name: 'x', costs: [{ id: 'c', amount: -5, date: '2026-01-01', kind: 'capex' }], uses: [] }] }), null);
assert.strictEqual(R.validate({ version: 1, items: [{ id: 'a', name: 'x', costs: [], uses: [{ id: 'u', value: 1, qty: 0, date: '2026-01-01' }] }] }), null);
assert.strictEqual(R.validate({ version: 1, items: [{ id: 'a', name: 'x', costs: [], uses: [] }, { id: 'a', name: 'y', costs: [], uses: [] }] }), null);

// Old data without mode loads as roi; invalid mode falls back to roi
const legacy = R.validate({ version: 1, items: [{ id: 'a', name: 'x', costs: [], uses: [] }, { id: 'b', name: 'y', mode: 'weird', baseline: -3, costs: [], uses: [] }] });
assert.strictEqual(legacy.items[0].mode, 'roi'); assert.strictEqual(legacy.items[1].mode, 'roi'); assert.deepStrictEqual(legacy.items[1].references, []);
const mig = R.validate({ version: 1, items: [{ id: 'm', name: 'Coffee', mode: 'track', baseline: 189, presets: [189], costs: [], uses: [] }] });
assert.deepStrictEqual(mig.items[0].references.map(r => [r.name, r.value]), [['Baseline', 189]]);
assert.deepStrictEqual(mig.items[0].presets, []);

// Running costs/uses count immediately; only capex waits for Include
const d2 = R.emptyData();
const meals = R.addItem(d2, 'Meals', [], 'track', [{ name: 'Konbini', value: 550 }, { name: 'Restaurant', value: 1200 }]);
R.addCost(meals, { amount: 3000, kind: 'running', date: '2026-11-01' });
R.addUse(meals, { value: 550, qty: 4, date: '2026-11-02', refName: 'Konbini' });
R.addUse(meals, { value: 1200, qty: 2, date: '2026-11-05', refName: 'Restaurant' });
c = R.calc(meals);
assert.strictEqual(c.track.rate, 500);                                     // 3000 / 6, no button needed
assert.strictEqual(c.track.saved, 1600); assert.strictEqual(R.totals(d2).net, 1600);
assert(Math.abs(c.track.avgRef - 4600 / 6) < 1e-9);
// A second shop counts right away: the rate jumps, then eases as meals are logged
R.addCost(meals, { amount: 2400, kind: 'running', date: '2026-11-07' });
assert.strictEqual(R.calc(meals).track.rate, 5400 / 6);                    // 900
R.addUse(meals, { value: 550, qty: 3, date: '2026-11-08' });
assert.strictEqual(R.calc(meals).track.rate, 5400 / 9);                    // 600
// Capex is pending until Include; cost side only; preview shows the effect
R.addCost(meals, { amount: 900, kind: 'capex', date: '2026-11-08' });
c = R.calc(meals);
assert.strictEqual(c.track.rate, 600); assert.strictEqual(c.track.pendingCapex, 900);
assert.strictEqual(c.track.canIncludeCapex, true); assert.strictEqual(c.track.canUndo, false);
assert(Math.abs(c.track.capexPreview - 6300 / 9) < 1e-9);                  // 700
assert.strictEqual(c.settledNet, c.track.value - 5400);                    // pending capex not in totals
assert.strictEqual(R.settleCapex(meals), 1);
c = R.calc(meals);
assert.strictEqual(c.track.countedCapex, 900); assert.strictEqual(c.track.rate, 700);
assert.strictEqual(c.track.canIncludeCapex, false); assert.strictEqual(c.track.canUndo, true);
assert.strictEqual(R.settleCapex(meals), 0);                               // nothing pending: no-op
// Undo reverts the include; a second undo has nothing left
assert.strictEqual(R.undoSettle(meals), true);
c = R.calc(meals); assert.strictEqual(c.track.rate, 600); assert.strictEqual(c.track.pendingCapex, 900);
assert.strictEqual(R.undoSettle(meals), false);
// Uses but no costs: no rate (not a misleading 0/use)
const bare = R.addItem(d2, 'Bare', [], 'track', [{ name: 'Baseline', value: 100 }]);
R.addUse(bare, { value: 100, qty: 2 });
assert.strictEqual(R.calc(bare).track.rate, null); assert.strictEqual(R.calc(bare).count, 2);
assert.strictEqual(R.calc(bare).track.uses, 2);
// Round-trip with refName
const st2 = mem(); R.save(d2, st2);
assert.strictEqual(R.load(st2).data.items[0].uses[0].refName, 'Konbini');

// Include state survives save/load
const stI = mem(); R.save(d2, stI);
const lm = R.load(stI).data.items.find(i => i.name === 'Meals');
assert.deepStrictEqual(lm.settles, meals.settles); assert.strictEqual(lm.settleSeq, meals.settleSeq);
assert.deepStrictEqual(lm.costs.map(x => x.settleId), meals.costs.map(x => x.settleId));
// Old data (no settle fields): running/uses count, capex pending
const oldT = R.validate({ version: 1, items: [{ id: 't', name: 'T', mode: 'track', references: [{ id: 'r', name: 'A', value: 100 }], costs: [{ id: 'c', date: '2026-01-01', amount: 500, kind: 'running' }], uses: [{ id: 'u', date: '2026-01-02', value: 100, qty: 2 }] }] });
assert.strictEqual(R.calc(oldT.items[0]).track.uses, 2); assert.strictEqual(R.calc(oldT.items[0]).track.rate, 250);

// References parsing
assert.deepStrictEqual(R.parseReferences('Konbini 550, Restaurant 1200'), [{ name: 'Konbini', value: 550 }, { name: 'Restaurant', value: 1200 }]);
assert.deepStrictEqual(R.parseReferences('189'), [{ name: 'Baseline', value: 189 }]);
assert.deepStrictEqual(R.parseReferences('Cafe: \u00a5189'), [{ name: 'Cafe', value: 189 }]);
assert.deepStrictEqual(R.parseReferences('Konbini 550\nRestaurant 1200.5'), [{ name: 'Konbini', value: 550 }, { name: 'Restaurant', value: 1200.5 }]);
assert.deepStrictEqual(R.parseReferences(''), []);
assert.strictEqual(R.parseReferences('abc'), null);
assert.strictEqual(R.parseReferences('Konbini 550, oops'), null);
const idBefore = meals.references[0].id;
R.setReferences(meals, [{ name: 'Konbini', value: 600 }, { name: 'Deli', value: 900 }]);
assert.strictEqual(meals.references[0].id, idBefore); assert.strictEqual(meals.references[0].value, 600);
assert.strictEqual(R.refsToText(meals.references), 'Konbini 600, Deli 900');

// Presets parsing
assert.deepStrictEqual(R.parsePresets('170, 250'), [170, 250]);
assert.deepStrictEqual(R.parsePresets(''), []);
assert.strictEqual(R.parsePresets('170, abc'), null);

// today() is local, not UTC
assert.strictEqual(R.today(new Date(2026, 10, 7, 0, 30)), '2026-11-07');

// Feedback notes
const fst = mem();
assert.deepStrictEqual(R.loadFeedback(fst), []);
let fl = [];
assert.strictEqual(R.addNote(fl, '   ', 'idea'), null);
R.addNote(fl, 'Add monthly total', 'idea');
R.addNote(fl, 'Line one\nline two', 'bug');
assert.strictEqual(fl.length, 2); assert.strictEqual(fl[1].kind, 'bug');
assert.strictEqual(R.saveFeedback(fl, fst), null);
assert.deepStrictEqual(R.loadFeedback(fst), fl);
const out = R.formatFeedback(fl);
assert(out.startsWith('# ROI Tracker feedback (') && out.includes('[idea]') && out.includes('Line one\n  line two'));
assert.strictEqual(R.formatFeedback([]), '');
fst.setItem(R.FKEY, '{bad'); assert.deepStrictEqual(R.loadFeedback(fst), []);
fst.setItem(R.FKEY, JSON.stringify([{ id: 'x', text: 'ok', date: '2026-01-01', kind: 'idea' }, { id: 'y', text: '', date: '2026-01-01', kind: 'idea' }, { id: 'z', text: 't', date: 'bad', kind: 'idea' }]));
assert.strictEqual(R.loadFeedback(fst).length, 1);
// Feedback is independent of main data
assert.notStrictEqual(R.FKEY, R.KEY);

console.log('all core tests passed');
