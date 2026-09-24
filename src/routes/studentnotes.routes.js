const express = require('express');
const Course = require('../models/Course');
const CourseNote = require('../models/CourseNote');
const Question = require('../models/Question');
const StudentNote = require('../models/StudentNote');
const Settings = require('../models/Settings');
const Student = require('../models/Student');
const { requireStudent } = require('../middleware/auth');
const { requireFeature } = require('../services/entitlements.service');
const { applyCreditDelta } = require('../utils/credits');
const { generateCourseNote } = require('../services/groq.service');
const { strip } = require('../services/notes.service');
const { normCourseKey, isObjectId, escapeRegex } = require('../utils/validate');
const { courseMatchFilter } = require('../utils/courseMatch');

const router = express.Router();
const MAX_SAVED = 100;
const DEPTHS = ['quick', 'standard', 'detailed'];
const costOf = (settings, depth) => settings.studentNotes[{ quick: 'costQuick', standard: 'costStandard', detailed: 'costDetailed' }[depth]];

// GET /api/my-notes/options — what it costs (admin-editable) and whether the feature is on.
router.get('/my-notes/options', requireStudent, requireFeature('courseNotes'), async (req, res) => {
  try {
    const s = (await Settings.getGlobal()).studentNotes;
    res.json({ enabled: s.enabled, costs: { quick: s.costQuick, standard: s.costStandard, detailed: s.costDetailed }, dailyLimit: s.dailyLimit });
  } catch (e) { res.status(500).json({ error: 'Could not load options' }); }
});

// GET /api/my-notes?course=<key> — the student's own generated notes (newest first)
router.get('/my-notes', requireStudent, requireFeature('courseNotes'), async (req, res) => {
  try {
    const filter = { matric: req.student.sub };
    if (req.query.course) filter.courseKey = normCourseKey(req.query.course);
    const rows = await StudentNote.find(filter).sort({ createdAt: -1 }).limit(MAX_SAVED).lean();
    res.json({ notes: rows.map(n => ({
      id: n._id, courseKey: n.courseKey, title: n.topic, topic: n.topic, depth: n.depth, body: n.body, createdAt: n.createdAt,
      readMinutes: Math.max(1, Math.ceil(n.body.split(/\s+/).filter(Boolean).length / 180)),
    })) });
  } catch (e) { res.status(500).json({ error: 'Could not load your notes' }); }
});

// POST /api/my-notes/generate  { course, topic, depth }
// Charged up front (atomic), refunded automatically if the AI fails, so a failed attempt never costs credits.
router.post('/my-notes/generate', requireStudent, requireFeature('courseNotes'), async (req, res) => {
  try {
    const matric = req.student.sub;
    const settings = await Settings.getGlobal();
    if (!settings.studentNotes.enabled) return res.status(403).json({ error: 'Writing your own notes is switched off right now.', code: 'FEATURE_OFF' });

    const course = await Course.findOne({ key: normCourseKey(req.body.course) }).select('key courseCode courseTitle').lean();
    if (!course) return res.status(400).json({ error: 'Pick a course first' });
    const topic = strip(req.body.topic).slice(0, 100);
    if (topic.length < 3) return res.status(400).json({ error: 'Type the topic you want notes on (at least 3 letters).' });
    const depth = DEPTHS.includes(req.body.depth) ? req.body.depth : 'standard';
    const cost = costOf(settings, depth);
    const re = new RegExp(`^${escapeRegex(topic)}$`, 'i');

    // Already free? A published note on this exact topic, or one this student already generated at this depth.
    const published = await CourseNote.findOne({ courseKey: course.key, published: true, $or: [{ topic: re }, { title: re }] }).select('_id').lean();
    if (published) return res.status(409).json({ error: 'A note on this topic is already published for this course — read it free in the notes list.', code: 'NOTE_EXISTS' });
    const mine = await StudentNote.findOne({ matric, courseKey: course.key, topic: re, depth });
    if (mine) return res.json({ note: { id: mine._id, title: mine.topic, depth: mine.depth, body: mine.body, createdAt: mine.createdAt }, charged: 0, cached: true });

    if ((await StudentNote.countDocuments({ matric })) >= MAX_SAVED) return res.status(400).json({ error: `You have ${MAX_SAVED} saved notes — delete some before making new ones.`, code: 'NOTES_FULL' });
    const limit = settings.studentNotes.dailyLimit;
    if (limit > 0 && (await StudentNote.countDocuments({ matric, createdAt: { $gte: new Date(Date.now() - 86400000) } })) >= limit) {
      return res.status(403).json({ error: `You can generate up to ${limit} notes a day. Try again tomorrow.`, code: 'LIMIT_REACHED' });
    }

    let balance;
    if (cost > 0) {
      try {
        ({ balance } = await applyCreditDelta({ matric, delta: -cost, reason: 'note_generation', note: `Study notes — ${course.courseCode}: ${topic} (${depth})`, actor: 'system' }));
      } catch (e) {
        if (e.code === 'INSUFFICIENT_CREDITS') {
          const s = await Student.findOne({ matric }).select('credits').lean();
          return res.status(402).json({ error: `Not enough credits. These notes cost ${cost}, you have ${s?.credits || 0}.`, code: 'INSUFFICIENT_CREDITS', required: cost, balance: s?.credits || 0 });
        }
        throw e;
      }
    }

    try {
      // Use the questions we already hold on this topic as a hint of what examiners ask (optional).
      const qs = await Question.find({ $and: [await courseMatchFilter(course.key), { tag: re }] }).select('q opts ans exp').limit(10).lean();
      const { body } = await generateCourseNote({
        courseCode: course.courseCode, courseTitle: course.courseTitle, topic, depth, priority: 'high',
        questions: qs.map(q => ({ q: strip(q.q).slice(0, 400), correct: strip((q.opts || [])[q.ans]).slice(0, 200), exp: strip(q.exp).slice(0, 300) })),
      });
      const note = await StudentNote.create({ matric, courseKey: course.key, topic, depth, body, cost });
      res.status(201).json({ note: { id: note._id, title: note.topic, depth, body, createdAt: note.createdAt }, charged: cost, balance });
    } catch (e) {
      if (cost > 0) await applyCreditDelta({ matric, delta: cost, reason: 'refund', note: 'Study notes could not be written — refunded', actor: 'system' }).catch(() => {});
      const status = e.code === 'GROQ_NOT_CONFIGURED' ? 503 : e.code === 'GROQ_TIMEOUT' ? 504 : e.code === 'GROQ_RATE_LIMITED' ? 429 : e.code && String(e.code).startsWith('GROQ') ? 502 : 500;
      res.status(status).json({ error: `${e.message}${cost > 0 ? ' Your credits were returned.' : ''}`, code: e.code || 'ERROR' });
    }
  } catch (e) { res.status(500).json({ error: 'Could not generate your notes' }); }
});

router.delete('/my-notes/:id', requireStudent, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Note not found' });
    const r = await StudentNote.deleteOne({ _id: req.params.id, matric: req.student.sub });
    res.json({ success: r.deletedCount > 0 });
  } catch (e) { res.status(500).json({ error: 'Could not delete' }); }
});

module.exports = router;
