// Public invite preview (v1.7.5): what a signed-out person sees when they open a shared-quiz or challenge link.
const assert = require('assert'), path = require('path'), http = require('http');
const abs = p => require.resolve(path.join(__dirname, '..', 'src', p));
const GeneratedQuestion = require(abs('models/GeneratedQuestion.js')), Challenge = require(abs('models/Challenge.js'));
const Student = require(abs('models/Student.js')), Settings = require(abs('models/Settings.js'));

const q = v => ({ select() { return this; }, lean() { return this; }, then: (a, b) => Promise.resolve(v).then(a, b) });
const quiz = { _id: 'q1', matric: 'OWNER1', course: 'CHM101', shareToken: 'SHAREtoken12',
  questions: Array.from({ length: 10 }, (_, i) => ({ q: `SECRET-Q${i}`, opts: ['a', 'b'], ans: 1 })) };
const students = { OWNER1: { name: 'Ada Obi', username: 'ada', referralCode: 'AB12CD3' }, NOREF: { name: 'Tunde Bello' } };
let owner = 'OWNER1', referral = { enabled: true, refereeBonus: 10 };
GeneratedQuestion.findOne = f => q(f.shareToken === quiz.shareToken ? { ...quiz, matric: owner } : null);
GeneratedQuestion.findById = id => q(id === 'q1' ? { ...quiz, matric: owner } : null);
Challenge.findOne = f => q(f.token === 'CHALLtoken123' ? { token: f.token, quizId: 'q1', owner, correct: 8, total: 10 } : null);
Student.findOne = f => q(students[f.matric] || null);
Settings.getGlobal = async () => ({ referral });

const express = require('express'); const app = express();
app.use('/api', require(abs('routes/invite.routes.js')));   // NOTE: no auth middleware — it must work signed out

(async () => {
  const server = http.createServer(app).listen(0); const base = `http://127.0.0.1:${server.address().port}/api/invite`;
  const get = async u => { const r = await fetch(base + u); return { status: r.status, body: await r.json() }; };
  try {
    const a = await get('/q/SHAREtoken12');
    assert.strictEqual(a.status, 200);
    assert.deepStrictEqual(a.body, { kind: 'q', by: '@ada', course: 'CHM101', questions: 10, score: null, ref: 'AB12CD3', bonus: 10 });

    const c = await get('/c/CHALLtoken123');
    assert.strictEqual(c.status, 200); assert.deepStrictEqual(c.body.score, { correct: 8, total: 10, pct: 80 }); assert.strictEqual(c.body.ref, 'AB12CD3');

    // nothing sensitive: no matric, no questions or answers
    const raw = JSON.stringify([a.body, c.body]);
    assert.ok(!raw.includes('OWNER1') && !raw.includes('SECRET-Q') && !/"ans"/.test(raw), 'invite must not leak matric, questions or answers');

    // sender without a username falls back to first name; without a referral code, no ref; referral off = no bonus
    owner = 'NOREF'; referral = { enabled: false, refereeBonus: 10 };
    const n = await get('/q/SHAREtoken12');
    assert.strictEqual(n.body.by, 'Tunde'); assert.strictEqual(n.body.ref, null); assert.strictEqual(n.body.bonus, 0);

    // bad / unknown / wrong-kind links are a clean 404
    for (const u of ['/q/nope', '/c/nope', '/x/SHAREtoken12', '/q/UNKNOWNtoken1', '/q/bad*token!!!']) assert.strictEqual((await get(u)).status, 404, u);
    console.log('public invite preview OK');
  } finally { server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
