// v1.17 Insights: gap-filling of daily series and the plain-English sentences. No database needed.
const assert = require('assert');
const { fillDays, buildSays, change, pct, hour12, naira, dayKey, DAY } = require('../src/services/insights.service');
const A = require('../src/utils/adminAccess');

const NOW = Date.UTC(2026, 10, 21, 12);
// fillDays: right length, oldest first, today last, gaps are zero
const rows = [{ _id: dayKey(NOW), n: 4 }, { _id: dayKey(NOW - 2 * DAY), n: 1 }, { _id: '1999-01-01', n: 99 }];
const f = fillDays(rows, 5, NOW);
assert.strictEqual(f.length, 5);
assert.deepStrictEqual(f.map(x => x.value), [0, 0, 1, 0, 4]);
assert.strictEqual(f[4].day, dayKey(NOW));
assert.strictEqual(new Set(f.map(x => x.day)).size, 5);
assert.deepStrictEqual(fillDays([], 3, NOW).map(x => x.value), [0, 0, 0]);
assert.strictEqual(fillDays([{ _id: dayKey(NOW), avg: 7.5 }], 1, NOW, 'avg')[0].value, 7.5);
// helpers
assert.strictEqual(change(120, 100), 20); assert.strictEqual(change(80, 100), -20); assert.strictEqual(change(5, 0), null);
assert.strictEqual(pct(1, 4), 25); assert.strictEqual(pct(1, 0), null);
assert.strictEqual(hour12(0), '12 AM'); assert.strictEqual(hour12(12), '12 PM'); assert.strictEqual(hour12(21), '9 PM');
assert.strictEqual(naira(1234.6), '₦1,235');

const base = { total: 200, dau: 20, mau: 80, signups7: 30, signupsPrev7: 20, cohort: { size: 50, active: 30 }, funnel: { signedUp: 200, picked: 180, tried: 60, regular: 40, premium: 12 },
  premium: { count: 12, expiring7: 3 }, revenue: { cur: 50000, prev: 40000 }, quiz: { count: 300, passRate: 62 }, peakHour: 21, hardest: { course: 'CHM101', accuracy: 38 }, easiest: { course: 'GST101', accuracy: 81 } };
const says = buildSays(base), text = says.map(s => s.text).join('\n');
assert.ok(says.every(s => ['good', 'warn', 'bad', 'info'].includes(s.tone) && s.text.length > 10));
assert.match(text, /30 students joined this week, up 50%/);
assert.match(text, /Out of every 10 students .* 3 used it today/);
assert.match(text, /60% were still active/);
assert.match(text, /Biggest drop-off: 67% .* never take even one quiz/);          // 180 → 60 is the worst step
assert.match(text, /3 Premium plans end within 7 days/);
assert.match(text, /₦50,000 confirmed .* up 25%/);
assert.match(text, /9 PM/);
assert.match(text, /CHM101 \(38% correct\)/);
assert.strictEqual(says.find(s => /joined this week/.test(s.text)).tone, 'good');
// warnings and edge cases
const down = buildSays({ ...base, signups7: 10, signupsPrev7: 20, revenue: { cur: 1000, prev: 4000 }, dau: 2 });
assert.strictEqual(down.find(s => /joined this week/.test(s.text)).tone, 'warn');
assert.match(down.map(s => s.text).join(' '), /down 75%/);
assert.strictEqual(down.find(s => /used it today/.test(s.text)).tone, 'warn');
const empty = buildSays({ total: 0, dau: 0, mau: 0, signups7: 0, signupsPrev7: 0, cohort: { size: 0, active: 0 }, funnel: { signedUp: 0, picked: 0, tried: 0, regular: 0, premium: 0 }, premium: { count: 0, expiring7: 0 }, revenue: { cur: 0, prev: 0 }, quiz: { count: 0, passRate: null }, peakHour: null, hardest: null, easiest: null });
assert.ok(empty.length >= 1 && empty.every(s => !/NaN|undefined|Infinity/.test(s.text)), 'no NaN on an empty platform');
assert.match(buildSays({ ...base, signupsPrev7: 0 }).map(s => s.text).join(' '), /none the week before/);
assert.strictEqual(buildSays({ ...base, premium: { count: 1, expiring7: 0 }, total: 200 }).some(s => /end within/.test(s.text)), false);
assert.match(buildSays({ ...base, premium: { count: 1, expiring7: 1 } }).map(s => s.text).join(' '), /1 Premium plan ends within/);
// permission: insights needs Analytics, view-only is enough
assert.ok(A.checkAccess({ full: false, permissions: ['analytics:view'], owner: false }, 'GET', '/insights/overview'));
assert.ok(!A.checkAccess({ full: false, permissions: ['bulk'], owner: false }, 'GET', '/insights/overview'));
console.log('insights checks passed');
