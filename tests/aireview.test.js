// AI question review (v1.8.1): queueing, duplicate handling, approval into the bank, on-demand generation, admin routes.
// In-memory: models and the AI call are stubbed, so no database or network is needed.
const assert = require('assert'), path = require('path'), http = require('http');
const abs = p => require.resolve(path.join(__dirname, '..', 'src', p));
require.cache[abs('middleware/auth.js')] = { id: 'auth', filename: abs('middleware/auth.js'), loaded: true,
  exports: { requireAdmin: (req, res, next) => { req.admin = { sub: 'goodnews', access: 'FULL' }; next(); }, requireStudent: (req, res, next) => next() } };
require.cache[abs('services/activity.service.js')] = { id: 'act', filename: abs('services/activity.service.js'), loaded: true, exports: { logActivity() {} } };

const groq = require(abs('services/groq.service.js'));
let genArgs = null, genOut = [];
groq.generateQuiz = async (a) => { genArgs = a; return { questions: genOut, model: 'm' }; };

const AIQuestionReview = require(abs('models/AIQuestionReview.js')), TheoryQuestion = require(abs('models/TheoryQuestion.js'));
const Question = require(abs('models/Question.js')), Course = require(abs('models/Course.js'));

const store = [], bank = [], theory = []; let seq = 0;
const mkId = () => String(++seq).padStart(24, '0');
const q = v => ({ select() { return this; }, lean() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, then: (a, b) => Promise.resolve(v).then(a, b), catch: f => Promise.resolve(v).catch(f) });
const withSave = d => Object.assign(d, { save: async () => d, toObject: () => ({ ...d }) });
AIQuestionReview.insertMany = async (docs) => {
  const ok = [], errs = [];
  for (const d of docs) {
    if (store.some(x => x.courseKey === d.courseKey && x.kind === d.kind && x.norm === d.norm)) { errs.push({ code: 11000 }); continue; }
    const doc = withSave({ _id: mkId(), status: 'pending', createdAt: new Date(), reviewedAt: null, note: '', ...d }); store.push(doc); ok.push(doc);
  }
  if (errs.length) throw Object.assign(new Error('dup'), { code: 11000, writeErrors: errs, insertedDocs: ok });
  return ok;
};
const matches = (d, f) => Object.entries(f).every(([k, v]) => (v && v.$in) ? v.$in.map(String).includes(String(d[k])) : (k === '_id' ? d._id === String(v) : d[k] === v));
AIQuestionReview.findOne = (f) => q(store.find(d => matches(d, f)) || null);
AIQuestionReview.find = (f) => q(store.filter(d => matches(d, f)).map(d => ({ ...d })));
AIQuestionReview.countDocuments = async (f) => store.filter(d => matches(d, f)).length;
AIQuestionReview.updateMany = async (f, u) => { const rows = store.filter(d => matches(d, f)); rows.forEach(d => Object.assign(d, u.$set)); return { modifiedCount: rows.length }; };
const courses = [{ key: 'chm101', courseCode: 'CHM101', title: 'General Chemistry I' }, { key: 'bio101', courseCode: 'BIO101', title: 'Biology' }];
Course.findOne = (f) => q(courses.find(c => (f.key && c.key === f.key) || (f.$or && f.$or.some(o => (o.key && o.key === c.key) || (o.courseCode && o.courseCode === c.courseCode)))) || null);
Question.distinct = async () => ['Atomic Structure', 'Bonding'];
Question.findOne = (f) => { const re = f.$and && f.$and[1] && f.$and[1].q && f.$and[1].q.$regex; return q(re && bank.find(b => re.test(b.q)) ? { _id: 'x' } : null); };
Question.create = async (d) => { const row = { _id: mkId(), ...d }; bank.push(row); return row; };
TheoryQuestion.create = async (d) => { if (theory.some(t => t.course === d.course && t.norm === d.norm)) throw Object.assign(new Error('dup'), { code: 11000 }); const row = { _id: mkId(), ...d }; theory.push(row); return row; };
require(abs('utils/courseMatch.js')); // real helper (uses Course.findOne, stubbed above)

const svc = require(abs('services/questionReview.service.js'));
const mcq = (t, ans = 1) => ({ q: t, opts: ['a', 'b', 'c', 'd'], ans, exp: 'because' });
const rubric = [{ point: 'p1', marks: 1 }, { point: 'p2', marks: 2 }];

(async () => {
  // ── queueing: valid items in, junk and repeats skipped ──
  const r1 = await svc.queueQuestions({ kind: 'mcq', course: 'CHEM 101', source: 'student-ai', submittedBy: 'S1', difficulty: 'hard', tag: 'Bonding',
    items: [mcq('What is an ionic bond?'), mcq('What is an ionic bond?'), { q: 'no options' }, { q: 'bad answer', opts: ['a', 'b'], ans: 5 }, mcq('Define an isotope.')] });
  assert.deepStrictEqual(r1, { queued: 2, skipped: 0 }, 'repeats inside a batch and invalid questions are dropped before queueing');
  assert.strictEqual(store[0].courseKey, 'chem101'); assert.strictEqual(store[0].status, 'pending'); assert.strictEqual(store[0].source, 'student-ai');
  const r2 = await svc.queueQuestions({ kind: 'mcq', course: 'chem-101', source: 'student-ai', submittedBy: 'S2', items: [mcq('what is an IONIC bond?'), mcq('A brand new question?')] });
  assert.deepStrictEqual(r2, { queued: 1, skipped: 1 }, 'the same question for the same course is queued only once');
  const rw = await svc.queueQuestions({ kind: 'written', course: 'chm101', source: 'student-ai', submittedBy: 'S1', items: [{ q: 'Explain the mole concept.', rubric, model: 'M' }, { q: 'one point only', rubric: [rubric[0]] }] });
  assert.strictEqual(rw.queued, 1);
  assert.deepStrictEqual(await svc.queueQuestions({ kind: 'mcq', course: '', source: 'student-ai', items: [mcq('x?')] }), { queued: 0, skipped: 0 });

  // ── approve: needs a catalogue course; MCQ -> Question bank; written -> theory bank ──
  const ionic = store.find(d => d.q === 'What is an ionic bond?'), isotope = store.find(d => d.q === 'Define an isotope.'), written = store.find(d => d.kind === 'written');
  let a = await svc.approve([{ id: ionic._id }], 'goodnews');
  assert.strictEqual(a.results[0].result, 'needs_course', "a course the catalogue doesn't know must be chosen first");
  a = await svc.approve([{ id: ionic._id, course: 'CHM101' }, { id: isotope._id, course: 'chm101' }, { id: written._id, course: 'CHM101' }], 'goodnews');
  assert.strictEqual(a.approved, 3); assert.match(a.batchId, /^ai-review-\d{4}-\d{2}-\d{2}$/);
  assert.strictEqual(bank.length, 2); assert.deepStrictEqual(bank[0], { _id: bank[0]._id, course: 'chm101', q: 'What is an ionic bond?', opts: ['a', 'b', 'c', 'd'], ans: 1, tag: 'Bonding', exp: 'because', createdBy: 'ai-review:goodnews', batchId: a.batchId });
  assert.strictEqual(theory.length, 1); assert.strictEqual(theory[0].course, 'chm101'); assert.strictEqual(theory[0].rubric.length, 2);
  assert.strictEqual(ionic.status, 'approved'); assert.strictEqual(ionic.addedId, bank[0]._id); assert.strictEqual(ionic.reviewedBy, 'goodnews');
  assert.strictEqual((await svc.approve([{ id: ionic._id, course: 'CHM101' }], 'goodnews')).results[0].result, 'gone', 'an approved question cannot be approved twice');

  // a question already in the bank is rejected instead of duplicated
  bank.push({ _id: 'existing', course: 'bio101', q: 'Name the powerhouse of the cell.' });
  await svc.queueQuestions({ kind: 'mcq', course: 'bio101', source: 'admin-ai', submittedBy: 'goodnews', items: [mcq('Name the powerhouse of the cell.')] });
  const dupDoc = store.find(d => d.q === 'Name the powerhouse of the cell.');
  assert.strictEqual((await svc.approve([{ id: dupDoc._id }], 'goodnews')).results[0].result, 'duplicate');
  assert.strictEqual(dupDoc.status, 'rejected'); assert.strictEqual(bank.length, 3, 'nothing was added'); // 2 approved + the pre-existing row

  // ── reject ──
  const fresh = store.find(d => d.q === 'A brand new question?');
  assert.deepStrictEqual(await svc.reject([fresh._id], 'goodnews'), { rejected: 1 }); assert.strictEqual(fresh.status, 'rejected');

  // ── on-demand generation: validated, grounded, queued as admin-ai (NOT added to the bank) ──
  await assert.rejects(svc.generateForAdmin({ course: 'NOPE999', count: 5 }), /catalogue/);
  await assert.rejects(svc.generateForAdmin({ course: 'CHM101', count: 11 }), /1 to 10/);
  await assert.rejects(svc.generateForAdmin({ course: 'CHM101', count: 0 }), /1 to 10/);
  genOut = [mcq('Gen Q1?'), mcq('Gen Q2?'), mcq('Gen Q3?')];
  const g = await svc.generateForAdmin({ course: 'CHM101', topic: 'Acids', difficulty: 'hard', count: 3, admin: 'goodnews' });
  assert.deepStrictEqual(g, { requested: 3, generated: 3, queued: 3, duplicates: 0 });
  assert.strictEqual(genArgs.count, 3); assert.strictEqual(genArgs.difficulty, 'hard'); assert.match(genArgs.studyMaterial, /Acids/); assert.match(genArgs.studyMaterial, /Atomic Structure; Bonding/);
  const adm = store.filter(d => d.source === 'admin-ai'); assert.ok(adm.length >= 3 && adm.every(d => d.courseKey)); assert.ok(!bank.some(b => /Gen Q/.test(b.q)), 'generated questions wait for approval');
  assert.strictEqual((await svc.generateForAdmin({ course: 'chm101', count: 3, admin: 'x' })).duplicates, 3, 'asking again for the same questions queues nothing new');

  // ── admin routes ──
  const express = require('express'); const app = express(); app.use(express.json());
  app.use('/api/admin', require(abs('routes/admin/admin.aireview.routes.js')));
  const server = http.createServer(app).listen(0); const base = `http://127.0.0.1:${server.address().port}/api/admin/ai-review`;
  const call = async (method, url, body) => { const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
  try {
    const list = await call('GET', '?status=pending&kind=written');
    assert.strictEqual(list.status, 200); assert.ok(list.body.counts.pending >= 0 && 'approved' in list.body.counts);
    assert.ok(list.body.items.every(i => i.kind === 'written' && i.status === 'pending'));
    assert.strictEqual((await call('POST', '/approve', { items: [] })).status, 400);
    assert.strictEqual((await call('POST', '/approve', { items: [{ id: 'not-an-id' }] })).status, 400);
    assert.strictEqual((await call('POST', '/reject', { ids: [] })).status, 400);
    assert.strictEqual((await call('POST', '/generate', { course: 'CHM101', count: 99 })).status, 400);
    const pend = store.find(d => d.status === 'pending' && d.kind === 'mcq');
    assert.strictEqual((await call('PUT', `/${pend._id}`, { q: 'Fixed?', opts: ['only one'], ans: 0 })).status, 400);
    assert.strictEqual((await call('PUT', `/${pend._id}`, { q: 'Fixed?', opts: ['a', 'b'], ans: 3 })).status, 400);
    const ok = await call('PUT', `/${pend._id}`, { q: 'Fixed question text?', opts: ['x', 'y', 'z'], ans: 2, exp: 'Why', tag: 'Acids' });
    assert.strictEqual(ok.status, 200); assert.deepStrictEqual(ok.body.opts, ['x', 'y', 'z']); assert.strictEqual(pend.norm, 'fixedquestiontext');
    assert.strictEqual((await call('PUT', `/${written._id}`, { q: 'x?', opts: ['a', 'b'], ans: 0 })).status, 404, 'approved items are no longer editable');
    console.log('AI question review: queue, dedupe, approval into the bank, on-demand generation OK');
  } finally { server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
