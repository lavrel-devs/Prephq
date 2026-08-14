const express = require('express');
const rateLimit = require('express-rate-limit');

const Student = require('../models/Student');
const GeneratedQuestion = require('../models/GeneratedQuestion');

const { requireStudent } = require('../middleware/auth');
const { applyCreditDelta } = require('../utils/credits');
const { generateQuiz } = require('../services/groq.service');

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

// POST /api/quiz/generate  { course, difficulty, count?, studyMaterial? }
router.post('/generate', genLimiter, async (req, res) => {
  try {
    const { course, difficulty, count, studyMaterial } = req.body;
    if (!course) return res.status(400).json({ error: 'Course code is required' });

    const diff = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';
    const qCount = Math.min(Math.max(parseInt(count) || 10, 5), 20);
    // Cap study material length so a huge paste/PDF can't blow up the
    // prompt — it's discarded after this request either way, never stored.
    const material = typeof studyMaterial === 'string' ? studyMaterial.trim().slice(0, 6000) : '';

    const matric = req.student.sub;
    const student = await Student.findOne({ matric });
    if (!student) return res.status(404).json({ error: 'Student not found' });
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

    const { balance } = await applyCreditDelta({
      matric,
      delta: -QUIZ_COST,
      reason: 'quiz_generation',
      note: `AI quiz — ${course} (${diff})`,
      actor: 'system',
    });

    const record = await GeneratedQuestion.create({
      matric,
      course: course.trim(),
      difficulty: diff,
      model: generated.model,
      creditCost: QUIZ_COST,
      questions: generated.questions,
    });

    res.status(201).json({
      id: record._id,
      course: record.course,
      difficulty: record.difficulty,
      questions: record.questions,
      creditsCharged: QUIZ_COST,
      newBalance: balance,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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
    const quiz = await GeneratedQuestion.findOne({ _id: req.params.id, matric }).lean();
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    res.json(quiz);
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

    const quiz = await GeneratedQuestion.findOne({ _id: req.params.id, matric });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

    quiz.userAnswers = userAnswers;
    quiz.score = score;
    quiz.totalQuestions = totalQuestions;
    quiz.submittedAt = new Date();
    await quiz.save();

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
