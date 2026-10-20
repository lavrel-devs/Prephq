const express = require('express');
const PlanCode = require('../../models/PlanCode');
const Student = require('../../models/Student');
const { requireAdmin } = require('../../middleware/auth');
const { createCodes, CodeError } = require('../../services/planCode.service');
const { planText } = require('../../services/entitlements.service');
const { isObjectId } = require('../../utils/validate');
const { logActivity } = require('../../services/activity.service');

const router = express.Router();
router.use(requireAdmin);
// Access is the "payments" area, enforced centrally by adminGate (see utils/adminAccess.js).

const fail = (res, e) => res.status(e instanceof CodeError ? e.status : 500).json({ error: e.message });
const view = c => ({ _id: c._id, code: c.code, plan: c.plan, days: c.days, label: planText(c.plan, c.days), status: c.status, forMatric: c.forMatric, note: c.note, amount: c.amount, requestCode: c.requestCode, createdBy: c.createdBy, createdAt: c.createdAt, usedBy: c.usedBy, usedAt: c.usedAt });

// POST /api/admin/plan-codes  { plan, customDays?, quantity?, forMatric?, note?, amount? }
router.post('/plan-codes', async (req, res) => {
  try {
    const b = req.body || {};
    const codes = await createCodes({ plan: b.plan, customDays: b.customDays, quantity: b.quantity, forMatric: b.forMatric, note: b.note, amount: b.amount, createdBy: req.admin.sub });
    logActivity({ actorType: 'admin', actor: req.admin.sub, action: 'plan_code.created', detail: { plan: b.plan, quantity: codes.length } });
    res.status(201).json({ codes: codes.map(view) });
  } catch (e) { fail(res, e); }
});

// GET /api/admin/plan-codes?status=unused|used|revoked&limit=100
router.get('/plan-codes', async (req, res) => {
  try {
    const filter = ['unused', 'used', 'revoked'].includes(req.query.status) ? { status: req.query.status } : {};
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 300);
    const rows = await PlanCode.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    const names = Object.fromEntries((await Student.find({ matric: { $in: rows.map(r => r.usedBy).filter(Boolean) } }).select('matric name').lean()).map(s => [s.matric, s.name]));
    res.json(rows.map(r => ({ ...view(r), usedByName: names[r.usedBy] || '' })));
  } catch (e) { fail(res, e); }
});

// POST /api/admin/plan-codes/:id/revoke — only an unused code can be revoked
router.post('/plan-codes/:id/revoke', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Code not found' });
    const r = await PlanCode.updateOne({ _id: req.params.id, status: 'unused' }, { status: 'revoked', revokedAt: new Date() });
    if (!r.matchedCount) return res.status(400).json({ error: 'Only an unused code can be revoked' });
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

module.exports = router;
