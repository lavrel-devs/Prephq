const express = require('express');
const Student = require('../../models/Student');
const CreditTransaction = require('../../models/CreditTransaction');
const Contest = require('../../models/Contest');
const { requireAdmin } = require('../../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

// GET /api/admin/analytics/signups?days=30 — new signups per day.
router.get('/analytics/signups', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 180);
    const since = daysAgo(days);
    const rows = await Student.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Africa/Lagos' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json(rows.map(r => ({ date: r._id, count: r.count })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/analytics/retention?days=30 — D1/D7/D30 retention by
// signup-day cohort. A cohort's D7/D30 figures are `null` until enough
// time has actually passed to measure them (a cohort from 3 days ago
// can't have a meaningful D7 number yet).
router.get('/analytics/retention', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
    const since = daysAgo(days);
    const students = await Student.find({ createdAt: { $gte: since } })
      .select('createdAt lastActiveAt').lean();

    const now = Date.now();
    const cohorts = {}; // date string -> { total, d1Active, d1Eligible, d7Active, d7Eligible, d30Active, d30Eligible }

    for (const s of students) {
      const day = s.createdAt.toISOString().slice(0, 10);
      if (!cohorts[day]) cohorts[day] = { total: 0, d1: [0, 0], d7: [0, 0], d30: [0, 0] };
      const c = cohorts[day];
      c.total++;

      const ageMs = now - s.createdAt.getTime();
      const activeAgeMs = s.lastActiveAt ? s.lastActiveAt.getTime() - s.createdAt.getTime() : 0;
      const DAY = 24 * 60 * 60 * 1000;

      if (ageMs >= 1 * DAY) { c.d1[1]++; if (activeAgeMs >= 1 * DAY) c.d1[0]++; }
      if (ageMs >= 7 * DAY) { c.d7[1]++; if (activeAgeMs >= 7 * DAY) c.d7[0]++; }
      if (ageMs >= 30 * DAY) { c.d30[1]++; if (activeAgeMs >= 30 * DAY) c.d30[0]++; }
    }

    const pct = (active, eligible) => eligible > 0 ? Math.round((active / eligible) * 100) : null;
    const result = Object.entries(cohorts).sort(([a], [b]) => a.localeCompare(b)).map(([date, c]) => ({
      date, cohortSize: c.total,
      d1: pct(c.d1[0], c.d1[1]),
      d7: pct(c.d7[0], c.d7[1]),
      d30: pct(c.d30[0], c.d30[1]),
    }));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/analytics/credit-velocity?days=30 — credits granted vs
// spent per day (granted = positive deltas, spent = absolute value of
// negative deltas).
router.get('/analytics/credit-velocity', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 180);
    const since = daysAgo(days);
    const rows = await CreditTransaction.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Africa/Lagos' } },
        granted: { $sum: { $cond: [{ $gt: ['$delta', 0] }, '$delta', 0] } },
        spent: { $sum: { $cond: [{ $lt: ['$delta', 0] }, { $multiply: ['$delta', -1] }, 0] } },
      } },
      { $sort: { _id: 1 } },
    ]);
    res.json(rows.map(r => ({ date: r._id, granted: r.granted, spent: r.spent })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/analytics/contest-participation?days=30 — contest
// joins per day (individual participants + team members combined),
// plus an overall participation rate against the active user base.
router.get('/analytics/contest-participation', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 180);
    const since = daysAgo(days);

    const [individualJoins, teamJoins, activeUserCount] = await Promise.all([
      Contest.aggregate([
        { $unwind: '$participants' },
        { $match: { 'participants.joinedAt': { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$participants.joinedAt', timezone: 'Africa/Lagos' } }, count: { $sum: 1 } } },
      ]),
      Contest.aggregate([
        { $match: { teamBased: true } },
        { $unwind: '$teams' },
        { $unwind: '$teams.members' },
        { $match: { 'teams.members.joinedAt': { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$teams.members.joinedAt', timezone: 'Africa/Lagos' } }, count: { $sum: 1 } } },
      ]),
      Student.countDocuments({ active: { $ne: false } }),
    ]);

    const byDate = {};
    individualJoins.forEach(r => { byDate[r._id] = (byDate[r._id] || 0) + r.count; });
    teamJoins.forEach(r => { byDate[r._id] = (byDate[r._id] || 0) + r.count; });

    const series = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
    const totalJoins = series.reduce((sum, r) => sum + r.count, 0);

    res.json({
      series,
      participationRate: activeUserCount > 0 ? Math.round((totalJoins / activeUserCount) * 100) : 0,
      activeUserCount,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
