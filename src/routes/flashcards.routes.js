const express = require('express');
const Student = require('../models/Student');
const Question = require('../models/Question');
const FlashcardProgress = require('../models/FlashcardProgress');
const { requireStudent } = require('../middleware/auth');
const { generateQuiz } = require('../services/groq.service');
const { applyCreditDelta } = require('../utils/credits');
const { checkDailyLimit, incrementDailyUsage, ensureTierCurrent } = require('../services/tier.service');
const Course = require('../models/Course');
const { courseMatchFilter } = require('../utils/courseMatch');
const { isObjectId } = require('../utils/validate');
const { withLock } = require('../utils/lock');

const FLASHCARD_GEN_COST = parseInt(process.env.CREDIT_COST_FLASHCARD_GEN || '3', 10);
const FLASHCARD_GEN_COUNT = 10;

const router = express.Router();
// Mounted at its own dedicated '/api/flashcards' prefix in server.js
// (not the shared '/api' prefix), so a blanket requireStudent here is
// safe — there are no public routes sharing this prefix to shadow.
router.use(requireStudent);

// Flashcards are a Basic/Pro perk — free users can see the feature
// exists (so they know what they're missing) but every data route
// below enforces the tier server-side, not just by hiding the tab.
async function requirePaidTier(req, res, next) {
  try {
    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    await ensureTierCurrent(student); // an expired Basic/Pro plan must not keep flashcard access
    if (student.tier === 'free') {
      return res.status(403).json({ error: 'Flashcards are a Basic/Pro feature. Upgrade to unlock spaced-repetition review.', code: 'TIER_REQUIRED' });
    }
    req._student = student;
    next();
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// GET /api/flashcards/due?courses=CHM142,PHY102 — cards due for review
// right now across the student's selected courses, oldest-due first,
// topped up with never-reviewed cards from the bank so the deck never
// runs dry just because nothing has technically come "due" yet.
router.get('/due', requirePaidTier, async (req, res) => {
  try {
    const matric = req.student.sub;
    const courses = String(req.query.courses || '').split(',').map(c => c.trim()).filter(Boolean);
    if (!courses.length) return res.status(400).json({ error: 'courses query param is required' });

    const progressDue = await FlashcardProgress.find({
      matric, course: { $in: courses }, dueDate: { $lte: new Date() },
    }).sort({ dueDate: 1 }).limit(40).lean();

    const seenIds = progressDue.map(p => p.questionId);
    const dueQuestions = await Question.find({ _id: { $in: seenIds } }).lean();
    const dueMap = new Map(dueQuestions.map(q => [String(q._id), q]));

    const cards = progressDue
      .map(p => dueMap.get(String(p.questionId)))
      .filter(Boolean)
      .map(q => ({ id: q._id, q: q.q, opts: q.opts, ans: q.ans, exp: q.exp, tag: q.tag, course: q.course, isNew: false }));

    // Top up with fresh (never-reviewed) cards if the due pile is thin.
    if (cards.length < 15) {
      const excludeIds = await FlashcardProgress.find({ matric, course: { $in: courses } }).distinct('questionId');
      // Questions store the course as key or code depending on who wrote them — match both.
      const filters = await Promise.all(courses.slice(0, 20).map(c => courseMatchFilter(c)));
      const fresh = await Question.find({ $or: filters.flatMap(f => f.$or), _id: { $nin: excludeIds } })
        .limit(15 - cards.length).lean();
      cards.push(...fresh.map(q => ({ id: q._id, q: q.q, opts: q.opts, ans: q.ans, exp: q.exp, tag: q.tag, course: q.course, isNew: true })));
    }

    // No automatic AI generation here on purpose — if the bank is dry,
    // the student sees an honest "all caught up" state and chooses for
    // themselves whether to spend credits generating more, via
    // POST /api/flashcards/generate. Never triggered for them based on
    // performance, wrong answers, or anything else — it's their call.
    res.json({ cards, dueCount: progressDue.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/flashcards/generate  { course, count? }
// Student-initiated, on demand, for any course they choose — never
// triggered automatically by the app (not tied to weak topics, wrong
// answers, or a dry deck). Same credit cost and daily AI-generation
// cap as the AI Quiz Generator so it can't be used as a free backdoor
// around either. Saved straight into the real Question bank, so it
// also benefits future quizzes for every student on that course.
router.post('/generate', requirePaidTier, (req, res) =>
  withLock(`quizgen:${req.student.sub}`, () => generateHandler(req, res)));

async function generateHandler(req, res) {
  try {
    const matric = req.student.sub;
    const student = req._student;
    const rawCourse = String(req.body.course || '').trim();
    if (!rawCourse) return res.status(400).json({ error: 'course is required' });
    // Generated cards go into the SHARED question bank, so the course must be a real one
    // (previously any typed string created a junk course visible to everyone).
    const courseDoc = await Course.findOne({ key: rawCourse.toLowerCase().replace(/[^a-z0-9]/g, '') }).lean();
    if (!courseDoc) return res.status(400).json({ error: `Unknown course "${rawCourse.slice(0, 40)}"` });
    const course = courseDoc.key;
    const count = Math.min(Math.max(parseInt(req.body.count) || FLASHCARD_GEN_COUNT, 5), 20);

    try {
      await checkDailyLimit(student, 'aiQuiz');
    } catch (e) {
      if (e.code === 'LIMIT_REACHED') {
        return res.status(403).json({ error: e.message, code: 'LIMIT_REACHED' });
      }
      throw e;
    }

    if ((student.credits || 0) < FLASHCARD_GEN_COST) {
      return res.status(402).json({
        error: `Not enough credits. Generating flashcards costs ${FLASHCARD_GEN_COST} credits, you have ${student.credits || 0}.`,
        code: 'INSUFFICIENT_CREDITS',
        required: FLASHCARD_GEN_COST,
        balance: student.credits || 0,
      });
    }

    let generated;
    try {
      generated = await generateQuiz({ course, difficulty: 'medium', count });
    } catch (e) {
      const status = e.code === 'GROQ_NOT_CONFIGURED' ? 503 : 502;
      return res.status(status).json({ error: e.message, code: e.code || 'GROQ_ERROR' });
    }
    if (!generated.questions || !generated.questions.length) {
      return res.status(502).json({ error: 'AI did not return any usable questions. Try again.', code: 'GROQ_EMPTY' });
    }

    // Charge BEFORE writing to the shared bank — otherwise a failed/raced charge left free questions behind.
    let balance;
    try {
      ({ balance } = await applyCreditDelta({
        matric, delta: -FLASHCARD_GEN_COST, reason: 'flashcard_generation',
        note: `AI flashcards — ${course}`, actor: 'system',
      }));
    } catch (e) {
      if (e.code === 'INSUFFICIENT_CREDITS') return res.status(402).json({ error: 'Not enough credits.', code: 'INSUFFICIENT_CREDITS', required: FLASHCARD_GEN_COST });
      throw e;
    }
    let created;
    try {
      created = await Question.insertMany(generated.questions.map(q => ({
        course, q: q.q, opts: q.opts, ans: q.ans, exp: q.exp, tag: 'AI Generated',
      })));
    } catch (e) {
      await applyCreditDelta({ matric, delta: FLASHCARD_GEN_COST, reason: 'refund', note: 'Flashcards could not be saved — refunded', actor: 'system' }).catch(() => {});
      throw e;
    }
    await incrementDailyUsage(student, 'aiQuiz');

    const cards = created.map(q => ({ id: q._id, q: q.q, opts: q.opts, ans: q.ans, exp: q.exp, tag: q.tag, course: q.course, isNew: true, aiGenerated: true }));
    res.status(201).json({ cards, creditsCharged: FLASHCARD_GEN_COST, newBalance: balance });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// POST /api/flashcards/review  { questionId, course, quality }
// quality: 0 = Again, 1 = Hard, 2 = Good, 3 = Easy — drives a simple
// SM-2-style schedule. "Again" always resets the card to be seen
// again within the same day; everything else grows the interval.
router.post('/review', requirePaidTier, async (req, res) => {
  try {
    const matric = req.student.sub;
    const { questionId, course, quality } = req.body;
    if (!isObjectId(questionId) || typeof course !== 'string' || !course.trim() || ![0, 1, 2, 3].includes(quality))
      return res.status(400).json({ error: 'questionId, course, and quality (0-3) are required' });

    // Upsert: two rapid first reviews of one card used to collide on the unique index (500).
    const p = await FlashcardProgress.findOneAndUpdate(
      { matric, questionId },
      { $setOnInsert: { course: course.trim().slice(0, 30) } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    if (quality === 0) {
      p.repetitions = 0;
      p.interval = 0;
      p.easeFactor = Math.max(1.3, p.easeFactor - 0.2);
      p.dueDate = new Date(Date.now() + 10 * 60 * 1000); // resurface in 10 minutes
    } else {
      p.repetitions += 1;
      p.easeFactor = Math.max(1.3, p.easeFactor + (0.1 - (3 - quality) * (0.08 + (3 - quality) * 0.02)));
      if (p.repetitions === 1) p.interval = quality === 1 ? 1 : quality === 2 ? 2 : 4;
      else p.interval = Math.max(p.interval + 1, Math.round(p.interval * p.easeFactor)); // always grows — rounding used to freeze 1-day cards at 1 day forever
      p.dueDate = new Date(Date.now() + p.interval * 24 * 60 * 60 * 1000);
    }
    p.lastReviewed = new Date();
    p.lastQuality = quality;
    await p.save();

    res.json({ interval: p.interval, dueDate: p.dueDate, easeFactor: p.easeFactor });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/flashcards/stats?courses=... — quick counts for a summary
// badge (how many cards are due today per course), used on the home
// screen entry point into the flashcards feature.
router.get('/stats', requirePaidTier, async (req, res) => {
  try {
    const matric = req.student.sub;
    const courses = String(req.query.courses || '').split(',').map(c => c.trim()).filter(Boolean);
    const dueCount = !courses.length ? 0 : await FlashcardProgress.countDocuments({
      matric, course: { $in: courses }, dueDate: { $lte: new Date() },
    });
    res.json({ dueCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
