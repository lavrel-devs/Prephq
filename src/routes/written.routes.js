const express = require('express');
const rateLimit = require('express-rate-limit');
const Student = require('../models/Student');
const Course = require('../models/Course');
const Question = require('../models/Question');
const WrittenExam = require('../models/WrittenExam');
const { requireStudent } = require('../middleware/auth');
const { generateTheoryQuestions, markTheoryAnswers } = require('../services/groq.service');
const { checkDailyLimit, incrementDailyUsage } = require('../services/tier.service');
const { requireFeature } = require('../services/entitlements.service');
const { normalizeQuestions, normalizeAnswers, applyMarking, totals, publicQuestions } = require('../services/written.service');
const { courseMatchFilter } = require('../utils/courseMatch');
const { withLock } = require('../utils/lock');
const { isObjectId } = require('../utils/validate');

// ── Written Exam (v1.8.0) ─────────────────────────────────────
// Theory/essay mode: the AI sets questions with a hidden marking scheme, the student types answers against a
// timer, the AI marks them rubric-point by rubric-point and shows what was missed plus a model answer.
//   • Starting an exam uses one of the student's "written exams per day" (Free: Admin setting, default 1; Premium:
//     unlimited by default). Marking is free once an exam is started.
//   • The scheme and model answers never leave the server until the exam has been submitted and marked.
//   • Answers are saved BEFORE marking, so an AI hiccup never loses what the student wrote; submitting again retries.
const router = express.Router();
router.use(requireStudent);

const MIN_Q = 1, MAX_Q = 5, DEFAULT_Q = 3, MIN_PER_QUESTION = 8, GRACE_MIN = 2, OPEN_EXAM_HOURS = 3;
const startLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many exams started. Slow down a little.' } });
const submitLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many submissions. Slow down a little.' } });

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const endsAt = e => new Date(new Date(e.startedAt).getTime() + e.durationMin * 60000);

function openView(e) {
  return { id: String(e._id), status: 'open', course: e.course, topic: e.topic, difficulty: e.difficulty, durationMin: e.durationMin,
    startedAt: e.startedAt, endsAt: endsAt(e), questions: publicQuestions(e.questions), answers: e.answers || [] };
}
// Only ever built for a MARKED exam — this is the one place the scheme and model answers are revealed.
function markedView(e) {
  return { id: String(e._id), status: 'marked', course: e.course, topic: e.topic, difficulty: e.difficulty, durationMin: e.durationMin,
    startedAt: e.startedAt, submittedAt: e.submittedAt, late: !!e.late, total: e.total, maxTotal: e.maxTotal, pct: pct(e.total, e.maxTotal),
    questions: e.questions.map((q, i) => {
      const r = (e.results || [])[i] || { score: 0, met: [], feedback: '', tip: '' };
      return { q: q.q, marks: q.marks, answer: (e.answers || [])[i] || '', score: r.score, feedback: r.feedback, tip: r.tip, model: q.model,
        rubric: q.rubric.map((p, idx) => ({ point: p.point, marks: p.marks, earned: (r.met || []).includes(idx) })) };
    }) };
}

// POST /api/written/start  { course, topic?, difficulty?, count? }
router.post('/start', startLimiter, requireFeature('writtenExam'), (req, res) =>
  withLock(`writtenstart:${req.student.sub}`, () => startHandler(req, res)));

async function startHandler(req, res) {
  try {
    const course = typeof req.body.course === 'string' ? req.body.course.trim() : '';
    if (!course) return res.status(400).json({ error: 'Choose a course' });
    if (!/^[A-Za-z0-9 _&.,()\/'\-]{2,60}$/.test(course)) return res.status(400).json({ error: 'That course looks invalid' });
    const topic = typeof req.body.topic === 'string' ? req.body.topic.trim().replace(/[<>"]/g, '').slice(0, 80) : '';
    const difficulty = ['easy', 'medium', 'hard'].includes(req.body.difficulty) ? req.body.difficulty : 'medium';
    let count = DEFAULT_Q;
    if (req.body.count !== undefined && req.body.count !== null && req.body.count !== '') {
      const n = Number(req.body.count);
      if (!Number.isInteger(n) || n < MIN_Q || n > MAX_Q) return res.status(400).json({ error: `A written exam has ${MIN_Q} to ${MAX_Q} questions`, code: 'INVALID_COUNT', min: MIN_Q, max: MAX_Q });
      count = n;
    }

    const matric = req.student.sub;
    // One exam at a time: coming back to an unfinished one is free and doesn't use another of today's exams.
    const since = new Date(Date.now() - OPEN_EXAM_HOURS * 3600000);
    const open = await WrittenExam.findOne({ matric, status: 'open', startedAt: { $gte: since } }).sort({ startedAt: -1 }).lean();
    if (open) return res.status(409).json({ error: 'You have an exam in progress — finish it first.', code: 'EXAM_IN_PROGRESS', exam: openView(open) });

    const student = await Student.findOne({ matric });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    try { await checkDailyLimit(student, 'written'); }
    catch (e) {
      if (e.code === 'LIMIT_REACHED') return res.status(403).json({ error: e.message, code: 'LIMIT_REACHED', tier: e.tier, limit: e.limit, used: e.used });
      throw e;
    }

    // Ground the questions in the real syllabus: the course title, the topic tags we already hold, a few past questions.
    const match = await courseMatchFilter(course);
    const [courseDoc, tags, samples] = await Promise.all([
      Course.findOne({ key: course.toLowerCase().replace(/[^a-z0-9]/g, '') }).select('title').lean(),
      Question.distinct('tag', match).catch(() => []),
      Question.aggregate([{ $match: match }, { $sample: { size: 6 } }, { $project: { q: 1 } }]).catch(() => []),
    ]);
    let generated;
    try {
      generated = await generateTheoryQuestions({
        course, courseTitle: (courseDoc && courseDoc.title) || '', topic, difficulty, count,
        topics: (tags || []).filter(t => typeof t === 'string' && t.trim()).slice(0, 40), samples: samples.map(s => String(s.q).slice(0, 220)),
      });
    } catch (e) {
      return res.status(e.code === 'GROQ_NOT_CONFIGURED' ? 503 : 502).json({ error: e.message, code: e.code || 'GROQ_ERROR' });
    }
    const questions = normalizeQuestions(generated.questions, count);
    if (!questions.length) return res.status(502).json({ error: 'The AI did not return a usable exam. Please try again — this did not use up one of your exams.', code: 'GROQ_EMPTY' });

    const exam = await WrittenExam.create({ matric, course, topic, difficulty, durationMin: questions.length * MIN_PER_QUESTION, questions });
    await incrementDailyUsage(student, 'written');   // only a successfully built exam counts
    res.status(201).json(openView(exam.toObject ? exam.toObject() : exam));
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// GET /api/written — my past exams (newest first)
router.get('/', async (req, res) => {
  try {
    const rows = await WrittenExam.find({ matric: req.student.sub }).sort({ startedAt: -1 }).limit(30).select('course topic startedAt status total maxTotal').lean();
    res.json(rows.map(r => ({ id: String(r._id), course: r.course, topic: r.topic, startedAt: r.startedAt, status: r.status, total: r.total, maxTotal: r.maxTotal, pct: r.status === 'marked' ? pct(r.total, r.maxTotal) : null })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/written/active — my unfinished exam, if any (so a refresh or a closed tab doesn't lose it)
router.get('/active', async (req, res) => {
  try {
    const since = new Date(Date.now() - OPEN_EXAM_HOURS * 3600000);
    const open = await WrittenExam.findOne({ matric: req.student.sub, status: 'open', startedAt: { $gte: since } }).sort({ startedAt: -1 }).lean();
    res.json({ exam: open ? openView(open) : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/written/:id — an open exam shows only its questions; a marked one shows everything
router.get('/:id', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Exam not found' });
    const e = await WrittenExam.findOne({ _id: req.params.id, matric: req.student.sub }).lean();
    if (!e) return res.status(404).json({ error: 'Exam not found' });
    res.json(e.status === 'marked' ? markedView(e) : openView(e));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/written/:id/submit  { answers: [string, ...] } — save, then mark
router.post('/:id/submit', submitLimiter, (req, res) =>
  withLock(`writtensubmit:${req.params.id}`, () => submitHandler(req, res)));

async function submitHandler(req, res) {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Exam not found' });
    const matric = req.student.sub;
    const exam = await WrittenExam.findOne({ _id: req.params.id, matric }).lean();
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    if (exam.status === 'marked') return res.json(markedView(exam));   // submitting twice just shows the result again

    const answers = normalizeAnswers(req.body && req.body.answers, exam.questions.length);
    const late = Date.now() > endsAt(exam).getTime() + GRACE_MIN * 60000;
    // Saved first: if marking fails below, nothing the student wrote is lost.
    await WrittenExam.updateOne({ _id: exam._id, status: 'open' }, { $set: { answers, submittedAt: new Date(), late } });

    const items = exam.questions.map((q, i) => ({ i, q: q.q, rubric: q.rubric, answer: answers[i] })).filter(it => it.answer);
    let marking = { results: [] };
    if (items.length) {
      try { ({ marking } = await markTheoryAnswers({ course: exam.course, items })); }
      catch (e) {
        return res.status(e.code === 'GROQ_NOT_CONFIGURED' ? 503 : 502).json({
          error: 'Marking is busy right now. Your answers are saved — tap Submit again in a moment.', code: e.code || 'GROQ_ERROR', saved: true });
      }
    }
    const results = applyMarking(exam.questions, answers, marking);
    const t = totals(exam.questions, results);
    const done = await WrittenExam.findOneAndUpdate(
      { _id: exam._id, status: 'open' },
      { $set: { status: 'marked', results, total: t.total, maxTotal: t.maxTotal, markedAt: new Date() } },
      { new: true },
    ).lean();
    res.json(markedView(done || { ...exam, answers, results, total: t.total, maxTotal: t.maxTotal, status: 'marked', late, submittedAt: new Date() }));
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = router;
