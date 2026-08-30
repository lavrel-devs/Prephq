const express = require('express');
const Question = require('../models/Question');
const Student = require('../models/Student');
const Course = require('../models/Course');
const Score = require('../models/Score');
const Transfer = require('../models/Transfer');
const CreditTransaction = require('../models/CreditTransaction');
const Notification = require('../models/Notification');
const { requireStudent } = require('../middleware/auth');
const { maybeApplyDailyRefresh } = require('../services/credit.service');
const { checkAvailability, setUsername } = require('../utils/username');
const { generateUniqueReferralCode } = require('../utils/referral');
const { usernameCheckLimiter, usernameChangeLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// GET /api/questions/:course — public. Different tools have written
// the `course` field differently over time — old bank data uses the
// raw uppercase code (e.g. "GST101"), newer admin CRUD writes the
// normalized lowercase key (e.g. "chm142"). Resolve the real course
// first, then match case-insensitively against every format its
// questions could plausibly have been stored under, so it works
// regardless of which tool wrote them or how the caller's :course
// param happens to be formatted.
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

router.get('/questions/:course', async (req, res) => {
  try {
    const param = req.params.course;
    const normalizedKey = param.toLowerCase().replace(/[^a-z0-9]/g, '');
    const courseDoc = await Course.findOne({ key: normalizedKey });

    const candidates = new Set([param, normalizedKey]);
    if (courseDoc) { candidates.add(courseDoc.key); candidates.add(courseDoc.courseCode); }

    const questions = await Question.find({
      $or: [...candidates].map(c => ({ course: { $regex: new RegExp(`^${escapeRegex(c)}$`, 'i') } })),
    }).lean();
    res.json(questions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/courses — public, new in v1.1.5. The dashboard's course
// grid, search bar, and AI quiz picker all fetch this live instead of
// relying on a hardcoded list.
router.get('/courses', async (req, res) => {
  try {
    const courses = await Course.find().sort({ courseCode: 1 }).lean();
    res.json(courses);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/me — current logged-in student's profile + live credit balance.
// The dashboard calls this on load/refresh so the credits shown are
// never stale after an admin top-up or a quiz spend.
router.get('/me', requireStudent, async (req, res) => {
  try {
    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Lazy daily refresh: tops up credits the moment this student is
    // seen today, without waiting on the midnight cron.
    await maybeApplyDailyRefresh(student);

    // v1.2 backfill: accounts created before v1.2 (or created without
    // going through activateNewStudent for any other reason) may not
    // have a referralCode yet. Generate one on first sight rather than
    // requiring a separate migration step.
    if (!student.referralCode) {
      student.referralCode = await generateUniqueReferralCode();
      await student.save();
    }

    res.json({
      matric: student.matric,
      name: student.name,
      role: student.role,
      credits: student.credits || 0,
      phone: student.phone,
      whatsapp: student.whatsapp,
      username: student.username,
      displayName: student.displayName || '',
      referralCode: student.referralCode,
      needsUsername: !student.username, // drives the blocking dashboard modal
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  USERNAMES (v1.2)
// ══════════════════════════════════════════════════════════════

// GET /api/username/check/:username — public-ish (still requires login,
// since it's only ever called from the signup-flow modal or the
// profile settings screen, both of which are post-auth). Real-time
// availability check, debounced on the frontend.
router.get('/username/check/:username', requireStudent, usernameCheckLimiter, async (req, res) => {
  try {
    const student = await Student.findOne({ matric: req.student.sub }).lean();
    const result = await checkAvailability(req.params.username, student?._id);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/username — set (first time) or change (respecting the
// 30-day cooldown) the current student's username.
router.post('/username', requireStudent, usernameChangeLimiter, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username is required' });

    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const finalUsername = await setUsername(student, username);
    res.json({ success: true, username: finalUsername });
  } catch (e) {
    const status = { INVALID_FORMAT: 400, TAKEN: 409, COOLDOWN: 429, UNCHANGED: 400 }[e.code] || 500;
    res.status(status).json({ error: e.message, code: e.code || 'SERVER_ERROR' });
  }
});

// PUT /api/profile/display-name — changeable anytime, unlike username.
router.put('/profile/display-name', requireStudent, async (req, res) => {
  try {
    const { displayName } = req.body;
    if (typeof displayName !== 'string') return res.status(400).json({ error: 'displayName must be a string' });
    const trimmed = displayName.trim().slice(0, 40);

    const student = await Student.findOneAndUpdate(
      { matric: req.student.sub },
      { displayName: trimmed },
      { new: true },
    ).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    res.json({ success: true, displayName: student.displayName });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/profile — the full profile page payload: identity, credits,
// quiz stats, transfer history, and referral link/code in one call.
router.get('/profile', requireStudent, async (req, res) => {
  try {
    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    if (!student.referralCode) {
      student.referralCode = await generateUniqueReferralCode();
      await student.save();
    }

    const [scores, transfersOut, transfersIn, referralCount] = await Promise.all([
      Score.find({ matric: student.matric }).sort({ ts: -1 }).lean(),
      Transfer.find({ fromMatric: student.matric }).sort({ createdAt: -1 }).limit(20).lean(),
      Transfer.find({ toMatric: student.matric }).sort({ createdAt: -1 }).limit(20).lean(),
      Student.countDocuments({ referredBy: student._id }),
    ]);

    const quizStats = {
      totalQuizzes: scores.length,
      avgScore: scores.length ? Math.round(scores.reduce((a, s) => a + (s.pct || 0), 0) / scores.length) : 0,
      bestScore: scores.length ? Math.max(...scores.map(s => s.pct || 0)) : 0,
    };

    const transferHistory = [...transfersOut, ...transfersIn]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 30);

    res.json({
      matric: student.matric,
      name: student.name,
      username: student.username,
      displayName: student.displayName || '',
      credits: student.credits || 0,
      quizStats,
      transferHistory,
      referral: {
        code: student.referralCode,
        referredCount: referralCount,
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  NOTIFICATIONS (v1.2)
// ══════════════════════════════════════════════════════════════

// GET /api/notifications — most recent 50, newest first.
router.get('/notifications', requireStudent, async (req, res) => {
  try {
    const notifications = await Notification.find({ matric: req.student.sub })
      .sort({ createdAt: -1 }).limit(50).lean();
    const unreadCount = await Notification.countDocuments({ matric: req.student.sub, read: false });
    res.json({ notifications, unreadCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/notifications/:id/read
router.post('/notifications/:id/read', requireStudent, async (req, res) => {
  try {
    await Notification.updateOne(
      { _id: req.params.id, matric: req.student.sub },
      { read: true },
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/notifications/read-all
router.post('/notifications/read-all', requireStudent, async (req, res) => {
  try {
    await Notification.updateMany({ matric: req.student.sub, read: false }, { read: true });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
