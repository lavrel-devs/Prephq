const Course = require('../models/Course');
const Question = require('../models/Question');
const { courseMatchFilter } = require('../utils/courseMatch');
const { generateCourseOutline, suggestTopicsFromTitle } = require('./groq.service');
const T = require('./courseTopics.logic');

// v1.8.5 AI course topic outline. Reads the questions already uploaded for a course and works out its topic outline
// (teaching order), then saves it into Course.topics. A course with no questions yet falls back to a suggestion from its
// title — flagged as such so the admin reviews it first. Nothing here ever removes a topic the admin wrote.
const MIN_QUESTIONS = 5;   // below this, past questions say too little about the syllabus
class TopicError extends Error { constructor(status, message) { super(message); this.status = status; } }

async function findCourse(idOrCode) {
  const key = String(idOrCode || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return Course.findOne({ $or: [...(String(idOrCode).match(/^[a-f0-9]{24}$/i) ? [{ _id: idOrCode }] : []), { key }, { courseCode: String(idOrCode).trim() }] });
}

// Works for a saved course (reads its questions) or an unsaved one from the Add Course form ({courseCode, courseTitle}).
// Returns { topics, basis: 'questions'|'title', totalQuestions, taggedQuestions } — does not save.
async function suggest({ courseDoc, courseCode, courseTitle, department, level, existing = [], priority = 'low' }) {
  const code = courseDoc ? courseDoc.courseCode : courseCode, title = courseDoc ? courseDoc.courseTitle : courseTitle;
  if (!code || !title) throw new TopicError(400, 'A course code and title are needed first.');
  let rows = [];
  if (courseDoc) rows = await Question.find(await courseMatchFilter(courseDoc.key)).select('tag q').limit(2500).lean();
  const stats = T.tagStats(rows);

  if (stats.total >= MIN_QUESTIONS) {
    const out = await generateCourseOutline({ courseCode: code, courseTitle: title, tags: stats.tags, untagged: stats.untagged, priority });
    const topics = T.cleanTopics(out.topics.map(t => t && t.name));
    if (topics.length) return { topics, basis: 'questions', totalQuestions: stats.total, taggedQuestions: stats.tags.reduce((n, t) => n + t.count, 0) };
  }
  const out = await suggestTopicsFromTitle({ courseCode: code, courseTitle: title, department: department || (courseDoc && courseDoc.department) || '', level: level || (courseDoc && courseDoc.level) || '', existing, priority });
  return { topics: T.cleanTopics(out.topics), basis: 'title', totalQuestions: stats.total, taggedQuestions: 0 };
}

// mode: 'fill'  -> only if the course has no topics yet
//       'merge' -> add new topics after the existing ones (default; non-destructive)
//       'replace' -> use exactly the AI's outline
async function generateAndSave(courseDoc, mode = 'merge') {
  const existing = courseDoc.topics || [];
  if (mode === 'fill' && existing.length) return { saved: false, reason: 'has-topics', before: existing, after: existing, added: [] };
  const s = await suggest({ courseDoc, existing });
  if (!s.topics.length) return { saved: false, reason: 'nothing-found', basis: s.basis, totalQuestions: s.totalQuestions, before: existing, after: existing, added: [] };
  const merged = mode === 'replace' ? { topics: s.topics, added: s.topics.filter(t => !existing.map(T.norm).includes(T.norm(t))) } : T.mergeTopics(existing, s.topics);
  await Course.updateOne({ _id: courseDoc._id }, { $set: { topics: merged.topics } });
  return { saved: true, basis: s.basis, totalQuestions: s.totalQuestions, before: existing, after: merged.topics, added: merged.added };
}

// Every course with no topics but enough questions: save an outline for each. Sequential and capped, so one click can't
// run for ages or flood the AI; `remaining` says how many are still waiting. Title-only guesses are NOT auto-saved here.
async function fillMissing({ limit = 12 } = {}) {
  const empty = await Course.find({ $or: [{ topics: { $exists: false } }, { topics: { $size: 0 } }] }).sort({ courseCode: 1 });
  const results = [];
  let done = 0;
  for (const c of empty) {
    if (done >= limit) break;
    const n = await Question.countDocuments(await courseMatchFilter(c.key)).catch(() => 0);
    if (n < MIN_QUESTIONS) { results.push({ courseCode: c.courseCode, status: 'skipped', reason: `only ${n} question${n === 1 ? '' : 's'}` }); continue; }
    done++;
    try {
      const r = await generateAndSave(c, 'fill');
      results.push({ courseCode: c.courseCode, status: r.saved ? 'saved' : 'skipped', topics: r.after.length, reason: r.saved ? '' : r.reason });
    } catch (e) { results.push({ courseCode: c.courseCode, status: 'failed', reason: e.message }); }
  }
  const left = empty.length - results.length;
  return { results, remaining: Math.max(0, left), saved: results.filter(r => r.status === 'saved').length };
}

module.exports = { suggest, generateAndSave, fillMissing, findCourse, TopicError, MIN_QUESTIONS };
