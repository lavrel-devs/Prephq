const Student = require('../models/Student');
const Score = require('../models/Score');
const RevisionTopic = require('../models/RevisionTopic');
const { notify } = require('./notification.service');
const { logActivity } = require('./activity.service');

// ── Achievements ──────────────────────────────────────────────
// Earned automatically from real activity — unlike shop badges, they can't be bought.
// `stats` is computed from the DB by loadStats(); evaluate() is pure so it can be unit-tested.
const ACHIEVEMENTS = [
  { key: 'first_quiz',     icon: '🎯', title: 'First Step',        desc: 'Finish your first quiz' },
  { key: 'q100',           icon: '💯', title: 'Century',           desc: 'Answer 100 questions' },
  { key: 'q500',           icon: '📚', title: 'Bookworm',          desc: 'Answer 500 questions' },
  { key: 'q1000',          icon: '🏆', title: 'Grand Master',      desc: 'Answer 1,000 questions' },
  { key: 'streak_7',       icon: '🔥', title: 'On Fire',           desc: 'Keep a 7-day streak' },
  { key: 'streak_30',      icon: '⚡', title: 'Unstoppable',       desc: 'Keep a 30-day streak' },
  { key: 'first_exam',     icon: '🎓', title: 'Exam Ready',        desc: 'Complete your first mock exam' },
  { key: 'perfect_score',  icon: '⭐', title: 'Perfect Score',     desc: 'Score 100% on a quiz of 10+ questions' },
  { key: 'topic_cleared',  icon: '🧹', title: 'Weakness Conquered', desc: 'Turn a weak topic around' },
  { key: 'contest_winner', icon: '🥇', title: 'Champion',          desc: 'Win a contest' },
];
const BY_KEY = Object.fromEntries(ACHIEVEMENTS.map(a => [a.key, a]));

// Which achievements do these stats qualify for? (contest_winner is awarded directly when a contest settles.)
function evaluate(stats) {
  const out = [];
  if (stats.quizzes >= 1) out.push('first_quiz');
  if (stats.questions >= 100) out.push('q100');
  if (stats.questions >= 500) out.push('q500');
  if (stats.questions >= 1000) out.push('q1000');
  if (stats.streak >= 7) out.push('streak_7');
  if (stats.streak >= 30) out.push('streak_30');
  if (stats.exams >= 1) out.push('first_exam');
  if (stats.perfect) out.push('perfect_score');
  if (stats.topicsCleared >= 1) out.push('topic_cleared');
  return out;
}

async function loadStats(student) {
  const [agg, perfect, exams, cleared] = await Promise.all([
    Score.aggregate([{ $match: { matric: student.matric } }, { $group: { _id: null, quizzes: { $sum: 1 }, questions: { $sum: { $ifNull: ['$total', 0] } } } }]),
    Score.exists({ matric: student.matric, pct: 100, total: { $gte: 10 } }),
    Score.countDocuments({ matric: student.matric, mode: 'exam' }),
    RevisionTopic.countDocuments({ matric: student.matric, status: 'cleared' }),
  ]);
  return {
    quizzes: agg[0] ? agg[0].quizzes : 0,
    questions: agg[0] ? agg[0].questions : 0,
    streak: student.streakCount || 0,
    exams, perfect: !!perfect, topicsCleared: cleared,
  };
}

// Awards one achievement atomically (never twice, even under concurrent requests). Returns true if newly awarded.
async function award(matric, key) {
  const def = BY_KEY[key];
  if (!def) return false;
  const r = await Student.updateOne(
    { matric: String(matric).toUpperCase(), 'achievements.key': { $ne: key } },
    { $push: { achievements: { key, earnedAt: new Date() } } },
  );
  if (!r.modifiedCount) return false;
  notify({ matric, type: 'achievement', title: `${def.icon} Achievement unlocked: ${def.title}`, message: def.desc }).catch(() => {});
  logActivity({ actorType: 'student', actor: matric, action: `achievement.${key}` });
  return true;
}

// Checks everything and awards what's newly earned. Returns the newly earned definitions.
async function evaluateAndAward(student) {
  const stats = await loadStats(student);
  const have = new Set((student.achievements || []).map(a => a.key));
  const fresh = [];
  for (const key of evaluate(stats)) {
    if (have.has(key)) continue;
    if (await award(student.matric, key)) fresh.push(BY_KEY[key]);
  }
  return { fresh, stats };
}

module.exports = { ACHIEVEMENTS, BY_KEY, evaluate, loadStats, award, evaluateAndAward };
