const assert = require('assert');
const Recovery = require('../public/js/attempt-recovery.js');

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const storage = new MemoryStorage();
const now = 1_800_000_000_000;
const quiz = { type: 'quiz', questions: [{ q: 'Q', opts: ['A', 'B'], ans: 1 }], answers: [0] };

assert.notStrictEqual(Recovery.keyFor('quiz', 'STUDENT-1'), Recovery.keyFor('quiz', 'STUDENT-2'), 'each signed-in student gets a separate recovery key');
assert.strictEqual(Recovery.keyFor('quiz', 'student-1'), Recovery.keyFor('quiz', ' STUDENT-1 '), 'matric casing and surrounding whitespace are normalized');
assert.ok(Recovery.write(storage, 'quiz', 'STUDENT-1', quiz, now));
assert.deepStrictEqual(Recovery.read(storage, 'quiz', 'STUDENT-1', now, r => r.type === 'quiz'), {
  ...quiz, version: 1, owner: Recovery.scopeFor('STUDENT-1'), updatedAt: now,
});
assert.strictEqual(Recovery.read(storage, 'quiz', 'STUDENT-2', now), null, 'one account cannot restore another account’s attempt');

const key = Recovery.keyFor('quiz', 'STUDENT-1');
assert.strictEqual(Recovery.read(storage, 'quiz', 'STUDENT-1', now + Recovery.MAX_AGE_MS + 1), null, 'stale records are rejected');
assert.strictEqual(storage.getItem(key), null, 'stale records are removed');

storage.setItem(key, '{bad json');
assert.strictEqual(Recovery.read(storage, 'quiz', 'STUDENT-1', now), null, 'corrupt records are ignored');
assert.strictEqual(storage.getItem(key), null, 'corrupt records are cleared');

Recovery.write(storage, 'written', 'STUDENT-1', {}, now);
assert.strictEqual(Recovery.read(storage, 'written', 'STUDENT-1', now, r => typeof r.examId === 'string'), null, 'application validation can reject malformed attempt data');
assert.strictEqual(storage.getItem(Recovery.keyFor('written', 'STUDENT-1')), null);

Recovery.write(storage, 'written', 'STUDENT-1', { examId: 'exam-2' }, now);
assert.strictEqual(Recovery.clear(storage, 'written', 'STUDENT-1'), true);
assert.strictEqual(Recovery.read(storage, 'written', 'STUDENT-1', now), null, 'completed or deliberately cleared attempts stay cleared');
console.log('attempt recovery: account isolation, expiry, validation, corrupt-state cleanup OK');
