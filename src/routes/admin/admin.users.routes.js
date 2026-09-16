const express = require('express');
const Student = require('../../models/Student');
const Score = require('../../models/Score');
const Contest = require('../../models/Contest');
const Transfer = require('../../models/Transfer');
const CreditTransaction = require('../../models/CreditTransaction');
const Payment = require('../../models/Payment');
const Session = require('../../models/Session');
const QuestionAttempt = require('../../models/QuestionAttempt');
const { requireAdmin } = require('../../middleware/auth');
const { applyCreditDelta } = require('../../utils/credits');
const { generatePerformanceReportPDF } = require('../../services/report.service');

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
      Student.countDocuments({ active: { $ne: false } }),
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
      credits: s.credits || 0, active: s.active !== false,
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
// Uses the same `active` field as the v1.1 admin Students tab's
// Suspend/Activate button — this endpoint is an alternate entry point
// to the same flag, not a separate ban mechanism, so both stay in sync
// and login is actually blocked (auth.routes.js checks `active`).
router.put('/users/:matric/status', async (req, res) => {
  try {
    const { active } = req.body;
    if (typeof active !== 'boolean') return res.status(400).json({ error: 'active must be a boolean' });

    const student = await Student.findOneAndUpdate(
      { matric: req.params.matric.toUpperCase() },
      { active },
      { new: true },
    ).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Deactivating also revokes any live sessions so the ban takes
    // effect immediately rather than waiting for their token to expire.
    if (!active) {
      await Session.updateMany({ subjectId: student.matric, role: 'student', revoked: { $ne: true } }, { revoked: true, revokedAt: new Date() });
    }

    res.json({ success: true, matric: student.matric, active: student.active });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/users/by-course/:course — v1.4.1. Every student who
// has this course in their selectedCourses (semester registration
// from v1.4), each with their attempt count/accuracy for THIS course
// specifically — not their overall stats — so the admin can see who's
// actually active on a given course, not just who's registered.
router.get('/users/by-course/:course', async (req, res) => {
  try {
    const course = req.params.course.trim();
    const students = await Student.find({ selectedCourses: course }).select('matric name username tier').lean();
    if (!students.length) return res.json({ course, students: [] });

    const matrics = students.map(s => s.matric);
    const agg = await QuestionAttempt.aggregate([
      { $match: { matric: { $in: matrics }, course } },
      { $group: { _id: '$matric', attempts: { $sum: 1 }, correct: { $sum: { $cond: ['$correct', 1, 0] } } } },
    ]);
    const statsByMatric = {};
    agg.forEach(a => { statsByMatric[a._id] = { attempts: a.attempts, accuracy: Math.round((a.correct / a.attempts) * 100) }; });

    res.json({
      course,
      students: students.map(s => ({
        matric: s.matric,
        name: s.name,
        username: s.username,
        tier: s.tier,
        attempts: statsByMatric[s.matric]?.attempts || 0,
        accuracy: statsByMatric[s.matric]?.accuracy ?? null,
      })).sort((a, b) => b.attempts - a.attempts),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/users/course-list — every distinct course at least
// one student has registered for, with a headcount — powers the
// dropdown/filter for the endpoint above.
router.get('/users/course-list', async (req, res) => {
  try {
    const rows = await Student.aggregate([
      { $unwind: '$selectedCourses' },
      { $group: { _id: '$selectedCourses', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    res.json(rows.map(r => ({ course: r._id, students: r.count })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/users/:matric/report.pdf — v1.4.1. Streams a
// downloadable performance-summary PDF for one student (GPA, quiz
// history, weak topics) — the reporting piece of the admin dashboard.
router.get('/users/:matric/report.pdf', async (req, res) => {
  try {
    const student = await Student.findOne({ matric: req.params.matric.toUpperCase() }).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });
    await generatePerformanceReportPDF(student, res);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/users/:matric/tier — v1.4. Manually grant/change a
// student's subscription tier after confirming payment through any of
// the existing manual channels (bank transfer, Opay, Palmpay, cash —
// same Payment.method options already used elsewhere in this file).
// There's no automated payment gateway wired up yet — this is the
// admin's control point until one is. `durationDays` is optional;
// omit it (or pass 0) for a tier that doesn't expire (e.g. a lifetime
// grant or reverting to free).
router.put('/users/:matric/tier', async (req, res) => {
  try {
    const { tier, durationDays, logPayment } = req.body;
    if (!['free', 'basic', 'pro'].includes(tier))
      return res.status(400).json({ error: 'tier must be free, basic, or pro' });

    const tierExpiresAt = (tier !== 'free' && durationDays > 0)
      ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)
      : null;

    const student = await Student.findOneAndUpdate(
      { matric: req.params.matric.toUpperCase() },
      { tier, tierExpiresAt },
      { new: true },
    ).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Optional: log the payment that justified this grant, so it shows
    // up alongside every other payment in the admin's records.
    if (logPayment && logPayment.amount > 0) {
      await Payment.create({
        matric: student.matric,
        name: student.name,
        amount: logPayment.amount,
        method: logPayment.method || 'bank_transfer',
        reference: logPayment.reference || '',
        note: logPayment.note || `${tier} tier${durationDays ? ` — ${durationDays} days` : ''}`,
        status: 'confirmed',
      });
    }

    res.json({ success: true, matric: student.matric, tier: student.tier, tierExpiresAt: student.tierExpiresAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/users/tier-distribution — counts per tier, for the
// admin dashboard's monetization overview.
router.get('/users/tier-distribution', async (req, res) => {
  try {
    const rows = await Student.aggregate([{ $group: { _id: '$tier', count: { $sum: 1 } } }]);
    const dist = { free: 0, basic: 0, pro: 0 };
    rows.forEach(r => { dist[r._id || 'free'] = r.count; });
    res.json(dist);
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
    const rows = ['matric,name,username,credits,active,createdAt'];
    students.forEach(s => {
      rows.push([s.matric, s.name, s.username || '', s.credits || 0, s.active !== false, s.createdAt?.toISOString?.() || ''].join(','));
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
