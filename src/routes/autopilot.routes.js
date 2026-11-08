const express = require('express');
const { requireStudent } = require('../middleware/auth');
const { requireFeature } = require('../services/entitlements.service');
const A = require('../services/autopilot.service');

const router = express.Router();

// GET /api/autopilot/today — today's time-boxed plan with live done-flags (created on the spot if the nightly run missed them).
router.get('/autopilot/today', requireStudent, requireFeature('studyPlan'), async (req, res) => {
  try {
    const plan = await A.getToday(req.student.sub);
    if (!plan) return res.status(404).json({ error: 'Student not found' });
    res.json(plan);
  } catch (e) { console.error('[autopilot/today]', e.message); res.status(500).json({ error: 'Could not build your plan' }); }
});

// POST /api/autopilot/refresh — rebuild today's plan now (e.g. after setting an exam date). Once a minute per student.
const lastRefresh = new Map();
router.post('/autopilot/refresh', requireStudent, requireFeature('studyPlan'), async (req, res) => {
  const who = req.student.sub, now = Date.now();
  if (now - (lastRefresh.get(who) || 0) < 60 * 1000) return res.status(429).json({ error: 'Your plan was just rebuilt — give it a minute.' });
  lastRefresh.set(who, now);
  if (lastRefresh.size > 5000) for (const [k, t] of lastRefresh) if (now - t > 60 * 1000) lastRefresh.delete(k);
  try {
    const plan = await A.refreshToday(who);
    if (!plan) return res.status(404).json({ error: 'Student not found' });
    res.json(plan);
  } catch (e) { console.error('[autopilot/refresh]', e.message); res.status(500).json({ error: 'Could not rebuild your plan' }); }
});

module.exports = router;
