const Student = require('../models/Student');
const StudentBackup = require('../models/StudentBackup');
const QuestionAttempt = require('../models/QuestionAttempt');
const Score = require('../models/Score');
const FlashcardProgress = require('../models/FlashcardProgress');
const Course = require('../models/Course');
const Settings = require('../models/Settings');
const DailyPlan = require('../models/DailyPlan');
const { canUse } = require('./entitlements.service');
const { getWeakTopics, courseKey, tagKey } = require('./weakTopics.service');
const { watDay } = require('./study.service');
const L = require('./autopilot.logic');

// ── Weakness Autopilot — data side (v1.9.0) ──────────────────────────────────────────────
// Gathers each student's real data, hands it to autopilot.logic.js to decide, and stores the result.
// "Nothing to configure": the plan appears on its own. Exam date and daily goal come from the settings
// the student already saved; if they haven't set an exam date the plan simply ranks by weakness.

const dayStart = day => new Date(`${day}T00:00:00+01:00`);          // WAT is UTC+1, no DST
const STUDENT_FIELDS = 'matric selectedCourses streakCount tier premiumPlan tierExpiresAt lastActiveAt';

// Latest attempt per question; the ones still wrong are the "missed" pool (capped like /api/questions/missed).
async function missedPool(matric) {
  const latest = await QuestionAttempt.aggregate([
    { $match: { matric, qid: { $ne: null } } },
    { $sort: { ts: -1 } },
    { $group: { _id: '$qid', correct: { $first: '$correct' }, ts: { $first: '$ts' } } },
    { $match: { correct: false } },
    { $sort: { ts: -1 } }, { $limit: 30 },
  ]);
  return { count: latest.length, qids: latest.map(l => String(l._id)) };
}

async function gatherInputs(student, settings, day) {
  const matric = student.matric;
  const week0 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const regKeys = (student.selectedCourses || []).map(L.normKey).filter(Boolean);
  const cardsEnabled = canUse(student, 'flashcards', settings);

  const [backup, weak, missed, courses, weekAgg, dueCards] = await Promise.all([
    StudentBackup.findOne({ matric }).select('settings').lean(),
    getWeakTopics(matric, L.MAX_WEAK_ITEMS),
    missedPool(matric),
    regKeys.length ? Course.find({ key: { $in: regKeys } }).select('key courseCode').lean() : [],
    QuestionAttempt.aggregate([{ $match: { matric, ts: { $gte: week0 } } }, { $addFields: { _c: courseKey } }, { $group: { _id: '$_c', n: { $sum: 1 } } }]),
    cardsEnabled && regKeys.length ? FlashcardProgress.countDocuments({ matric, course: { $in: regKeys }, dueDate: { $lte: new Date() } }) : 0,
  ]);

  const lastActive = student.lastActiveAt ? new Date(student.lastActiveAt).getTime() : null;
  return {
    day,
    exam: L.examFromSettings((backup && backup.settings) || {}, day),
    weakTopics: weak, missed, dueCards, cardsEnabled,
    registered: courses.map(c => ({ key: c.key, code: c.courseCode })),
    practicedWeek: Object.fromEntries(weekAgg.map(r => [r._id, r.n])),
    daysSinceActive: lastActive ? Math.floor((Date.now() - lastActive) / 86400000) : null,
  };
}

// Builds and stores today's plan. `overwrite` is true only for an explicit refresh; the nightly run and
// on-demand creation never replace a plan that already exists (so a rerun or a second server is harmless).
async function generateFor(student, { day = watDay(), source = 'ondemand', overwrite = false, settings = null } = {}) {
  const sets = settings || await Settings.getGlobal();
  const plan = L.buildAutopilotPlan(await gatherInputs(student, sets, day));
  const doc = { matric: student.matric, day, budgetMin: plan.budgetMin, totalMin: plan.totalMin, headline: plan.headline, items: plan.items, source, generatedAt: new Date() };
  try {
    if (overwrite) return await DailyPlan.findOneAndUpdate({ matric: student.matric, day }, { $set: doc }, { upsert: true, new: true }).lean();
    return await DailyPlan.findOneAndUpdate({ matric: student.matric, day }, { $setOnInsert: doc }, { upsert: true, new: true }).lean();
  } catch (e) {
    if (e && e.code === 11000) return DailyPlan.findOne({ matric: student.matric, day }).lean();   // another process created it first
    throw e;
  }
}

// What the student has really done today, in the shape markDone() expects.
async function activityFor(student, plan) {
  const matric = student.matric, since = dayStart(plan.day);
  const missedItem = (plan.items || []).find(i => i.type === 'missed');
  const regKeys = (student.selectedCourses || []).map(L.normKey).filter(Boolean);
  const hasCards = (plan.items || []).some(i => i.type === 'flashcards');

  const [rows, retried, cardsDueNow] = await Promise.all([
    QuestionAttempt.aggregate([
      { $match: { matric, ts: { $gte: since } } },
      { $addFields: { _c: courseKey, _t: tagKey } },
      { $group: { _id: { c: '$_c', t: '$_t' }, n: { $sum: 1 } } },
    ]),
    missedItem && (missedItem.qids || []).length
      ? QuestionAttempt.distinct('qid', { matric, ts: { $gte: since }, qid: { $in: missedItem.qids } }) : [],
    hasCards && regKeys.length ? FlashcardProgress.countDocuments({ matric, course: { $in: regKeys }, dueDate: { $lte: new Date() } }) : null,
  ]);

  const attemptsByKey = {}, attemptsByCourse = {};
  rows.forEach(r => {
    attemptsByKey[`${r._id.c}|${r._id.t}`] = (attemptsByKey[`${r._id.c}|${r._id.t}`] || 0) + r.n;
    attemptsByCourse[r._id.c] = (attemptsByCourse[r._id.c] || 0) + r.n;
  });
  return { attemptsByKey, attemptsByCourse, retriedQids: retried.length, cardsDueNow };
}

// Today's plan with live done-flags. Creates it on the spot if the nightly run hasn't (or couldn't) make one.
async function getToday(matric) {
  const [student, settings] = await Promise.all([Student.findOne({ matric }).select(STUDENT_FIELDS).lean(), Settings.getGlobal()]);
  if (!student) return null;
  const day = watDay();
  let plan = await DailyPlan.findOne({ matric: student.matric, day }).lean();
  if (!plan) plan = await generateFor(student, { day, source: 'ondemand', settings });
  const marked = L.markDone(plan, await activityFor(student, plan));
  return { ...marked, generatedAt: plan.generatedAt, source: plan.source, streak: student.streakCount || 0 };
}

async function refreshToday(matric) {
  const student = await Student.findOne({ matric }).select(STUDENT_FIELDS).lean();
  if (!student) return null;
  const plan = await generateFor(student, { source: 'refresh', overwrite: true });
  return { ...L.markDone(plan, await activityFor(student, plan)), generatedAt: plan.generatedAt, source: plan.source, streak: student.streakCount || 0 };
}

// Overnight batch: every student active in the last `activeDays` days who has picked courses and whose plan includes the
// study plan. A small worker pool keeps database load steady; one student failing never stops the run.
async function runNightly({ concurrency = 4, activeDays = 21 } = {}) {
  const day = watDay(), settings = await Settings.getGlobal();
  const cutoff = new Date(Date.now() - activeDays * 24 * 60 * 60 * 1000);
  const cursor = Student.find({ lastActiveAt: { $gte: cutoff }, 'selectedCourses.0': { $exists: true } }).select(STUDENT_FIELDS).lean().cursor();
  const stats = { built: 0, skipped: 0, failed: 0 };
  const inflight = new Set();
  const work = async student => {
    try {
      if (!canUse(student, 'studyPlan', settings)) { stats.skipped++; return; }
      await generateFor(student, { day, source: 'nightly', settings });
      stats.built++;
    } catch (e) { stats.failed++; console.error('[autopilot] plan failed for', student.matric, e.message); }
  };
  for await (const student of cursor) {
    const p = work(student).finally(() => inflight.delete(p));
    inflight.add(p);
    if (inflight.size >= concurrency) await Promise.race(inflight);
  }
  await Promise.all(inflight);
  return { day, ...stats };
}

module.exports = { generateFor, getToday, refreshToday, runNightly, gatherInputs, activityFor };
