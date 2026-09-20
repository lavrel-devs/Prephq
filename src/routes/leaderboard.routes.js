const express = require('express');
const Score = require('../models/Score');
const Student = require('../models/Student');
const { requireStudent } = require('../middleware/auth');
const CosmeticItem = require('../models/CosmeticItem');
const { escapeRegex } = require('../utils/validate');

const router = express.Router();

const MIN_QUIZZES = 1; // any real quiz history counts — a stricter bar made the leaderboard look permanently empty for a small/early user base

// GET /api/leaderboard?course=...&limit=50 — ranked by average score
// (min MIN_QUIZZES quizzes to qualify), among students who opted in.
// `course` filters to Score.courses containing that substring (courses
// is stored as a joined display string, e.g. "GST 101, MTH 201").
router.get('/leaderboard', requireStudent, async (req, res) => {
  try {
    const optedIn = await Student.find({ publicLeaderboardOptIn: true, active: { $ne: false } }).select('matric username displayName equippedBadge').lean();
    if (!optedIn.length) return res.json([]);

    const matricSet = optedIn.map(s => s.matric);
    const matchStage = { matric: { $in: matricSet } };
    // escaped + string-only: a raw user regex was a ReDoS / operator-injection hole
    if (typeof req.query.course === 'string' && req.query.course.trim()) matchStage.courses = { $regex: escapeRegex(req.query.course.trim().slice(0, 60)), $options: 'i' };

    const agg = await Score.aggregate([
      { $match: matchStage },
      { $group: {
        _id: '$matric',
        totalQuizzes: { $sum: 1 },
        avgPct: { $avg: '$pct' },
        totalCorrect: { $sum: '$correct' },
      } },
      { $match: { totalQuizzes: { $gte: MIN_QUIZZES } } },
      { $sort: { avgPct: -1, totalQuizzes: -1 } },
      { $limit: Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100) },
    ]);

    const studentMap = Object.fromEntries(optedIn.map(s => [s.matric, s]));
    const badgeIds = [...new Set(optedIn.map(s => s.equippedBadge).filter(Boolean).map(String))];
    const badges = badgeIds.length ? await CosmeticItem.find({ _id: { $in: badgeIds } }).select('value').lean() : [];
    const badgeValue = Object.fromEntries(badges.map(b => [String(b._id), b.value]));

    const leaderboard = agg.map((row, i) => {
      const s = studentMap[row._id];
      return {
        rank: i + 1,
        username: s.username || null,
        displayName: s.displayName || s.username || 'Student',
        badge: s.equippedBadge ? (badgeValue[String(s.equippedBadge)] || null) : null,
        avgScore: Math.round(row.avgPct),
        totalQuizzes: row.totalQuizzes,
        totalCorrect: row.totalCorrect,
        isMe: row._id === req.student.sub,
      };
    });

    res.json(leaderboard);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
