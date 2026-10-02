const express = require('express');
const rateLimit = require('express-rate-limit');
const Student = require('../models/Student');
const Question = require('../models/Question');
const Settings = require('../models/Settings');
const SupportRequest = require('../models/SupportRequest');
const { requireStudent } = require('../middleware/auth');
const { PREMIUM_PERIODS, PERIOD_PRICE_FIELD } = require('../services/entitlements.service');
const { uniqueCode, pickAdminContact, waUrl } = require('../services/support.service');
const { isObjectId } = require('../utils/validate');

const router = express.Router();

const limiter = (max) => rateLimit({ windowMs: 60 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' } });

const PLAN_LABEL = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly', lifetime: 'Lifetime' };

// POST /api/upgrade-request  { plan }
// No online payment: this files a request and hands the student a WhatsApp link to an admin, who confirms
// payment by hand and grants the plan from the Support inbox.
router.post('/upgrade-request', requireStudent, limiter(10), async (req, res) => {
  try {
    const plan = String(req.body.plan || '');
    if (!PREMIUM_PERIODS.includes(plan)) return res.status(400).json({ error: 'Choose Weekly, Monthly, Yearly or Lifetime' });

    const [student, settings] = await Promise.all([
      Student.findOne({ matric: req.student.sub }).select('matric name').lean(),
      Settings.getGlobal(),
    ]);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const price = settings.tiers.premium[PERIOD_PRICE_FIELD[plan]];
    if (price == null) return res.status(400).json({ error: `${PLAN_LABEL[plan]} isn't offered right now` });

    // One open request per student+plan: tapping twice reuses it rather than spamming the inbox.
    let reqDoc = await SupportRequest.findOne({ type: 'upgrade', matric: student.matric, plan, status: 'open' });
    if (!reqDoc) {
      const contact = await pickAdminContact();
      reqDoc = await SupportRequest.create({
        type: 'upgrade', code: await uniqueCode(), matric: student.matric, name: student.name, plan,
        assignedAdmin: contact ? contact.username : '',
      });
    }
    const contact = await pickAdminContact();
    const to = contact ? contact.number : '';
    const msg = `Hi, I'd like to activate PrepHQ Premium (${PLAN_LABEL[plan]} — ₦${Number(price).toLocaleString('en-NG')}). Request ${reqDoc.code}. Matric: ${student.matric}. Name: ${student.name}.`;
    res.status(201).json({ code: reqDoc.code, plan, price, whatsappUrl: waUrl(to, msg), hasContact: !!to });
  } catch (e) { res.status(500).json({ error: 'Could not create your request. Please try again.' }); }
});

// POST /api/questions/report  { questionId?, reason, note?, snapshot? }
// A student flags a question as wrong/unclear. For bank questions the server takes its own snapshot;
// AI-generated questions (no bank id) use the text the client sends.
const REASONS = ['wrong_answer', 'typo', 'unclear', 'other'];
router.post('/questions/report', requireStudent, limiter(30), async (req, res) => {
  try {
    const reason = REASONS.includes(req.body.reason) ? req.body.reason : 'other';
    const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 300) : '';
    const matric = req.student.sub;

    let snap = null, questionId = null;
    if (req.body.questionId) {
      if (!isObjectId(String(req.body.questionId))) return res.status(400).json({ error: 'Invalid question' });
      const q = await Question.findById(req.body.questionId).lean();
      if (!q) return res.status(404).json({ error: 'That question no longer exists' });
      questionId = q._id;
      snap = { course: q.course, q: q.q, opts: q.opts, ans: q.ans, tag: q.tag || '' };
    } else {
      const s = req.body.snapshot || {};
      if (typeof s.q !== 'string' || !s.q.trim() || !Array.isArray(s.opts)) return res.status(400).json({ error: 'Nothing to report' });
      snap = {
        course: String(s.course || '').slice(0, 40), q: s.q.slice(0, 1500),
        opts: s.opts.slice(0, 8).map(o => String(o).slice(0, 300)), ans: Number.isInteger(s.ans) ? s.ans : null, tag: String(s.tag || '').slice(0, 100),
      };
    }

    // Same student reporting the same question again just returns the existing report.
    const dup = await SupportRequest.findOne(questionId
      ? { type: 'question_report', matric, status: 'open', 'report.questionId': questionId }
      : { type: 'question_report', matric, status: 'open', 'report.q': snap.q });
    if (dup) return res.json({ code: dup.code, duplicate: true });

    const today = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if ((await SupportRequest.countDocuments({ type: 'question_report', matric, createdAt: { $gte: today } })) >= 20)
      return res.status(429).json({ error: "You've sent a lot of reports today — thank you! Try again tomorrow." });

    const doc = await SupportRequest.create({
      type: 'question_report', code: await uniqueCode(), matric,
      report: { reason, note, questionId, course: snap.course, q: snap.q, opts: snap.opts, ans: snap.ans, tag: snap.tag },
    });
    res.status(201).json({ code: doc.code });
  } catch (e) { res.status(500).json({ error: 'Could not send your report. Please try again.' }); }
});

module.exports = router;
