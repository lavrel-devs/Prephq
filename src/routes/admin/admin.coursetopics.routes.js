const express = require('express');
const { requireAdmin } = require('../../middleware/auth');
const { suggest, generateAndSave, fillMissing, findCourse, TopicError } = require('../../services/courseTopics.service');
const { isObjectId } = require('../../utils/validate');
const { logActivity } = require('../../services/activity.service');

// v1.8.5 AI course topic outline. Area: "courses" (see utils/adminAccess.js — /courses/* is already covered).
//   POST /api/admin/courses/ai-topics              preview for the Add/Edit Course form (works before the course is saved)
//   POST /api/admin/courses/ai-topics/fill-missing save an outline for every course that has none (and enough questions)
//   POST /api/admin/courses/:id/ai-topics          generate + save for one course, { mode: 'merge'|'fill'|'replace' }
const router = express.Router();
router.use(requireAdmin);

const fail = (res, e) => res.status(e instanceof TopicError ? e.status : (e.code === 'GROQ_NOT_CONFIGURED' ? 503 : 500)).json({ error: e.message, code: e.code });
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

router.post('/courses/ai-topics', async (req, res) => {
  try {
    const b = req.body || {};
    const courseDoc = b.courseCode ? await findCourse(str(b.courseCode, 40)) : null;
    const existing = Array.isArray(b.existing) ? b.existing.map(x => str(x, 80)).filter(Boolean).slice(0, 80) : [];
    const out = await suggest({ courseDoc, courseCode: str(b.courseCode, 40), courseTitle: str(b.courseTitle, 160), department: str(b.department, 80), level: str(b.level, 20), existing });
    res.json(out);
  } catch (e) { fail(res, e); }
});

router.post('/courses/ai-topics/fill-missing', async (req, res) => {
  try {
    const out = await fillMissing({ limit: 12 });
    logActivity({ actorType: 'admin', actor: req.admin.sub, action: 'course.ai_topics_bulk', detail: { saved: out.saved, remaining: out.remaining } });
    res.json(out);
  } catch (e) { fail(res, e); }
});

router.post('/courses/:id/ai-topics', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Bad course id' });
    const course = await findCourse(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    const mode = ['fill', 'merge', 'replace'].includes((req.body || {}).mode) ? req.body.mode : 'merge';
    const out = await generateAndSave(course, mode);
    if (out.saved) logActivity({ actorType: 'admin', actor: req.admin.sub, action: 'course.ai_topics', detail: { course: course.courseCode, mode, added: out.added.length, basis: out.basis } });
    res.json(out);
  } catch (e) { fail(res, e); }
});

module.exports = router;
