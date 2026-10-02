const Settings = require('../models/Settings');
const Student = require('../models/Student');
const { watDateString } = require('./credit.service');
const { resolvePlan } = require('./entitlements.service');

// ── Tier service ──────────────────────────────────────────────
// v1.4. Central place for subscription-tier daily usage limits.
// Free tier: capped daily questions/AI quizzes/AI chat messages.
// Premium: whatever Settings.tiers.premium says (default: unlimited,
// admin-editable). A `null` limit means unlimited.
//
// Pattern mirrors the existing aiChatDailyCount logic in
// chat.service.js: check BEFORE the action (throws if over cap),
// increment AFTER it actually succeeds.

// Auto-revert an expired paid tier back to free. Called lazily
// whenever we touch a student's tier, so no cron job is required.
async function ensureTierCurrent(student) {
  // Lifetime never expires. Only recurring premium periods (or manual grants with an
  // end date) fall back to free.
  if (student.tier !== 'free' && student.premiumPlan !== 'lifetime' && student.tierExpiresAt && new Date() > student.tierExpiresAt) {
    // Conditional update: don't clobber a renewal an admin applied a
    // moment ago (the in-memory doc may already be stale).
    await Student.updateOne(
      { _id: student._id, premiumPlan: { $ne: 'lifetime' }, tierExpiresAt: { $lte: new Date() } },
      { $set: { tier: 'free', tierExpiresAt: null, premiumPlan: null } },
    );
    for (const f of ['tier', 'tierExpiresAt', 'premiumPlan']) {
      student.set(f, f === 'tier' ? 'free' : null);
      student.unmarkModified(f);
    }
  }
  return student;
}

async function getTierLimits(student) {
  const settings = await Settings.getGlobal();
  const tier = settings.tiers[resolvePlan(student)] || settings.tiers.free;
  return {
    dailyQuestions: tier.dailyQuestions ?? null,
    dailyAIQuizzes: tier.dailyAIQuizzes ?? null,
    dailyAIChatMessages: tier.dailyAIChatMessages ?? null,
  };
}

// kind: 'questions' | 'aiQuiz'. Chat has its own dedicated flow in
// chat.service.js since it already carries a monthly cap too.
const COUNTER_FIELDS = {
  questions: { countField: 'dailyQuestionCount', dateField: 'dailyQuestionDate', limitKey: 'dailyQuestions', label: 'questions' },
  aiQuiz:    { countField: 'dailyAIQuizCount',    dateField: 'dailyAIQuizDate',    limitKey: 'dailyAIQuizzes', label: 'AI quizzes' },
};

// Resets the counter if the WAT day has rolled over, then checks it
// against the tier limit. Throws with .code = 'LIMIT_REACHED' if the
// student is already at/over cap. Does NOT increment — callers should
// only call incrementDailyUsage() once the gated action has actually
// succeeded (same pattern as the AI chatbot limiter).
async function checkDailyLimit(student, kind, amount = 1) {
  await ensureTierCurrent(student);
  const { countField, dateField, limitKey, label } = COUNTER_FIELDS[kind];
  const today = watDateString();

  if (student[dateField] !== today) { student[countField] = 0; student[dateField] = today; }

  const limits = await getTierLimits(student);
  const limit = limits[limitKey];

  if (limit != null && student[countField] + amount > limit) {
    const err = new Error(`Daily ${label} limit reached (${limit}/day on your current plan). Upgrade to keep going today, or try again tomorrow.`);
    err.code = 'LIMIT_REACHED';
    err.tier = student.tier;
    err.limit = limit;
    err.used = student[countField];
    throw err;
  }

  return { remaining: limit == null ? null : limit - student[countField] };
}

// Atomically bumps a "count within a window" counter (window key =
// a WAT date/month string). If the stored window is the current one the
// count is $inc'd; otherwise the window rolls over and the count
// restarts at `amount`. The old `student[field] += amount; save()` wrote
// an absolute number computed from a possibly stale document, so
// parallel requests under-counted and the daily caps could be
// out-run. The in-memory doc is synced without being marked dirty.
async function bumpCounter(student, countField, keyField, keyValue, amount = 1) {
  const projection = { [countField]: 1, [keyField]: 1 };
  let doc = await Student.findOneAndUpdate(
    { _id: student._id, [keyField]: keyValue },
    { $inc: { [countField]: amount } },
    { new: true, projection },
  );
  if (!doc) {
    doc = await Student.findOneAndUpdate(
      { _id: student._id },
      { $set: { [keyField]: keyValue, [countField]: amount } },
      { new: true, projection },
    );
  }
  if (doc) {
    student.set(countField, doc[countField]);
    student.set(keyField, keyValue);
    student.unmarkModified(countField);
    student.unmarkModified(keyField);
  }
  return doc ? doc[countField] : null;
}

async function incrementDailyUsage(student, kind, amount = 1) {
  const { countField, dateField } = COUNTER_FIELDS[kind];
  await bumpCounter(student, countField, dateField, watDateString(), amount);
}

// Full usage snapshot for a student — powers GET /api/usage/limits so
// the frontend can proactively show/hide the upgrade paywall before a
// student even starts an action, not just after a 403 comes back.
async function usageSnapshot(student) {
  await ensureTierCurrent(student);
  const today = watDateString();
  const limits = await getTierLimits(student);

  const questionsUsed = student.dailyQuestionDate === today ? student.dailyQuestionCount : 0;
  const aiQuizUsed = student.dailyAIQuizDate === today ? student.dailyAIQuizCount : 0;
  const aiChatUsed = student.aiChatDailyDate === today ? student.aiChatDailyCount : 0;

  return {
    tier: resolvePlan(student),
    premiumPlan: student.premiumPlan || null,
    tierExpiresAt: student.premiumPlan === 'lifetime' ? null : student.tierExpiresAt,
    questions: { used: questionsUsed, limit: limits.dailyQuestions },
    aiQuizzes: { used: aiQuizUsed, limit: limits.dailyAIQuizzes },
    aiChatMessages: { used: aiChatUsed, limit: limits.dailyAIChatMessages },
  };
}

module.exports = { ensureTierCurrent, getTierLimits, checkDailyLimit, incrementDailyUsage, usageSnapshot, bumpCounter };
