const AIQuestionReview = require('../models/AIQuestionReview');
const TheoryQuestion = require('../models/TheoryQuestion');
const Question = require('../models/Question');
const Course = require('../models/Course');
const { courseMatchFilter } = require('../utils/courseMatch');
const { generateQuiz } = require('./groq.service');

// ── AI question review (v1.8.1) ───────────────────────────────
const courseKeyOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normText = (s) => String(s || '').toLowerCase().replace(/<[^>]*>/g, '').replace(/[^a-z0-9]/g, '').slice(0, 300);
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

class ReviewError extends Error { constructor(status, message) { super(message); this.status = status; } }

// A valid MCQ: a question, 2–6 options, and an answer index that points at one of them.
function validMcq(it) {
  return it && clean(it.q, 800) && Array.isArray(it.opts) && it.opts.length >= 2 && it.opts.length <= 6
    && it.opts.every(o => clean(o, 400)) && Number.isInteger(it.ans) && it.ans >= 0 && it.ans < it.opts.length;
}

// Put AI-written questions in the review queue. Safe to call fire-and-forget: duplicates (same course + same question
// text, in any status) are skipped silently. Returns { queued, skipped }.
async function queueQuestions({ kind, course, items, source, submittedBy = '', difficulty = 'medium', tag = '' }) {
  const courseKey = courseKeyOf(course);
  if (!courseKey || !Array.isArray(items) || !items.length) return { queued: 0, skipped: 0 };
  const docs = [], seen = new Set();
  for (const it of items) {
    if (kind === 'mcq' ? !validMcq(it) : !(it && clean(it.q, 800) && Array.isArray(it.rubric) && it.rubric.length >= 2)) continue;
    const norm = normText(it.q);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    docs.push(kind === 'mcq'
      ? { kind, course: clean(course, 60), courseKey, tag: clean(tag, 80), difficulty, q: clean(it.q, 800), opts: it.opts.map(o => clean(o, 400)), ans: it.ans, exp: clean(it.exp, 800), source, submittedBy, norm }
      : { kind, course: clean(course, 60), courseKey, tag: clean(tag, 80), difficulty, q: clean(it.q, 800), rubric: it.rubric.map(r => ({ point: clean(r.point, 240), marks: r.marks })), model: clean(it.model, 1800), source, submittedBy, norm });
  }
  if (!docs.length) return { queued: 0, skipped: items.length };
  let queued = 0;
  try {
    const res = await AIQuestionReview.insertMany(docs, { ordered: false });
    queued = Array.isArray(res) ? res.length : docs.length;
  } catch (e) {
    // 11000 = already queued before; the rest of the batch still went in
    const errs = e.writeErrors || [];
    if (e.code !== 11000 && !(errs.length && errs.every(w => (w.code || (w.err && w.err.code)) === 11000))) throw e;
    queued = e.insertedDocs ? e.insertedDocs.length : (e.result && e.result.nInserted) || 0;
  }
  return { queued, skipped: docs.length - queued };
}

// Admin: ask the AI for `count` (1–10 per call) practice MCQs for a catalogue course. They go to the queue as
// 'admin-ai' — nothing reaches the bank until approved. Grounded in the course's existing topic tags.
async function generateForAdmin({ course, topic = '', difficulty = 'medium', count = 10, admin = '' }) {
  const courseDoc = await Course.findOne({ $or: [{ key: courseKeyOf(course) }, { courseCode: String(course).trim() }] }).lean();
  if (!courseDoc) throw new ReviewError(400, 'Choose a course from the catalogue');
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new ReviewError(400, 'Ask for 1 to 10 questions per request');
  const diff = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';
  const tags = (await Question.distinct('tag', await courseMatchFilter(courseDoc.key)).catch(() => [])).filter(t => typeof t === 'string' && t.trim()).slice(0, 40);
  const material = [
    courseDoc.title ? `Course title: ${courseDoc.title}.` : '',
    topic ? `Focus specifically on the topic: ${String(topic).slice(0, 80)}.` : '',
    tags.length ? `Topics this course covers: ${tags.join('; ')}. Spread the questions across them unless a focus topic is given.` : '',
  ].filter(Boolean).join('\n');
  const { questions } = await generateQuiz({ course: courseDoc.courseCode || courseDoc.key, difficulty: diff, count: n, studyMaterial: material });
  const r = await queueQuestions({ kind: 'mcq', course: courseDoc.key, items: questions, source: 'admin-ai', submittedBy: admin, difficulty: diff, tag: String(topic || '').slice(0, 80) });
  return { requested: n, generated: questions.length, queued: r.queued, duplicates: r.skipped };
}

// Admin: approve queued questions. `items` = [{ id, course? }] — `course` overrides the queued course (the student's
// free-typed course is often not a catalogue key). An MCQ becomes a Question-bank row; a written question goes into the
// theory bank. Duplicates of questions already in the bank are rejected instead of added.
async function approve(items, admin) {
  const batchId = `ai-review-${new Date().toISOString().slice(0, 10)}`;
  const out = [];
  for (const it of items) {
    const doc = await AIQuestionReview.findOne({ _id: it.id, status: 'pending' });
    if (!doc) { out.push({ id: it.id, result: 'gone' }); continue; }
    const courseDoc = await Course.findOne({ key: courseKeyOf(it.course || doc.course) }).lean();
    if (!courseDoc) { out.push({ id: it.id, result: 'needs_course' }); continue; }
    try {
      let addedId;
      if (doc.kind === 'mcq') {
        const exists = await Question.findOne({ $and: [await courseMatchFilter(courseDoc.key), { q: { $regex: new RegExp(`^${escapeRe(doc.q.trim())}$`, 'i') } }] }).select('_id').lean();
        if (exists) { doc.status = 'rejected'; doc.note = 'Already in the question bank'; doc.reviewedAt = new Date(); doc.reviewedBy = admin; await doc.save(); out.push({ id: it.id, result: 'duplicate' }); continue; }
        const created = await Question.create({ course: courseDoc.key, q: doc.q, opts: doc.opts, ans: doc.ans, tag: doc.tag || '', exp: doc.exp || '', createdBy: `ai-review:${admin}`, batchId });
        addedId = String(created._id);
      } else {
        const created = await TheoryQuestion.create({ course: courseDoc.key, tag: doc.tag || '', q: doc.q, rubric: doc.rubric, model: doc.model, norm: doc.norm, createdBy: admin });
        addedId = String(created._id);
      }
      doc.status = 'approved'; doc.addedId = addedId; doc.course = courseDoc.key; doc.reviewedAt = new Date(); doc.reviewedBy = admin;
      await doc.save();
      out.push({ id: it.id, result: 'approved', addedId });
    } catch (e) {
      if (e.code === 11000) { doc.status = 'rejected'; doc.note = 'Already in the theory bank'; doc.reviewedAt = new Date(); doc.reviewedBy = admin; await doc.save(); out.push({ id: it.id, result: 'duplicate' }); }
      else throw e;
    }
  }
  return { batchId, results: out, approved: out.filter(r => r.result === 'approved').length };
}

async function reject(ids, admin) {
  const r = await AIQuestionReview.updateMany({ _id: { $in: ids }, status: 'pending' }, { $set: { status: 'rejected', reviewedAt: new Date(), reviewedBy: admin } });
  return { rejected: r.modifiedCount != null ? r.modifiedCount : r.nModified || 0 };
}

module.exports = { queueQuestions, generateForAdmin, approve, reject, validMcq, normText, courseKeyOf, ReviewError };
