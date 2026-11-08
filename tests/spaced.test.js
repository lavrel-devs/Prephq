const assert = require('assert');
const { reviewState } = require('../src/utils/spaced');
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0), D = 86400000;
const at = days => new Date(NOW - days * D);

assert.deepStrictEqual(reviewState([]).missed, false, 'no history is not missed');
assert.strictEqual(reviewState([{ correct: true, ts: at(1) }, { correct: false, ts: at(5) }], NOW).missed, false, 'answered right since: cleared');

let r = reviewState([{ correct: false, ts: at(0.5) }], NOW);
assert.ok(r.missed && !r.due, 'first miss 12h ago is not due yet (wait 1 day)');
r = reviewState([{ correct: false, ts: at(1.1) }], NOW);
assert.ok(r.due, 'first miss over a day ago is due');

r = reviewState([{ correct: false, ts: at(2) }, { correct: false, ts: at(4) }], NOW);
assert.ok(r.missed && !r.due, 'second consecutive miss waits 3 days: 2 days is too soon');
r = reviewState([{ correct: false, ts: at(3.2) }, { correct: false, ts: at(6) }], NOW);
assert.ok(r.due, 'second consecutive miss is due after 3 days');

r = reviewState([{ correct: false, ts: at(6) }, { correct: false, ts: at(9) }, { correct: false, ts: at(12) }], NOW);
assert.ok(!r.due, 'third consecutive miss waits 7 days: 6 is too soon');
r = reviewState([{ correct: false, ts: at(8) }, { correct: false, ts: at(9) }, { correct: false, ts: at(12) }, { correct: false, ts: at(13) }], NOW);
assert.ok(r.due, 'a long run of misses is still capped at 7 days');

r = reviewState([{ correct: false, ts: at(1.5) }, { correct: true, ts: at(3) }, { correct: false, ts: at(4) }], NOW);
assert.strictEqual(r.streak, 1, 'only the consecutive misses at the front count');
console.log('spaced review: 1/3/7-day schedule, clears on a correct answer, caps at 7');
