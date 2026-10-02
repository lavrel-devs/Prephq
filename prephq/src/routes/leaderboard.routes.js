const express = require('express');
const Score = require('../models/Score');
const Student = require('../models/Student');
const { requireStudent } = require('../middleware/auth');
const CosmeticItem = require('../models/CosmeticItem');
const { BY_KEY } = require('../services/achievements.service');
const { escapeRegex } = require('../utils/validate');
const Settings = require('../models/Settings');

const router = express.Router();

const MIN_QUIZZES = 1; // any real quiz history counts — a stricter bar made the leaderboard look permanently empty for a small/early user base

// GET /api/leaderboard?course=...&limit=50 — ranked by average score
// (min MIN_QUIZZES quizzes to qualify), among students who opted in.
// `course` filters to Score.courses containing that substring (courses
// is stored as a joined display string, e.g. "GST 101, MTH 201").
// `scope=department` ranks only students who share the requesting student's department — genuinely
// motivating since it's the classmates they'll actually sit the exam with, not strangers university-wide.
router.get('/leaderboard', requireStudent, async (req, res) => {
  try {
    const studentFilter = { publicLeaderboardOptIn: true, active: { $ne: false } };
    if (req.query.scope === 'department') {
      const me = await Student.findOne({ matric: req.student.sub }).select('department').lean();
      if (!me || !me.department) return res.json({ leaderboard: [], scope: 'department', error: 'Set your department in your profile to see this leaderboard.' });
      studentFilter.department = me.department;
    }
    const optedIn = await Student.find(studentFilter).select('matric username displayName equippedBadge equippedAchievement').lean();
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
        badge: (s.equippedAchievement && BY_KEY[s.equippedAchievement] ? BY_KEY[s.equippedAchievement].icon : null)
          || (s.equippedBadge ? (badgeValue[String(s.equippedBadge)] || null) : null),
        avgScore: Math.round(row.avgPct),
        totalQuizzes: row.totalQuizzes,
        totalCorrect: row.totalCorrect,
        isMe: row._id === req.student.sub,
      };
    });

    res.json({ leaderboard, scope: req.query.scope === 'department' ? 'department' : 'global' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/referral-leaderboard — this term's referral leaderboard: who's brought in the most students
// since the period last reset, feeding into the prize pool an admin can settle from the admin panel.
router.get('/referral-leaderboard', requireStudent, async (req, res) => {
  try {
    const settings = await Settings.getGlobal();
    const periodStart = settings.referral.leaderboard.periodStart || new Date(0);
    const optedIn = await Student.find({ publicLeaderboardOptIn: true, active: { $ne: false } })
      .select('_id matric username displayName equippedBadge').lean();
    if (!optedIn.length) return res.json({ leaderboard: [], prizes: settings.referral.leaderboard.prizes, periodStart });

    const idSet = optedIn.map(s => s._id);
    const agg = await Student.aggregate([
      { $match: { referredBy: { $in: idSet }, createdAt: { $gte: periodStart } } },
      { $group: { _id: '$referredBy', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 50 },
    ]);
    const byId = Object.fromEntries(optedIn.map(s => [String(s._id), s]));
    const prizes = settings.referral.leaderboard.prizes || [];
    const leaderboard = agg.filter(r => byId[String(r._id)]).map((r, i) => {
      const s = byId[String(r._id)];
      return {
        rank: i + 1, referrals: r.n, prize: prizes[i] || 0,
        displayName: s.displayName || s.username || 'Student', isMe: s.matric === req.student.sub,
      };
    });
    res.json({ leaderboard, prizes, periodStart });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
