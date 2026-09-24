const express = require('express');
const Course = require('../models/Course');
const CourseNote = require('../models/CourseNote');
const { requireStudent } = require('../middleware/auth');
const { requireFeature } = require('../services/entitlements.service');
const { normCourseKey } = require('../utils/validate');

const router = express.Router();

// GET /api/course-notes — how many published notes each course has (drives the course chips).
router.get('/course-notes', requireStudent, requireFeature('courseNotes'), async (req, res) => {
  try {
    const rows = await CourseNote.aggregate([{ $match: { published: true } }, { $group: { _id: '$courseKey', n: { $sum: 1 } } }]);
    res.json({ counts: Object.fromEntries(rows.map(r => [r._id, r.n])) });
  } catch (e) { res.status(500).json({ error: 'Could not load course notes' }); }
});

// GET /api/course-notes/:course — the published notes for a course, in the order the admin set.
// Notes only: no practice links (practice lives in the rest of the app), and only approved notes are ever returned.
router.get('/course-notes/:course', requireStudent, requireFeature('courseNotes'), async (req, res) => {
  try {
    const course = await Course.findOne({ key: normCourseKey(req.params.course) }).select('key courseCode courseTitle').lean();
    if (!course) return res.status(404).json({ error: 'Course not found' });
    const notes = await CourseNote.find({ courseKey: course.key, published: true }).sort({ order: 1, createdAt: 1 }).lean();
    res.json({
      course: { key: course.key, code: course.courseCode, title: course.courseTitle },
      notes: notes.map(n => ({
        id: n._id, title: n.title, topic: n.topic || '', body: n.body, updatedAt: n.updatedAt,
        readMinutes: Math.max(1, Math.ceil(n.body.split(/\s+/).filter(Boolean).length / 180)),
      })),
    });
  } catch (e) { res.status(500).json({ error: 'Could not load course notes' }); }
});

// ── Student-written notes (paid in credits) ───────────────────
// The AI writes notes on a topic the student types. Cost depends on depth (admin-editable in Credit Settings).
// Credits are taken first and given back automatically if anything fails.
const rateLimit = require('express-rate-limit');
const PersonalNote = require('../models/PersonalNote');
const Question = require('../models/Question');
const Settings = require('../models/Settings');
const Student = require('../models/Student');
const { applyCreditDelta } = require('../utils/credits');
const { withLock } = require('../utils/lock');
const { generateStudentNote } = require('../services/groq.service');
const { courseMatchFilter } = require('../utils/courseMatch');
const { isObjectId, escapeRegex } = require('../utils/validate');
const { strip } = require('../services/notes.service');

const DEPTHS = ['quick', 'standard', 'detailed'];
const costsOf = (s) => ({ quick: s.notes.costQuick, standard: s.notes.costStandard, detailed: s.notes.costDetailed });
const readMinutes = (b) => Math.max(1, Math.ceil(String(b).split(/\s+/).filter(Boolean).length / 180));
const shapeNote = (n) => ({ id: n._id, title: n.title, topic: n.topic, depth: n.depth, body: n.body, readMinutes: readMinutes(n.body), createdAt: n.createdAt });
const cleanTopic = (v) => strip(String(v || '')).replace(/[{}$\\`"<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);

const genLimiter = rateLimit({ windowMs: 60 * 1000, max: 4, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many note requests. Slow down a little.' } });

router.get('/my-notes/options', requireStudent, async (req, res) => {
  try {
    const s = await Settings.getGlobal();
    res.json({ enabled: !!s.notes.enabled, costs: costsOf(s) });
  } catch (e) { res.status(500).json({ error: 'Could not load note options' }); }
});

router.get('/my-notes', requireStudent, async (req, res) => {
  try {
    const filter = { matric: req.student.sub };
    if (req.query.course) filter.courseKey = normCourseKey(req.query.course);
    const notes = await PersonalNote.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ notes: notes.map(shapeNote) });
  } catch (e) { res.status(500).json({ error: 'Could not load your notes' }); }
});

router.delete('/my-notes/:id', requireStudent, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Note not found' });
    await PersonalNote.deleteOne({ _id: req.params.id, matric: req.student.sub });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Could not delete the note' }); }
});

// POST /api/my-notes/generate  { course, topic, depth }
router.post('/my-notes/generate', requireStudent, genLimiter, requireFeature('courseNotes'), (req, res) =>
  withLock(`mynote:${req.student.sub}`, () => generateNote(req, res)));

async function generateNote(req, res) {
  const matric = req.student.sub;
  let charged = 0, cost = 0;
  try {
    const settings = await Settings.getGlobal();
    if (!settings.notes.enabled) return res.status(403).json({ error: 'Writing your own notes is switched off right now.', code: 'NOTES_DISABLED' });
    const course = await Course.findOne({ key: normCourseKey(req.body.course) }).select('key courseCode courseTitle').lean();
    if (!course) return res.status(400).json({ error: 'Pick one of your courses first' });
    const topic = cleanTopic(req.body.topic);
    if (topic.length < 3) return res.status(400).json({ error: 'Type the topic you want notes on (at least 3 letters).' });
    const depth = DEPTHS.includes(req.body.depth) ? req.body.depth : 'standard';
    cost = costsOf(settings)[depth];
    const topicKey = topic.toLowerCase();

    // Already covered by an approved course note? Point them to it — no charge.
    const re = new RegExp(`^${escapeRegex(topic)}$`, 'i');
    if (await CourseNote.exists({ courseKey: course.key, published: true, $or: [{ topic: re }, { title: re }] })) {
      return res.status(409).json({ error: `PrepHQ already has notes on “${topic}” for ${course.courseCode} — it's in the list below, free.`, code: 'NOTE_EXISTS' });
    }
    // Already wrote this exact topic + depth for this student? Open it again for free.
    const mine = await PersonalNote.findOne({ matric, courseKey: course.key, topicKey, depth });
    const student = await Student.findOne({ matric }).select('credits').lean();
    if (mine) return res.json({ note: shapeNote(mine), charged: 0, cached: true, balance: student ? student.credits || 0 : 0 });

    if (cost > 0) {
      try {
        await applyCreditDelta({ matric, delta: -cost, reason: 'note_generation', note: `Study notes — ${course.courseCode}: ${topic} (${depth})`, actor: 'system' });
        charged = cost;
      } catch (e) {
        if (e.code === 'INSUFFICIENT_CREDITS') {
          return res.status(402).json({ error: `Not enough credits. This costs ${cost}.`, code: 'INSUFFICIENT_CREDITS', required: cost, balance: student ? student.credits || 0 : 0 });
        }
        throw e;
      }
    }

    let generated;
    try {
      // Past questions on this topic (if any) show the AI what examiners ask.
      const qs = await Question.find({ $and: [await courseMatchFilter(course.key), { $or: [{ tag: new RegExp(escapeRegex(topic), 'i') }, { q: new RegExp(escapeRegex(topic), 'i') }] }] })
        .select('q opts ans').limit(10).lean();
      generated = await generateStudentNote({
        courseCode: course.courseCode, courseTitle: course.courseTitle, topic, depth,
        questions: qs.map(q => ({ q: strip(q.q).slice(0, 300), correct: strip((q.opts || [])[q.ans]).slice(0, 160) })),
      });
    } catch (e) {
      await refund(matric, charged, 'AI notes failed — refunded'); charged = 0;
      const status = e.code === 'GROQ_NOT_CONFIGURED' ? 503 : e.code === 'GROQ_TIMEOUT' ? 504 : e.code === 'GROQ_BUSY' ? 429 : 502;
      return res.status(status).json({ error: `${e.message} Your credits were returned.`, code: e.code || 'GROQ_ERROR' });
    }

    let note;
    try {
      note = await PersonalNote.findOneAndUpdate(
        { matric, courseKey: course.key, topicKey, depth },
        { $set: { topic, title: topic.charAt(0).toUpperCase() + topic.slice(1), body: generated.body, cost: charged, model: generated.model } },
        { new: true, upsert: true, setDefaultsOnInsert: true });
    } catch (e) {
      await refund(matric, charged, 'AI notes could not be saved — refunded'); charged = 0;
      throw e;
    }
    const after = await Student.findOne({ matric }).select('credits').lean();
    res.status(201).json({ note: shapeNote(note), charged, balance: after ? after.credits || 0 : 0 });
  } catch (e) {
    if (charged) await refund(matric, charged, 'AI notes failed — refunded');
    console.error('[my-notes]', e.message);
    res.status(500).json({ error: 'Could not write the notes. Any credits taken were returned.' });
  }
}
const refund = (matric, amount, note) => amount > 0
  ? applyCreditDelta({ matric, delta: amount, reason: 'refund', note, actor: 'system' }).catch(err => console.error('[my-notes] refund failed', matric, err.message))
  : null;

module.exports = router;
