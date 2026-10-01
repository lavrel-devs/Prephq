// Per-course question counts: matching rules, 60s cache, single-flight, invalidation.
const assert = require('assert');
let Aggregator = null; try { ({ Aggregator } = require('mingo')); } catch (e) { /* optional dev dependency */ }
const S = require('../src/services/questionBank.service.js');

// 1) mapping rules — same matching as GET /questions/:course (case-insensitive key or courseCode)
const stored = ['chm141','CHM141','Chm141','CHM 141','mth101','MTH101','gst101',null,'phy999'];   // mixed-case legacy data
const qs = stored.map(course => ({ course }));
const rows = Aggregator
  ? new Aggregator([{ $group: { _id: { $toLower: '$course' }, n: { $sum: 1 } } }]).run(qs)
  : Object.entries(qs.reduce((m, q) => { const k = String(q.course || '').toLowerCase(); m[k] = (m[k] || 0) + 1; return m; }, {})).map(([_id, n]) => ({ _id, n }));
const courses = [{ key:'chm141', courseCode:'CHM141' }, { key:'mth101', courseCode:'MTH 101' }, { key:'gst101', courseCode:'GST101' }, { key:'eng101', courseCode:'ENG101' }];
const c = S.countsForCourses(rows, courses);
assert.deepStrictEqual(c, { chm141: 3, mth101: 2, gst101: 1, eng101: 0 });   // 'CHM 141' (with a space) never matched before either
// key === courseCode (lower) must not double count
assert.strictEqual(S.countsForCourses([{ _id:'abc', n:5 }], [{ key:'abc', courseCode:'ABC' }]).abc, 5);
// key differs from code and both exist in data -> summed (the old regex OR matched both)
assert.strictEqual(S.countsForCourses([{ _id:'chm141', n:2 }, { _id:'chm 141', n:4 }], [{ key:'chm141', courseCode:'CHM 141' }]).chm141, 6);

// 2) cache: one scan for a burst, TTL, invalidation, error not cached
(async () => {
  let scans = 0, fail = false;
  const Q = { aggregate: async () => { scans++; await new Promise(r => setTimeout(r, 30)); if (fail) throw new Error('db down'); return [{ _id:'chm141', n: 7 }]; } };
  const C = { find: () => ({ select: () => ({ lean: async () => [{ key:'chm141', courseCode:'CHM141' }] }) }) };
  const burst = await Promise.all(Array.from({ length: 25 }, () => S.getCourseCounts(Q, C)));
  assert.strictEqual(scans, 1); assert.ok(burst.every(b => b.chm141 === 7));                 // 25 students -> 1 scan
  await S.getCourseCounts(Q, C); assert.strictEqual(scans, 1);                               // cached
  S.invalidateCounts(); await S.getCourseCounts(Q, C); assert.strictEqual(scans, 2);         // admin change refreshes
  await S.getCourseCounts(Q, C, 0); assert.strictEqual(scans, 3);                            // ttl 0 -> always fresh
  S.invalidateCounts(); fail = true;
  await assert.rejects(S.getCourseCounts(Q, C), /db down/);
  fail = false; assert.strictEqual((await S.getCourseCounts(Q, C)).chm141, 7);               // failure wasn't cached, recovers
  console.log('counts tests passed');
})();
