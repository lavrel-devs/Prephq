const express = require('express');
const Student = require('../../models/Student');
const Score = require('../../models/Score');
const Contest = require('../../models/Contest');
const Transfer = require('../../models/Transfer');
const CreditTransaction = require('../../models/CreditTransaction');
const Payment = require('../../models/Payment');
const Session = require('../../models/Session');
const { requireAdmin } = require('../../middleware/auth');
const { applyCreditDelta } = require('../../utils/credits');

const router = express.Router();
router.use(requireAdmin);

// ══════════════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════════════

// GET /api/admin/dashboard/stats — v1.2 overview: user count, revenue,
// contests, transfer stats, all in one call for the admin landing page.
router.get('/dashboard/stats', async (req, res) => {
  try {
    const [
      userCount, activeUserCount, revenueAgg, contestCounts,
      transferCount, transferVolumeAgg, liveContests,
    ] = await Promise.all([
      Student.countDocuments(),
      Student.countDocuments({ isActive: { $ne: false } }),
      Payment.aggregate([{ $match: { status: 'confirmed' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Contest.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Transfer.countDocuments({ status: 'completed' }),
      Transfer.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Contest.countDocuments({ status: 'live' }),
    ]);

    res.json({
      users: { total: userCount, active: activeUserCount },
      revenue: revenueAgg[0]?.total || 0,
      contests: {
        byStatus: Object.fromEntries(contestCounts.map(c => [c._id, c.count])),
        live: liveContests,
      },
      transfers: { count: transferCount, totalVolume: transferVolumeAgg[0]?.total || 0 },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  USERS
// ══════════════════════════════════════════════════════════════

// GET /api/admin/users/search?q=... — searches matric, username, or name
// (no email field exists in this schema — matric is the account identifier).
router.get('/users/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);

    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const students = await Student.find({
      $or: [{ matric: regex }, { username: regex }, { name: regex }],
    }).limit(30).lean();

    res.json(students.map(s => ({
      matric: s.matric, name: s.name, username: s.username,
      credits: s.credits || 0, isActive: s.isActive !== false,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/users/:matric — full detail view: credits, transactions,
// quizzes, contests joined, activity log (session-derived).
router.get('/users/:matric', async (req, res) => {
  try {
    const matric = req.params.matric.toUpperCase();
    const student = await Student.findOne({ matric }).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const [scores, transactions, contestsJoined, sessions, transfersOut, transfersIn] = await Promise.all([
      Score.find({ matric }).sort({ ts: -1 }).limit(50).lean(),
      CreditTransaction.find({ matric }).sort({ createdAt: -1 }).limit(50).lean(),
      Contest.find({ 'participants.matric': matric }).select('title type status startTime endTime participants.$').lean(),
      Session.find({ subjectId: matric, role: 'student' }).sort({ lastActiveAt: -1 }).limit(10).lean(),
      Transfer.find({ fromMatric: matric }).sort({ createdAt: -1 }).limit(20).lean(),
      Transfer.find({ toMatric: matric }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);

    res.json({
      profile: { ...student, passwordHash: undefined },
      quizzes: { count: scores.length, recent: scores },
      credits: { balance: student.credits || 0, recentTransactions: transactions },
      contestsJoined,
      transfers: { sent: transfersOut, received: transfersIn },
      activityLog: sessions.map(s => ({
        sessionId: s._id, createdAt: s.createdAt, lastActiveAt: s.lastActiveAt,
        expiresAt: s.expiresAt, userAgent: s.userAgent, revoked: s.revoked,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/users/:matric/status — activate/deactivate (ban) a student.
router.put('/users/:matric/status', async (req, res) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'isActive must be a boolean' });

    const student = await Student.findOneAndUpdate(
      { matric: req.params.matric.toUpperCase() },
      { isActive },
      { new: true },
    ).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Deactivating also revokes any live sessions so the ban takes
    // effect immediately rather than waiting for their token to expire.
    if (!isActive) {
      await Session.updateMany({ subjectId: student.matric, role: 'student', revoked: { $ne: true } }, { revoked: true, revokedAt: new Date() });
    }

    res.json({ success: true, matric: student.matric, isActive: student.isActive });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/users/bulk-grant — grant/deduct credits across many
// matrics at once, one CreditTransaction each for a clean audit trail.
router.post('/users/bulk-grant', async (req, res) => {
  try {
    const { matrics, amount, note } = req.body;
    if (!Array.isArray(matrics) || matrics.length === 0) return res.status(400).json({ error: 'matrics must be a non-empty array' });
    if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: 'amount must be a non-zero number' });

    const results = [];
    for (const matric of matrics) {
      try {
        const { balance } = await applyCreditDelta({
          matric: matric.toUpperCase(),
          delta: amount,
          reason: amount > 0 ? 'admin_grant' : 'admin_deduct',
          note: note || 'Bulk admin adjustment',
          actor: req.admin.sub,
        });
        results.push({ matric, success: true, balance });
      } catch (e) {
        results.push({ matric, success: false, error: e.message });
      }
    }

    res.json({ results, succeeded: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/credits/leaderboard — all users sorted by credit balance, filterable.
router.get('/credits/leaderboard', async (req, res) => {
  try {
    const filter = {};
    if (req.query.minCredits) filter.credits = { $gte: parseInt(req.query.minCredits, 10) };
    const students = await Student.find(filter).sort({ credits: -1 }).limit(200).lean();
    res.json(students.map(s => ({ matric: s.matric, username: s.username, name: s.name, credits: s.credits || 0 })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  EXPORT
// ══════════════════════════════════════════════════════════════

// GET /api/admin/export/users — full user list as CSV
router.get('/export/users', async (req, res) => {
  try {
    const students = await Student.find().sort({ createdAt: -1 }).lean();
    const rows = ['matric,name,username,credits,isActive,createdAt'];
    students.forEach(s => {
      rows.push([s.matric, s.name, s.username || '', s.credits || 0, s.isActive !== false, s.createdAt?.toISOString?.() || ''].join(','));
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="prephq-users.csv"');
    res.send(rows.join('\n'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/export/transactions — full CreditTransaction log as CSV
router.get('/export/transactions', async (req, res) => {
  try {
    const txs = await CreditTransaction.find().sort({ createdAt: -1 }).limit(5000).lean();
    const rows = ['matric,delta,balanceAfter,reason,note,actor,createdAt'];
    txs.forEach(t => {
      rows.push([t.matric, t.delta, t.balanceAfter, t.reason, `"${(t.note || '').replace(/"/g, '""')}"`, t.actor, t.createdAt?.toISOString?.() || ''].join(','));
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="prephq-transactions.csv"');
    res.send(rows.join('\n'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/export/transfers — full Transfer log as CSV
router.get('/export/transfers', async (req, res) => {
  try {
    const transfers = await Transfer.find().sort({ createdAt: -1 }).limit(5000).lean();
    const rows = ['fromMatric,toMatric,amount,fee,totalDebited,status,createdAt'];
    transfers.forEach(t => {
      rows.push([t.fromMatric, t.toMatric, t.amount, t.fee, t.totalDebited, t.status, t.createdAt?.toISOString?.() || ''].join(','));
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="prephq-transfers.csv"');
    res.send(rows.join('\n'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/transfers — transfer log with filters (matric, date range)
router.get('/transfers', async (req, res) => {
  try {
    const filter = {};
    if (req.query.matric) {
      const m = req.query.matric.toUpperCase();
      filter.$or = [{ fromMatric: m }, { toMatric: m }];
    }
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
    }
    const transfers = await Transfer.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    res.json(transfers);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
