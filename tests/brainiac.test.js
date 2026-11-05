// v1.8.3 Brainiac: which nudge shows, what it is allowed to remember, and how the prompt/mood are handled.
const assert = require('assert'), path = require('path');
const L = require(path.join(__dirname, '..', 'src', 'services', 'brainiac.logic.js'));

const base = { name: 'ADEBAYO JOHN', today: '2026-11-04', hour: 10, streak: { count: 0, last: null }, studiedToday: 0, daysAway: 0,
  acc7: null, accPrev: null, attempts7: 0, attemptsPrev: 0, weak: [], introduced: true };
const ids = (snap, recent) => L.buildPulse(snap, recent).map(n => n.id);

// first-name handling
assert.strictEqual(L.firstName('ADEBAYO JOHN'), 'Adebayo');
assert.strictEqual(L.firstName(''), 'friend');

// brand-new student gets the intro first, once
assert.strictEqual(L.buildPulse({ ...base, introduced: false })[0].id, 'welcome');
assert.ok(!ids(base).includes('welcome'));

// streak at risk: studied yesterday, nothing today, evening → loudest nudge, worried
const risk = L.buildPulse({ ...base, hour: 19, streak: { count: 5, last: '2026-11-03' } })[0];
assert.strictEqual(risk.id, 'streak-risk:2026-11-04'); assert.strictEqual(risk.mood, 'worried');
assert.ok(!ids({ ...base, hour: 10, streak: { count: 5, last: '2026-11-03' } }).some(i => i.startsWith('streak-risk')), 'not nagged in the morning');
assert.ok(!ids({ ...base, hour: 19, studiedToday: 12, streak: { count: 5, last: '2026-11-04' } }).some(i => i.startsWith('streak-risk')), 'already studied today');

// milestone celebrates only on the day the streak lands on it
const ms = L.buildPulse({ ...base, studiedToday: 20, streak: { count: 7, last: '2026-11-04' } })[0];
assert.strictEqual(ms.id, 'streak:7'); assert.strictEqual(ms.mood, 'celebrate');
assert.ok(!ids({ ...base, studiedToday: 20, streak: { count: 6, last: '2026-11-04' } }).some(i => i.startsWith('streak:')));

// comeback, weak topic with a drill action, accuracy up
assert.ok(ids({ ...base, daysAway: 9 }).includes('back:2026-11-04'));
const weak = { course: 'chm141', tag: 'Thermodynamics', acc: 0.42, n: 9 };
const w = L.buildPulse({ ...base, weak: [weak] }).find(n => n.id.startsWith('weak:'));
assert.strictEqual(w.cta.action, 'drill'); assert.strictEqual(w.cta.tag, 'Thermodynamics');
assert.ok(w.text.includes('42%'));
assert.ok(ids({ ...base, studiedToday: 5, attempts7: 40, attemptsPrev: 30, acc7: 78, accPrev: 60 }).includes('up:2026-11-04'));
assert.ok(!ids({ ...base, studiedToday: 5, attempts7: 40, attemptsPrev: 30, acc7: 64, accPrev: 60 }).includes('up:2026-11-04'), 'small change is not praised');

// late night → sleepy, and no daily "ready to study?" nag at that hour
const late = ids({ ...base, hour: 23 });
assert.ok(late.includes('sleep:2026-11-04')); assert.ok(!late.includes('daily:2026-11-04'));

// already-shown nudges are not repeated
assert.ok(!ids({ ...base, hour: 19, streak: { count: 5, last: '2026-11-03' } }, ['streak-risk:2026-11-04']).includes('streak-risk:2026-11-04'));
// best-first
const p = L.buildPulse({ ...base, hour: 19, daysAway: 1, weak: [weak], streak: { count: 5, last: '2026-11-03' } }).map(n => n.priority);
assert.deepStrictEqual(p, [...p].sort((a, b) => b - a));

// what Brainiac may remember
const kept = L.sanitizeFacts([
  'Studies best late at night', 'Writing CHM 141 on 12 Dec', 'Call me on 08031234567', 'email me at a@b.com',
  'Struggling with depression lately', 'Goes to church on Sundays', 'ok', 'studies best late at night', 'Prefers worked examples over theory',
], ['Prefers short explanations']);
assert.deepStrictEqual(kept, ['Studies best late at night', 'Writing CHM 141 on 12 Dec', 'Prefers worked examples over theory']);
assert.strictEqual(L.sanitizeFacts('not an array').length, 0);

// mood tag is peeled off, unknown moods fall back to happy
assert.deepStrictEqual(L.parseMood('[mood:proud] Nice work!'), { mood: 'proud', text: 'Nice work!' });
assert.deepStrictEqual(L.parseMood('[mood:angry] Hmm'), { mood: 'happy', text: 'Hmm' });
assert.deepStrictEqual(L.parseMood('No tag here'), { mood: 'happy', text: 'No tag here' });

// screen context is size-capped; prompt carries what it knows and the screen, and tells the model about the mood tag
const ctx = L.sanitizeContext({ screen: 'quiz', question: 'x'.repeat(5000), options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], wasCorrect: false, chosen: 'B', correct: 'C' });
assert.strictEqual(ctx.question.length, 700); assert.strictEqual(ctx.options.length, 6);
assert.strictEqual(L.sanitizeContext('junk'), null);
const sys = L.buildSystemPrompt({ snap: { ...base, weak: [weak], gpa: { current: 3.1, target: 4.0 } }, facts: ['Studies best at night'], ctx, sciFormat: 'SCI' });
assert.ok(sys.includes('Adebayo') && sys.includes('Thermodynamics') && sys.includes('Studies best at night') && sys.includes('[mood:happy]') && sys.includes('SCI'));
assert.ok(sys.includes('the right answer is C'));

// v1.8.6 guesses: Brainiac nudges about questions the student admitted guessing, and knows about them
assert.ok(ids({ ...base, guessN: 4 }).includes('guess:2026-11-04'));
assert.ok(!ids({ ...base, guessN: 2 }).includes('guess:2026-11-04'), 'two guesses is not worth a nudge');
const gn = L.buildPulse({ ...base, guessN: 4 }).find(n => n.id.startsWith('guess:'));
assert.strictEqual(gn.cta.action, 'guesses');
assert.ok(L.buildSystemPrompt({ snap: { ...base, guessN: 4, guessTags: ['Thermodynamics'] }, sciFormat: '' }).includes('guessing on 4'));
console.log('Brainiac logic OK');
