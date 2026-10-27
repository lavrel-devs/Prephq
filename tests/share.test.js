// Shareable quiz links (v1.7.1): create/revoke by the owner, and the friend-side open that is gated on the
// FRIEND's daily limit. Pure in-memory — the models are stubbed, so no database or network is needed.
const assert = require('assert'), path = require('path'), http = require('http');
const SRC = path.join(__dirname, '..', 'src');
const abs = p => require.resolve(path.join(SRC, p));

// ── stub auth: the caller's matric comes from a header ──
require.cache[abs('middleware/auth.js')] = { id: 'auth', filename: abs('middleware/auth.js'), loaded: true,
  exports: { requireStudent: (req, res, next) => { req.student = { sub: String(req.headers['x-matric'] || '').toUpperCase() }; next(); } } };

const GeneratedQuestion = require(abs('models/GeneratedQuestion.js'));
const Student = require(abs('models/Student.js'));
const Settings = require(abs('models/Settings.js'));
const { watDateString } = require(abs('services/credit.service.js'));

const hex = c => c.repeat(24);
const quizzes = [
  { _id: hex('a'), matric: 'OWNER1', course: 'CHM101', difficulty: 'medium', shareOpens: 0,
    questions: Array.from({ length: 10 }, (_, i) => ({ q: `Q${i}`, opts: ['a', 'b'], ans: 0, exp: '', tag: 't', course: 'CHM101' })) },
];
const students = {
  OWNER1:  { matric: 'OWNER1',  name: 'Ada Obi', username: 'ada', tier: 'free', premiumPlan: null, tierExpiresAt: null },
  FRIEND1: { matric: 'FRIEND1', name: 'Bayo',    tier: 'free', premiumPlan: null, tierExpiresAt: null, dailyQuestionDate: watDateString(), dailyQuestionCount: 0 },
  FRIEND2: { matric: 'FRIEND2', name: 'Chi',     tier: 'free', premiumPlan: null, tierExpiresAt: null, dailyQuestionDate: watDateString(), dailyQuestionCount: 20 }, // already at the cap
  FRIEND3: { matric: 'FRIEND3', name: 'Dayo',    tier: 'free', premiumPlan: null, tierExpiresAt: null, dailyQuestionDate: watDateString(), dailyQuestionCount: 17 }, // 3 left
  FRIEND4: { matric: 'FRIEND4', name: 'Efe',     tier: 'premium', premiumPlan: 'monthly', tierExpiresAt: null, dailyQuestionDate: watDateString(), dailyQuestionCount: 500 },
};

const q = v => ({ select() { return this; }, lean() { return this; }, then: (a, b) => Promise.resolve(v).then(a, b), catch: f => Promise.resolve(v).catch(f) });
const clone = o => (o ? JSON.parse(JSON.stringify(o)) : o);
GeneratedQuestion.findOne = f => q(clone(quizzes.find(d => (!f._id || d._id === f._id) && (!f.matric || d.matric === f.matric) && (!f.shareToken || d.shareToken === f.shareToken)) || null));
GeneratedQuestion.findById = id => q(clone(quizzes.find(d => d._id === id) || null));
GeneratedQuestion.updateOne = async (f, u) => {
  const d = quizzes.find(x => (!f._id || x._id === f._id) && (!f.matric || x.matric === f.matric));
  if (!d || (f.shareToken && f.shareToken.$exists === false && d.shareToken)) return { matchedCount: d ? 1 : 0, modifiedCount: 0 };
  Object.assign(d, u.$set || {});
  for (const k of Object.keys(u.$unset || {})) delete d[k];
  for (const [k, n] of Object.entries(u.$inc || {})) d[k] = (d[k] || 0) + n;
  return { matchedCount: 1, modifiedCount: 1 };
};
Student.findOne = f => q(clone(students[f.matric]) ? Object.assign(clone(students[f.matric]), { set() {}, unmarkModified() {} }) : null);
Settings.getGlobal = async () => ({
  tiers: { free: { dailyQuestions: 20, dailyAIQuizzes: 2, dailyAIChatMessages: 5, features: {} }, premium: { dailyQuestions: null } },
});

require(abs('models/Challenge.js')).deleteMany = async () => ({});   // revoking a share also clears its challenges (v1.7.4); none here

const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/quiz', require(abs('routes/quiz.routes.js')));

(async () => {
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/quiz`;
  const call = async (method, url, matric) => { const r = await fetch(base + url, { method, headers: { 'x-matric': matric } }); return { status: r.status, body: await r.json() }; };
  try {
    // owner creates a link; tapping Share again returns the SAME link
    const a = await call('POST', `/history/${hex('a')}/share`, 'OWNER1');
    assert.strictEqual(a.status, 200); assert.match(a.body.token, /^[A-Za-z0-9_-]{12}$/); assert.strictEqual(a.body.path, `/q/${a.body.token}`);
    const a2 = await call('POST', `/history/${hex('a')}/share`, 'OWNER1');
    assert.strictEqual(a2.body.token, a.body.token, 'share must be idempotent');
    const token = a.body.token;

    // someone else's quiz can't be shared; junk tokens are 404
    assert.strictEqual((await call('POST', `/history/${hex('a')}/share`, 'FRIEND1')).status, 404);
    assert.strictEqual((await call('GET', '/shared/not*valid', 'FRIEND1')).status, 404);
    assert.strictEqual((await call('GET', '/shared/AAAAAAAAAAAA', 'FRIEND1')).status, 404);

    // friend under the cap gets the whole quiz, and the owner's identity is a handle, not a matric
    const ok = await call('GET', `/shared/${token}`, 'FRIEND1');
    assert.strictEqual(ok.status, 200); assert.strictEqual(ok.body.questions.length, 10); assert.strictEqual(ok.body.capped, false);
    assert.strictEqual(ok.body.sharedBy, '@ada'); assert.ok(!JSON.stringify(ok.body).includes('OWNER1'), 'must not leak the owner matric');
    assert.strictEqual(quizzes[0].shareOpens, 1, 'a friend opening the link is counted');

    // friend already at the daily cap: refused BEFORE any question is returned
    const full = await call('GET', `/shared/${token}`, 'FRIEND2');
    assert.strictEqual(full.status, 403); assert.strictEqual(full.body.code, 'LIMIT_REACHED'); assert.strictEqual(full.body.questions, undefined);

    // friend with 3 left only gets 3 questions
    const few = await call('GET', `/shared/${token}`, 'FRIEND3');
    assert.strictEqual(few.status, 200); assert.strictEqual(few.body.questions.length, 3); assert.strictEqual(few.body.capped, true); assert.strictEqual(few.body.total, 10);

    // an unlimited (premium) plan is never capped
    const prem = await call('GET', `/shared/${token}`, 'FRIEND4');
    assert.strictEqual(prem.status, 200); assert.strictEqual(prem.body.questions.length, 10);

    // owner opening their own link is not counted as a friend open
    const before = quizzes[0].shareOpens;
    assert.strictEqual((await call('GET', `/shared/${token}`, 'OWNER1')).body.isOwner, true);
    assert.strictEqual(quizzes[0].shareOpens, before);

    // only the owner can revoke; once revoked the link is dead
    assert.strictEqual((await call('DELETE', `/history/${hex('a')}/share`, 'FRIEND1')).status, 404);
    assert.strictEqual((await call('DELETE', `/history/${hex('a')}/share`, 'OWNER1')).status, 200);
    const gone = await call('GET', `/shared/${token}`, 'FRIEND1');
    assert.strictEqual(gone.status, 404); assert.strictEqual(gone.body.code, 'LINK_NOT_FOUND');
    console.log('shared quiz links: create, revoke and daily-limit gating OK');
  } finally { server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
