const express = require('express');
const Score = require('../models/Score');
const { requireStudent, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/scores/:matric — a student may only read their own scores
router.get('/:matric', requireStudent, async (req, res) => {
  try {
    if (req.student.sub !== req.params.matric.toUpperCase())
      return res.status(403).json({ error: 'Forbidden' });
    const scores = await Score.find({ matric: req.params.matric.toUpperCase() })
      .sort({ ts: -1 }).limit(200).lean();
    res.json(scores);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/scores/:matric — a student may only write their own scores
router.post('/:matric', requireStudent, async (req, res) => {
  try {
    if (req.student.sub !== req.params.matric.toUpperCase())
      return res.status(403).json({ error: 'Forbidden' });
    const { correct, total, pct, wrong, skip, courses, mode } = req.body;
    if (typeof pct !== 'number') return res.status(400).json({ error: 'Invalid' });
    await Score.create({
      matric: req.params.matric.toUpperCase(),
      correct, total, pct, wrong, skip, courses, mode,
    });
    res.status(201).json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/scores/:matric — admin only (unchanged)
router.delete('/:matric', requireAdmin, async (req, res) => {
  try {
    await Score.deleteMany({ matric: req.params.matric.toUpperCase() });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
