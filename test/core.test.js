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
assert.strictEqual(c.runningPerUse, null);

// Coffee: beans 1500 yen, 10 brews at 189 baseline
const coffee = R.addItem(d, 'Coffee', [], 'track', 189);
assert.strictEqual(coffee.mode, 'track'); assert.deepStrictEqual(coffee.presets, [189]);
assert.strictEqual(bike.mode, 'roi'); assert.strictEqual(bike.baseline, null);
R.addCost(coffee, { amount: 1500, kind: 'running' });
for (let i = 0; i < 10; i++) R.addUse(coffee, { value: 189 });
c = R.calc(coffee);
assert.strictEqual(c.runningPerUse, 150);
assert.strictEqual(c.vsBaseline, 39);
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
assert.strictEqual(legacy.items[0].mode, 'roi'); assert.strictEqual(legacy.items[1].mode, 'roi'); assert.strictEqual(legacy.items[1].baseline, null);

// Presets parsing
assert.deepStrictEqual(R.parsePresets('170, 250'), [170, 250]);
assert.deepStrictEqual(R.parsePresets(''), []);
assert.strictEqual(R.parsePresets('170, abc'), null);

// today() is local, not UTC
assert.strictEqual(R.today(new Date(2026, 10, 7, 0, 30)), '2026-11-07');

console.log('all core tests passed');
