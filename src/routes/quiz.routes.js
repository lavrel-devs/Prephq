const express = require('express');
const rateLimit = require('express-rate-limit');

const Student = require('../models/Student');
const GeneratedQuestion = require('../models/GeneratedQuestion');

const { requireStudent } = require('../middleware/auth');
const { applyCreditDelta } = require('../utils/credits');
const { generateQuiz, explainAnswer } = require('../services/groq.service');
const { checkDailyLimit, incrementDailyUsage } = require('../services/tier.service');
const { withLock } = require('../utils/lock');
const { isObjectId } = require('../utils/validate');

const router = express.Router();
router.use(requireStudent);

const QUIZ_COST = parseInt(process.env.CREDIT_COST_QUIZ_GEN || '5', 10);

const genLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many quiz generation requests. Slow down a little.' },
});

// v1.3: separate, more generous limiter for wrong-answer explanations —
// this is a free learning aid (no credit cost), not content generation,
// so it gets its own bucket rather than sharing genLimiter's tighter cap.
const explainLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many explanation requests. Slow down a little.' },
});

// POST /api/quiz/generate  { course, difficulty, count?, studyMaterial? }
router.post('/generate', genLimiter, (req, res) => {
  // One generation at a time per student: the credit/daily-limit checks
  // below run before a multi-second AI call, so parallel requests could
  // each pass them and overspend.
  return withLock(`quizgen:${req.student.sub}`, () => generateHandler(req, res));
});

async function generateHandler(req, res) {
  try {
    const { difficulty, count, studyMaterial } = req.body;
    // `course` is interpolated into the AI prompt, so keep it to a
    // plain course-code-like string rather than arbitrary text.
    const course = typeof req.body.course === 'string' ? req.body.course.trim() : '';
    if (!course) return res.status(400).json({ error: 'Course code is required' });
    if (!/^[A-Za-z0-9 _&.,()\/'\-]{2,60}$/.test(course)) return res.status(400).json({ error: 'That course code looks invalid' });

    const diff = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';
    const qCount = Math.min(Math.max(parseInt(count) || 10, 5), 20);
    // Cap study material length so a huge paste/PDF can't blow up the
    // prompt — it's discarded after this request either way, never stored.
    const material = typeof studyMaterial === 'string' ? studyMaterial.trim().slice(0, 6000) : '';

    const matric = req.student.sub;
    const student = await Student.findOne({ matric });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    try {
      await checkDailyLimit(student, 'aiQuiz');
    } catch (e) {
      if (e.code === 'LIMIT_REACHED') {
        return res.status(403).json({ error: e.message, code: 'LIMIT_REACHED', tier: e.tier, limit: e.limit, used: e.used });
      }
      throw e;
    }

    if ((student.credits || 0) < QUIZ_COST) {
      return res.status(402).json({
        error: `Not enough credits. This costs ${QUIZ_COST} credits, you have ${student.credits || 0}.`,
        code: 'INSUFFICIENT_CREDITS',
        required: QUIZ_COST,
        balance: student.credits || 0,
      });
    }

    // Generate first, only charge credits on success — don't charge for a
    // failed AI call.
    let generated;
    try {
      generated = await generateQuiz({ course, difficulty: diff, count: qCount, studyMaterial: material });
    } catch (e) {
      const status = e.code === 'GROQ_NOT_CONFIGURED' ? 503 : 502;
      return res.status(status).json({ error: e.message, code: e.code || 'GROQ_ERROR' });
    }

    if (!generated.questions.length) {
      return res.status(502).json({ error: 'AI did not return any usable questions. Try again.', code: 'GROQ_EMPTY' });
    }

    let balance;
    try {
      ({ balance } = await applyCreditDelta({
        matric,
        delta: -QUIZ_COST,
        reason: 'quiz_generation',
        note: `AI quiz — ${course} (${diff})`,
        actor: 'system',
      }));
    } catch (e) {
      if (e.code === 'INSUFFICIENT_CREDITS') {
        return res.status(402).json({
          error: `Not enough credits. This costs ${QUIZ_COST} credits.`,
          code: 'INSUFFICIENT_CREDITS',
          required: QUIZ_COST,
        });
      }
      throw e;
    }

    let record;
    try {
      record = await GeneratedQuestion.create({
        matric,
        course,
        difficulty: diff,
        model: generated.model,
        creditCost: QUIZ_COST,
        questions: generated.questions,
      });
    } catch (e) {
      // Charged but nothing saved — give the credits back.
      await applyCreditDelta({ matric, delta: QUIZ_COST, reason: 'refund', note: 'AI quiz could not be saved — refunded', actor: 'system' }).catch(() => {});
      throw e;
    }

    await incrementDailyUsage(student, 'aiQuiz');

    res.status(201).json({
      id: record._id,
      course: record.course,
      difficulty: record.difficulty,
      questions: record.questions,
      creditsCharged: QUIZ_COST,
      newBalance: balance,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// GET /api/quiz/history — this student's past AI-generated quizzes
router.get('/history', async (req, res) => {
  try {
    const matric = req.student.sub;
    const history = await GeneratedQuestion.find({ matric })
      .sort({ createdAt: -1 }).limit(50).lean();
    res.json(history);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/quiz/history/:id — full detail of one past quiz
router.get('/history/:id', async (req, res) => {
  try {
    const matric = req.student.sub;
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Quiz not found' });
    const quiz = await GeneratedQuestion.findOne({ _id: req.params.id, matric }).lean();
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    res.json(quiz);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/quiz/save-for-later — v1.4. Student chooses to bank a
// quiz (regular practice, weak-topics, or an AI set they didn't play
// through) instead of finishing it now. No credit cost and no daily-
// limit check here — the limit is enforced the normal way (via
// /api/usage/limits + /api/scores) whenever they actually come back
// and play it, exactly like a fresh quiz would be.
router.post('/save-for-later', async (req, res) => {
  try {
    const matric = req.student.sub;
    const { difficulty, questions } = req.body;
    const course = typeof req.body.course === 'string' ? req.body.course.trim().slice(0, 50) : '';
    if (!course || !Array.isArray(questions) || !questions.length)
      return res.status(400).json({ error: 'course and a non-empty questions[] are required' });
    if (questions.length > 50)
      return res.status(400).json({ error: 'A saved quiz can hold at most 50 questions' });

    const clean = questions
      .filter(q => q && typeof q === 'object')
      .map(q => {
        const opts = Array.isArray(q.opts) ? q.opts.slice(0, 10).map(o => String(o).slice(0, 500)) : [];
        return {
          q: String(q.q || '').slice(0, 2000),
          opts,
          ans: Number.isInteger(q.ans) && q.ans >= 0 && q.ans < opts.length ? q.ans : 0,
          exp: String(q.exp || '').slice(0, 2000),
          tag: String(q.tag || '').slice(0, 200),
          course: String(q.course || course).slice(0, 50),
        };
      })
      .filter(q => q.q && q.opts.length >= 2);
    if (!clean.length) return res.status(400).json({ error: 'None of the supplied questions were valid' });

    const record = await GeneratedQuestion.create({
      matric, course, difficulty: ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium',
      questions: clean, creditCost: 0, source: 'manual',
    });
    res.json({ id: record._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/quiz/history/:id/submit  { userAnswers: [Number|null], score, totalQuestions }
// Records how the student actually did on a previously-generated AI
// quiz, so it can show up with a real score in quiz history — not just
// "quiz generated" like before.
router.patch('/history/:id/submit', async (req, res) => {
  try {
    const matric = req.student.sub;
    const { userAnswers, score, totalQuestions } = req.body;
    if (!Array.isArray(userAnswers) || typeof score !== 'number' || typeof totalQuestions !== 'number')
      return res.status(400).json({ error: 'userAnswers[], score, and totalQuestions are required' });
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Quiz not found' });
    if (!Number.isFinite(score) || !Number.isFinite(totalQuestions) || totalQuestions < 0 || score < 0 || score > totalQuestions || userAnswers.length > 100)
      return res.status(400).json({ error: 'score must be between 0 and totalQuestions' });

    const quiz = await GeneratedQuestion.findOne({ _id: req.params.id, matric });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

    quiz.userAnswers = userAnswers.map(a => (Number.isInteger(a) ? a : null));
    quiz.score = score;
    quiz.totalQuestions = totalQuestions;
    quiz.submittedAt = new Date();
    await quiz.save();

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/quiz/explain — v1.3. On-demand AI explanation for a wrong
// (or skipped) answer during results review. Free (no credit cost) —
// this is a learning aid, gated only by explainLimiter to control
// Groq API spend, not by the quiz-generation credit economy.
router.post('/explain', explainLimiter, async (req, res) => {
  try {
    const { course, question, opts, correctIndex, chosenIndex } = req.body;
    if (typeof question !== 'string' || !question.trim() || !Array.isArray(opts) || opts.length < 2 || opts.length > 10 || !Number.isInteger(correctIndex)) {
      return res.status(400).json({ error: 'question, opts[], and correctIndex are required' });
    }
    if (correctIndex < 0 || correctIndex >= opts.length || question.length > 2000 || opts.some(o => typeof o !== 'string' || o.length > 500)) {
      return res.status(400).json({ error: 'question or options are invalid' });
    }
    const explanation = await explainAnswer({
      course: typeof course === 'string' ? course.slice(0, 50) : '', question, opts, correctIndex,
      chosenIndex: Number.isInteger(chosenIndex) && chosenIndex >= 0 && chosenIndex < opts.length ? chosenIndex : null,
    });
    res.json({ explanation });
  } catch (e) {
    const status = e.code === 'GROQ_NOT_CONFIGURED' ? 503 : 500;
    res.status(status).json({ error: e.message, code: e.code || 'SERVER_ERROR' });
  }
});

module.exports = router;
