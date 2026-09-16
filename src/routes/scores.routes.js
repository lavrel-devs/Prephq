const express = require('express');
const Score = require('../models/Score');
const QuestionAttempt = require('../models/QuestionAttempt');
const Student = require('../models/Student');
const { requireStudent, requireAdmin } = require('../middleware/auth');
const { getWeakTopics } = require('../services/weakTopics.service');
const { checkDailyLimit, incrementDailyUsage } = require('../services/tier.service');

const router = express.Router();

// GET /api/scores/:matric — a student may only read their own scores
router.get('/:matric', requireStudent, async (req, res) => {
  try {
    if (req.student.sub !== req.params.matric.toUpperCase())
      return res.status(403).json({ error: 'Forbidden' });
    const scores = await Score.find({ matric: req.params.matric.toUpperCase() })
      .sort({ ts: -1 }).limit(200).lean();
    res.json(scores);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/scores/:matric — a student may only write their own scores
// v1.3: accepts an optional `perQuestion` array — [{course, tag, correct}]
// — one entry per question in the quiz just taken, powering weak-topic
// drilling. Entirely optional and additive; omitting it behaves exactly
// as before.
// v1.4: `total` questions in this quiz count against the student's
// daily practice-question tier limit (free: 20/day). Checked BEFORE
// the quiz is recorded — a free student already at cap can't log a
// new quiz until tomorrow (or upgrading). This is a soft spot in the
// flow (a quiz already taken client-side could still hit this and be
// rejected) — see GET /api/usage/limits, which the dashboard should
// check before a quiz starts to avoid that in the common case.
router.post('/:matric', requireStudent, async (req, res) => {
  try {
    if (req.student.sub !== req.params.matric.toUpperCase())
      return res.status(403).json({ error: 'Forbidden' });
    const { correct, total, pct, wrong, skip, courses, mode, perQuestion } = req.body;
    if (typeof pct !== 'number') return res.status(400).json({ error: 'Invalid' });

    const student = await Student.findOne({ matric: req.params.matric.toUpperCase() });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const questionCount = Number.isFinite(total) ? total : 0;
    if (questionCount > 0) {
      try {
        await checkDailyLimit(student, 'questions', questionCount);
      } catch (e) {
        if (e.code === 'LIMIT_REACHED') {
          return res.status(403).json({ error: e.message, code: 'LIMIT_REACHED', tier: e.tier, limit: e.limit, used: e.used });
        }
        throw e;
      }
    }

    await Score.create({
      matric: req.params.matric.toUpperCase(),
      correct, total, pct, wrong, skip, courses, mode,
    });

    if (questionCount > 0) await incrementDailyUsage(student, 'questions', questionCount);

    if (Array.isArray(perQuestion) && perQuestion.length) {
      const docs = perQuestion
        .filter(p => p && p.course && typeof p.correct === 'boolean')
        .slice(0, 100) // sanity cap — no single quiz submission should exceed this
        .map(p => ({
          matric: req.params.matric.toUpperCase(),
          course: String(p.course).trim(),
          tag: String(p.tag || '').trim(),
          correct: p.correct,
        }));
      if (docs.length) await QuestionAttempt.insertMany(docs);
    }

    res.status(201).json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/scores/:matric/weak-topics — v1.3. Topics this student is
// weakest on, worst first, based on their QuestionAttempt history.
router.get('/:matric/weak-topics', requireStudent, async (req, res) => {
  try {
    if (req.student.sub !== req.params.matric.toUpperCase())
      return res.status(403).json({ error: 'Forbidden' });
    const topics = await getWeakTopics(req.params.matric.toUpperCase());
    res.json(topics);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/scores/:matric — admin only (unchanged)
router.delete('/:matric', requireAdmin, async (req, res) => {
  try {
    await Score.deleteMany({ matric: req.params.matric.toUpperCase() });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
