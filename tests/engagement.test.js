// Real engagement report (v1.7.8): students count only when they ANSWERED QUESTIONS; weekly actives, come-back
// rate, free-cap hits and the exclusion list. Pure functions + the aggregation stage run through mingo.
const assert = require('assert'), path = require('path');
const { buildReport, weekStart } = require(path.join(__dirname, '..', 'src', 'services', 'engagement.service.js'));

assert.strictEqual(weekStart('2026-10-11'), '2026-10-05');   // Sunday -> that week's Monday
assert.strictEqual(weekStart('2026-10-05'), '2026-10-05');
assert.strictEqual(weekStart('2026-10-06'), '2026-10-05');

const now = new Date('2026-10-14T10:00:00Z');                 // a Wednesday
const premium = { tier: 'premium', premiumPlan: 'monthly', tierExpiresAt: new Date('2026-12-01') };
const st = (m, o = {}) => ({ matric: m, tier: 'free', profileCompleted: true, selectedCourses: ['chm101'], ...o });
const students = [st('A'), st('B'), st('C'), st('D', { profileCompleted: false, selectedCourses: [] }), st('E', premium), st('F')];
// A: studies on 3 days across two weeks (came back).  B: one day only.  C: weeks 1 then 3 (came back).  E: premium, heavy.  D,F never studied.
const rows = [
  { matric: 'A', day: '2026-09-28', n: 15 }, { matric: 'A', day: '2026-09-29', n: 4 }, { matric: 'A', day: '2026-10-06', n: 20 },
  { matric: 'B', day: '2026-09-29', n: 15 },
  { matric: 'C', day: '2026-09-30', n: 5 }, { matric: 'C', day: '2026-10-13', n: 6 },
  { matric: 'E', day: '2026-10-12', n: 60 }, { matric: 'E', day: '2026-10-13', n: 50 },
  { matric: 'GHOST', day: '2026-10-12', n: 99 },               // attempts by an account that isn't in the student list (deleted/excluded) must not count
];
const r = buildReport({ rows, students, freeCap: 15, weeks: 4, now });

assert.deepStrictEqual(r.funnel, { registered: 6, profileDone: 5, hasCourses: 5, studied: 4, studied3Days: 1, studied7Days: 0, studiedOneDayOnly: 1 });
assert.deepStrictEqual(r.weekly.map(w => [w.week, w.active]), [['2026-09-21', 0], ['2026-09-28', 3], ['2026-10-05', 1], ['2026-10-12', 2]]);
assert.strictEqual(r.weekly[3].partial, true, 'the running week is flagged');
assert.strictEqual(r.weekly[1].pct, 50);                     // 3 of 6 registered
// first-study-week cohort 09-28: A, B, C -> A and C studied again in a later week
assert.deepStrictEqual(r.cohorts, [{ week: '2026-09-28', newStudiers: 3, cameBack: 2, pct: 67 }]);
// free student-days >= 15 in the last 30 days: A(15) A(20) B(15) hit; A(4) C(5) C(6) don't; premium E excluded
assert.deepStrictEqual(r.freeCap, { cap: 15, studentDays: 6, hit: 3, pct: 50 });
assert.strictEqual(r.concentration.attempts, 15 + 4 + 20 + 15 + 5 + 6 + 60 + 50);
assert.strictEqual(r.concentration.top1Pct, Math.round((110 / 175) * 100));

// the mongo group stage the route uses, run in memory: attempts -> (matric, WAT day, n)
let Aggregator; try { ({ Aggregator } = require('mingo')); } catch (e) { Aggregator = null; }
if (Aggregator) {
  const at = (m, iso) => ({ matric: m, ts: new Date(iso) });
  const out = new Aggregator([
    { $group: { _id: { matric: '$matric', day: { $dateToString: { format: '%Y-%m-%d', date: '$ts', timezone: 'Africa/Lagos' } } }, n: { $sum: 1 } } },
    { $project: { _id: 0, matric: '$_id.matric', day: '$_id.day', n: 1 } },
  ]).run([at('A', '2026-10-05T23:30:00Z'), at('A', '2026-10-06T08:00:00Z'), at('B', '2026-10-05T10:00:00Z')]);
  const key = Object.fromEntries(out.map(o => [`${o.matric}|${o.day}`, o.n]));
  assert.deepStrictEqual(key, { 'A|2026-10-06': 2, 'B|2026-10-05': 1 }, '23:30 UTC is already the next day in Nigeria');
}
console.log('engagement report OK');
