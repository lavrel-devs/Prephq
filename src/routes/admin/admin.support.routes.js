const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Student = require('../../models/Student');
const Admin = require('../../models/Admin');
const Session = require('../../models/Session');
const Question = require('../../models/Question');
const Payment = require('../../models/Payment');
const Settings = require('../../models/Settings');
const SupportRequest = require('../../models/SupportRequest');
const { requireAdmin, forgetSubject } = require('../../middleware/auth');
const { canChange } = require('../../utils/adminAccess');
const { PREMIUM_PERIODS, PERIOD_DAYS, PERIOD_PRICE_FIELD } = require('../../services/entitlements.service');
const { normalizePhone, waUrl } = require('../../services/support.service');
const { notify } = require('../../services/notification.service');
const { logActivity } = require('../../services/activity.service');
const { isObjectId } = require('../../utils/validate');

const router = express.Router();
router.use(requireAdmin);
// Access ("support" area) is enforced centrally by adminGate. Extra powers used below are checked here:
// granting Premium needs "payments", fixing a question's answer needs "questions".

const PLAN_LABEL = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly', lifetime: 'Lifetime' };

function tempPassword() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += A[crypto.randomInt(A.length)];
  return s;
}

async function loadRequest(req, res) {
  if (!isObjectId(req.params.id)) { res.status(404).json({ error: 'Request not found' }); return null; }
  const r = await SupportRequest.findById(req.params.id);
  if (!r) { res.status(404).json({ error: 'Request not found' }); return null; }
  return r;
}
async function close(r, admin, status, note = '') {
  r.status = status; r.resolvedBy = admin; r.resolvedAt = new Date(); r.resolutionNote = String(note || '').slice(0, 300);
  await r.save();
}

// GET /api/admin/support?status=open|resolved|rejected|all&type=
router.get('/support', async (req, res) => {
  try {
    const filter = {};
    const status = String(req.query.status || 'open');
    if (['open', 'resolved', 'rejected'].includes(status)) filter.status = status;
    if (['recovery', 'upgrade', 'question_report'].includes(req.query.type)) filter.type = req.query.type;
    const rows = await SupportRequest.find(filter).sort({ createdAt: -1 }).limit(200).lean();

    const matrics = [...new Set(rows.map(r => r.matric).filter(Boolean))];
    const students = await Student.find({ matric: { $in: matrics } }).select('matric name phone whatsapp tier premiumPlan tierExpiresAt active').lean();
    const by = Object.fromEntries(students.map(s => [s.matric, s]));
    res.json(rows.map(r => {
      const s = by[r.matric];
      return { ...r, student: s ? { name: s.name, tier: s.tier, premiumPlan: s.premiumPlan, active: s.active !== false, contact: normalizePhone(s.whatsapp || s.phone) } : null };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/support/counts — open requests by type (for the sidebar badge)
router.get('/support/counts', async (req, res) => {
  try {
    const rows = await SupportRequest.aggregate([{ $match: { status: 'open' } }, { $group: { _id: '$type', n: { $sum: 1 } } }]);
    const out = { recovery: 0, upgrade: 0, question_report: 0 };
    rows.forEach(r => { out[r._id] = r.n; });
    res.json({ ...out, total: out.recovery + out.upgrade + out.question_report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET/PUT /api/admin/support/me — this admin's own WhatsApp number (where students get routed)
router.get('/support/me', async (req, res) => {
  try {
    if (req.admin.sub === 'legacy-key') return res.json({ whatsapp: '', legacy: true });
    const a = await Admin.findOne({ username: req.admin.sub }).select('whatsapp').lean();
    res.json({ whatsapp: (a && a.whatsapp) || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/support/me/whatsapp', async (req, res) => {
  try {
    if (req.admin.sub === 'legacy-key') return res.status(400).json({ error: 'Log in with an admin account to set your WhatsApp number' });
    const raw = String(req.body.whatsapp || '').trim();
    const num = raw ? normalizePhone(raw) : '';
    if (raw && !num) return res.status(400).json({ error: 'Enter a valid number, e.g. 08012345678 or +2348012345678' });
    await Admin.updateOne({ username: req.admin.sub }, { $set: { whatsapp: num } });
    res.json({ whatsapp: num });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/support/:id/recovery/temp-password
// Verifies nothing by itself — the admin has already checked the student over WhatsApp. Issues a one-time
// temporary password, signs the student out everywhere, and forces a new password at next login.
router.post('/support/:id/recovery/temp-password', async (req, res) => {
  try {
    const r = await loadRequest(req, res); if (!r) return;
    if (r.type !== 'recovery') return res.status(400).json({ error: 'Not a recovery request' });
    if (r.status !== 'open') return res.status(400).json({ error: 'This request is already closed' });

    const student = await Student.findOne({ matric: r.matric });
    if (!student) return res.status(404).json({ error: 'No student account has that matric number' });

    let temp = tempPassword();
    if (temp.toUpperCase() === student.matric) temp = tempPassword();
    student.passwordHash = await bcrypt.hash(temp, 10);
    student.password = ''; // drop any legacy plaintext copy
    student.mustChangePassword = true;
    await student.save();
    await Session.updateMany({ subjectId: student.matric, role: 'student', revoked: { $ne: true } }, { revoked: true, revokedAt: new Date() });
    forgetSubject('student', student.matric);

    await close(r, req.admin.sub, 'resolved', 'Temporary password issued');
    logActivity({ actorType: 'admin', actor: req.admin.sub, action: 'support.recovery_temp_password', detail: { matric: student.matric, request: r.code } });

    const msg = `Hi ${student.name}, this is PrepHQ support. Your temporary password is: ${temp}\nLog in with it, then you'll be asked to choose your own new password. (Request ${r.code})`;
    res.json({ tempPassword: temp, matric: student.matric, name: student.name, whatsappUrl: waUrl(student.whatsapp || student.phone, msg), message: msg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/support/:id/upgrade/grant  { amount?, note? } — activates the requested Premium plan
router.post('/support/:id/upgrade/grant', async (req, res) => {
  try {
    if (!canChange(req.admin.access, 'payments')) return res.status(403).json({ error: 'Granting Premium needs the Payments permission', code: 'FORBIDDEN_AREA' });
    const r = await loadRequest(req, res); if (!r) return;
    if (r.type !== 'upgrade') return res.status(400).json({ error: 'Not an upgrade request' });
    if (r.status !== 'open') return res.status(400).json({ error: 'This request is already closed' });
    if (!PREMIUM_PERIODS.includes(r.plan)) return res.status(400).json({ error: 'Unknown plan on this request' });

    const settings = await Settings.getGlobal();
    const listed = settings.tiers.premium[PERIOD_PRICE_FIELD[r.plan]];
    const amount = Number(req.body.amount);
    const days = PERIOD_DAYS[r.plan];
    const student = await Student.findOneAndUpdate(
      { matric: r.matric },
      { tier: 'premium', premiumPlan: r.plan, tierExpiresAt: r.plan === 'lifetime' ? null : new Date(Date.now() + days * 86400000) },
      { new: true },
    );
    if (!student) return res.status(404).json({ error: 'Student not found' });
    forgetSubject('student', student.matric);

    const paid = Number.isFinite(amount) && amount > 0 ? amount : (listed || 0);
    if (paid > 0) {
      await Payment.create({ matric: student.matric, name: student.name, amount: paid, method: 'other', reference: r.code, note: String(req.body.note || `Premium ${PLAN_LABEL[r.plan]}`).slice(0, 200), status: 'confirmed' });
    }
    await close(r, req.admin.sub, 'resolved', `Premium ${PLAN_LABEL[r.plan]} activated`);
    notify({ matric: student.matric, type: 'announcement', title: '⭐ Premium activated', message: `Your Premium ${PLAN_LABEL[r.plan]} plan is now active.` }).catch(() => {});
    logActivity({ actorType: 'admin', actor: req.admin.sub, action: 'support.upgrade_granted', detail: { matric: student.matric, plan: r.plan, request: r.code } });

    const msg = `Hi ${student.name}, your PrepHQ Premium ${PLAN_LABEL[r.plan]} plan is now active. Thank you! (Request ${r.code})`;
    res.json({ success: true, matric: student.matric, plan: r.plan, whatsappUrl: waUrl(student.whatsapp || student.phone, msg) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/support/:id/report/fix-answer  { ans } — corrects the answer key of the reported bank question
router.post('/support/:id/report/fix-answer', async (req, res) => {
  try {
    if (!canChange(req.admin.access, 'questions')) return res.status(403).json({ error: 'Editing questions needs the Question bank permission', code: 'FORBIDDEN_AREA' });
    const r = await loadRequest(req, res); if (!r) return;
    if (r.type !== 'question_report' || !r.report.questionId) return res.status(400).json({ error: 'This report has no bank question to fix' });
    if (r.status !== 'open') return res.status(400).json({ error: 'This report is already closed' });
    const ans = parseInt(req.body.ans, 10);
    const q = await Question.findById(r.report.questionId);
    if (!q) return res.status(404).json({ error: 'That question no longer exists' });
    if (!Number.isInteger(ans) || ans < 0 || ans >= q.opts.length) return res.status(400).json({ error: 'Pick one of the question’s options' });
    q.ans = ans; await q.save();
    await close(r, req.admin.sub, 'resolved', `Answer key changed to option ${String.fromCharCode(65 + ans)}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/support/:id/resolve  { status: 'resolved' | 'rejected', note? }
router.post('/support/:id/resolve', async (req, res) => {
  try {
    const r = await loadRequest(req, res); if (!r) return;
    if (r.status !== 'open') return res.status(400).json({ error: 'This request is already closed' });
    const status = req.body.status === 'rejected' ? 'rejected' : 'resolved';
    await close(r, req.admin.sub, status, req.body.note);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
