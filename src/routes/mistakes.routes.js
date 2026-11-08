// "Why I got it wrong" (v1.9.2): the student tags a wrong answer with a reason and may write a one-line lesson.
//   PUT /api/mistakes/:qid   { why?, lesson?, course?, tag? }   save or update one note
//   GET /api/mistakes                                         the notebook, newest first, plus the pattern and advice
const express = require('express');
const mongoose = require('mongoose');
const MistakeNote = require('../models/MistakeNote');
const Question = require('../models/Question');
const { requireStudent } = require('../middleware/auth');
const { REASONS, adviceFor } = require('../utils/mistakes');

const router = express.Router();
router.use(requireStudent);

router.put('/:qid', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.qid)) return res.status(400).json({ error: 'Bad question' });
    const set = {};
    if (req.body.why !== undefined) {
      if (req.body.why !== '' && !REASONS.includes(req.body.why)) return res.status(400).json({ error: 'Pick one of the reasons' });
      set.why = req.body.why;
    }
    if (req.body.lesson !== undefined) set.lesson = String(req.body.lesson).trim().slice(0, 240);
    if (typeof req.body.course === 'string') set.course = req.body.course.slice(0, 40);
    if (typeof req.body.tag === 'string') set.tag = req.body.tag.slice(0, 80);
    if (!Object.keys(set).length) return res.status(400).json({ error: 'Nothing to save' });
    await MistakeNote.updateOne({ matric: req.student.sub, qid: req.params.qid }, { $set: set }, { upsert: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Could not save that' }); }
});

router.get('/', async (req, res) => {
  try {
    const [counts, notes] = await Promise.all([
      MistakeNote.aggregate([{ $match: { matric: req.student.sub, why: { $ne: '' } } }, { $group: { _id: '$why', n: { $sum: 1 } } }]),
      MistakeNote.find({ matric: req.student.sub }).sort({ updatedAt: -1 }).limit(100).lean(),
    ]);
    const byReason = Object.fromEntries(counts.map(c => [c._id, c.n]));
    const qs = await Question.find({ _id: { $in: notes.map(n => n.qid) } }).select('q opts ans').lean();
    const byId = new Map(qs.map(q => [String(q._id), q]));
    res.json({
      counts: byReason, advice: adviceFor(byReason),
      notes: notes.filter(n => byId.has(String(n.qid))).map(n => { const q = byId.get(String(n.qid)); return { qid: n.qid, why: n.why, lesson: n.lesson, course: n.course, tag: n.tag, updatedAt: n.updatedAt, q: q.q, answer: (q.opts || [])[q.ans] || '' }; }),
    });
  } catch (e) { res.status(500).json({ error: 'Could not load your notebook' }); }
});

module.exports = router;
