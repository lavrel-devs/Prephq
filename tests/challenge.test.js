// "Challenge a friend" (v1.7.4): create a score-carrying link, the friend plays it (gated on THEIR daily limit),
// the result is compared and the sender is notified. In-memory: models are stubbed, no database or network.
const assert = require('assert'), path = require('path'), http = require('http');
const abs = p => require.resolve(path.join(__dirname, '..', 'src', p));
require.cache[abs('middleware/auth.js')] = { id: 'auth', filename: abs('middleware/auth.js'), loaded: true,
  exports: { requireStudent: (req, res, next) => { req.student = { sub: String(req.headers['x-matric'] || '').toUpperCase() }; next(); } } };

const GeneratedQuestion = require(abs('models/GeneratedQuestion.js')), Challenge = require(abs('models/Challenge.js'));
const Student = require(abs('models/Student.js')), Settings = require(abs('models/Settings.js')), Notification = require(abs('models/Notification.js'));
const { watDateString } = require(abs('services/credit.service.js'));

const hex = c => c.repeat(24);
const quizzes = [{ _id: hex('a'), matric: 'OWNER1', course: 'CHM101', difficulty: 'medium', shareOpens: 0,
  questions: Array.from({ length: 10 }, (_, i) => ({ q: `Q${i}`, opts: ['a', 'b'], ans: 0, exp: '', tag: 't', course: 'CHM101' })) }];
const today = watDateString();
const mk = (m, extra = {}) => ({ matric: m, name: m, tier: 'free', premiumPlan: null, tierExpiresAt: null, dailyQuestionDate: today, dailyQuestionCount: 0, ...extra });
const students = { OWNER1: mk('OWNER1', { name: 'Ada Obi', username: 'ada' }), F1: mk('F1', { name: 'Bayo', username: 'bayo' }), F2: mk('F2', { name: 'Chi' }),
  FULL: mk('FULL', { dailyQuestionCount: 15 }), FEW: mk('FEW', { dailyQuestionCount: 12 }) };
const challenges = [], notes = [];

const q = v => ({ select() { return this; }, lean() { return this; }, then: (a, b) => Promise.resolve(v).then(a, b) });
const clone = o => (o ? JSON.parse(JSON.stringify(o)) : o);
GeneratedQuestion.findOne = f => q(clone(quizzes.find(d => (!f._id || d._id === f._id) && (!f.matric || d.matric === f.matric)) || null));
GeneratedQuestion.findById = id => q(clone(quizzes.find(d => d._id === String(id)) || null));
GeneratedQuestion.updateOne = async (f, u) => { const d = quizzes.find(x => x._id === f._id); if (d && u.$inc) for (const [k, n] of Object.entries(u.$inc)) d[k] = (d[k] || 0) + n; return { matchedCount: d ? 1 : 0, modifiedCount: d ? 1 : 0 }; };
Student.findOne = f => q(students[f.matric] ? Object.assign(clone(students[f.matric]), { set() {}, unmarkModified() {} }) : null);
Settings.getGlobal = async () => ({ tiers: { free: { dailyQuestions: 15, dailyAIQuizzes: 1, dailyAIChatMessages: 3, features: {} }, premium: { dailyQuestions: null } } });
Notification.create = async d => { notes.push(d); return d; };

let seq = 0;
Challenge.findOne = f => q(clone(challenges.find(c => (!f.token || c.token === f.token) && (!f.quizId || c.quizId === String(f.quizId)) && (!f.owner || c.owner === f.owner) && (f.correct === undefined || c.correct === f.correct) && (f.total === undefined || c.total === f.total)) || null));
Challenge.create = async d => { const c = { _id: String(++seq), results: [], ...d, quizId: String(d.quizId) }; challenges.push(c); return { toObject: () => clone(c) }; };
Challenge.deleteMany = async f => { for (let i = challenges.length - 1; i >= 0; i--) if (challenges[i].quizId === String(f.quizId) && challenges[i].owner === f.owner) challenges.splice(i, 1); return {}; };
Challenge.updateOne = async (f, u) => {
  const c = challenges.find(x => x.token === f.token); if (!c) return { modifiedCount: 0 };
  if (u.$push) { const m = f['results.matric'].$ne; if (c.results.some(r => r.matric === m)) return { modifiedCount: 0 }; c.results.push(...u.$push.results.$each); return { modifiedCount: 1 }; }
  if (u.$set) { const r = c.results.find(x => x.matric === f['results.matric']); r.correct = u.$set['results.$.correct']; r.total = u.$set['results.$.total']; return { modifiedCount: 1 }; }
  return { modifiedCount: 0 };
};

const express = require('express'); const app = express(); app.use(express.json());
app.use('/api/quiz', require(abs('routes/quiz.routes.js')));

(async () => {
  const server = http.createServer(app).listen(0); const base = `http://127.0.0.1:${server.address().port}/api/quiz`;
  const call = async (method, url, matric, body) => { const r = await fetch(base + url, { method, headers: { 'x-matric': matric, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
  try {
    // creating
    assert.strictEqual((await call('POST', `/history/${hex('a')}/challenge`, 'OWNER1', { correct: 11, total: 10 })).status, 400);
    assert.strictEqual((await call('POST', `/history/${hex('a')}/challenge`, 'OWNER1', { correct: 1, total: 12 })).status, 400);
    assert.strictEqual((await call('POST', `/history/${hex('a')}/challenge`, 'OWNER1', { correct: '8', total: 10 })).status, 400);
    assert.strictEqual((await call('POST', `/history/${hex('a')}/challenge`, 'F1', { correct: 8, total: 10 })).status, 404);   // not their quiz
    const c1 = await call('POST', `/history/${hex('a')}/challenge`, 'OWNER1', { correct: 8, total: 10 });
    assert.strictEqual(c1.status, 200); assert.match(c1.body.token, /^[A-Za-z0-9_-]{12}$/); assert.strictEqual(c1.body.path, `/c/${c1.body.token}`); assert.strictEqual(c1.body.pct, 80);
    assert.strictEqual((await call('POST', `/history/${hex('a')}/challenge`, 'OWNER1', { correct: 8, total: 10 })).body.token, c1.body.token, 'same quiz + score = same link');
    const t = c1.body.token;

    // opening: gated on the FRIEND's daily limit
    const open = await call('GET', `/challenge/${t}`, 'F1');
    assert.strictEqual(open.status, 200); assert.strictEqual(open.body.questions.length, 10);
    assert.deepStrictEqual({ by: open.body.challenge.by, c: open.body.challenge.correct, t: open.body.challenge.total, mine: open.body.challenge.mine }, { by: '@ada', c: 8, t: 10, mine: null });
    assert.ok(!JSON.stringify(open.body).includes('OWNER1'), 'no matric leak');
    const full = await call('GET', `/challenge/${t}`, 'FULL'); assert.strictEqual(full.status, 403); assert.strictEqual(full.body.code, 'LIMIT_REACHED'); assert.strictEqual(full.body.questions, undefined);
    const few = await call('GET', `/challenge/${t}`, 'FEW'); assert.strictEqual(few.body.questions.length, 3); assert.strictEqual(few.body.capped, true);
    assert.strictEqual((await call('GET', '/challenge/bad*token', 'F1')).status, 404);

    // results: win, notify once, best-of kept, own challenge refused
    assert.strictEqual((await call('POST', `/challenge/${t}/result`, 'OWNER1', { correct: 9, total: 10 })).status, 400);
    assert.strictEqual((await call('POST', `/challenge/${t}/result`, 'F1', { correct: 11, total: 10 })).status, 400);
    const r1 = await call('POST', `/challenge/${t}/result`, 'F1', { correct: 9, total: 10 });
    assert.strictEqual(r1.body.outcome, 'win'); assert.strictEqual(r1.body.you.pct, 90); assert.strictEqual(r1.body.challenger.by, '@ada');
    assert.strictEqual(notes.length, 1); assert.strictEqual(notes[0].matric, 'OWNER1'); assert.match(notes[0].message, /@bayo scored 9\/10.*beat your score/);
    const r2 = await call('POST', `/challenge/${t}/result`, 'F1', { correct: 5, total: 10 });
    assert.strictEqual(r2.body.outcome, 'win', 'a worse retry keeps the best score'); assert.strictEqual(r2.body.you.correct, 9); assert.strictEqual(notes.length, 1, 'only the first attempt notifies');
    assert.strictEqual((await call('GET', `/challenge/${t}`, 'F1')).body.challenge.mine.correct, 9);

    // tie and lose
    assert.strictEqual((await call('POST', `/challenge/${t}/result`, 'F2', { correct: 8, total: 10 })).body.outcome, 'tie');
    const lose = await call('POST', `/challenge/${t}/result`, 'FEW', { correct: 1, total: 3 });
    assert.strictEqual(lose.body.outcome, 'lose'); assert.strictEqual(notes.length, 3);
    assert.strictEqual(challenges[0].results.length, 3);

    // stopping the share of the quiz kills its challenge links
    assert.strictEqual((await call('DELETE', `/history/${hex('a')}/share`, 'OWNER1')).status, 200);
    assert.strictEqual((await call('GET', `/challenge/${t}`, 'F1')).status, 404);
    console.log('challenge a friend: create, daily-limit gating, results, notifications OK');
  } finally { server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
