const QuestionAttempt = require('../models/QuestionAttempt');

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
async function getWeakTopics(matric, limit = 5) {
  const rows = await QuestionAttempt.aggregate([
    { $match: { matric: matric.toUpperCase(), tag: { $ne: '' } } },
    { $sort: { ts: -1 } },
    { $group: {
      _id: { course: '$course', tag: '$tag' },
      recentResults: { $push: '$correct' }, // newest first, thanks to the $sort above
    } },
    { $project: {
      _id: 0, course: '$_id.course', tag: '$_id.tag',
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
  return rows;
}

module.exports = { getWeakTopics, MIN_ATTEMPTS, WEAK_THRESHOLD, RECENT_WINDOW };
