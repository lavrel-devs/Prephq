const express = require('express');
const rateLimit = require('express-rate-limit');
const Student = require('../models/Student');
const StudentMemory = require('../models/StudentMemory');
const { requireStudent } = require('../middleware/auth');
const { requireFeature } = require('../services/entitlements.service');
const { getMemory, pulse, chat } = require('../services/brainiac.service');
const { isObjectId } = require('../utils/validate');

// v1.8.3 Brainiac — the floating companion. Separate from /chat (the Study Assistant tab) on purpose.
const router = express.Router();
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many messages at once. Slow down a moment.' } });
const lightLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests.' } });

const publicState = (m, name) => ({
  enabled: m.enabled, sound: m.sound, nudges: m.nudges, learn: m.learn, name: String(name || '').trim().split(/\s+/)[0] || '',
  facts: (m.facts || []).map(f => ({ id: String(f._id), text: f.text })),
});

// GET /api/brainiac/state — switches, what it remembers, and the last few messages (so the sheet reopens where you left off)
router.get('/brainiac/state', requireStudent, lightLimiter, async (req, res) => {
  try {
    const student = await Student.findOne({ matric: req.student.sub }).select('name').lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const m = await getMemory(req.student.sub);
    res.json({ ...publicState(m, student.name), recent: (m.recent || []).slice(-12).map(x => ({ role: x.role, content: x.content })) });
  } catch (e) { res.status(500).json({ error: 'Could not load Brainiac' }); }
});

// PUT /api/brainiac/settings — { enabled?, sound?, nudges?, learn? }
router.put('/brainiac/settings', requireStudent, lightLimiter, async (req, res) => {
  try {
    const set = {};
    for (const k of ['enabled', 'sound', 'nudges', 'learn']) if (typeof req.body[k] === 'boolean') set[k] = req.body[k];
    await getMemory(req.student.sub);
    const m = await StudentMemory.findOneAndUpdate({ matric: req.student.sub }, { $set: set }, { new: true });
    const student = await Student.findOne({ matric: req.student.sub }).select('name').lean();
    res.json(publicState(m, student && student.name));
  } catch (e) { res.status(500).json({ error: 'Could not save that' }); }
});

// GET /api/brainiac/pulse — Brainiac speaking first. Rule-based, never calls the AI, never counts against the chat limit.
router.get('/brainiac/pulse', requireStudent, lightLimiter, async (req, res) => {
  try {
    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json({ nudges: await pulse(student) });
  } catch (e) { res.json({ nudges: [] }); }   // a nudge failing should never bother the student
});

// POST /api/brainiac/chat — { message, context? }
router.post('/brainiac/chat', requireStudent, requireFeature('aiTutor'), chatLimiter, async (req, res) => {
  try {
    const { message, context } = req.body;
    if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message is required' });
    if (message.length > 1500) return res.status(400).json({ error: 'That is a bit long. Try a shorter message.' });
    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json(await chat(student, message.trim(), context));
  } catch (e) {
    const status = { CHATBOT_DISABLED: 503, LIMIT_REACHED: 429, GROQ_NOT_CONFIGURED: 503 }[e.code] || 500;
    res.status(status).json({ error: e.message, code: e.code || 'SERVER_ERROR' });
  }
});

// DELETE /api/brainiac/memory/:id — forget one thing.   DELETE /api/brainiac/memory — forget everything (facts + conversation).
router.delete('/brainiac/memory/:id', requireStudent, lightLimiter, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Bad id' });
    await StudentMemory.updateOne({ matric: req.student.sub }, { $pull: { facts: { _id: req.params.id } } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Could not forget that' }); }
});
router.delete('/brainiac/memory', requireStudent, lightLimiter, async (req, res) => {
  try {
    await StudentMemory.updateOne({ matric: req.student.sub }, { $set: { facts: [], recent: [], msgsSinceLearn: 0 } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Could not clear that' }); }
});

module.exports = router;
