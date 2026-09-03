const Course = require('../models/Course');

// Question.course has been stored inconsistently across the app's
// history — some documents hold the lowercase Course.key, others (older
// data, or admin-typed values) hold the raw uppercase courseCode. A
// naive exact match silently misses one or the other. This mirrors the
// defensive matching already used by GET /api/admin/questions and GET
// /api/questions/:course, centralized here so every new feature that
// needs "questions for course X" doesn't have to rediscover the bug.
async function courseMatchFilter(courseKeyOrCode) {
  const raw = String(courseKeyOrCode || '').trim();
  const normalizedKey = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const courseDoc = await Course.findOne({ key: normalizedKey }).lean();

  const candidates = new Set([raw, normalizedKey]);
  if (courseDoc) { candidates.add(courseDoc.key); candidates.add(courseDoc.courseCode); }

  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { $or: [...candidates].filter(Boolean).map(c => ({ course: { $regex: new RegExp(`^${escape(c)}$`, 'i') } })) };
}

module.exports = { courseMatchFilter };
