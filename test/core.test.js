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
// single purchase = still an open batch: no per-meal rate yet, and it does not count toward totals
assert.strictEqual(c.track.rate, null); assert.strictEqual(c.track.hasOpen, true);
assert.strictEqual(c.track.openMeals, 10); assert.strictEqual(c.track.openCost, 1500);
assert.strictEqual(c.settledNet, 0);
assert.strictEqual(c.net, 1890 - 1500);
assert.strictEqual(c.brokeEven, true);

// Empty item
const e = R.addItem(d, 'Empty', []);
c = R.calc(e);
assert.strictEqual(c.net, 0); assert.strictEqual(c.progress, null); assert.strictEqual(c.avgValue, null);

// Totals
assert.strictEqual(R.totals(d).net, (920 - 46200) + 0);

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

// Batch costing: groceries 3000 (11-01), 6 meals, groceries 2400 (11-07), 3 meals in progress
const d2 = R.emptyData();
const meals = R.addItem(d2, 'Meals', [], 'track', [{ name: 'Konbini', value: 550 }, { name: 'Restaurant', value: 1200 }]);
R.addCost(meals, { amount: 3000, kind: 'running', date: '2026-11-01' });
R.addCost(meals, { amount: 50000, kind: 'capex', date: '2026-11-01' });
R.addUse(meals, { value: 550, qty: 4, date: '2026-11-02', refName: 'Konbini' });
R.addUse(meals, { value: 1200, qty: 2, date: '2026-11-05', refName: 'Restaurant' });
R.addUse(meals, { value: 550, qty: 1, date: '2026-10-30' });            // before first purchase
R.addCost(meals, { amount: 2400, kind: 'running', date: '2026-11-07' });
R.addCost(meals, { amount: 100, kind: 'running', date: '2026-11-07' });   // same-day purchases merge
R.addUse(meals, { value: 550, qty: 3, date: '2026-11-08' });
c = R.calc(meals);
assert.strictEqual(c.track.closedBatches, 1);
assert.strictEqual(c.track.closedMeals, 6); assert.strictEqual(c.track.closedCost, 3000);
assert.strictEqual(c.track.rate, 500);
assert.strictEqual(c.track.closedValue, 4 * 550 + 2 * 1200);
assert(Math.abs(c.track.avgRef - 4600 / 6) < 1e-9);
assert.strictEqual(c.track.savedClosed, 1600);
assert.strictEqual(c.track.openCost, 2500); assert.strictEqual(c.track.openMeals, 3); assert.strictEqual(c.track.openSince, '2026-11-07');
assert.strictEqual(c.track.unassigned, 1);
assert.strictEqual(c.settledNet, 4600 - 3000 - 50000);                    // capex counted, open batch not
assert.strictEqual(R.totals(d2).net, 4600 - 3000 - 50000);
// No purchases at all: meals counted, no batches
const bare = R.addItem(d2, 'Bare', [], 'track', [{ name: 'Baseline', value: 100 }]);
R.addUse(bare, { value: 100, qty: 2 });
assert.strictEqual(R.calc(bare).track.hasOpen, false); assert.strictEqual(R.calc(bare).track.rate, null); assert.strictEqual(R.calc(bare).count, 2);
// Round-trip with refName
const st2 = mem(); R.save(d2, st2);
assert.strictEqual(R.load(st2).data.items[0].uses[0].refName, 'Konbini');

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
