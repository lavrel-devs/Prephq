// Shared by the single-topic admin buttons and the background bulk job.
const CourseNote = require('../models/CourseNote');
const Course = require('../models/Course');
const Question = require('../models/Question');
const { escapeRegex } = require('../utils/validate');
const { courseMatchFilter } = require('../utils/courseMatch');
const { withLock } = require('../utils/lock');
const { generateCourseOutline, generateCourseNote } = require('./groq.service');
const { collectTopics, normalizeOutline, strip } = require('./notes.service');

// Reads a course's uploaded past questions, asks the AI to arrange the topics, and marks which already have a note.
// Throws an Error with .status = 400 when there is nothing to build from.
async function buildOutline(course, { priority } = {}) {
  const questions = await Question.find(await courseMatchFilter(course.key)).select('q tag').limit(800).lean();
  if (!questions.length) { const e = new Error(`No past questions have been uploaded for ${course.courseCode} yet, so there are no topics to build from.`); e.status = 400; throw e; }
  const { tags, untagged } = collectTopics(questions);
  if (!tags.length && !untagged.length) { const e = new Error('The uploaded questions have no usable topics.'); e.status = 400; throw e; }
  const ai = await generateCourseOutline({ courseCode: course.courseCode, courseTitle: course.courseTitle, tags: tags.slice(0, 80), untagged, priority });
  const topics = normalizeOutline(ai.topics, tags.slice(0, 80), untagged);
  if (!topics.length) { const e = new Error('The AI could not build an outline. Try again.'); e.status = 502; throw e; }

  const existing = await CourseNote.find({ courseKey: course.key }).select('title topic source published').lean();
  const has = new Map();
  for (const n of existing) for (const k of [n.topic, n.title]) if (k) has.set(k.trim().toLowerCase(), n);
  return {
    totalQuestions: questions.length,
    topics: topics.map(t => { const n = has.get(t.name.toLowerCase()); return { ...t, note: n ? { id: n._id, source: n.source, published: n.published } : null }; }),
  };
}

// Writes one AI draft note for a topic. Returns { note } | { conflict } | { bad }.
async function writeNoteForTopic({ course, topic, tags = [], questionIds = [], actor = 'admin', priority }) {
  topic = strip(topic).slice(0, 100);
  return withLock(`notegen:${course.key}:${topic.toLowerCase()}`, async () => {
    const re = `^${escapeRegex(topic)}$`;
    const existing = await CourseNote.findOne({ courseKey: course.key, $or: [{ topic: new RegExp(re, 'i') }, { title: new RegExp(re, 'i') }] });
    // Never overwrite something an admin wrote or already published; an old AI draft may be regenerated.
    if (existing && !(existing.source === 'ai' && !existing.published)) {
      return { conflict: existing.published ? 'This topic already has a published note.' : 'This topic already has a note.' };
    }
    const match = [];
    if (tags.length) match.push({ tag: { $in: tags.map(t => new RegExp(`^${escapeRegex(t)}$`, 'i')) } });
    if (questionIds.length) match.push({ _id: { $in: questionIds } });
    if (!match.length) return { bad: 'This topic has no past questions to build from.' };
    const qs = await Question.find({ $and: [await courseMatchFilter(course.key), { $or: match }] }).select('q opts ans exp').limit(25).lean();
    if (!qs.length) return { bad: 'No past questions were found for this topic.' };

    const { body } = await generateCourseNote({
      courseCode: course.courseCode, courseTitle: course.courseTitle, topic, priority,
      questions: qs.map(q => ({ q: strip(q.q).slice(0, 400), correct: strip((q.opts || [])[q.ans]).slice(0, 200), exp: strip(q.exp).slice(0, 300) })),
    });
    if (existing) { existing.body = body; existing.updatedBy = `${actor} (AI)`; await existing.save(); return { note: existing }; }
    const order = (await CourseNote.countDocuments({ courseKey: course.key })) + 1;
    return { note: await CourseNote.create({ courseKey: course.key, topic, title: topic, body, order, published: false, source: 'ai', updatedBy: `${actor} (AI)` }) };
  });
}

async function loadCourseByKey(key) { return Course.findOne({ key }).lean(); }

module.exports = { buildOutline, writeNoteForTopic, loadCourseByKey };
