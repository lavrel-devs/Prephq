// Sponsor link (v1.9.2): a read-only weekly progress page for whoever pays for a student's plan. Opt-in and revocable.
//   PUBLIC   GET  /api/sponsor/public/:token   what the sponsor page shows (no login; rate-limited)
//   STUDENT  GET  /api/sponsor                 { enabled, token }
//            POST /api/sponsor                 turn it on (a new link every time { rotate: true } is sent)
//            DELETE /api/sponsor               turn it off: the old link stops working at once
// The public view is deliberately small: first name, this week's answers, accuracy, streak, plan. No matric, no email, no scores per
// course, no notes, no question text.
const express = require('express');
const rateLimit = require('express-rate-limit');
const SponsorLink = require('../models/SponsorLink');
const QuestionAttempt = require('../models/QuestionAttempt');
const Student = require('../models/Student');
const Settings = require('../models/Settings');
const { requireStudent } = require('../middleware/auth');
const { newToken, weekSummary, planFor } = require('../utils/sponsor');

const router = express.Router();
const TOKEN_RE = /^[A-Za-z0-9_-]{16,40}$/;
const limiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Try again in a minute.' } });

router.get('/public/:token', limiter, async (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  try {
    const gone = () => res.status(404).json({ error: 'This link is not active any more. Ask the student for a new one.', code: 'LINK_OFF' });
    if (!TOKEN_RE.test(req.params.token)) return gone();
    const link = await SponsorLink.findOne({ token: req.params.token, enabled: true }).lean();
    if (!link) return gone();
    const since = new Date(Date.now() - 15 * 86400000);
    const [st, attempts, settings] = await Promise.all([
      Student.findOne({ matric: link.matric }).select('name streakCount tier premiumPlan tierExpiresAt').lean(),
      QuestionAttempt.find({ matric: link.matric, ts: { $gte: since } }).select('correct ts').lean(),
      Settings.findOne().select('support').lean(),
    ]);
    if (!st) return gone();
    SponsorLink.updateOne({ _id: link._id }, { $inc: { views: 1 }, $set: { lastViewedAt: new Date() } }).catch(() => {});
    res.json(Object.assign({
      name: String(st.name || 'Your student').split(' ')[0], streak: st.streakCount || 0, plan: planFor(st),
      whatsapp: String((settings && settings.support && settings.support.whatsapp) || '').replace(/\D/g, ''),
    }, weekSummary(attempts)));
  } catch (e) { res.status(500).json({ error: 'Something went wrong. Try again shortly.' }); }
});

router.get('/', requireStudent, async (req, res) => {
  const link = await SponsorLink.findOne({ matric: req.student.sub }).lean().catch(() => null);
  res.json({ enabled: !!(link && link.enabled), token: link && link.enabled ? link.token : null, views: link ? link.views : 0, lastViewedAt: link ? link.lastViewedAt : null });
});

router.post('/', requireStudent, async (req, res) => {
  try {
    const cur = await SponsorLink.findOne({ matric: req.student.sub });
    if (cur && cur.enabled && !req.body.rotate) return res.json({ enabled: true, token: cur.token });
    const token = newToken();
    await SponsorLink.updateOne({ matric: req.student.sub }, { $set: { token, enabled: true, views: 0, lastViewedAt: null } }, { upsert: true });
    res.json({ enabled: true, token });
  } catch (e) { res.status(500).json({ error: 'Could not create the link' }); }
});

router.delete('/', requireStudent, async (req, res) => {
  try { await SponsorLink.updateOne({ matric: req.student.sub }, { $set: { enabled: false } }); res.json({ enabled: false }); }
  catch (e) { res.status(500).json({ error: 'Could not turn it off' }); }
});

module.exports = router;
