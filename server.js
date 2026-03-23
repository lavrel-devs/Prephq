require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const mongoose  = require('mongoose');
const crypto    = require('crypto');
const path      = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ══════════════════════════════════════════════════════════════
//  ADMIN KEY GUARD
// ══════════════════════════════════════════════════════════════
const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY || ADMIN_KEY === 'REPLACE_WITH_GENERATED_KEY') {
  console.error('\n╔══════════════════════════════════════════════════╗');
  console.error('║  ❌  ADMIN_KEY not set. Server will not start.   ║');
  console.error('╠══════════════════════════════════════════════════╣');
  console.error('║  Run this command to generate a secure key:      ║');
  console.error('║                                                  ║');
  console.error('║  node -e "console.log(require(\'crypto\')           ║');
  console.error('║    .randomBytes(32).toString(\'hex\'))"             ║');
  console.error('║                                                  ║');
  console.error('║  Then paste it into your .env as ADMIN_KEY=...   ║');
  console.error('╚══════════════════════════════════════════════════╝\n');
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════
//  MIDDLEWARE
// ══════════════════════════════════════════════════════════════
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════════════════════════════
//  MONGODB CONNECTION
// ══════════════════════════════════════════════════════════════
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/prephq')
  .then(() => console.log('✅  MongoDB connected'))
  .catch(e => {
    console.error('❌  MongoDB connection failed:', e.message);
    console.error('    Check your MONGODB_URI in .env');
  });

// ══════════════════════════════════════════════════════════════
//  SCHEMAS & MODELS
// ══════════════════════════════════════════════════════════════

// ── Student ───────────────────────────────────────────────────
const StudentSchema = new mongoose.Schema({
  matric:    { type: String, required: true, unique: true, uppercase: true, trim: true },
  password:  { type: String, required: true },
  name:      { type: String, required: true, trim: true },
  phone:     { type: String, default: '' },
  whatsapp:  { type: String, default: '' },
  role:      { type: String, default: 'student' },
  active:    { type: Boolean, default: true },
  codeUsed:  { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});
const Student = mongoose.model('Student', StudentSchema);

// ── Activation Code ───────────────────────────────────────────
const CodeSchema = new mongoose.Schema({
  code:      { type: String, required: true, unique: true, uppercase: true },
  status:    { type: String, enum: ['unused','used','expired'], default: 'unused' },
  usedBy:    { type: String, default: '' },     // matric of student who used it
  usedAt:    { type: Date, default: null },
  expiresAt: { type: Date, default: null },     // null = never expires
  batch:     { type: String, default: '' },     // batch label e.g. "Batch 1"
  note:      { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});
const Code = mongoose.model('Code', CodeSchema);

// ── Score ─────────────────────────────────────────────────────
const ScoreSchema = new mongoose.Schema({
  matric:  { type: String, required: true, uppercase: true },
  correct: Number,
  total:   Number,
  pct:     Number,
  wrong:   Number,
  skip:    Number,
  courses: String,
  mode:    String,
  ts:      { type: Date, default: Date.now },
});
ScoreSchema.index({ matric: 1, ts: -1 });
const Score = mongoose.model('Score', ScoreSchema);

// ── Payment ───────────────────────────────────────────────────
const PaymentSchema = new mongoose.Schema({
  matric:    { type: String, default: '', uppercase: true },
  name:      { type: String, default: '' },
  amount:    { type: Number, default: 0 },
  method:    { type: String, enum: ['cash','bank_transfer','opay','palmpay','other'], default: 'cash' },
  reference: { type: String, default: '' },
  note:      { type: String, default: '' },
  status:    { type: String, enum: ['confirmed','pending'], default: 'confirmed' },
  createdAt: { type: Date, default: Date.now },
});
const Payment = mongoose.model('Payment', PaymentSchema);

// ── Admin Question ────────────────────────────────────────────
const QuestionSchema = new mongoose.Schema({
  course:    { type: String, required: true },
  q:         { type: String, required: true },
  opts:      { type: [String], required: true },
  ans:       { type: Number, required: true },
  tag:       { type: String, default: '' },
  exp:       { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});
const Question = mongoose.model('Question', QuestionSchema);

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════
function adminOnly(req, res, next) {
  const key = req.headers['x-admin-key'] || req.body?.adminKey;
  if (key !== ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// Generate a code like X7K2-9QMP-4RBT
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  const seg = (n) => Array.from({ length: n }, () => chars[crypto.randomInt(chars.length)]).join('');
  return `${seg(4)}-${seg(4)}-${seg(4)}`;
}

// ══════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════════

// POST /api/auth/login  — student login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { matric, password } = req.body;
    if (!matric || !password)
      return res.status(400).json({ error: 'Matric and password required' });

    const student = await Student.findOne({ matric: matric.toUpperCase() });
    if (!student || student.password !== password)
      return res.status(401).json({ error: 'Invalid matric number or password' });
    if (!student.active)
      return res.status(403).json({ error: 'Account suspended. Contact admin.' });

    res.json({ matric: student.matric, name: student.name, role: student.role });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/auth/admin  — admin login
app.post('/api/auth/admin', (req, res) => {
  if (req.body?.key !== ADMIN_KEY)
    return res.status(401).json({ error: 'Invalid admin key' });
  res.json({ success: true });
});

// POST /api/auth/register  — student self-registration with activation code
app.post('/api/auth/register', async (req, res) => {
  try {
    const { matric, name, phone, whatsapp, code, password } = req.body;

    if (!matric || !name || !code)
      return res.status(400).json({ error: 'Matric, name and activation code are required' });

    // Check matric not taken
    const exists = await Student.findOne({ matric: matric.toUpperCase() });
    if (exists)
      return res.status(409).json({ error: 'This matric number is already registered' });

    // Validate code
    const codeDoc = await Code.findOne({ code: code.trim().toUpperCase() });
    if (!codeDoc)
      return res.status(404).json({ error: 'Invalid activation code' });
    if (codeDoc.status === 'used')
      return res.status(409).json({ error: 'This code has already been used' });
    if (codeDoc.status === 'expired')
      return res.status(410).json({ error: 'This code has expired' });
    if (codeDoc.expiresAt && new Date() > codeDoc.expiresAt)
      return res.status(410).json({ error: 'This code has expired' });

    // Create student
    const pw = password || matric.toUpperCase();
    const student = await Student.create({
      matric:   matric.toUpperCase().trim(),
      password: pw,
      name:     name.trim(),
      phone:    phone?.trim() || '',
      whatsapp: whatsapp?.trim() || '',
      codeUsed: codeDoc.code,
    });

    // Mark code as used
    await Code.updateOne({ _id: codeDoc._id }, {
      status: 'used',
      usedBy: student.matric,
      usedAt: new Date(),
    });

    res.status(201).json({
      matric:   student.matric,
      name:     student.name,
      password: pw,
      message:  'Account created successfully',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  ADMIN — DASHBOARD STATS
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/stats', adminOnly, async (req, res) => {
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
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const avgScore = allScores.length
      ? Math.round(allScores.reduce((a, b) => a + b.pct, 0) / allScores.length) : 0;

    // Top students
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

    // Recent registrations
    const recent = await Student.find().sort({ createdAt: -1 }).limit(5).lean();

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
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  ADMIN — STUDENTS
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/students', adminOnly, async (req, res) => {
  try {
    const students = await Student.find().sort({ createdAt: -1 }).lean();
    const result = await Promise.all(students.map(async s => {
      const scores = await Score.find({ matric: s.matric }).lean();
      return {
        ...s,
        quizCount: scores.length,
        best: scores.length ? Math.max(...scores.map(x => x.pct)) : 0,
        avg:  scores.length ? Math.round(scores.reduce((a, b) => a + b.pct, 0) / scores.length) : 0,
      };
    }));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/students  — admin manually adds a student
app.post('/api/admin/students', adminOnly, async (req, res) => {
  try {
    const { matric, name, phone, whatsapp, password, amount, method, reference, note } = req.body;
    if (!matric || !name)
      return res.status(400).json({ error: 'Matric and name required' });

    const exists = await Student.findOne({ matric: matric.toUpperCase() });
    if (exists) return res.status(409).json({ error: 'Matric already exists' });

    const pw = password || matric.toUpperCase();
    const student = await Student.create({
      matric:   matric.toUpperCase().trim(),
      password: pw,
      name:     name.trim(),
      phone:    phone?.trim() || '',
      whatsapp: whatsapp?.trim() || '',
      codeUsed: 'ADMIN_ADDED',
    });

    // Auto-record payment if amount given
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

    res.status(201).json({ matric: student.matric, name: student.name, password: pw });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/students/:matric
app.put('/api/admin/students/:matric', adminOnly, async (req, res) => {
  try {
    const { name, password, phone, whatsapp, active } = req.body;
    const update = {};
    if (name     !== undefined) update.name     = name.trim();
    if (password !== undefined) update.password = password;
    if (phone    !== undefined) update.phone    = phone;
    if (whatsapp !== undefined) update.whatsapp = whatsapp;
    if (active   !== undefined) update.active   = active;
    await Student.updateOne({ matric: req.params.matric.toUpperCase() }, update);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/admin/students/:matric
app.delete('/api/admin/students/:matric', adminOnly, async (req, res) => {
  try {
    await Student.deleteOne({ matric: req.params.matric.toUpperCase() });
    await Score.deleteMany({ matric: req.params.matric.toUpperCase() });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  ADMIN — ACTIVATION CODES
// ══════════════════════════════════════════════════════════════

// GET /api/admin/codes
app.get('/api/admin/codes', adminOnly, async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.batch)  filter.batch  = req.query.batch;
    const codes = await Code.find(filter).sort({ createdAt: -1 }).lean();
    res.json(codes);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/codes/generate — generate batch of codes
app.post('/api/admin/codes/generate', adminOnly, async (req, res) => {
  try {
    const count     = Math.min(parseInt(req.body.count) || 10, 200);
    const batch     = req.body.batch || `Batch ${new Date().toLocaleDateString('en-GB')}`;
    const note      = req.body.note || '';
    const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;

    const codes = [];
    let attempts = 0;
    while (codes.length < count && attempts < count * 5) {
      attempts++;
      const code = generateCode();
      const exists = await Code.findOne({ code });
      if (!exists) codes.push({ code, batch, note, expiresAt });
    }

    await Code.insertMany(codes);
    res.status(201).json({
      generated: codes.length,
      batch,
      codes: codes.map(c => c.code),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/codes/:id — deactivate / update
app.put('/api/admin/codes/:id', adminOnly, async (req, res) => {
  try {
    await Code.updateOne({ _id: req.params.id }, req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/admin/codes/:id
app.delete('/api/admin/codes/:id', adminOnly, async (req, res) => {
  try {
    await Code.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE unused codes in a batch
app.delete('/api/admin/codes/batch/:batch', adminOnly, async (req, res) => {
  try {
    const result = await Code.deleteMany({ batch: req.params.batch, status: 'unused' });
    res.json({ deleted: result.deletedCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  ADMIN — PAYMENTS
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/payments', adminOnly, async (req, res) => {
  try {
    const payments = await Payment.find().sort({ createdAt: -1 }).lean();
    res.json(payments);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/payments', adminOnly, async (req, res) => {
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

app.delete('/api/admin/payments/:id', adminOnly, async (req, res) => {
  try {
    await Payment.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  ADMIN — QUESTIONS
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/questions', adminOnly, async (req, res) => {
  try {
    const filter = {};
    if (req.query.course) filter.course = req.query.course;
    const questions = await Question.find(filter).sort({ createdAt: -1 }).lean();
    res.json(questions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/questions', adminOnly, async (req, res) => {
  try {
    const { course, q, opts, ans, tag, exp } = req.body;
    if (!course || !q || !opts || opts.length < 2 || ans === undefined)
      return res.status(400).json({ error: 'course, question, options and answer index required' });
    const question = await Question.create({
      course, q: q.trim(), opts, ans: parseInt(ans), tag: tag || '', exp: exp || '',
    });
    res.status(201).json(question);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/questions/:id', adminOnly, async (req, res) => {
  try {
    const { q, opts, ans, tag, exp } = req.body;
    await Question.updateOne({ _id: req.params.id }, {
      q: q?.trim(), opts, ans: parseInt(ans), tag, exp,
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/questions/:id', adminOnly, async (req, res) => {
  try {
    await Question.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Student-facing: get admin-added questions for a course
app.get('/api/questions/:course', async (req, res) => {
  try {
    const questions = await Question.find({ course: req.params.course }).lean();
    res.json(questions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  SCORES
// ══════════════════════════════════════════════════════════════
app.get('/api/scores/:matric', async (req, res) => {
  try {
    const scores = await Score.find({ matric: req.params.matric.toUpperCase() })
      .sort({ ts: -1 }).limit(200).lean();
    res.json(scores);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/scores/:matric', async (req, res) => {
  try {
    const { correct, total, pct, wrong, skip, courses, mode } = req.body;
    if (typeof pct !== 'number') return res.status(400).json({ error: 'Invalid' });
    await Score.create({
      matric: req.params.matric.toUpperCase(),
      correct, total, pct, wrong, skip, courses, mode,
    });
    res.status(201).json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/scores/:matric', adminOnly, async (req, res) => {
  try {
    await Score.deleteMany({ matric: req.params.matric.toUpperCase() });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  CATCH-ALL
// ══════════════════════════════════════════════════════════════
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ══════════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║  🎓  PrepHQ running on http://localhost:${PORT}      ║`);
  console.log(`║  🛡️   Admin: http://localhost:${PORT}/admin.html     ║`);
  console.log('╚══════════════════════════════════════════════════╝\n');
});
