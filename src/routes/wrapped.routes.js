// GET /api/wrapped[?days=120] - the signed-in student's semester recap (v1.9.2), built only from their own answers.
const express = require('express');
const QuestionAttempt = require('../models/QuestionAttempt');
const Student = require('../models/Student');
const { requireStudent } = require('../middleware/auth');
const { buildWrapped } = require('../utils/wrapped');

const router = express.Router();
router.get('/', requireStudent, async (req, res) => {
  try {
    const days = Math.min(366, Math.max(14, parseInt(req.query.days, 10) || 120));
    const since = new Date(Date.now() - days * 86400000);
    const [attempts, st] = await Promise.all([
      QuestionAttempt.find({ matric: req.student.sub, ts: { $gte: since } }).select('course tag correct ts').sort({ ts: -1 }).limit(20000).lean(),
      Student.findOne({ matric: req.student.sub }).select('name streakCount').lean(),
    ]);
    res.json(Object.assign({ days, name: ((st && st.name) || '').split(' ')[0], streakNow: (st && st.streakCount) || 0 }, buildWrapped(attempts)));
  } catch (e) { res.status(500).json({ error: 'Could not build your recap' }); }
});
module.exports = router;
