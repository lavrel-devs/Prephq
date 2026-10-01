// Bulk-upload planning, duplicate detection and question-quality ranking.
const assert = require('assert');
const { stemKey, dupeKey, planBulk, rankQuality } = require('../src/services/questionBank.service.js');
assert.strictEqual(stemKey('What is  the Value of π?'), stemKey('what is the value of π'));
assert.notStrictEqual(stemKey('2 + 3'), stemKey('2 + 4'));
const courses = new Set(['chm141', 'mth101']);
const existing = new Set([dupeKey('chm141', 'Existing question?')]);
const mk = (o = {}) => ({ course: 'CHM 141', q: 'A new q', opts: ['a', 'b', 'c', 'd'], ans: 1, ...o });
const { accepted, rejected } = planBulk([
  mk(), mk(),                                   // 2nd is an in-batch duplicate
  mk({ q: 'existing   question' }),             // duplicate of the bank
  mk({ course: 'PHY 999' }),                    // unknown course
  mk({ q: 'x', ans: 9 }),                       // bad answer index
  mk({ q: 'y', opts: ['only one'] }),           // too few options
  mk({ q: '   ' }),                             // empty
  mk({ q: 'Other course', course: 'mth101' }),  // same-ish text is fine in another course
  mk({ q: 'String ans', ans: '2' }),            // numeric string accepted
  null,
], courses, existing);
assert.deepStrictEqual(accepted.map(a => a.course + ':' + a.q), ['chm141:A new q', 'mth101:Other course', 'chm141:String ans']);
assert.strictEqual(accepted[2].ans, 2);
assert.deepStrictEqual(rejected.map(r => r.index), [1, 2, 3, 4, 5, 6, 9]);
assert.ok(/Duplicate/.test(rejected[0].reason) && /Unknown course/.test(rejected[2].reason));
const ranked = rankQuality([{ _id: 'a', attempts: 40, correct: 8 }, { _id: 'b', attempts: 3, correct: 0 }, { _id: 'c', attempts: 20, correct: 19 }, { _id: 'd', attempts: 2, correct: 2 }], new Map([['d', 3]]));
assert.deepStrictEqual(ranked.map(r => r._id), ['d', 'a', 'c']);   // reported first, then lowest accuracy; 'b' has too few attempts
console.log('questionBank tests passed');
