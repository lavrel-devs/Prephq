const express = require('express');
const Score = require('../models/Score');
const Student = require('../models/Student');
const { requireStudent } = require('../middleware/auth');

const router = express.Router();

const MIN_QUIZZES = 1; // any real quiz history counts — a stricter bar made the leaderboard look permanently empty for a small/early user base

// GET /api/leaderboard?course=...&limit=50 — ranked by average score
// (min MIN_QUIZZES quizzes to qualify), among students who opted in.
// `course` filters to Score.courses containing that substring (courses
// is stored as a joined display string, e.g. "GST 101, MTH 201").
router.get('/leaderboard', requireStudent, async (req, res) => {
  try {
    const optedIn = await Student.find({ publicLeaderboardOptIn: true }).select('matric username displayName').lean();
    if (!optedIn.length) return res.json([]);

    const matricSet = optedIn.map(s => s.matric);
    const matchStage = { matric: { $in: matricSet } };
    if (req.query.course) matchStage.courses = { $regex: req.query.course, $options: 'i' };

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
      { $limit: parseInt(req.query.limit, 10) || 50 },
    ]);

    const studentMap = Object.fromEntries(optedIn.map(s => [s.matric, s]));

    const leaderboard = agg.map((row, i) => {
      const s = studentMap[row._id];
      return {
        rank: i + 1,
        username: s.username || null,
        displayName: s.displayName || s.username || 'Student',
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
