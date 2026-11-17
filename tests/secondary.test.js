// Wreddi Secondary (v1.11): exam rules, grading, paper filtering, bulk-upload metadata, and the route handlers end to end
// against stubbed models (no database or network needed).
const assert = require('assert'), path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test';
const S = require(path.join(ROOT, 'src/utils/secondary.js'));
const { planBulk, secondaryMeta } = require(path.join(ROOT, 'src/services/questionBank.service.js'));
const { mingo } = (() => { try { return { mingo: require('mingo') }; } catch (e) { return {}; } })();

// ── grading ──
assert.strictEqual(S.gradeFor(75), 'A1'); assert.strictEqual(S.gradeFor(74), 'B2'); assert.strictEqual(S.gradeFor(50), 'C6');
assert.strictEqual(S.gradeFor(49), 'D7'); assert.strictEqual(S.gradeFor(40), 'E8'); assert.strictEqual(S.gradeFor(39), 'F9'); assert.strictEqual(S.gradeFor(NaN), 'F9');
assert.ok(S.isCredit('C6') && !S.isCredit('D7') && !S.isCredit('F9'));

// ── JAMB shape: 180 questions, 2 hours, English first ──
const full = S.jambShape(4); assert.deepStrictEqual(full.counts, [60, 40, 40, 40]); assert.strictEqual(full.total, 180); assert.strictEqual(full.minutes, 120);
assert.ok(S.jambShape(4, true).total < 60, 'mini mock fits inside a small daily allowance');
const pj = S.summarisePaper('jamb', [{ course: 'seceng', correct: 45, total: 60 }, { course: 'secmth', correct: 20, total: 40 }, { course: 'secphy', correct: 40, total: 40 }, { course: 'secchm', correct: 0, total: 40 }]);
assert.strictEqual(pj.utme, 75 + 50 + 100 + 0, 'UTME is the sum of four subject marks out of 100');
assert.strictEqual(S.jambSubjectScore(5, 0), 0); assert.strictEqual(S.jambSubjectScore(99, 10), 100, 'correct can never exceed total');

// ── subject rules ──
assert.ok(S.validateSubjects('jamb', ['seceng', 'secphy', 'secchm']), 'JAMB needs four');
assert.ok(S.validateSubjects('jamb', ['secmth', 'secphy', 'secchm', 'secbio']), 'JAMB needs English');
assert.strictEqual(S.validateSubjects('jamb', ['seceng', 'secmth', 'secphy', 'secchm']), null);
assert.ok(S.validateSubjects('waec', ['seceng', 'secphy']), 'WAEC needs English and Maths');
assert.strictEqual(S.validateSubjects('neco', ['seceng', 'secmth']), null);
assert.ok(S.validateSubjects('waec', ['seceng', 'secmth', ...Array.from({ length: 8 }, (_, i) => 'x' + i)]), 'max nine');
assert.strictEqual(S.validateSubjects('school', ['secbio']), null);

// ── credit check ──
assert.deepStrictEqual(S.creditCheck({ seceng: 'B3', secmth: 'C6', secphy: 'C4', secchm: 'A1', secbio: 'C5' }).ok, true);
const cc = S.creditCheck({ seceng: 'D7', secmth: 'C6', secphy: 'C4' }); assert.strictEqual(cc.ok, false); assert.ok(cc.missing.some(m => /English/.test(m)));

// ── profile + score-block cleaning ──
const known = new Set(['seceng', 'secmth', 'secphy', 'secchm']);
assert.ok(S.cleanProfile({ exam: 'ielts' }, known).error);
assert.ok(S.cleanProfile({ subjects: ['nonsense'] }, known).error);
assert.ok(S.cleanProfile({ targetScore: 401 }, known).error);
assert.ok(S.cleanProfile({ examDate: 'not a date' }, known).error);
assert.deepStrictEqual(S.cleanProfile({ exam: 'jamb', subjects: ['SEC-ENG', 'sec eng', 'SEC-MTH'] }, known).value, { exam: 'jamb', subjects: ['seceng', 'secmth'] });
const cs = S.cleanSec({ exam: 'jamb', kind: 'mock', rows: [{ course: 'seceng', correct: 999, total: 60 }, { course: 'bogus', correct: 1, total: 1 }, { course: 'secmth', correct: 10, total: 40, utme: 9999, grade: 'A1' }], utme: 9999 }, known);
assert.strictEqual(cs.rows.length, 2, 'unknown subjects dropped'); assert.strictEqual(cs.rows[0].correct, 60, 'correct clamped to total');
assert.strictEqual(cs.utme, 100 + 25, 'UTME recomputed server-side, the client value is ignored'); assert.strictEqual(cs.rows[1].grade, 'F9', 'grade recomputed');
assert.strictEqual(S.cleanSec({ exam: 'x', rows: [] }, known), null);

// ── countdown ──
const now = new Date('2026-11-16T10:00:00').getTime();
assert.strictEqual(S.daysUntil('2026-11-20T00:00:00', now), 4); assert.strictEqual(S.daysUntil('2026-11-16T23:00:00', now), 0); assert.strictEqual(S.daysUntil('2026-11-10T00:00:00', now), -6); assert.strictEqual(S.daysUntil(null, now), null);
assert.strictEqual(S.sample([1, 2, 3, 4, 5], 3).length, 3); assert.strictEqual(new Set(S.sample([1, 2, 3, 4, 5], 5)).size, 5);

// ── seeded subjects are consistent ──
const { seedDocs } = require(path.join(ROOT, 'src/utils/secondarySeed.js'));
const docs = seedDocs(), keys = docs.map(d => d.key);
assert.strictEqual(new Set(keys).size, keys.length, 'subject keys are unique'); assert.ok(keys.includes(S.KEY_ENG) && keys.includes(S.KEY_MTH));
assert.ok(docs.every(d => d.track === 'secondary' && /^[a-z0-9]+$/.test(d.key)));
for (const c of S.JAMB_COMBOS) { assert.strictEqual(c.subjects.length, 4, c.course + ' has four subjects'); assert.ok(c.subjects[0] === 'SEC-ENG', c.course + ' starts with English'); c.subjects.forEach(code => assert.ok(S.SUBJECTS.some(s => s.code === code), 'combo subject exists: ' + code)); }

// ── bulk upload carries exam / year / classLevel, and old files still work ──
const ck = new Set(['seceng']);
const out = planBulk([
  { course: 'SEC-ENG', q: 'Pick the synonym of "big"', opts: ['large', 'tiny', 'thin', 'slow'], ans: 0, exam: 'JAMB', year: '2019' },
  { course: 'SEC-ENG', q: 'Another one', opts: ['a', 'b'], ans: 1, exam: 'ielts', year: 'soon', classLevel: 'ss 2' },
  { course: 'SEC-ENG', q: 'Plain old question', opts: ['a', 'b', 'c', 'd'], ans: 2 },
], ck, new Set());
assert.strictEqual(out.accepted.length, 3);
assert.deepStrictEqual([out.accepted[0].exam, out.accepted[0].year], ['jamb', 2019]);
assert.deepStrictEqual(Object.keys(out.accepted[1]).filter(k => ['exam', 'year', 'classLevel'].includes(k)), ['classLevel'], 'bad exam and year are dropped, classLevel is normalised');
assert.strictEqual(out.accepted[1].classLevel, 'SS2'); assert.strictEqual(out.accepted[2].exam, undefined);
assert.deepStrictEqual(secondaryMeta({ year: 1500 }), {}, 'implausible years are dropped');

// ── the question filter: general questions (no exam / class) are always allowed; tagged ones only for their exam ──
// stubs go in BEFORE the routes are loaded: the route file destructures these at require time
const authMw = require(path.join(ROOT, 'src/middleware/auth.js')); authMw.requireStudent = (req, res, next) => { req.student = { sub: 'TEST001' }; next(); }; authMw.requireTrack = () => (req, res, next) => next();   // the real track gate is covered by tracklock.test.js
const ent = require(path.join(ROOT, 'src/services/entitlements.service.js')); let locked = null; ent.requireFeature = key => (req, res, next) => locked === key ? res.status(403).json({ code: 'FEATURE_LOCKED', feature: key }) : next();
const tier = require(path.join(ROOT, 'src/services/tier.service.js')); let capLeft = Infinity; tier.checkDailyLimit = async (st, kind, n) => { if (n > capLeft) { const e = new Error('Daily question limit reached'); e.code = 'LIMIT_REACHED'; e.limit = capLeft; e.used = 0; e.tier = 'free'; throw e; } return {}; };
const routes = require(path.join(ROOT, 'src/routes/secondary.routes.js'));
if (mingo && mingo.Query) {
  const Q = [
    { course: 'seceng', exam: 'jamb', year: 2019 }, { course: 'SEC-ENG', exam: 'waec', year: 2019 }, { course: 'seceng' }, { course: 'seceng', exam: '' },
    { course: 'secmth', exam: 'jamb' }, { course: 'seceng', exam: 'school', classLevel: 'SS1' }, { course: 'seceng', exam: 'school', classLevel: 'JSS2' }, { course: 'seceng', exam: null },
  ];
  const run = f => Q.filter(d => new mingo.Query(routes.questionFilter({ key: 'seceng', courseCode: 'SEC-ENG' }, f)).test(d));
  assert.strictEqual(run({ exam: 'jamb' }).length, 4, 'jamb sees jamb + general (any case of key or code), never waec / school ones');
  assert.strictEqual(run({ exam: 'waec' }).length, 4);
  assert.strictEqual(run({ exam: 'jamb', year: 2019 }).length, 1);
  assert.strictEqual(run({ exam: 'school', classLevel: 'SS1' }).length, 4, 'school: its own class + general');
  assert.strictEqual(run({}).length, 7);
}

// ── the routes, run against stubbed models ──
const Course = require(path.join(ROOT, 'src/models/Course.js')), Question = require(path.join(ROOT, 'src/models/Question.js')), Student = require(path.join(ROOT, 'src/models/Student.js')), Score = require(path.join(ROOT, 'src/models/Score.js')), QA = require(path.join(ROOT, 'src/models/QuestionAttempt.js'));
const courseDocs = docs.map((d, i) => ({ _id: 'c' + i, ...d }));
const query = v => { const p = Promise.resolve(v); p.select = () => p; p.lean = () => p; p.sort = () => p; p.limit = () => p; return p; };
Course.find = f => query(courseDocs.filter(c => !f || !f.key || (f.key.$in || [f.key]).includes(c.key)));
Course.findOne = f => query(courseDocs.find(c => c.key === f.key) || null);
const bank = (course, n) => Array.from({ length: n }, (_, i) => ({ _id: course + i, course, q: `${course} question ${i}`, opts: ['a', 'b', 'c', 'd'], ans: i % 4, tag: 'Algebra', exp: '', year: 2019 }));
const pools = { seceng: bank('seceng', 100), secmth: bank('secmth', 100), secphy: bank('secphy', 10), secchm: bank('secchm', 100), secbio: bank('secbio', 100) };
Question.aggregate = pipe => {
  const m = pipe.find(s => s.$match), sample = pipe.find(s => s.$sample);
  const src = JSON.stringify(m || {}, (k, v) => (v instanceof RegExp ? v.source : v)), course = Object.keys(pools).find(k => src.toLowerCase().includes('^(' + k));   // RegExp has no JSON form, so use its source
  return Promise.resolve(sample && course ? pools[course].slice(0, sample.$sample.size) : []);
};
let saved = null; const student = { matric: 'TEST001', track: 'secondary', secondary: undefined, save: async function () { saved = JSON.parse(JSON.stringify(this)); }, profileCompleted: false };
Student.findOne = () => query(student);
Score.find = () => query([]); QA.aggregate = () => Promise.resolve([]);

const express = require('express'); const app = express(); app.use(express.json()); app.use('/api', routes);
const srv = app.listen(0, async () => {
  const base = `http://127.0.0.1:${srv.address().port}/api/secondary`;
  const call = async (p, method = 'GET', body) => { const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
  try {
    let r = await call('/config'); assert.strictEqual(r.status, 200); assert.ok(r.body.subjects.length >= 15 && r.body.combos.length > 5 && r.body.exams.jamb);
    assert.ok(r.body.combos.every(c => c.subjects.length === 4), 'every combo resolves to four real subject keys');

    // setup: rules are enforced, English is pulled to the front, and the university prompt is cleared
    r = await call('/profile', 'PUT', { exam: 'jamb', subjects: ['secphy', 'secmth', 'seceng'] }); assert.strictEqual(r.status, 400);
    r = await call('/profile', 'PUT', { exam: 'jamb', subjects: ['secphy', 'secmth', 'seceng', 'secchm'], targetScore: 250 }); assert.strictEqual(r.status, 200);
    assert.strictEqual(saved.track, 'secondary'); assert.strictEqual(saved.profileCompleted, true); assert.strictEqual(saved.secondary.subjects[0], 'seceng', 'English first');
    student.secondary = { exam: 'jamb', subjects: ['seceng', 'secmth', 'secphy', 'secchm'], toObject() { return { exam: this.exam, subjects: this.subjects }; } };

    // JAMB full mock: 60/40/40/40, two hours; physics only has 10 questions so the clock shrinks and the paper says it is short
    r = await call('/paper?exam=jamb&kind=mock'); assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.sections.map(s => s.questions.length), [60, 40, 10, 40]); assert.strictEqual(r.body.short, true);
    assert.ok(r.body.minutes < 120 && r.body.minutes >= 5); assert.strictEqual(r.body.sections[0].course, 'seceng');
    r = await call('/paper?exam=jamb&kind=mock&mini=1'); assert.strictEqual(r.body.total, 15 + 10 + 10 + 10); assert.strictEqual(r.body.minutes, 30);

    // the plan's daily allowance is checked up front, with a clear message
    capLeft = 20; r = await call('/paper?exam=jamb&kind=mock'); assert.strictEqual(r.status, 403); assert.strictEqual(r.body.code, 'LIMIT_REACHED'); assert.ok(r.body.needed > 20);
    r = await call('/paper?exam=jamb&kind=mock&mini=1'); assert.strictEqual(r.status, 403, 'even the mini mock (45) is over a 20/day allowance, and says so'); capLeft = Infinity;
    locked = 'examMode'; r = await call('/paper?exam=jamb&kind=mock'); assert.strictEqual(r.status, 403); assert.strictEqual(r.body.code, 'FEATURE_LOCKED');
    r = await call('/paper?exam=waec&kind=practice&subject=secbio&count=10'); assert.strictEqual(r.status, 200, 'practice needs a different feature (practiceQuestions), not examMode'); locked = null;

    // single-subject papers and practice
    r = await call('/paper?exam=waec&kind=mock&subject=secbio'); assert.strictEqual(r.body.total, 50); assert.strictEqual(r.body.minutes, 60);
    r = await call('/paper?exam=neco&kind=mock&subject=secbio'); assert.strictEqual(r.body.total, 60);
    r = await call('/paper?exam=waec&kind=practice&subject=secbio&count=500'); assert.strictEqual(r.body.total, 50, 'practice count is capped'); assert.strictEqual(r.body.minutes, null);
    r = await call('/paper?exam=waec&kind=practice&subject=nope'); assert.strictEqual(r.status, 400);
    r = await call('/paper?exam=gce&kind=practice&subject=secbio'); assert.strictEqual(r.status, 400);
    r = await call('/paper?exam=jamb&kind=practice&subject=seceng&count=10'); assert.strictEqual(r.status, 200); assert.ok(r.body.sections[0].questions[0].ans !== undefined);

    // an unset JAMB profile is told to finish setup
    student.secondary = { exam: 'waec', subjects: ['seceng'], toObject() { return { exam: 'waec', subjects: ['seceng'] }; } };
    r = await call('/paper?exam=jamb&kind=mock'); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'NEEDS_SETUP');

    // v1.12: nobody can switch apps themselves any more
    r = await call('/track', 'PUT', { track: 'university' }); assert.strictEqual(r.status, 403); assert.strictEqual(r.body.code, 'TRACK_LOCKED');
    console.log('secondary: grading, JAMB 180Q/400 scoring, subject rules, filters, bulk metadata, setup and paper routes OK');
    srv.close(); process.exit(0);
  } catch (e) { console.error(e); srv.close(); process.exit(1); }
});
