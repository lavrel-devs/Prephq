const StudentMemory = require('../models/StudentMemory');
const QuestionAttempt = require('../models/QuestionAttempt');
const GuessFlag = require('../models/GuessFlag');
const Settings = require('../models/Settings');
const { brainiacReply, extractStudentFacts, SCI_FORMAT } = require('./groq.service');
const { checkUsageLimit, incrementUsage, getQuota } = require('./chat.service');
const { withLock } = require('../utils/lock');
const L = require('./brainiac.logic');

const DAY = 24 * 60 * 60 * 1000;
const LEARN_EVERY = 6;   // student messages between "what did I learn?" passes

async function getMemory(matric) {
  return StudentMemory.findOneAndUpdate({ matric }, { $setOnInsert: { matric } }, { new: true, upsert: true, setDefaultsOnInsert: true });
}

// WAT (UTC+1) calendar day 'YYYY-MM-DD', same convention as engagement.service
const watDateString = (d) => new Date(d.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
const watHour = (now) => new Date(now.getTime() + 60 * 60 * 1000).getUTCHours();   // WAT = UTC+1

// Everything Brainiac "knows" right now, from data the app already has. Missing data (no topic tags, a brand-new
// student) just leaves fields null — the logic copes.
async function buildSnapshot(student, mem, now = new Date()) {
  const matric = student.matric;
  const since7 = new Date(now.getTime() - 7 * DAY), since14 = new Date(now.getTime() - 14 * DAY), since30 = new Date(now.getTime() - 30 * DAY);
  const today = watDateString(now);
  const tz = 'Africa/Lagos';

  const [last, weeks, todayRows, weak, guessN, guessTags] = await Promise.all([
    QuestionAttempt.findOne({ matric }).sort({ ts: -1 }).select('ts').lean(),
    QuestionAttempt.aggregate([
      { $match: { matric, ts: { $gte: since14 } } },
      { $group: { _id: { $cond: [{ $gte: ['$ts', since7] }, 'this', 'prev'] }, n: { $sum: 1 }, right: { $sum: { $cond: ['$correct', 1, 0] } } } },
    ]),
    QuestionAttempt.aggregate([
      { $match: { matric, ts: { $gte: new Date(now.getTime() - 36 * 60 * 60 * 1000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$ts', timezone: tz } }, n: { $sum: 1 } } },
    ]),
    QuestionAttempt.aggregate([
      { $match: { matric, ts: { $gte: since30 }, tag: { $nin: [null, ''] } } },
      { $group: { _id: { course: '$course', tag: '$tag' }, n: { $sum: 1 }, right: { $sum: { $cond: ['$correct', 1, 0] } } } },
      { $match: { n: { $gte: 4 } } },
      { $addFields: { acc: { $divide: ['$right', '$n'] } } },
      { $match: { acc: { $lt: 0.6 } } },
      { $sort: { acc: 1, n: -1 } }, { $limit: 3 },
    ]),
    GuessFlag.countDocuments({ matric }),
    GuessFlag.aggregate([{ $match: { matric, tag: { $ne: '' } } }, { $group: { _id: '$tag', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 3 }]),
  ]);

  const wk = Object.fromEntries(weeks.map(w => [w._id, w]));
  const acc = w => (w && w.n ? (w.right / w.n) * 100 : null);
  const lastDay = last ? watDateString(last.ts) : null;
  return {
    name: student.name, today, hour: watHour(now),
    university: student.university, department: student.department, courses: student.selectedCourses || [],
    gpa: { current: student.currentGPA, target: student.targetGPA },
    streak: { count: student.streakCount || 0, last: student.streakLastDate || null },
    studiedToday: (todayRows.find(r => r._id === today) || {}).n || 0,
    daysAway: lastDay ? L.dayDiff(today, lastDay) : null,
    attempts7: wk.this ? wk.this.n : 0, attemptsPrev: wk.prev ? wk.prev.n : 0,
    acc7: acc(wk.this), accPrev: acc(wk.prev),
    weak: weak.map(w => ({ course: w._id.course, tag: w._id.tag, acc: w.acc, n: w.n })),
    guessN, guessTags: guessTags.map(g => g._id),
    introduced: !!mem.introducedAt,
  };
}

// GET /brainiac/pulse — up to 2 nudges the student hasn't seen lately. Logged so the same one isn't repeated.
async function pulse(student, now = new Date()) {
  const mem = await getMemory(student.matric);
  if (!mem.enabled || !mem.nudges) return [];
  const snap = await buildSnapshot(student, mem, now);
  const recent = (mem.nudgeLog || []).filter(x => now - x.ts < 36 * 60 * 60 * 1000).map(x => x.id);
  const nudges = L.buildPulse(snap, recent).slice(0, 2);
  if (nudges.length) {
    const set = nudges[0].id === 'welcome' ? { introducedAt: now } : {};
    await StudentMemory.updateOne({ matric: student.matric }, {
      $push: { nudgeLog: { $each: [{ id: nudges[0].id, ts: now }], $slice: -30 } },
      ...(Object.keys(set).length ? { $set: set } : {}),
    });
  }
  return nudges;
}

// POST /brainiac/chat. Shares the daily AI-chat allowance with the Study Assistant (so Groq spend stays bounded);
// nudges, reactions and quick actions never touch it.
async function chat(student, message, context) {
  return withLock(`brainiac:${student.matric}`, async () => {
    await checkUsageLimit(student);   // throws LIMIT_REACHED / CHATBOT_DISABLED before anything else happens
    const mem = await getMemory(student.matric);
    const snap = await buildSnapshot(student, mem);
    const system = L.buildSystemPrompt({ snap, facts: mem.learn ? (mem.facts || []).map(f => f.text) : [], ctx: L.sanitizeContext(context), sciFormat: SCI_FORMAT });
    const history = (mem.recent || []).slice(-10).map(m => ({ role: m.role, content: m.content }));
    const raw = await brainiacReply([...history, { role: 'user', content: message }], { system });
    const { mood, text } = L.parseMood(raw);

    const now = new Date();
    await StudentMemory.updateOne({ matric: student.matric }, {
      $push: { recent: { $each: [{ role: 'user', content: message, ts: now }, { role: 'assistant', content: text, ts: now }], $slice: -20 } },
      $inc: { msgsSinceLearn: 1 }, $set: { lastChatAt: now },
    });
    await incrementUsage(student);
    if (mem.learn) maybeLearn(student.matric).catch(e => console.error('[brainiac] learn failed:', e.message));
    const q = await getQuota(student);
    return { reply: text, mood, dailyRemaining: q.dailyRemaining };
  });
}

// Every few messages, pull durable facts out of what the student said. Runs in the background, low priority;
// a failure just means Brainiac learns a little later.
async function maybeLearn(matric) {
  const claimed = await StudentMemory.updateOne({ matric, learn: true, msgsSinceLearn: { $gte: LEARN_EVERY } }, { $set: { msgsSinceLearn: 0 } });
  if (!claimed.modifiedCount) return;
  const mem = await StudentMemory.findOne({ matric }).lean();
  const said = (mem.recent || []).filter(m => m.role === 'user').slice(-8).map(m => m.content);
  if (!said.length) return;
  const known = (mem.facts || []).map(f => f.text);
  const facts = L.sanitizeFacts(await extractStudentFacts(said, known), known);
  if (facts.length) await StudentMemory.updateOne({ matric }, { $push: { facts: { $each: facts.map(text => ({ text, ts: new Date() })), $slice: -40 } } });
}

module.exports = { getMemory, buildSnapshot, pulse, chat, maybeLearn };
