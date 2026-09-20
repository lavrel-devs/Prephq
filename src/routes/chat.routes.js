const express = require('express');
const rateLimit = require('express-rate-limit');
const Student = require('../models/Student');
const ChatMessage = require('../models/ChatMessage');
const { requireStudent } = require('../middleware/auth');
const { sendMessage, getQuota } = require('../services/chat.service');

const router = express.Router();

// Backstop against request-spam distinct from the daily/monthly quota
// (which is the real limit — this just prevents rapid-fire retries).
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages at once. Slow down a moment.' },
});

// GET /api/chat/history — persisted conversation, so it survives a
// device switch or cleared browser (see ChatMessage model).
router.get('/chat/history', requireStudent, async (req, res) => {
  try {
    const messages = await ChatMessage.find({ matric: req.student.sub })
      .sort({ ts: 1 }).limit(200).lean();
    res.json(messages);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/chat/quota — current remaining daily/monthly messages,
// without sending anything. Reports 0 remaining rather than erroring
// if the student is already at the limit.
router.get('/chat/quota', requireStudent, async (req, res) => {
  try {
    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const { enabled, dailyRemaining, monthlyRemaining } = await getQuota(student);
    res.json({ dailyRemaining, monthlyRemaining, disabled: !enabled });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/chat/message — { message }
router.post('/chat/message', requireStudent, chatLimiter, async (req, res) => {
  try {
    const { message } = req.body;
    if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message is required' });
    if (message.length > 2000) return res.status(400).json({ error: 'Message is too long (max 2000 characters)' });

    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const result = await sendMessage(student, message.trim());
    res.json(result);
  } catch (e) {
    const status = { CHATBOT_DISABLED: 503, LIMIT_REACHED: 429, GROQ_NOT_CONFIGURED: 503 }[e.code] || 500;
    res.status(status).json({ error: e.message, code: e.code || 'SERVER_ERROR' });
  }
});

// DELETE /api/chat/history — student can clear their own conversation.
router.delete('/chat/history', requireStudent, async (req, res) => {
  try {
    await ChatMessage.deleteMany({ matric: req.student.sub });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
