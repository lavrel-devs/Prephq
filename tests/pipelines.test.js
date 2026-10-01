// Runs the routes' MongoDB aggregation pipelines through an in-memory engine (mingo).
// Runs the exact aggregation pipelines from the routes through mingo (an in-memory MongoDB aggregation engine).
const assert = require('assert');
let Aggregator; try { ({ Aggregator } = require('mingo')); } catch (e) { console.log('skipped: run `npm install` (dev dependency mingo) to check the aggregation pipelines'); process.exit(0); }
const run = (pipe, data) => new Aggregator(pipe).run(data);
const t = (d, h = 0) => new Date(Date.UTC(2026, 8, d, h));
const attempts = [
  { matric: 'A1', course: 'chm141', qid: 'q1', correct: false, ts: t(1) },
  { matric: 'A1', course: 'chm141', qid: 'q1', correct: true,  ts: t(5) },  // fixed later -> not missed
  { matric: 'A1', course: 'chm141', qid: 'q2', correct: true,  ts: t(2) },
  { matric: 'A1', course: 'chm141', qid: 'q2', correct: false, ts: t(6) },  // regressed -> missed
  { matric: 'A1', course: 'mth101', qid: 'q3', correct: false, ts: t(7) },  // missed, other course
  { matric: 'A1', course: 'mth101', qid: null, correct: false, ts: t(8) },  // AI quiz, ignored
  { matric: 'B2', course: 'chm141', qid: 'q9', correct: false, ts: t(9) },  // another student
];
const missed = (extra = {}) => run([
  { $match: { matric: 'A1', qid: { $ne: null }, ...extra } },
  { $sort: { ts: -1 } },
  { $group: { _id: '$qid', correct: { $first: '$correct' }, ts: { $first: '$ts' } } },
  { $match: { correct: false } }, { $sort: { ts: -1 } }, { $limit: 30 },
], attempts).map(r => r._id);
assert.deepStrictEqual(missed(), ['q3', 'q2']);
assert.deepStrictEqual(missed({ course: 'chm141' }), ['q2']);
// quality pipeline
const q = run([{ $match: { qid: { $ne: null } } }, { $group: { _id: '$qid', attempts: { $sum: 1 }, correct: { $sum: { $cond: ['$correct', 1, 0] } } } }], attempts);
const byId = Object.fromEntries(q.map(r => [r._id, r]));
assert.deepStrictEqual([byId.q1.attempts, byId.q1.correct, byId.q2.attempts, byId.q2.correct], [2, 1, 2, 1]);
// batches pipeline
const qs = [
  { batchId: 'b_1', course: 'chm141', createdBy: 'ada', createdAt: t(3) }, { batchId: 'b_1', course: 'mth101', createdBy: 'ada', createdAt: t(3, 1) },
  { batchId: 'b_2', course: 'chm141', createdBy: 'bo', createdAt: t(4) }, { batchId: '', course: 'chm141', createdBy: 'x', createdAt: t(1) },
];
const b = run([{ $match: { batchId: { $ne: '' } } }, { $group: { _id: '$batchId', count: { $sum: 1 }, courses: { $addToSet: '$course' }, by: { $first: '$createdBy' }, at: { $min: '$createdAt' } } }, { $sort: { at: -1 } }, { $limit: 30 }], qs);
assert.deepStrictEqual(b.map(r => [r._id, r.count]), [['b_2', 1], ['b_1', 2]]);
console.log('aggregation pipelines verified');
