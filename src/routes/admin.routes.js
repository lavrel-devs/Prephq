const express = require('express');
const bcrypt = require('bcryptjs');

const Student = require('../models/Student');
const Score = require('../models/Score');
const Payment = require('../models/Payment');
const Question = require('../models/Question');
const Admin = require('../models/Admin');
const CreditTransaction = require('../models/CreditTransaction');
const Course = require('../models/Course');

const { requireAdmin } = require('../middleware/auth');
const { applyCreditDelta } = require('../utils/credits');
const { checkAvailability, adminSetUsername } = require('../utils/username');
const { cleanMatric, cleanName, cleanPhone, isObjectId, escapeRegex } = require('../utils/validate');
const Session = require('../models/Session');
const QuestionAttempt = require('../models/QuestionAttempt');
const ChatMessage = require('../models/ChatMessage');
const StudentBackup = require('../models/StudentBackup');
const Notification = require('../models/Notification');
const FlashcardProgress = require('../models/FlashcardProgress');
const GeneratedQuestion = require('../models/GeneratedQuestion');
const StudyGuide = require('../models/StudyGuide');
const { forgetSubject } = require('../middleware/auth');
const { canChange } = require('../utils/adminAccess');

const router = express.Router();
router.use(requireAdmin);

// ══════════════════════════════════════════════════════════════
//  DASHBOARD STATS
// ══════════════════════════════════════════════════════════════
router.get('/stats', async (req, res) => {
  try {
    const [totalStudents, totalPayments, avgAgg] =
      await Promise.all([
        Student.countDocuments(),
        Payment.countDocuments({ status: 'confirmed' }),
        Score.aggregate([{ $group: { _id: null, avg: { $avg: { $ifNull: ['$pct', 0] } } } }]),
      ]);

    const revenueAgg = await Payment.aggregate([
      { $match: { status: 'confirmed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const avgScore = avgAgg[0] ? Math.round(avgAgg[0].avg) : 0;

    // v1.4 fix: "top scorers" used to be a lifetime average, which meant
    // a rough start months ago permanently buried anyone who's actively
    // improving now. Now it's each student's best recent streak: their
    // highest average over any 5 consecutive quizzes, considering only
    // quizzes from the last RECENCY_WINDOW_DAYS. Only that window is
    // loaded (this used to pull every Score and every Student into memory).
    const RECENCY_WINDOW_DAYS = 14;
    const STREAK_LEN = 5;
    const cutoff = new Date(Date.now() - RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const recentScores = await Score.find({ ts: { $gte: cutoff } }).select('matric pct ts').lean();

    const scoresByMatric = {};
    recentScores.forEach(s => {
      if (!scoresByMatric[s.matric]) scoresByMatric[s.matric] = [];
      scoresByMatric[s.matric].push(s);
    });

    const ranked = Object.entries(scoresByMatric)
      .map(([m, scores]) => {
        const sorted = scores.sort((a, b) => new Date(a.ts) - new Date(b.ts));
        let bestStreakAvg = 0;
        for (let i = 0; i + STREAK_LEN <= sorted.length; i++) {
          const window = sorted.slice(i, i + STREAK_LEN);
          const windowAvg = window.reduce((a, s) => a + (s.pct || 0), 0) / window.length;
          if (windowAvg > bestStreakAvg) bestStreakAvg = windowAvg;
        }
        // Fewer than STREAK_LEN recent quizzes: use their average of
        // whatever recent quizzes they do have.
        if (!bestStreakAvg) bestStreakAvg = sorted.reduce((a, s) => a + (s.pct || 0), 0) / sorted.length;
        return { matric: m, avg: Math.round(bestStreakAvg), quizzes: sorted.length };
      })
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 5);

    const topDocs = await Student.find({ matric: { $in: ranked.map(r => r.matric) } }).select('matric name').lean();
    const nameOf = Object.fromEntries(topDocs.map(d => [d.matric, d.name]));
    const topStudents = ranked.map(r => ({ ...r, name: nameOf[r.matric] || r.matric }));

    // Never ship credentials (hash or legacy plaintext) to the browser.
    const recent = await Student.find().sort({ createdAt: -1 }).limit(5)
      .select('-password -passwordHash -devices').lean();
    const totalCreditsIssuedAgg = await CreditTransaction.aggregate([
      { $match: { delta: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$delta' } } },
    ]);

    res.json({
      totalStudents,
      totalPayments,
      totalRevenue: revenueAgg[0]?.total || 0,
      avgScore,
      topStudents,
      recentStudents: recent,
      totalCreditsIssued: totalCreditsIssuedAgg[0]?.total || 0,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  STUDENTS
// ══════════════════════════════════════════════════════════════
router.get('/students', async (req, res) => {
  try {
    // One aggregate for everyone's quiz stats instead of a query per student.
    const [students, statsAgg] = await Promise.all([
      Student.find().sort({ createdAt: -1 }).select('-password -passwordHash -devices').lean(),
      Score.aggregate([{ $group: { _id: '$matric', n: { $sum: 1 }, best: { $max: { $ifNull: ['$pct', 0] } }, avg: { $avg: { $ifNull: ['$pct', 0] } } } }]),
    ]);
    const stats = Object.fromEntries(statsAgg.map(r => [r._id, r]));
    res.json(students.map(s => {
      const st = stats[s.matric];
      return { ...s, quizCount: st ? st.n : 0, best: st ? st.best : 0, avg: st ? Math.round(st.avg) : 0 };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/students', async (req, res) => {
  try {
    const { password, amount, method, reference, note, credits, username } = req.body;
    const matric = cleanMatric(req.body.matric);
    const name = cleanName(req.body.name);
    const phone = cleanPhone(req.body.phone);
    const whatsapp = cleanPhone(req.body.whatsapp);
    if (!req.body.matric || !req.body.name)
      return res.status(400).json({ error: 'Matric and name required' });
    if (!matric) return res.status(400).json({ error: 'Matric can only contain letters, numbers, spaces and / - _ . (3–30 characters)' });
    if (!name) return res.status(400).json({ error: 'Name must be 2–80 characters with no < or >' });
    if (phone === null || whatsapp === null) return res.status(400).json({ error: 'Phone numbers can only contain digits, +, -, ( ) and spaces' });
    if (password !== undefined && password !== '' && (typeof password !== 'string' || password.length < 4 || password.length > 72))
      return res.status(400).json({ error: 'Password must be 4–72 characters' });

    // v1.3: username required here too, same rules as self-registration.
    if (typeof username !== 'string' || !username.trim())
      return res.status(400).json({ error: 'Please choose a username' });

    const usernameCheck = await checkAvailability(username);
    if (!usernameCheck.ok)
      return res.status(409).json({ error: usernameCheck.reason === 'That username is already taken'
        ? 'Username already taken'
        : usernameCheck.reason });

    const exists = await Student.findOne({ matric });
    if (exists) return res.status(409).json({ error: 'Matric already exists' });

    const pw = (typeof password === 'string' && password) ? password : matric;
    const passwordHash = await bcrypt.hash(pw, 10);
    let student;
    try {
      student = await Student.create({
        matric,
        passwordHash,
        name,
        phone,
        whatsapp,
        credits:           0,
        username:          usernameCheck.username,
        usernameChangedAt: new Date(),
      });
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: 'Matric or username already exists' });
      throw e;
    }

    // A students-only admin may create accounts but not hand out money: starting
    // credits need the Credits permission, a logged payment needs Payments.
    const payAmount = parseFloat(amount);
    if (payAmount > 0 && canChange(req.admin.access, 'payments')) {
      await Payment.create({
        matric: student.matric,
        name:   student.name,
        amount: payAmount,
        method: method || 'cash',
        reference: String(reference || ''),
        note:   String(note || ''),
        status: 'confirmed',
      });
    }

    if (parseInt(credits) > 0 && canChange(req.admin.access, 'credits')) {
      await applyCreditDelta({
        matric: student.matric,
        delta: parseInt(credits),
        reason: 'admin_credit',
        note: 'Initial credits on account creation',
        actor: req.admin.sub,
      });
    }

    res.status(201).json({ matric: student.matric, name: student.name, password: pw });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/students/:matric', async (req, res) => {
  try {
    const { password, active } = req.body;
    const update = {};
    if (req.body.name !== undefined) {
      const name = cleanName(req.body.name);
      if (!name) return res.status(400).json({ error: 'Name must be 2–80 characters with no < or >' });
      update.name = name;
    }
    if (password !== undefined && password !== '') {
      if (typeof password !== 'string' || password.length < 4 || password.length > 72)
        return res.status(400).json({ error: 'Password must be 4–72 characters' });
      update.passwordHash = await bcrypt.hash(password, 10);
      update.password = ''; // drop any legacy plaintext copy
    }
    for (const f of ['phone', 'whatsapp']) {
      if (req.body[f] === undefined) continue;
      const v = cleanPhone(req.body[f]);
      if (v === null) return res.status(400).json({ error: 'Phone numbers can only contain digits, +, -, ( ) and spaces' });
      update[f] = v;
    }
    if (active !== undefined) {
      if (typeof active !== 'boolean') return res.status(400).json({ error: 'active must be a boolean' });
      update.active = active;
    }

    const matric = req.params.matric.toUpperCase();
    const r = await Student.updateOne({ matric }, update);
    if (!r.matchedCount) return res.status(404).json({ error: 'Student not found' });

    // Suspending here must cut off live sessions too (the dedicated
    // /users/:matric/status endpoint already did; this one didn't).
    // A changed password also signs out existing devices.
    if (update.active === false || update.passwordHash) {
      await Session.updateMany({ subjectId: matric, role: 'student', revoked: { $ne: true } }, { revoked: true, revokedAt: new Date() });
      forgetSubject('student', matric);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/students/:matric', async (req, res) => {
  try {
    const matric = req.params.matric.toUpperCase();
    await Student.deleteOne({ matric });
    // Cascade: this used to leave sessions (still able to act until the
    // token expired) and all of the student's other data orphaned.
    // The credit ledger, transfers and contest history are kept on purpose (audit trail).
    await Promise.all([
      Score.deleteMany({ matric }),
      Session.deleteMany({ subjectId: matric, role: 'student' }),
      QuestionAttempt.deleteMany({ matric }),
      ChatMessage.deleteMany({ matric }),
      StudentBackup.deleteMany({ matric }),
      Notification.deleteMany({ matric }),
      FlashcardProgress.deleteMany({ matric }),
      GeneratedQuestion.deleteMany({ matric }),
      StudyGuide.deleteMany({ matric }),
    ]);
    forgetSubject('student', matric);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CREDITS ──────────────────────────────────────────────────
// POST /api/admin/students/:matric/credits  { amount, note }
// amount can be positive (credit) or negative (debit). This is the
// endpoint the admin dashboard's "Credit a student" panel calls.
router.post('/students/:matric/credits', async (req, res) => {
  try {
    const amount = parseInt(req.body.amount, 10);
    if (!amount || isNaN(amount) || Math.abs(amount) > 1000000) return res.status(400).json({ error: 'A non-zero integer amount is required' });

    const result = await applyCreditDelta({
      matric: req.params.matric,
      delta: amount,
      reason: amount > 0 ? 'admin_credit' : 'admin_debit',
      note: String(req.body.note || '').slice(0, 300),
      actor: req.admin.sub,
      allowNegative: false,
    });

    res.json({ success: true, matric: req.params.matric.toUpperCase(), balance: result.balance });
  } catch (e) {
    if (e.message === 'Student not found') return res.status(404).json({ error: e.message });
    if (e.code === 'INSUFFICIENT_CREDITS') return res.status(400).json({ error: 'That would take the student below 0 credits' });
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/students/:matric/credits/history
router.get('/students/:matric/credits/history', async (req, res) => {
  try {
    const history = await CreditTransaction.find({ matric: req.params.matric.toUpperCase() })
      .sort({ createdAt: -1 }).limit(100).lean();
    res.json(history);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/students/:matric/username — v1.2. Force-set or reset a
// student's username. Bypasses the 30-day change cooldown (that's the
// point of an admin override). Pass { username: null } or omit to just
// clear it back to unset, forcing the student through the setup modal
// again on next login.
router.put('/students/:matric/username', async (req, res) => {
  try {
    const student = await Student.findOne({ matric: req.params.matric.toUpperCase() });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const { username } = req.body;
    if (username === null || username === undefined || username === '') {
      // $unset (not null): an explicit null is indexed by the sparse unique
      // index, so clearing a second student's username would collide with the first.
      student.username = undefined;
      student.usernameChangedAt = null;
      await student.save();
      return res.json({ success: true, username: null, cleared: true });
    }

    const finalUsername = await adminSetUsername(student, username);
    res.json({ success: true, username: finalUsername });
  } catch (e) {
    const status = { INVALID_FORMAT: 400, TAKEN: 409 }[e.code] || 500;
    res.status(status).json({ error: e.message, code: e.code || 'SERVER_ERROR' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PAYMENTS
// ══════════════════════════════════════════════════════════════
router.get('/payments', async (req, res) => {
  try {
    const payments = await Payment.find().sort({ createdAt: -1 }).lean();
    res.json(payments);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/payments', async (req, res) => {
  try {
    const { matric, name, amount, method, reference, note } = req.body;
    const amt = parseFloat(amount);
    if (!(amt > 0)) return res.status(400).json({ error: 'A positive amount is required' });
    const payment = await Payment.create({
      matric: typeof matric === 'string' ? matric.toUpperCase().trim() : '',
      name: String(name || ''),
      amount: amt,
      method: method || 'cash',
      reference: String(reference || ''),
      note: String(note || ''),
    });
    res.status(201).json(payment);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/payments/:id', async (req, res) => {
  try {
    await Payment.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  COURSES  (v1.1.5)
// ══════════════════════════════════════════════════════════════
router.get('/courses', async (req, res) => {
  try {
    const courses = await Course.find().sort({ courseCode: 1 }).lean();
    res.json(courses);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/courses', async (req, res) => {
  try {
    const { courseCode, courseTitle, department, level, topics, color, icon } = req.body;
    if (typeof courseCode !== 'string' || typeof courseTitle !== 'string' || !courseCode.trim() || !courseTitle.trim())
      return res.status(400).json({ error: 'Course code and title are required' });

    const key = courseCode.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    const exists = await Course.findOne({ $or: [{ courseCode: courseCode.toUpperCase().trim() }, { key }] });
    if (exists) return res.status(409).json({ error: 'That course code already exists' });

    const course = await Course.create({
      courseCode: courseCode.toUpperCase().trim(),
      key,
      courseTitle: courseTitle.trim(),
      department: department?.trim() || '',
      level: level?.trim() || '',
      topics: Array.isArray(topics) ? topics : (topics ? String(topics).split(',').map(t => t.trim()).filter(Boolean) : []),
      color: color || '#0A5CF5',
      icon: icon || 'star',
    });
    res.status(201).json(course);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/courses/:id', async (req, res) => {
  try {
    const { courseTitle, department, level, topics, color, icon } = req.body;
    const update = {};
    if (courseTitle !== undefined) update.courseTitle = courseTitle.trim();
    if (department  !== undefined) update.department  = department.trim();
    if (level       !== undefined) update.level       = level.trim();
    if (topics      !== undefined) update.topics = Array.isArray(topics) ? topics : String(topics).split(',').map(t => t.trim()).filter(Boolean);
    if (color       !== undefined) update.color = color;
    if (icon        !== undefined) update.icon  = icon;
    await Course.updateOne({ _id: req.params.id }, update);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/courses/:id', async (req, res) => {
  try {
    await Course.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  QUESTIONS
// ══════════════════════════════════════════════════════════════
router.get('/questions', async (req, res) => {
  try {
    let filter = {};
    if (typeof req.query.course === 'string' && req.query.course) {
      // Same normalization as the public /api/questions/:course route —
      // admin-added questions are stored under the lowercase key, but
      // older bank data may still use a raw uppercase code. Match both
      // so the admin panel's filter never silently hides questions.
      const normalizedKey = req.query.course.toLowerCase().replace(/[^a-z0-9]/g, '');
      const courseDoc = await Course.findOne({ key: normalizedKey });
      const candidates = new Set([req.query.course, normalizedKey]);
      if (courseDoc) { candidates.add(courseDoc.key); candidates.add(courseDoc.courseCode); }
      filter = { $or: [...candidates].map(c => ({ course: { $regex: new RegExp(`^${escapeRegex(c)}$`, 'i') } })) };
    }
    const questions = await Question.find(filter).sort({ createdAt: -1 }).lean();
    res.json(questions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function validOpts(opts) {
  return Array.isArray(opts) && opts.length >= 2 && opts.length <= 10 && opts.every(o => typeof o === 'string' && o.trim());
}

router.post('/questions', async (req, res) => {
  try {
    const { course, q, opts, ans, tag, exp } = req.body;
    if (typeof course !== 'string' || typeof q !== 'string' || !q.trim() || !validOpts(opts) || ans === undefined)
      return res.status(400).json({ error: 'course, question, options (2–10 non-empty strings) and answer index required' });

    const ansIdx = parseInt(ans);
    if (Number.isNaN(ansIdx) || ansIdx < 0 || ansIdx >= opts.length)
      return res.status(400).json({ error: 'Correct answer must point to one of the supplied options' });

    // Normalized like every other course lookup ("CHM 142" → "chm142"), and stored
    // under the canonical key so the bank stops accumulating mixed formats.
    const normalizedKey = course.toLowerCase().replace(/[^a-z0-9]/g, '');
    const courseExists = await Course.findOne({ key: normalizedKey });
    if (!courseExists)
      return res.status(400).json({ error: `Unknown course "${course}" — add it under Course Management first` });

    const question = await Question.create({
      course: courseExists.key, q: q.trim(), opts: opts.map(o => o.trim()), ans: ansIdx,
      tag: typeof tag === 'string' ? tag : '', exp: typeof exp === 'string' ? exp : '',
      createdBy: req.admin.sub || '',
    });
    res.status(201).json(question);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/questions/:id', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Question not found' });
    const existing = await Question.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Question not found' });

    // Only touch fields that were actually sent — this used to write
    // `ans: NaN` whenever `ans` was omitted, failing the whole edit.
    const { q, opts, ans, tag, exp } = req.body;
    if (q !== undefined) {
      if (typeof q !== 'string' || !q.trim()) return res.status(400).json({ error: 'Question text cannot be empty' });
      existing.q = q.trim();
    }
    if (opts !== undefined) {
      if (!validOpts(opts)) return res.status(400).json({ error: 'Options must be 2–10 non-empty strings' });
      existing.opts = opts.map(o => o.trim());
    }
    if (ans !== undefined) {
      const idx = parseInt(ans);
      if (Number.isNaN(idx)) return res.status(400).json({ error: 'Answer must be a number' });
      existing.ans = idx;
    }
    if (existing.ans < 0 || existing.ans >= existing.opts.length)
      return res.status(400).json({ error: 'Correct answer must point to one of the options' });
    if (tag !== undefined) existing.tag = String(tag);
    if (exp !== undefined) existing.exp = String(exp);
    await existing.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/questions/:id', async (req, res) => {
  try {
    await Question.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  ADMIN ACCOUNT MANAGEMENT
// ══════════════════════════════════════════════════════════════
// (Creating / editing / removing admins now lives in admin/admin.admins.routes.js.)

// PUT /api/admin/admins/me/password — change your own password
router.put('/admins/me/password', async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 72)
      return res.status(400).json({ error: 'Password must be 8–72 characters' });
    // The legacy ADMIN_KEY has no Admin row, so there is nothing to update (it used to say "success").
    if (req.admin.sub === 'legacy-key') return res.status(400).json({ error: 'Log in with an admin account to change a password' });
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await Admin.updateOne({ username: req.admin.sub }, { passwordHash });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
