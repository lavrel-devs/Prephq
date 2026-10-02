const express = require('express');
const CourseNote = require('../../models/CourseNote');
const NoteJob = require('../../models/NoteJob');
const Course = require('../../models/Course');
const { requireAdmin } = require('../../middleware/auth');
const Question = require('../../models/Question');
const { isObjectId, normCourseKey, escapeRegex } = require('../../utils/validate');
const { courseMatchFilter } = require('../../utils/courseMatch');
const { withLock } = require('../../utils/lock');
const { strip } = require('../../services/notes.service');
const { buildOutline, writeNoteForTopic } = require('../../services/noteBuilder.service');
const jobs = require('../../services/noteJob.service');

const router = express.Router();
router.use(requireAdmin);
// "courses" area — enforced by adminGate.

function clean(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!title || title.length > 120) return { error: 'Title is required (max 120 characters)' };
  if (!text || text.length > 12000) return { error: 'Notes are required (max 12,000 characters)' };
  return {
    value: {
      title, body: text,
      topic: typeof body.topic === 'string' ? body.topic.trim().replace(/\s+/g, ' ').slice(0, 100) : '',
      order: Number.isFinite(Number(body.order)) ? Math.round(Number(body.order)) : 0,
      published: body.published !== false,
    },
  };
}

// GET /api/admin/course-notes?course=<key|code>
router.get('/course-notes', async (req, res) => {
  try {
    const filter = req.query.course ? { courseKey: normCourseKey(req.query.course) } : {};
    res.json(await CourseNote.find(filter).sort({ courseKey: 1, order: 1, createdAt: 1 }).lean());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/course-notes', async (req, res) => {
  try {
    const key = normCourseKey(req.body.course);
    if (!(await Course.exists({ key }))) return res.status(400).json({ error: 'Pick an existing course' });
    const c = clean(req.body); if (c.error) return res.status(400).json({ error: c.error });
    res.status(201).json(await CourseNote.create({ ...c.value, courseKey: key, updatedBy: req.admin.sub }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/course-notes/:id', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Note not found' });
    const c = clean(req.body); if (c.error) return res.status(400).json({ error: c.error });
    const n = await CourseNote.findByIdAndUpdate(req.params.id, { ...c.value, updatedBy: req.admin.sub }, { new: true });
    if (!n) return res.status(404).json({ error: 'Note not found' });
    res.json(n);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/course-notes/:id', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Note not found' });
    await CourseNote.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AI note builder ───────────────────────────────────────────
// Step 1: read the past questions uploaded for a course and let the AI arrange their topics into a teaching
//         order (merging spelling variants). Nothing is saved yet.
// Step 2: generate a note per topic — saved as an unpublished DRAFT. Students see nothing until an admin approves.
function aiError(res, e) {
  const status = e.status || (e.code === 'GROQ_NOT_CONFIGURED' ? 503 : e.code === 'GROQ_TIMEOUT' ? 504 : e.code === 'GROQ_BUSY' ? 429 : 502);
  return res.status(status).json({ error: e.message, code: e.code || 'GROQ_ERROR' });
}

async function loadCourse(req, res) {
  const key = normCourseKey(req.body.course);
  const course = await Course.findOne({ key }).lean();
  if (!course) { res.status(400).json({ error: 'Pick an existing course' }); return null; }
  return course;
}

// POST /api/admin/course-notes/ai/outline  { course }
router.post('/course-notes/ai/outline', async (req, res) => {
  try {
    const course = await loadCourse(req, res); if (!course) return;
    const out = await buildOutline(course);
    res.json({ course: { key: course.key, code: course.courseCode, title: course.courseTitle }, ...out });
  } catch (e) { return aiError(res, e); }
});

// POST /api/admin/course-notes/ai/generate  { course, topic, tags[], questionIds[] }  — one topic, right now
router.post('/course-notes/ai/generate', async (req, res) => {
  try {
    const course = await loadCourse(req, res); if (!course) return;
    const topic = strip(req.body.topic).slice(0, 100);
    if (!topic) return res.status(400).json({ error: 'A topic name is required' });
    const tags = (Array.isArray(req.body.tags) ? req.body.tags : []).map(strip).filter(Boolean).slice(0, 20);
    const ids = (Array.isArray(req.body.questionIds) ? req.body.questionIds : []).filter(i => isObjectId(String(i))).slice(0, 40);
    const r = await writeNoteForTopic({ course, topic, tags, questionIds: ids, actor: req.admin.sub });
    if (r.conflict) return res.status(409).json({ error: r.conflict });
    if (r.bad) return res.status(400).json({ error: r.bad });
    res.status(201).json(r.note);
  } catch (e) { return aiError(res, e); }
});

// ── Bulk background jobs ──────────────────────────────────────
// POST /api/admin/course-notes/ai/jobs  { course } | { all: true }  — write every missing note as drafts
router.post('/course-notes/ai/jobs', async (req, res) => {
  try {
    const all = req.body.all === true;
    const r = await jobs.startJob({ courseKey: all ? null : normCourseKey(req.body.course), all, admin: req.admin.sub });
    res.status(r.already ? 200 : 201).json({ ...jobs.summary(r.job.toObject()), already: r.already });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
// GET /api/admin/course-notes/ai/jobs/current — the active job, or the most recent one
router.get('/course-notes/ai/jobs/current', async (req, res) => {
  try {
    const j = (await jobs.activeJob()) || (await NoteJob.findOne({}).sort({ createdAt: -1 }));
    res.json(j ? jobs.summary(j.toObject()) : null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/course-notes/ai/jobs/:id/cancel', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    res.json({ stopped: await jobs.cancelJob(req.params.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/course-notes/ai/jobs/:id/retry', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    res.json(jobs.summary((await jobs.retryFailed(req.params.id)).toObject()));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// POST /api/admin/course-notes/:id/approve — publishes one note
router.post('/course-notes/:id/approve', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Note not found' });
    const n = await CourseNote.findByIdAndUpdate(req.params.id, { published: true, updatedBy: req.admin.sub }, { new: true });
    if (!n) return res.status(404).json({ error: 'Note not found' });
    res.json(n);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/course-notes/approve-drafts  { course } | { all: true } — publishes every pending AI draft
router.post('/course-notes/approve-drafts', async (req, res) => {
  try {
    const scope = req.body.all === true ? {} : { courseKey: normCourseKey(req.body.course) };
    const r = await CourseNote.updateMany({ ...scope, source: 'ai', published: false }, { published: true, updatedBy: req.admin.sub });
    res.json({ approved: r.modifiedCount || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
