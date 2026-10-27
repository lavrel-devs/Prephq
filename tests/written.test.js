// Written exam (v1.8.0): start (daily-limit gated), hidden marking scheme, save-before-mark, rubric-based scoring.
// In-memory: models and the AI calls are stubbed, so no database or network is needed.
const assert = require('assert'), path = require('path'), http = require('http');
const abs = p => require.resolve(path.join(__dirname, '..', 'src', p));
require.cache[abs('middleware/auth.js')] = { id: 'auth', filename: abs('middleware/auth.js'), loaded: true,
  exports: { requireStudent: (req, res, next) => { req.student = { sub: String(req.headers['x-matric'] || '').toUpperCase() }; next(); } } };

const groq = require(abs('services/groq.service.js'));
let aiExam = null, aiMark = null, markCalls = 0, genCalls = 0;
groq.generateTheoryQuestions = async (a) => { genCalls++; lastGen = a; return { questions: aiExam(a), model: 'm' }; };
groq.markTheoryAnswers = async (a) => { markCalls++; return { marking: aiMark(a), model: 'm' }; };
let lastGen = null;

const WrittenExam = require(abs('models/WrittenExam.js')), Student = require(abs('models/Student.js')), Course = require(abs('models/Course.js'));
const Question = require(abs('models/Question.js')), Settings = require(abs('models/Settings.js'));
const { watDateString } = require(abs('services/credit.service.js'));
const today = watDateString();

const students = {
  FREE1: { _id: 'f1', matric: 'FREE1', tier: 'free', dailyWrittenDate: today, dailyWrittenCount: 0 },
  FREE2: { _id: 'f2', matric: 'FREE2', tier: 'free', dailyWrittenDate: today, dailyWrittenCount: 0 },
  PREM:  { _id: 'p1', matric: 'PREM', tier: 'premium', premiumPlan: 'monthly', tierExpiresAt: new Date(Date.now() + 864e5), dailyWrittenDate: today, dailyWrittenCount: 5 },
};
const q = v => ({ select() { return this; }, lean() { return this; }, sort() { return this; }, limit() { return this; }, then: (a, b) => Promise.resolve(v).then(a, b) });
const clone = o => (o ? JSON.parse(JSON.stringify(o)) : o);
Student.findOne = f => q(students[f.matric] ? Object.assign(clone(students[f.matric]), { set(k, v) { this[k] = v; }, unmarkModified() {} }) : null);
Student.findOneAndUpdate = async (f, u) => {
  const s = Object.values(students).find(x => x._id === f._id); if (!s) return null;
  if (u.$inc && f.dailyWrittenDate) { if (s.dailyWrittenDate !== f.dailyWrittenDate) return null; s.dailyWrittenCount += u.$inc.dailyWrittenCount; }
  else if (u.$set) Object.assign(s, u.$set);
  return clone(s);
};
Course.findOne = f => q(f.key === 'chm101' ? { key: 'chm101', courseCode: 'CHM101', title: 'General Chemistry I' } : null);
Question.distinct = async () => ['Atomic Structure', 'Bonding'];
Question.aggregate = async () => [{ q: 'Define an isotope.' }];
Settings.getGlobal = async () => ({ tiers: { free: { dailyQuestions: 15, dailyAIQuizzes: 1, dailyAIChatMessages: 3, dailyWrittenExams: 1, features: {} }, premium: { dailyQuestions: null, dailyWrittenExams: null } } });

const exams = []; let n = 0;
const ex = id => exams.find(e => String(e._id) === String(id));
WrittenExam.create = async d => { const e = { _id: String(++n).padStart(24, '0'), status: 'open', answers: [], results: [], total: 0, maxTotal: 0, startedAt: new Date(), ...d }; exams.push(e); return e; };
WrittenExam.findOne = f => q(clone(exams.find(e => (!f._id || String(e._id) === String(f._id)) && (!f.matric || e.matric === f.matric) && (!f.status || e.status === f.status) && (!f.startedAt || new Date(e.startedAt) >= f.startedAt.$gte)) || null));
WrittenExam.find = f => q(clone(exams.filter(e => e.matric === f.matric)));
WrittenExam.updateOne = async (f, u) => { const e = ex(f._id); if (!e || (f.status && e.status !== f.status)) return { modifiedCount: 0 }; Object.assign(e, u.$set); return { modifiedCount: 1 }; };
WrittenExam.findOneAndUpdate = (f, u) => { const e = ex(f._id); if (!e || (f.status && e.status !== f.status)) return q(null); Object.assign(e, u.$set); return q(clone(e)); };

const express = require('express'); const app = express(); app.use(express.json());
app.use('/api/written', require(abs('routes/written.routes.js')));

const goodExam = () => [
  { q: 'Explain the Bohr model of the atom.', marks: 99, rubric: [{ point: 'Electrons orbit the nucleus in fixed shells', marks: 2 }, { point: 'Energy is quantised', marks: 1 }, { point: 'Photon emitted or absorbed on transitions', marks: 2 }], model: 'MODEL-ANSWER-ONE' },
  { q: 'Differentiate between ionic and covalent bonds.', rubric: [{ point: 'Ionic: transfer of electrons', marks: 1 }, { point: 'Covalent: sharing of electrons', marks: 1 }, { point: 'Properties differ', marks: 1 }], model: 'MODEL-ANSWER-TWO' },
  { q: 'junk with one rubric point only', rubric: [{ point: 'x', marks: 1 }], model: '' },     // < 2 points: dropped
];

(async () => {
  const server = http.createServer(app).listen(0); const base = `http://127.0.0.1:${server.address().port}/api/written`;
  const call = async (method, url, matric, body) => { const r = await fetch(base + url, { method, headers: { 'x-matric': matric, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
  try {
    // ── start ──
    assert.strictEqual((await call('POST', '/start', 'FREE1', { course: '' })).status, 400);
    assert.strictEqual((await call('POST', '/start', 'FREE1', { course: 'CHM101', count: 9 })).body.code, 'INVALID_COUNT');
    aiExam = () => ({ questions: [] });
    const empty = await call('POST', '/start', 'FREE1', { course: 'CHM101', count: 2 });
    assert.strictEqual(empty.status, 502); assert.strictEqual(students.FREE1.dailyWrittenCount, 0, 'a failed build does not use up the daily exam');

    aiExam = () => ({ questions: goodExam() });
    const s1 = await call('POST', '/start', 'FREE1', { course: 'CHM101', topic: 'Atomic structure', count: 3 });
    assert.strictEqual(s1.status, 201); assert.strictEqual(s1.body.questions.length, 2, 'invalid AI questions are dropped');
    assert.deepStrictEqual(s1.body.questions.map(x => x.marks), [5, 3], 'marks always equal the rubric total, never the AI figure');
    assert.strictEqual(s1.body.durationMin, 16);
    assert.ok(lastGen.topics.includes('Atomic Structure') && lastGen.courseTitle === 'General Chemistry I' && lastGen.samples.length === 1, 'questions are grounded in the course');
    const raw = JSON.stringify(s1.body); assert.ok(!/rubric|MODEL-ANSWER|Bohr model.*shells/.test(raw.replace(/Explain the Bohr model of the atom\./, '')), 'open exam must not reveal the scheme');
    assert.strictEqual(students.FREE1.dailyWrittenCount, 1);
    const id = s1.body.id;

    // one at a time: re-starting resumes the open exam and uses nothing
    const again = await call('POST', '/start', 'FREE1', { course: 'CHM101' });
    assert.strictEqual(again.status, 409); assert.strictEqual(again.body.code, 'EXAM_IN_PROGRESS'); assert.strictEqual(again.body.exam.id, id); assert.strictEqual(genCalls, 2);
    assert.strictEqual((await call('GET', '/active', 'FREE1')).body.exam.id, id);

    // reading an open exam shows questions only; other students can't see it
    const open = await call('GET', `/${id}`, 'FREE1');
    assert.strictEqual(open.body.status, 'open'); assert.ok(!('rubric' in open.body.questions[0]) && !('model' in open.body.questions[0]));
    assert.strictEqual((await call('GET', `/${id}`, 'FREE2')).status, 404);
    assert.strictEqual((await call('POST', `/${id}/submit`, 'FREE2', { answers: ['a', 'b'] })).status, 404);

    // ── submit: AI outage keeps the answers; retry marks them ──
    const answers = ['Electrons move in fixed orbits and energy is quantised.', ''];
    aiMark = () => { throw Object.assign(new Error('rate limited'), { code: 'GROQ_ERROR' }); };
    const fail = await call('POST', `/${id}/submit`, 'FREE1', { answers });
    assert.strictEqual(fail.status, 502); assert.strictEqual(fail.body.saved, true);
    assert.deepStrictEqual(ex(id).answers, answers.map(a => a.trim()), 'answers are stored before marking'); assert.strictEqual(ex(id).status, 'open');

    // an over-eager AI: wrong score field, out-of-range and duplicate indexes, and marks for the BLANK answer
    aiMark = () => ({ results: [{ i: 0, met: [0, 1, 1, 7, -1, 'x'], score: 50, feedback: 'Good start.', tip: 'Mention photons.' }, { i: 1, met: [0, 1, 2], score: 3, feedback: 'ignored' }] });
    const ok = await call('POST', `/${id}/submit`, 'FREE1', { answers });
    assert.strictEqual(ok.status, 200); assert.strictEqual(ok.body.status, 'marked');
    assert.strictEqual(ok.body.questions[0].score, 3, 'score = marks of the rubric points earned (2 + 1), not the AI number');
    assert.strictEqual(ok.body.questions[1].score, 0, 'a blank answer can never score'); assert.match(ok.body.questions[1].feedback, /No answer/);
    assert.strictEqual(ok.body.total, 3); assert.strictEqual(ok.body.maxTotal, 8); assert.strictEqual(ok.body.pct, 38);
    assert.deepStrictEqual(ok.body.questions[0].rubric.map(r => r.earned), [true, true, false]);
    assert.strictEqual(ok.body.questions[0].model, 'MODEL-ANSWER-ONE', 'the model answer is revealed once marked');
    const callsAfter = markCalls;
    const dup = await call('POST', `/${id}/submit`, 'FREE1', { answers: ['changed', 'changed'] });
    assert.strictEqual(dup.body.total, 3); assert.strictEqual(markCalls, callsAfter, 'submitting a marked exam does not re-mark it');

    // an all-blank exam is marked 0 without calling the AI at all
    students.FREE2.dailyWrittenCount = 0;
    aiExam = () => ({ questions: goodExam() });
    const b = await call('POST', '/start', 'FREE2', { course: 'CHM101', count: 2 });
    const before = markCalls; const blank = await call('POST', `/${b.body.id}/submit`, 'FREE2', { answers: ['', '   '] });
    assert.strictEqual(blank.body.total, 0); assert.strictEqual(markCalls, before);

    // ── daily limit: free = 1/day, premium unlimited ──
    const lim = await call('POST', '/start', 'FREE1', { course: 'CHM101' });
    assert.strictEqual(lim.status, 403); assert.strictEqual(lim.body.code, 'LIMIT_REACHED'); assert.strictEqual(lim.body.limit, 1);
    assert.strictEqual((await call('POST', '/start', 'PREM', { course: 'CHM101' })).status, 201);

    // ── history ──
    const hist = await call('GET', '/', 'FREE1'); assert.strictEqual(hist.body.length, 1); assert.strictEqual(hist.body[0].pct, 38);
    console.log('written exam: gating, hidden scheme, save-before-mark, rubric scoring OK');
  } finally { server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
