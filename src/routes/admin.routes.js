const express = require('express');
const bcrypt = require('bcryptjs');

const Student = require('../models/Student');
const Code = require('../models/Code');
const Score = require('../models/Score');
const Payment = require('../models/Payment');
const Question = require('../models/Question');
const Admin = require('../models/Admin');
const CreditTransaction = require('../models/CreditTransaction');
const Course = require('../models/Course');

const { requireAdmin } = require('../middleware/auth');
const { generateCode } = require('../utils/codeGen');
const { applyCreditDelta } = require('../utils/credits');

const router = express.Router();
router.use(requireAdmin);

// ══════════════════════════════════════════════════════════════
//  DASHBOARD STATS
// ══════════════════════════════════════════════════════════════
router.get('/stats', async (req, res) => {
  try {
    const [totalStudents, totalCodes, usedCodes, unusedCodes, totalPayments, allScores] =
      await Promise.all([
        Student.countDocuments(),
        Code.countDocuments(),
        Code.countDocuments({ status: 'used' }),
        Code.countDocuments({ status: 'unused' }),
        Payment.countDocuments({ status: 'confirmed' }),
        Score.find().lean(),
      ]);

    const revenueAgg = await Payment.aggregate([
      { $match: { status: 'confirmed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const avgScore = allScores.length
      ? Math.round(allScores.reduce((a, b) => a + b.pct, 0) / allScores.length) : 0;

    const students = await Student.find().lean();
    const scoreMap = {};
    allScores.forEach(s => {
      if (!scoreMap[s.matric]) scoreMap[s.matric] = [];
      scoreMap[s.matric].push(s.pct);
    });
    const topStudents = Object.entries(scoreMap)
      .map(([m, pcts]) => ({
        matric: m,
        name: students.find(u => u.matric === m)?.name || m,
        avg: Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length),
        quizzes: pcts.length,
      }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 5);

    const recent = await Student.find().sort({ createdAt: -1 }).limit(5).lean();
    const totalCreditsIssuedAgg = await CreditTransaction.aggregate([
      { $match: { delta: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$delta' } } },
    ]);

    res.json({
      totalStudents,
      totalCodes,
      usedCodes,
      unusedCodes,
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
    const students = await Student.find().sort({ createdAt: -1 }).lean();
    const result = await Promise.all(students.map(async s => {
      const scores = await Score.find({ matric: s.matric }).lean();
      return {
        ...s,
        password: undefined,
        passwordHash: undefined,
        quizCount: scores.length,
        best: scores.length ? Math.max(...scores.map(x => x.pct)) : 0,
        avg:  scores.length ? Math.round(scores.reduce((a, b) => a + b.pct, 0) / scores.length) : 0,
      };
    }));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/students', async (req, res) => {
  try {
    const { matric, name, phone, whatsapp, password, amount, method, reference, note, credits } = req.body;
    if (!matric || !name)
      return res.status(400).json({ error: 'Matric and name required' });

    const exists = await Student.findOne({ matric: matric.toUpperCase() });
    if (exists) return res.status(409).json({ error: 'Matric already exists' });

    const pw = password || matric.toUpperCase();
    const passwordHash = await bcrypt.hash(pw, 10);
    const student = await Student.create({
      matric:       matric.toUpperCase().trim(),
      passwordHash,
      name:         name.trim(),
      phone:        phone?.trim() || '',
      whatsapp:     whatsapp?.trim() || '',
      codeUsed:     'ADMIN_ADDED',
      credits:      0,
    });

    if (amount && parseFloat(amount) > 0) {
      await Payment.create({
        matric: student.matric,
        name:   student.name,
        amount: parseFloat(amount),
        method: method || 'cash',
        reference: reference || '',
        note:   note || '',
        status: 'confirmed',
      });
    }

    if (credits && parseInt(credits) > 0) {
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
    const { name, password, phone, whatsapp, active } = req.body;
    const update = {};
    if (name     !== undefined) update.name     = name.trim();
    if (password !== undefined) update.passwordHash = await bcrypt.hash(password, 10);
    if (phone    !== undefined) update.phone    = phone;
    if (whatsapp !== undefined) update.whatsapp = whatsapp;
    if (active   !== undefined) update.active   = active;
    await Student.updateOne({ matric: req.params.matric.toUpperCase() }, update);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/students/:matric', async (req, res) => {
  try {
    await Student.deleteOne({ matric: req.params.matric.toUpperCase() });
    await Score.deleteMany({ matric: req.params.matric.toUpperCase() });
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
    if (!amount || isNaN(amount)) return res.status(400).json({ error: 'A non-zero integer amount is required' });

    const result = await applyCreditDelta({
      matric: req.params.matric,
      delta: amount,
      reason: amount > 0 ? 'admin_credit' : 'admin_debit',
      note: req.body.note || '',
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

// ══════════════════════════════════════════════════════════════
//  ACTIVATION CODES
// ══════════════════════════════════════════════════════════════
router.get('/codes', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.batch)  filter.batch  = req.query.batch;
    const codes = await Code.find(filter).sort({ createdAt: -1 }).lean();
    res.json(codes);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/codes/generate', async (req, res) => {
  try {
    const count     = Math.min(parseInt(req.body.count) || 10, 200);
    const batch     = req.body.batch || `Batch ${new Date().toLocaleDateString('en-GB')}`;
    const note      = req.body.note || '';
    const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
    const creditsGranted = Math.max(0, parseInt(req.body.creditsGranted) || 0);

    const codes = [];
    let attempts = 0;
    while (codes.length < count && attempts < count * 5) {
      attempts++;
      const code = generateCode();
      const existsCode = await Code.findOne({ code });
      if (!existsCode) codes.push({ code, batch, note, expiresAt, creditsGranted });
    }

    await Code.insertMany(codes);
    res.status(201).json({
      generated: codes.length,
      batch,
      creditsGranted,
      codes: codes.map(c => c.code),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/codes/:id', async (req, res) => {
  try {
    await Code.updateOne({ _id: req.params.id }, req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/codes/:id', async (req, res) => {
  try {
    await Code.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/codes/batch/:batch', async (req, res) => {
  try {
    const result = await Code.deleteMany({ batch: req.params.batch, status: 'unused' });
    res.json({ deleted: result.deletedCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    if (!amount) return res.status(400).json({ error: 'Amount required' });
    const payment = await Payment.create({
      matric: matric?.toUpperCase() || '',
      name: name || '',
      amount: parseFloat(amount),
      method: method || 'cash',
      reference: reference || '',
      note: note || '',
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
    if (!courseCode || !courseTitle)
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
    if (req.query.course) {
      // Same normalization as the public /api/questions/:course route —
      // admin-added questions are stored under the lowercase key, but
      // older bank data may still use a raw uppercase code. Match both
      // so the admin panel's filter never silently hides questions.
      const normalizedKey = req.query.course.toLowerCase().replace(/[^a-z0-9]/g, '');
      const courseDoc = await Course.findOne({ key: normalizedKey });
      const candidates = new Set([req.query.course, normalizedKey]);
      if (courseDoc) { candidates.add(courseDoc.key); candidates.add(courseDoc.courseCode); }
      filter = { $or: [...candidates].map(c => ({ course: { $regex: new RegExp(`^${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } })) };
    }
    const questions = await Question.find(filter).sort({ createdAt: -1 }).lean();
    res.json(questions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/questions', async (req, res) => {
  try {
    const { course, q, opts, ans, tag, exp } = req.body;
    if (!course || !q || !opts || opts.length < 2 || ans === undefined)
      return res.status(400).json({ error: 'course, question, options and answer index required' });

    const ansIdx = parseInt(ans);
    if (Number.isNaN(ansIdx) || ansIdx < 0 || ansIdx >= opts.length)
      return res.status(400).json({ error: 'Correct answer must point to one of the supplied options' });

    const courseExists = await Course.findOne({ key: course.toLowerCase() });
    if (!courseExists)
      return res.status(400).json({ error: `Unknown course "${course}" — add it under Course Management first` });

    const question = await Question.create({
      course, q: q.trim(), opts, ans: ansIdx, tag: tag || '', exp: exp || '',
      createdBy: req.admin.sub || '',
    });
    res.status(201).json(question);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/questions/:id', async (req, res) => {
  try {
    const { q, opts, ans, tag, exp } = req.body;
    await Question.updateOne({ _id: req.params.id }, {
      q: q?.trim(), opts, ans: parseInt(ans), tag, exp,
    });
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
// POST /api/admin/admins — create another admin account (any logged-in admin can)
router.post('/admins', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || password.length < 8)
      return res.status(400).json({ error: 'Username and an 8+ character password are required' });

    const exists = await Admin.findOne({ username: username.toLowerCase().trim() });
    if (exists) return res.status(409).json({ error: 'That username is already taken' });

    const passwordHash = await bcrypt.hash(password, 10);
    const admin = await Admin.create({ username: username.toLowerCase().trim(), passwordHash });
    res.status(201).json({ username: admin.username });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/admins/me/password — change your own password
router.put('/admins/me/password', async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await Admin.updateOne({ username: req.admin.sub }, { passwordHash });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
