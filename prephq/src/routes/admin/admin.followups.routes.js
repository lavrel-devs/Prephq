const express = require('express');
const Student = require('../../models/Student');
const FollowUpMark = require('../../models/FollowUpMark');
const { cleanMatric } = require('../../utils/validate');
const { requireAdmin } = require('../../middleware/auth');
const { normalizePhone } = require('../../services/support.service');

const router = express.Router();
router.use(requireAdmin);
// "students" area — enforced by adminGate.

const FIELDS = 'matric name phone whatsapp tier premiumPlan tierExpiresAt lastActiveAt credits createdAt';
const shape = (s) => ({
  matric: s.matric, name: s.name, tier: s.tier, premiumPlan: s.premiumPlan || null, tierExpiresAt: s.tierExpiresAt || null,
  lastActiveAt: s.lastActiveAt || null, credits: s.credits || 0, wa: normalizePhone(s.whatsapp || s.phone),
});

// A mark only counts for the exact situation it was made in (see FollowUpMark).
const cycleOf = (kind, s) => kind === 'expiring' ? (s.tierExpiresAt ? new Date(s.tierExpiresAt).toISOString() : 'none') : (s.lastActiveAt ? new Date(s.lastActiveAt).toISOString() : 'never');
async function withMarks(kind, rows) {
  const marks = await FollowUpMark.find({ kind, matric: { $in: rows.map(r => r.matric) } }).lean();
  const byKey = new Map(marks.map(m => [`${m.matric}|${m.cycle}`, m]));
  return rows.map(r => { const m = byKey.get(`${r.matric}|${cycleOf(kind, r)}`); return { ...r, followedUp: m ? { by: m.by, at: m.at } : null }; });
}

// GET /api/admin/followups/expiring?days=7 — Premium plans ending soon, plus ones that ended recently.
router.get('/followups/expiring', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
    const now = new Date();
    const rows = await Student.find({
      active: { $ne: false }, tier: 'premium', premiumPlan: { $ne: 'lifetime' },
      tierExpiresAt: { $ne: null, $lte: new Date(now.getTime() + days * 86400000), $gte: new Date(now.getTime() - 14 * 86400000) },
    }).select(FIELDS).sort({ tierExpiresAt: 1 }).limit(300).lean();
    res.json(await withMarks('expiring', rows.map(s => ({ ...shape(s), state: s.tierExpiresAt < now ? 'expired' : 'expiring',
      daysLeft: Math.ceil((s.tierExpiresAt - now) / 86400000) }))));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/followups/inactive?days=7 — students not seen for N days (or ever)
router.get('/followups/inactive', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 365);
    const cutoff = new Date(Date.now() - days * 86400000);
    const rows = await Student.find({
      active: { $ne: false }, createdAt: { $lte: cutoff },
      $or: [{ lastActiveAt: null }, { lastActiveAt: { $exists: false } }, { lastActiveAt: { $lt: cutoff } }],
    }).select(FIELDS).sort({ lastActiveAt: 1 }).limit(300).lean();
    res.json(await withMarks('inactive', rows.map(s => ({ ...shape(s), inactiveDays: s.lastActiveAt ? Math.floor((Date.now() - s.lastActiveAt) / 86400000) : null }))));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/followups/mark  { matric, kind }  — "I've already followed this student up"
// DELETE /api/admin/followups/mark { matric, kind }  — undo
async function markTarget(req, res) {
  const matric = cleanMatric(req.body.matric), kind = req.body.kind;
  if (!matric || !['expiring', 'inactive'].includes(kind)) { res.status(400).json({ error: 'matric and kind are required' }); return null; }
  const st = await Student.findOne({ matric }).select('matric tierExpiresAt lastActiveAt').lean();
  if (!st) { res.status(404).json({ error: 'Student not found' }); return null; }
  return { matric, kind, cycle: cycleOf(kind, st) };
}
router.post('/followups/mark', async (req, res) => {
  try {
    const t = await markTarget(req, res); if (!t) return;
    const m = await FollowUpMark.findOneAndUpdate(t, { $set: { by: req.admin.sub, at: new Date() } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    res.json({ followedUp: { by: m.by, at: m.at } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/followups/mark', async (req, res) => {
  try {
    const t = await markTarget(req, res); if (!t) return;
    await FollowUpMark.deleteOne(t);
    res.json({ followedUp: null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
