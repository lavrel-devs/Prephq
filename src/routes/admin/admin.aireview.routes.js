const express = require('express');
const AIQuestionReview = require('../../models/AIQuestionReview');
const { requireAdmin } = require('../../middleware/auth');
const { generateForAdmin, approve, reject, validMcq, normText, courseKeyOf, ReviewError } = require('../../services/questionReview.service');
const { isObjectId } = require('../../utils/validate');
const { logActivity } = require('../../services/activity.service');

// ── AI question review (v1.8.1) ───────────────────────────────
// Area: "questions" (see utils/adminAccess.js). Everything students generate with the AI, plus anything the admin asks
// the AI to write on demand, waits here until approved.
const router = express.Router();
router.use(requireAdmin);

const fail = (res, e) => res.status(e instanceof ReviewError ? e.status : (e.code === 'GROQ_NOT_CONFIGURED' ? 503 : 500)).json({ error: e.message, code: e.code });
const view = (d) => ({ _id: d._id, kind: d.kind, course: d.course, courseKey: d.courseKey, tag: d.tag, difficulty: d.difficulty, q: d.q, opts: d.opts, ans: d.ans, exp: d.exp,
  rubric: d.rubric, model: d.model, source: d.source, submittedBy: d.submittedBy, status: d.status, createdAt: d.createdAt, reviewedAt: d.reviewedAt, reviewedBy: d.reviewedBy, note: d.note });

// GET /api/admin/ai-review?status=pending&kind=mcq|written&source=student-ai|admin-ai&limit=40&skip=0
router.get('/ai-review', async (req, res) => {
  try {
    const f = {};
    if (['pending', 'approved', 'rejected'].includes(req.query.status)) f.status = req.query.status;
    if (['mcq', 'written'].includes(req.query.kind)) f.kind = req.query.kind;
    if (['student-ai', 'admin-ai'].includes(req.query.source)) f.source = req.query.source;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 40, 1), 100), skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    const [items, total, pending, approved, rejected] = await Promise.all([
      AIQuestionReview.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AIQuestionReview.countDocuments(f),
      AIQuestionReview.countDocuments({ status: 'pending' }), AIQuestionReview.countDocuments({ status: 'approved' }), AIQuestionReview.countDocuments({ status: 'rejected' }),
    ]);
    res.json({ items: items.map(view), total, counts: { pending, approved, rejected } });
  } catch (e) { fail(res, e); }
});

// GET /api/admin/ai-review/summary — for the nav badge
router.get('/ai-review/summary', async (req, res) => {
  try { res.json({ pending: await AIQuestionReview.countDocuments({ status: 'pending' }) }); } catch (e) { fail(res, e); }
});

// POST /api/admin/ai-review/generate { course, topic?, difficulty?, count (1–10) } — AI writes practice MCQs into the queue.
// The dashboard calls this repeatedly (10 at a time) to reach a bigger target, so each request stays short.
router.post('/ai-review/generate', async (req, res) => {
  try {
    const b = req.body || {};
    const out = await generateForAdmin({ course: b.course, topic: b.topic, difficulty: b.difficulty, count: b.count, admin: req.admin.sub });
    logActivity({ actorType: 'admin', actor: req.admin.sub, action: 'ai_review.generate', detail: { course: b.course, requested: out.requested, queued: out.queued } });
    res.status(201).json(out);
  } catch (e) { fail(res, e); }
});

// POST /api/admin/ai-review/approve { items: [{ id, course? }] }
router.post('/ai-review/approve', async (req, res) => {
  try {
    const items = (Array.isArray(req.body && req.body.items) ? req.body.items : []).filter(i => i && isObjectId(i.id)).slice(0, 100);
    if (!items.length) return res.status(400).json({ error: 'Nothing selected' });
    const out = await approve(items, req.admin.sub);
    logActivity({ actorType: 'admin', actor: req.admin.sub, action: 'ai_review.approve', detail: { approved: out.approved, batchId: out.batchId } });
    res.json(out);
  } catch (e) { fail(res, e); }
});

// POST /api/admin/ai-review/reject { ids: [...] }
router.post('/ai-review/reject', async (req, res) => {
  try {
    const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).filter(isObjectId).slice(0, 200);
    if (!ids.length) return res.status(400).json({ error: 'Nothing selected' });
    res.json(await reject(ids, req.admin.sub));
  } catch (e) { fail(res, e); }
});

// PUT /api/admin/ai-review/:id { q, opts, ans, exp, tag, course } — fix a pending MCQ before approving it
// v1.8.7 DELETE /api/admin/ai-review { ids: [...] } — permanently delete REJECTED generations. Pending and approved items can
// never be deleted here (approved ones already live in the question bank; pending ones should be reviewed first).
router.delete('/ai-review', async (req, res) => {
  try {
    const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).filter(isObjectId).slice(0, 200);
    if (!ids.length) return res.status(400).json({ error: 'Nothing selected' });
    const r = await AIQuestionReview.deleteMany({ _id: { $in: ids }, status: 'rejected' });
    logActivity({ actorType: 'admin', actor: req.admin.sub, action: 'ai_review.delete', detail: { deleted: r.deletedCount } });
    res.json({ deleted: r.deletedCount });
  } catch (e) { fail(res, e); }
});

// v1.8.7 DELETE /api/admin/ai-review/rejected?kind=mcq|written&source=student-ai|admin-ai — clear every rejected generation
// (optionally only one type or source). Same rule: only rejected items are ever touched.
router.delete('/ai-review/rejected', async (req, res) => {
  try {
    const f = { status: 'rejected' };
    if (['mcq', 'written'].includes(req.query.kind)) f.kind = req.query.kind;
    if (['student-ai', 'admin-ai'].includes(req.query.source)) f.source = req.query.source;
    const r = await AIQuestionReview.deleteMany(f);
    logActivity({ actorType: 'admin', actor: req.admin.sub, action: 'ai_review.delete_all_rejected', detail: { deleted: r.deletedCount, kind: f.kind || 'all', source: f.source || 'all' } });
    res.json({ deleted: r.deletedCount });
  } catch (e) { fail(res, e); }
});

router.put('/ai-review/:id', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const doc = await AIQuestionReview.findOne({ _id: req.params.id, status: 'pending' });
    if (!doc) return res.status(404).json({ error: 'That question is no longer pending' });
    if (doc.kind !== 'mcq') return res.status(400).json({ error: 'Only multiple-choice questions can be edited' });
    const b = req.body || {};
    const next = { q: String(b.q || '').trim(), opts: (Array.isArray(b.opts) ? b.opts : []).map(o => String(o).trim()), ans: Number(b.ans) };
    if (!validMcq(next)) return res.status(400).json({ error: 'A question needs 2–6 non-empty options and a correct answer that matches one of them' });
    doc.q = next.q.slice(0, 800); doc.opts = next.opts.map(o => o.slice(0, 400)); doc.ans = next.ans;
    doc.exp = String(b.exp || '').trim().slice(0, 800); doc.tag = String(b.tag || '').trim().slice(0, 80);
    if (b.course) { doc.course = String(b.course).trim().slice(0, 60); doc.courseKey = courseKeyOf(b.course); }
    doc.norm = normText(doc.q);
    await doc.save();
    res.json(view(doc.toObject ? doc.toObject() : doc));
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'That question is already in the queue for this course' });
    fail(res, e);
  }
});

module.exports = router;
