const Score = require('../models/Score');
const QuestionAttempt = require('../models/QuestionAttempt');
const RevisionTopic = require('../models/RevisionTopic');
const Course = require('../models/Course');
const { courseKey, tagKey, getWeakTopics, MIN_ATTEMPTS } = require('./weakTopics.service');

const WAT_MS = 60 * 60 * 1000;
const watDay = (d = new Date()) => new Date(d.getTime() + WAT_MS).toISOString().slice(0, 10);

// ── Study plan (pure) ─────────────────────────────────────────
// Builds today's checklist from real data only — nothing is invented. Every item says why it's there.
function buildStudyPlan({ goalTarget = 20, doneToday = 0, exam = null, weakTopics = [], dueCards = 0, cardsEnabled = false,
                          registered = [], practicedWeek = {}, examsToday = 0, daysSinceExam = null }) {
  const items = [];

  const target = Math.max(1, goalTarget);
  items.push({
    id: 'goal', type: 'questions', title: `Answer ${target} questions`,
    detail: doneToday >= target ? `Done — ${doneToday} answered today` : `${doneToday} / ${target} answered today`,
    done: doneToday >= target,
  });

  const weak = weakTopics[0];
  if (weak) {
    items.push({
      id: 'weak', type: 'drill', title: `Drill: ${weak.tag}`,
      detail: `${weak.courseCode} · ${weak.accuracy}% recently — your weakest topic`,
      course: weak.course, tag: weak.tag, done: !!weak.drilledToday,
    });
  }

  if (cardsEnabled && dueCards > 0) {
    items.push({ id: 'cards', type: 'flashcards', title: `Review ${dueCards} flashcard${dueCards === 1 ? '' : 's'}`, detail: 'Due for spaced repetition today', done: false });
  }

  if (exam && exam.daysLeft != null && exam.daysLeft >= 0 && exam.daysLeft <= 14) {
    const stale = daysSinceExam == null || daysSinceExam >= 3;
    if (examsToday > 0) items.push({ id: 'mock', type: 'exam', title: 'Mock exam', detail: 'Completed today', done: true });
    else if (stale) items.push({
      id: 'mock', type: 'exam', title: `Take a mock exam${exam.courseCode ? ' — ' + exam.courseCode : ''}`,
      detail: `${exam.courseCode ? exam.courseCode + ' exam' : 'Your exam'} is in ${exam.daysLeft} day${exam.daysLeft === 1 ? '' : 's'}`, course: exam.course || '', done: false,
    });
  }

  // Least-practised registered course this week (only if there's more than one to compare).
  if (registered.length > 1) {
    const least = [...registered].sort((a, b) => (practicedWeek[a.key] || 0) - (practicedWeek[b.key] || 0))[0];
    if (least && (practicedWeek[least.key] || 0) < 10) {
      items.push({ id: 'cover', type: 'practice', title: `Practise ${least.code}`, detail: `Only ${practicedWeek[least.key] || 0} question${(practicedWeek[least.key] || 0) === 1 ? '' : 's'} this week`, course: least.key, done: false });
    }
  }
  return items;
}

// Readiness for one course from its most recent attempts. Transparent on purpose:
//   accuracy × confidence, where confidence grows with how much they've practised (full at 30 attempts).
function readinessScore(correct, attempts) {
  if (!attempts) return { score: 0, accuracy: 0, band: 'No data' };
  const accuracy = Math.round((correct / attempts) * 100);
  const score = Math.round(accuracy * Math.min(1, attempts / 30));
  const band = score >= 80 ? 'Ready' : score >= 65 ? 'Almost there' : score >= 40 ? 'Building' : 'Needs work';
  return { score, accuracy, band };
}

// ── DB-backed helpers ─────────────────────────────────────────
async function courseMap(keys) {
  const docs = await Course.find({ key: { $in: keys } }).select('key courseCode courseTitle').lean();
  return Object.fromEntries(docs.map(c => [c.key, c]));
}

async function courseReadiness(matric, registeredKeys) {
  const rows = await QuestionAttempt.aggregate([
    { $match: { matric } },
    { $addFields: { _course: courseKey } },
    { $sort: { ts: -1 } },
    { $group: { _id: '$_course', results: { $push: '$correct' } } },
    { $project: { results: { $slice: ['$results', 40] } } },
    { $project: { attempts: { $size: '$results' }, correct: { $size: { $filter: { input: '$results', cond: '$$this' } } } } },
  ]);
  const by = Object.fromEntries(rows.map(r => [r._id, r]));
  const keys = [...new Set([...registeredKeys, ...rows.map(r => r._id)])].filter(Boolean);
  const cm = await courseMap(keys);
  return keys.map(k => {
    const r = by[k] || { attempts: 0, correct: 0 };
    return { course: k, courseCode: cm[k]?.courseCode || k.toUpperCase(), courseTitle: cm[k]?.courseTitle || '', attempts: r.attempts, ...readinessScore(r.correct, r.attempts) };
  }).sort((a, b) => a.score - b.score);
}

// Keeps RevisionTopic in step with the current weak topics: new ones become active, ones the student
// has turned around become 'cleared'. Called after quizzes and whenever the queue is opened.
async function syncRevisionQueue(matric) {
  const weak = await getWeakTopics(matric, 50);
  const ids = [];
  for (const w of weak) {
    const tk = String(w.tag).trim().toLowerCase();
    const doc = await RevisionTopic.findOneAndUpdate(
      { matric, course: w.course, tagKey: tk },
      { $set: { tag: w.tag, status: 'active', clearedAt: null, lastAccuracy: w.accuracy, attempts: w.attempts }, $setOnInsert: { firstFlaggedAt: new Date() } },
      { upsert: true, new: true },
    );
    ids.push(doc._id);
  }
  await RevisionTopic.updateMany({ matric, status: 'active', _id: { $nin: ids } }, { $set: { status: 'cleared', clearedAt: new Date() } });
  return weak;
}

async function revisionQueue(matric) {
  const weak = await syncRevisionQueue(matric);
  const cleared = await RevisionTopic.find({ matric, status: 'cleared' }).sort({ clearedAt: -1 }).limit(10).lean();
  const active = await RevisionTopic.find({ matric, status: 'active' }).lean();
  const flagged = Object.fromEntries(active.map(a => [`${a.course}|${a.tagKey}`, a.firstFlaggedAt]));
  const cm = await courseMap([...new Set([...weak.map(w => w.course), ...cleared.map(c => c.course)])]);
  return {
    active: weak.map(w => ({ course: w.course, courseCode: w.courseCode, tag: w.tag, accuracy: w.accuracy, attempts: w.attempts, flaggedAt: flagged[`${w.course}|${String(w.tag).toLowerCase()}`] || null })),
    cleared: cleared.map(c => ({ course: c.course, courseCode: cm[c.course]?.courseCode || c.course.toUpperCase(), tag: c.tag, clearedAt: c.clearedAt, lastAccuracy: c.lastAccuracy })),
  };
}

// 14-day activity from saved quiz scores (WAT days), oldest → newest.
async function progress14(matric) {
  const since = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
  const rows = await Score.aggregate([
    { $match: { matric, ts: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$ts', timezone: 'Africa/Lagos' } },
      quizzes: { $sum: 1 }, questions: { $sum: { $ifNull: ['$total', 0] } }, correct: { $sum: { $ifNull: ['$correct', 0] } } } },
  ]);
  const by = Object.fromEntries(rows.map(r => [r._id, r]));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = watDay(new Date(Date.now() - i * 24 * 60 * 60 * 1000));
    const r = by[d];
    days.push({ date: d, quizzes: r ? r.quizzes : 0, questions: r ? r.questions : 0, correct: r ? r.correct : 0 });
  }
  const active = days.filter(d => d.questions > 0).length;
  const thisWeek = days.slice(7).reduce((a, d) => a + d.questions, 0);
  const lastWeek = days.slice(0, 7).reduce((a, d) => a + d.questions, 0);
  return { days, activeDays: active, consistency: Math.round((active / 14) * 100), thisWeek, lastWeek };
}

module.exports = { watDay, buildStudyPlan, readinessScore, courseReadiness, syncRevisionQueue, revisionQueue, progress14, courseMap, MIN_ATTEMPTS };
