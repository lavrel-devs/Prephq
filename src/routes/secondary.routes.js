// Wreddi Secondary (v1.11) — JAMB / WAEC / NECO / school exam prep.
//
// It reuses the existing collections: a subject is a Course with track 'secondary', questions live in the same Question
// bank (optionally tagged exam / year / classLevel), and finished papers are saved through the normal POST /api/scores
// route with a `sec` block. This file only adds what the secondary app needs on top: setup, the paper builder, the
// overview and the history.
const express = require('express');
const Course = require('../models/Course');
const Question = require('../models/Question');
const Student = require('../models/Student');
const Score = require('../models/Score');
const QuestionAttempt = require('../models/QuestionAttempt');
const { requireStudent, requireTrack } = require('../middleware/auth');
const { requireFeature } = require('../services/entitlements.service');
const { checkDailyLimit } = require('../services/tier.service');
const { escapeRegex } = require('../utils/validate');
const S = require('../utils/secondary');

const router = express.Router();
router.use('/secondary', requireStudent, requireTrack('secondary'));   // v1.12: only Secondary accounts get in

const subjectMeta = code => S.SUBJECTS.find(s => s.code === code) || null;
async function secondaryCourses() { return Course.find({ track: 'secondary' }).sort({ courseTitle: 1 }).lean(); }
const publicCourse = c => {
  const m = subjectMeta(c.courseCode);
  return { key: c.key, code: c.courseCode, title: c.courseTitle, color: c.color, icon: c.icon, topics: c.topics || [], exams: m ? m.exams : S.EXAM_KEYS, core: !!(m && m.core) };
};

// GET /api/secondary/config — everything the setup screen and the paper screens need, in one request.
router.get('/secondary/config', async (req, res) => {
  try {
    const courses = (await secondaryCourses()).map(publicCourse);
    const byCode = new Map(courses.map(c => [c.code, c.key]));
    res.json({
      exams: S.EXAMS, papers: S.PAPERS, classLevels: S.CLASS_LEVELS, gradeBands: S.GRADE_BANDS,
      subjects: courses,
      combos: S.JAMB_COMBOS.map(c => ({ course: c.course, subjects: c.subjects.map(code => byCode.get(code)).filter(Boolean) })),
    });
  } catch (e) { res.status(500).json({ error: 'Could not load the Secondary setup' }); }
});

// GET /api/secondary/profile
router.get('/secondary/profile', async (req, res) => {
  try {
    const st = await Student.findOne({ matric: req.student.sub }).select('track secondary university department').lean();
    if (!st) return res.status(404).json({ error: 'Student not found' });
    const sec = st.secondary || {};
    res.json({
      matric: req.student.sub,
      track: st.track || 'university',
      setUp: !!(sec.exam && (sec.subjects || []).length),
      secondary: { exam: sec.exam || '', classLevel: sec.classLevel || '', subjects: sec.subjects || [], examDate: sec.examDate || null, targetScore: sec.targetScore ?? null, school: sec.school || '', courseOfStudy: sec.courseOfStudy || '' },
    });
  } catch (e) { res.status(500).json({ error: 'Could not load your Secondary profile' }); }
});

// PUT /api/secondary/profile — saves the exam setup. When both an exam and a valid subject list are present the student
// becomes a secondary student (track = 'secondary') and the university "complete your profile" prompt is cleared, because
// they will never fill university / department / courses.
router.put('/secondary/profile', async (req, res) => {
  try {
    const known = new Set((await secondaryCourses()).map(c => c.key));
    const parsed = S.cleanProfile(req.body, known);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const st = await Student.findOne({ matric: req.student.sub });
    if (!st) return res.status(404).json({ error: 'Student not found' });
    const cur = (st.secondary && st.secondary.toObject) ? st.secondary.toObject() : (st.secondary || {});
    const next = { exam: '', classLevel: '', subjects: [], examDate: null, targetScore: null, school: '', courseOfStudy: '', ...cur, ...parsed.value };

    if (next.exam) {
      const bad = S.validateSubjects(next.exam, next.subjects);
      if (bad) return res.status(400).json({ error: bad });
      if (next.exam === 'jamb' && next.subjects[0] !== S.KEY_ENG) {           // English always comes first in a JAMB paper
        next.subjects = [S.KEY_ENG, ...next.subjects.filter(k => k !== S.KEY_ENG)];
      }
    }
    st.secondary = next;
    if (next.exam && next.subjects.length) st.profileCompleted = true;
    await st.save();
    res.json({ success: true, track: st.track, secondary: next });
  } catch (e) { res.status(500).json({ error: 'Could not save your setup' }); }
});

// v1.12: PUT /api/secondary/track is gone. An account belongs to one app for good; only an admin can move it
// (PUT /api/admin/students/:matric { track }). Left as an explicit refusal so an old client gets a clear answer.
router.put('/secondary/track', (req, res) => res.status(403).json({ error: 'Accounts cannot switch between the university and Secondary apps. Create a separate account.', code: 'TRACK_LOCKED' }));

// A question belongs to a subject if its stored `course` equals the subject's key or code (any case) — same rule as the
// university bank. exam / classLevel are optional on a question: one with none is a general question and is always allowed.
function questionFilter(course, { exam, classLevel, year, topic } = {}) {
  const names = [course.key, course.courseCode].filter(Boolean).map(escapeRegex).join('|');
  const and = [{ course: { $regex: new RegExp(`^(${names})$`, 'i') } }];
  const open = f => ({ $or: [{ [f]: '' }, { [f]: { $exists: false } }, { [f]: null }] });
  if (exam && exam !== 'school') and.push({ $or: [{ exam }, ...open('exam').$or] });
  if (exam === 'school') and.push({ $or: [{ exam: 'school' }, ...open('exam').$or] });
  if (classLevel) and.push({ $or: [{ classLevel }, ...open('classLevel').$or] });
  if (year) and.push({ year });
  if (topic) and.push({ tag: { $regex: new RegExp(`^${escapeRegex(topic)}$`, 'i') } });
  return { $and: and };
}
const pick = (course, n, f) => n > 0 ? Question.aggregate([{ $match: questionFilter(course, f) }, { $sample: { size: n } }]) : Promise.resolve([]);
const wire = (q, course) => ({ _id: q._id, course: course.key, q: q.q, opts: q.opts, ans: q.ans, tag: q.tag || '', exp: q.exp || '', year: q.year || null, exam: q.exam || '' });

// GET /api/secondary/topics?course=seceng[&exam=jamb] — topics (question tags) and past-question years that really have questions.
router.get('/secondary/topics', async (req, res) => {
  try {
    const key = String(req.query.course || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const course = await Course.findOne({ key, track: 'secondary' }).lean();
    if (!course) return res.status(404).json({ error: 'Unknown subject' });
    const exam = S.EXAM_KEYS.includes(req.query.exam) ? req.query.exam : '';
    const match = { $match: questionFilter(course, { exam }) };
    const [tags, years] = await Promise.all([
      Question.aggregate([match, { $match: { tag: { $ne: '' } } }, { $group: { _id: '$tag', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 80 }]),
      Question.aggregate([match, { $match: { year: { $ne: null } } }, { $group: { _id: '$year', n: { $sum: 1 } } }, { $sort: { _id: -1 } }, { $limit: 40 }]),
    ]);
    res.json({ topics: tags.map(t => ({ tag: t._id, n: t.n })), years: years.map(y => ({ year: y._id, n: y.n })) });
  } catch (e) { res.status(500).json({ error: 'Could not load topics' }); }
});

// GET /api/secondary/paper — builds a paper for the student.
//   exam      jamb | waec | neco | school
//   kind      mock (a timed paper, needs Exam mode) | practice (untimed or self-timed, needs Practice questions)
//   subject   a secondary course key (not used for a JAMB mock, which uses the student's four subjects)
//   mini=1    a shorter paper (also what fits inside a Free plan's daily question cap)
//   count     practice only, 5–50      topic, year    optional filters
router.get('/secondary/paper', (req, res, next) =>
  requireFeature(req.query.kind === 'practice' ? 'practiceQuestions' : 'examMode')(req, res, next),
async (req, res) => {
  try {
    const exam = S.EXAM_KEYS.includes(req.query.exam) ? req.query.exam : null;
    if (!exam) return res.status(400).json({ error: 'Choose JAMB, WAEC, NECO or School.' });
    const kind = req.query.kind === 'practice' ? 'practice' : 'mock';
    const mini = req.query.mini === '1' || req.query.mini === 'true';
    const st = await Student.findOne({ matric: req.student.sub });
    if (!st) return res.status(404).json({ error: 'Student not found' });
    const prof = (st.secondary && st.secondary.toObject) ? st.secondary.toObject() : (st.secondary || {});
    const classLevel = exam === 'school' ? (S.CLASS_LEVELS.includes(req.query.classLevel) ? req.query.classLevel : (prof.classLevel || '')) : '';
    const year = Number.parseInt(req.query.year, 10) || null;
    const topic = typeof req.query.topic === 'string' ? req.query.topic.slice(0, 80) : '';
    const filt = { exam, classLevel, year, topic };

    const all = await secondaryCourses();
    const byKey = new Map(all.map(c => [c.key, c]));
    let sections = [], minutes, label;

    if (exam === 'jamb' && kind === 'mock') {
      const keys = (prof.subjects || []).filter(k => byKey.has(k));
      if (prof.exam !== 'jamb' || keys.length !== 4) return res.status(400).json({ error: 'Set up your four JAMB subjects first.', code: 'NEEDS_SETUP' });
      const shape = S.jambShape(4, mini);
      for (let i = 0; i < 4; i++) {
        const course = byKey.get(keys[i]);
        const qs = await pick(course, shape.counts[i], { exam: 'jamb', year, topic });
        sections.push({ course: course.key, title: course.courseTitle, wanted: shape.counts[i], questions: qs.map(q => wire(q, course)) });
      }
      minutes = shape.minutes; label = mini ? 'JAMB mini mock' : 'JAMB full mock';
    } else {
      const course = byKey.get(String(req.query.subject || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
      if (!course) return res.status(400).json({ error: 'Pick a subject.' });
      const cfg = S.PAPERS[exam];
      let want;
      if (kind === 'mock') { want = exam === 'jamb' ? (mini ? 10 : 40) : (mini ? cfg.mini.questions : cfg.questions); minutes = exam === 'jamb' ? (mini ? 10 : 40) : (mini ? cfg.mini.minutes : cfg.minutes); }
      else { want = Math.max(5, Math.min(Number.parseInt(req.query.count, 10) || 20, 50)); minutes = null; }
      const qs = await pick(course, want, filt);
      sections.push({ course: course.key, title: course.courseTitle, wanted: want, questions: qs.map(q => wire(q, course)) });
      label = kind === 'mock' ? `${S.EXAMS[exam].short} ${course.courseTitle} paper` : `${course.courseTitle} practice`;
    }

    const total = sections.reduce((a, s) => a + s.questions.length, 0);
    if (!total) return res.status(404).json({ error: 'No questions for that yet. Try another subject, topic or year, or check back soon.', code: 'NO_QUESTIONS' });
    // A short bank gets a proportionally shorter clock, so a 12-question paper is not given two hours.
    if (minutes) { const wantedTotal = sections.reduce((a, s) => a + s.wanted, 0); if (total < wantedTotal) minutes = Math.max(5, Math.round(minutes * total / wantedTotal)); }

    // Tell the student up front if their plan's daily question allowance can't cover this paper, instead of after they finish it.
    try { await checkDailyLimit(st, 'questions', total); }
    catch (e) {
      if (e.code === 'LIMIT_REACHED') return res.status(403).json({ error: e.message, code: 'LIMIT_REACHED', tier: e.tier, limit: e.limit, used: e.used, needed: total });
      throw e;
    }

    res.json({ exam, kind, label, minutes, total, short: total < sections.reduce((a, s) => a + s.wanted, 0), year, topic, classLevel, sections });
  } catch (e) { console.error('[secondary] paper failed:', e); res.status(500).json({ error: 'Could not build that paper' }); }
});

// GET /api/secondary/overview — the hub: per-subject bank size and accuracy, exam countdown, latest results, credit check.
router.get('/secondary/overview', async (req, res) => {
  try {
    const st = await Student.findOne({ matric: req.student.sub }).select('matric track secondary').lean();
    if (!st) return res.status(404).json({ error: 'Student not found' });
    const prof = st.secondary || {};
    const keys = prof.subjects || [];
    const courses = keys.length ? await Course.find({ key: { $in: keys }, track: 'secondary' }).lean() : [];
    const names = [...new Set(courses.flatMap(c => [c.key, c.courseCode].map(x => String(x).toLowerCase())))];

    const [counts, acc, recent] = await Promise.all([
      names.length ? Question.aggregate([{ $match: { $expr: { $in: [{ $toLower: '$course' }, names] } } }, { $group: { _id: { $toLower: '$course' }, n: { $sum: 1 } } }]) : [],
      keys.length ? QuestionAttempt.aggregate([{ $match: { matric: st.matric, course: { $in: keys } } }, { $group: { _id: '$course', n: { $sum: 1 }, correct: { $sum: { $cond: ['$correct', 1, 0] } } } }]) : [],
      Score.find({ matric: st.matric, sec: { $exists: true } }).sort({ ts: -1 }).limit(40).lean(),
    ]);
    const nBy = new Map(counts.map(r => [r._id, r.n])), aBy = new Map(acc.map(r => [r._id, r]));
    const subjects = keys.map(k => {
      const c = courses.find(x => x.key === k); if (!c) return null;
      const a = aBy.get(k);
      return { ...publicCourse(c), questions: (nBy.get(c.key) || 0) + (c.courseCode.toLowerCase() === c.key ? 0 : (nBy.get(c.courseCode.toLowerCase()) || 0)), attempts: a ? a.n : 0, accuracy: a && a.n ? Math.round((a.correct / a.n) * 100) : null };
    }).filter(Boolean);

    // Best WAEC/NECO grade per subject across mock papers, for the "5 credits incl. English and Maths" check.
    const best = {}; const order = S.GRADE_BANDS.map(b => b.grade);
    for (const sc of recent) if (sc.sec && sc.sec.kind === 'mock' && sc.sec.exam === prof.exam && prof.exam !== 'jamb' && prof.exam !== 'school')
      for (const r of sc.sec.rows) if (!best[r.course] || order.indexOf(r.grade) < order.indexOf(best[r.course])) best[r.course] = r.grade;
    const utmes = recent.filter(sc => sc.sec && sc.sec.exam === 'jamb' && sc.sec.kind === 'mock' && Number.isFinite(sc.sec.utme)).map(sc => ({ utme: sc.sec.utme, ts: sc.ts }));

    res.json({
      track: st.track || 'university',
      exam: prof.exam || '', classLevel: prof.classLevel || '', targetScore: prof.targetScore ?? null, examDate: prof.examDate || null,
      daysLeft: S.daysUntil(prof.examDate), subjects,
      credit: (prof.exam === 'waec' || prof.exam === 'neco') ? { ...S.creditCheck(best), best } : null,
      utme: utmes.length ? { latest: utmes[0].utme, best: Math.max(...utmes.map(u => u.utme)), trend: utmes.slice(0, 8).reverse().map(u => u.utme) } : null,
      papers: recent.filter(sc => sc.sec && sc.sec.kind === 'mock').length,
    });
  } catch (e) { console.error('[secondary] overview failed:', e); res.status(500).json({ error: 'Could not load your overview' }); }
});

// GET /api/secondary/history — the student's recent secondary papers, newest first.
router.get('/secondary/history', async (req, res) => {
  try {
    const rows = await Score.find({ matric: req.student.sub, sec: { $exists: true } }).sort({ ts: -1 }).limit(30).lean();
    res.json(rows.map(r => ({ id: r._id, ts: r.ts, pct: r.pct, correct: r.correct, total: r.total, sec: r.sec })));
  } catch (e) { res.status(500).json({ error: 'Could not load your history' }); }
});

module.exports = router;
module.exports.questionFilter = questionFilter;   // exported for tests
