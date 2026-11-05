const express = require('express');
const rateLimit = require('express-rate-limit');
const GuessFlag = require('../models/GuessFlag');
const Question = require('../models/Question');
const { requireStudent } = require('../middleware/auth');
const { requireFeature } = require('../services/entitlements.service');
const { isObjectId } = require('../utils/validate');

// v1.8.6 "I guessed". Paths avoid /questions/:course on purpose (that wildcard would swallow them).
//   POST /api/guesses            { items: [{ qid, guessed, correct, course, tag }] }   sent when a quiz is finished
//   GET  /api/guesses?count=1    just the number (home-screen card)
//   GET  /api/guesses/questions  the questions themselves, newest first, max 30 (the review session)
const router = express.Router();
const limiter = rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests.' } });
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const courseKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);

// A finished quiz reports every bank question the student answered: marked ones are saved, unmarked ones clear any
// old mark (they have now answered it with confidence, so it no longer counts as a guess).
router.post('/guesses', requireStudent, limiter, async (req, res) => {
  try {
    const items = Array.isArray(req.body && req.body.items) ? req.body.items.slice(0, 100) : [];
    const ops = [], matric = req.student.sub;
    for (const it of items) {
      if (!it || !isObjectId(String(it.qid))) continue;
      if (it.guessed === true) {
        ops.push({ updateOne: { filter: { matric, qid: it.qid }, update: { $set: { course: courseKey(it.course), tag: clip(it.tag, 80), correct: it.correct === true, ts: new Date() } }, upsert: true } });
      } else {
        ops.push({ deleteOne: { filter: { matric, qid: it.qid } } });
      }
    }
    if (ops.length) await GuessFlag.bulkWrite(ops, { ordered: false });
    res.json({ success: true, count: await GuessFlag.countDocuments({ matric }) });
  } catch (e) { res.status(500).json({ error: 'Could not save that' }); }
});

router.get('/guesses', requireStudent, limiter, async (req, res) => {
  try { res.json({ count: Math.min(30, await GuessFlag.countDocuments({ matric: req.student.sub })) }); }
  catch (e) { res.status(500).json({ error: 'Could not load that' }); }
});

router.get('/guesses/questions', requireStudent, requireFeature('practiceQuestions'), limiter, async (req, res) => {
  try {
    const flags = await GuessFlag.find({ matric: req.student.sub }).sort({ ts: -1 }).limit(30).lean();
    if (!flags.length) return res.json([]);
    const docs = await Question.find({ _id: { $in: flags.map(f => f.qid) } }).lean();
    const byId = new Map(docs.map(d => [String(d._id), d]));
    res.json(flags.map(f => byId.get(String(f.qid))).filter(Boolean));   // a question an admin deleted just disappears
  } catch (e) { res.status(500).json({ error: 'Could not load your guessed questions' }); }
});

module.exports = router;
