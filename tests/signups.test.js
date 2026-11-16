const assert = require('assert');
const { dayKeyInTimezone, zeroFillDailyCounts } = require('../src/utils/dailySeries');

assert.strictEqual(dayKeyInTimezone(new Date('2026-11-15T23:30:00.000Z')), '2026-11-16');
assert.deepStrictEqual(
  zeroFillDailyCounts([
    { date: '2026-11-13', count: 2 },
    { date: '2026-11-11', count: 3 },
  ], '2026-11-10', '2026-11-14'),
  [
    { date: '2026-11-10', count: 0 },
    { date: '2026-11-11', count: 3 },
    { date: '2026-11-12', count: 0 },
    { date: '2026-11-13', count: 2 },
    { date: '2026-11-14', count: 0 },
  ],
);
assert.deepStrictEqual(
  zeroFillDailyCounts([], '2026-11-10', '2026-11-12'),
  [
    { date: '2026-11-10', count: 0 },
    { date: '2026-11-11', count: 0 },
    { date: '2026-11-12', count: 0 },
  ],
);
assert.deepStrictEqual(zeroFillDailyCounts([], '2026-11-12', '2026-11-10'), []);
assert.throws(() => zeroFillDailyCounts([], '2026-02-30', '2026-03-01'), /valid YYYY-MM-DD/);
console.log('signup series: zero days are explicit and dates align to Africa/Lagos');
