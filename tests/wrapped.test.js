const assert = require('assert');
const { buildWrapped, dayKey } = require('../src/utils/wrapped');
const at = (iso, course, tag, correct) => ({ ts: iso, course, tag, correct });
assert.strictEqual(buildWrapped([]).answered, 0); assert.strictEqual(buildWrapped(null).longestStreak, 0);

// WAT day boundary: 23:30 UTC is already the next Nigerian day
assert.strictEqual(dayKey('2026-03-01T23:30:00Z'), '2026-03-02'); assert.strictEqual(dayKey('2026-03-01T10:00:00Z'), '2026-03-01');

const a = [];
['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-05', '2026-03-06'].forEach(d => { for (let i = 0; i < 3; i++) a.push(at(d + 'T10:0' + i + ':00Z', 'chm101', 'Acids', i < 2)); });
for (let i = 0; i < 8; i++) a.push(at('2026-03-06T12:0' + i + ':00Z', 'chm101', 'Bonding', true));
const w = buildWrapped(a);
assert.strictEqual(w.answered, 23); assert.strictEqual(w.correct, 10 + 8);
assert.strictEqual(w.activeDays, 5); assert.strictEqual(w.longestStreak, 3, 'Mar 1-3 is the longest run; the gap on the 4th breaks it');
assert.deepStrictEqual([w.bestDay.date, w.bestDay.answered], ['2026-03-06', 11]);
assert.strictEqual(w.topCourse.course, 'chm101');

// weak to strong: first half mostly wrong, second half mostly right
const g = [];
[0, 0, 0, 1, 1, 1, 1, 1].forEach((c, i) => g.push(at('2026-04-0' + (i + 1) + 'T09:00:00Z', 'chm102', 'Kinetics', !!c)));
const wi = buildWrapped(g).improved; assert.strictEqual(wi.length, 1); assert.deepStrictEqual([wi[0].tag, wi[0].from, wi[0].to], ['Kinetics', 25, 100]);
// a topic that was already strong, or has too few answers, is not "improved"
assert.strictEqual(buildWrapped(g.slice(3)).improved.length, 0, 'too few attempts, and already strong');
console.log('wrapped: totals, WAT days, longest streak, best day, weak-to-strong topics');
