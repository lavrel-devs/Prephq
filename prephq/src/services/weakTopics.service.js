const QuestionAttempt = require('../models/QuestionAttempt');
const Course = require('../models/Course');
const { GENERIC_TAGS } = require('../utils/validate');

const MIN_ATTEMPTS = 3;      // need at least this many recent attempts on a tag before judging it "weak"
const WEAK_THRESHOLD = 0.65; // below 65% accuracy (within the recent window) counts as weak
const RECENT_WINDOW = 8;     // only the last N attempts per tag count — see note below

// Aggregates a student's QuestionAttempt history by course+tag and
// returns the topics they're weakest on, worst first. Untagged
// questions (tag === '') are excluded — there's nothing specific to
// drill if the question bank hasn't labeled a sub-topic.
//
// Uses only the most RECENT `RECENT_WINDOW` attempts per tag, not an
// all-time cumulative average. An all-time average barely moves after
// a strong practice session — someone could genuinely master a topic
// and it would stay flagged "weak" for a long time simply because of
// how many bad attempts came before. A recent-window average means
// doing well on a focused practice quiz for a topic can actually clear
// it from the list, which is the whole point of drilling it.
// Older attempt rows were saved with inconsistent spelling, so course and tag are normalised when read
// (lower-case; course also stripped of spaces/punctuation). Shared with the readiness/plan queries.
const courseKey = { $let: { vars: { c: { $toLower: { $ifNull: ['$course', ''] } } }, in:
    { $reduce: { input: [' ', '-', '_', '/', '.', '&', '(', ')', ','], initialValue: '$$c',
        in: { $replaceAll: { input: '$$value', find: '$$this', replacement: '' } } } } } };
const tagKey = { $trim: { input: { $toLower: { $ifNull: ['$tag', ''] } } } };

async function getWeakTopics(matric, limit = 5) {
  const rows = await QuestionAttempt.aggregate([
    { $match: { matric: matric.toUpperCase() } },
    { $addFields: { _course: courseKey, _tag: tagKey } },
    { $match: { _tag: { $nin: ['', ...[...GENERIC_TAGS]] }, _course: { $ne: '' } } },
    { $sort: { ts: -1 } },
    { $group: {
      _id: { course: '$_course', tag: '$_tag' },
      label: { $first: '$tag' },              // newest spelling, for display
      recentResults: { $push: '$correct' },   // newest first, thanks to the $sort above
    } },
    { $project: {
      _id: 0, course: '$_id.course', tag: { $trim: { input: '$label' } },
      recentResults: { $slice: ['$recentResults', RECENT_WINDOW] },
    } },
    { $project: {
      course: 1, tag: 1,
      attempts: { $size: '$recentResults' },
      correct: { $size: { $filter: { input: '$recentResults', cond: '$$this' } } },
    } },
    { $match: { attempts: { $gte: MIN_ATTEMPTS } } },
    { $project: {
      course: 1, tag: 1, attempts: 1, correct: 1,
      accuracy: { $round: [{ $multiply: [{ $divide: ['$correct', '$attempts'] }, 100] }, 0] },
    } },
    { $match: { accuracy: { $lt: WEAK_THRESHOLD * 100 } } },
    { $sort: { accuracy: 1 } },
    { $limit: limit },
  ]);

  // Attach the real course code/title so the UI never has to guess from a raw string.
  const courses = await Course.find({ key: { $in: rows.map(r => r.course) } }).select('key courseCode courseTitle').lean();
  const byKey = Object.fromEntries(courses.map(c => [c.key, c]));
  return rows.map(r => ({
    ...r,
    courseCode: byKey[r.course]?.courseCode || r.course.toUpperCase(),
    courseTitle: byKey[r.course]?.courseTitle || '',
  }));
}

module.exports = { courseKey, tagKey, getWeakTopics, MIN_ATTEMPTS, WEAK_THRESHOLD, RECENT_WINDOW };
