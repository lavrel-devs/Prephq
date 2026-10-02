const express = require('express');
const Score = require('../models/Score');
const QuestionAttempt = require('../models/QuestionAttempt');
const Student = require('../models/Student');
const { requireStudent, requireAdmin } = require('../middleware/auth');
const { getWeakTopics } = require('../services/weakTopics.service');
const { checkDailyLimit, incrementDailyUsage } = require('../services/tier.service');

const { canUse } = require('../services/entitlements.service');
const Settings = require('../models/Settings');
const { normCourseKey, cleanTag } = require('../utils/validate');
const { syncRevisionQueue } = require('../services/study.service');
const { evaluateAndAward } = require('../services/achievements.service');
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
    const { perQuestion } = req.body;
    const { pct } = req.body;
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) return res.status(400).json({ error: 'Invalid' });

    // Clamp every numeric field: this data is client-posted, feeds the
    // leaderboard/admin stats, and `total` drives the free-tier daily cap.
    const clampInt = (v, max) => (Number.isFinite(v) ? Math.min(Math.max(Math.round(v), 0), max) : 0);
    const total = clampInt(req.body.total, 500);
    const correct = Math.min(clampInt(req.body.correct, 500), total);
    const wrong = clampInt(req.body.wrong, 500);
    const skip = clampInt(req.body.skip, 500);
    const courses = Array.isArray(req.body.courses) ? req.body.courses.join(', ').slice(0, 200)
      : (typeof req.body.courses === 'string' ? req.body.courses.slice(0, 200) : '');
    const mode = typeof req.body.mode === 'string' ? req.body.mode.slice(0, 30) : '';

    const student = await Student.findOne({ matric: req.params.matric.toUpperCase() });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Exam-mode results need the Exam mode feature (Premium, or enabled for Free).
    if (mode === 'exam' && !canUse(student, 'examMode', await Settings.getGlobal())) {
      return res.status(403).json({ error: "Exam mode isn't available on the Free plan. Upgrade to Premium to unlock it.", code: 'FEATURE_LOCKED', feature: 'examMode' });
    }

    const attemptDocs = Array.isArray(perQuestion)
      ? perQuestion
          .filter(p => p && typeof p.course === 'string' && normCourseKey(p.course) && typeof p.correct === 'boolean')
          .slice(0, 100)
          .map(p => ({
            matric: req.params.matric.toUpperCase(),
            // Stored in ONE canonical form. Attempts used to keep whatever spelling the client sent
            // ("chm141" from the bank, "CHM 141" from an AI quiz), which split one topic into several
            // rows and made "weak topics" impossible to match back to the question bank.
            course: normCourseKey(p.course).slice(0, 30),
            tag: cleanTag(p.tag),
            correct: p.correct,
          }))
      : [];

    // Omitting `total` used to skip the daily-question cap entirely; the
    // per-question list is a second, independent count of what was answered.
    const questionCount = Math.max(total, attemptDocs.length);
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

    // Per-topic breakdown for exam history (course key + tag → correct/total).
    const topicMap = new Map();
    for (const a of attemptDocs) {
      const k = `${a.course}|${a.tag.toLowerCase()}`;
      const cur = topicMap.get(k) || { course: a.course, tag: a.tag, correct: 0, total: 0 };
      cur.total++; if (a.correct) cur.correct++;
      topicMap.set(k, cur);
    }

    await Score.create({
      matric: req.params.matric.toUpperCase(),
      correct, total, pct, wrong, skip, courses, mode,
      ...(topicMap.size ? { topics: [...topicMap.values()] } : {}),
    });

    if (questionCount > 0) await incrementDailyUsage(student, 'questions', questionCount);

    if (attemptDocs.length) {
      // Score is already saved — a failure here only costs weak-topic data, not the quiz.
      await QuestionAttempt.insertMany(attemptDocs).catch(e => console.error('[scores] attempt insert failed:', e.message));
    }

    // Bookkeeping that must never fail the save itself.
    let achievements = [];
    try {
      if (attemptDocs.length) await syncRevisionQueue(req.params.matric.toUpperCase());
      const fresh = await Student.findOne({ matric: req.params.matric.toUpperCase() });
      if (fresh) achievements = (await evaluateAndAward(fresh)).fresh.map(a => ({ key: a.key, icon: a.icon, title: a.title, desc: a.desc }));
    } catch (e) { console.error('[scores] post-save bookkeeping failed:', e.message); }

    res.status(201).json({ success: true, achievements });
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
