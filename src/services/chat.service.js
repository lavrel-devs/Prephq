const Settings = require('../models/Settings');
const ChatMessage = require('../models/ChatMessage');
const { watDateString } = require('./credit.service');
const { chatReply } = require('./groq.service');
const { getTierLimits, ensureTierCurrent } = require('./tier.service');

function watMonthString(d = new Date()) {
  return watDateString(d).slice(0, 7); // YYYY-MM
}

// Checks the student's daily/monthly counters against admin-configured
// limits, resetting each counter when its window has rolled over (WAT
// day for daily, WAT month for monthly). Throws with `.code` =
// 'LIMIT_REACHED' if either cap is hit. Does NOT increment — call
// incrementUsage() only after a reply actually succeeds, so a failed
// Groq call doesn't burn the student's quota.
//
// v1.4: the daily cap is now tier-aware (Settings.tiers.<tier>.
// dailyAIChatMessages — null means unlimited for that tier). The
// monthly cap stays a single global safety ceiling regardless of tier.
async function checkUsageLimit(student) {
  const settings = await Settings.getGlobal();
  if (!settings.aiChatbot.enabled) {
    const err = new Error('The AI study assistant is currently disabled');
    err.code = 'CHATBOT_DISABLED';
    throw err;
  }

  await ensureTierCurrent(student);
  const today = watDateString();
  const thisMonth = watMonthString();

  if (student.aiChatDailyDate !== today) { student.aiChatDailyCount = 0; student.aiChatDailyDate = today; }
  if (student.aiChatMonthlyMonth !== thisMonth) { student.aiChatMonthlyCount = 0; student.aiChatMonthlyMonth = thisMonth; }

  const { dailyAIChatMessages } = await getTierLimits(student);

  if (dailyAIChatMessages != null && student.aiChatDailyCount >= dailyAIChatMessages) {
    const err = new Error(`Daily limit reached (${dailyAIChatMessages} messages/day on your current plan). Upgrade to keep chatting today, or try again tomorrow.`);
    err.code = 'LIMIT_REACHED';
    err.tier = student.tier;
    throw err;
  }
  if (student.aiChatMonthlyCount >= settings.aiChatbot.monthlyLimit) {
    const err = new Error(`Monthly limit reached (${settings.aiChatbot.monthlyLimit} messages/month). Try again next month.`);
    err.code = 'LIMIT_REACHED';
    throw err;
  }

  return {
    dailyRemaining: dailyAIChatMessages == null ? null : dailyAIChatMessages - student.aiChatDailyCount,
    monthlyRemaining: settings.aiChatbot.monthlyLimit - student.aiChatMonthlyCount,
  };
}

async function incrementUsage(student) {
  student.aiChatDailyCount += 1;
  student.aiChatMonthlyCount += 1;
  await student.save();
}

// Sends a message, persists both sides, enforces + increments usage.
// Returns { reply, dailyRemaining, monthlyRemaining }.
async function sendMessage(student, content) {
  await checkUsageLimit(student); // throws before we touch the DB or call Groq if already over limit

  const recentHistory = await ChatMessage.find({ matric: student.matric })
    .sort({ ts: -1 }).limit(12).lean();
  recentHistory.reverse(); // oldest first for the model

  const reply = await chatReply([...recentHistory, { role: 'user', content }]);

  await ChatMessage.create({ matric: student.matric, role: 'user', content });
  await ChatMessage.create({ matric: student.matric, role: 'assistant', content: reply });
  await incrementUsage(student);

  const settings = await Settings.getGlobal();
  const { dailyAIChatMessages } = await getTierLimits(student);
  return {
    reply,
    dailyRemaining: dailyAIChatMessages == null ? null : dailyAIChatMessages - student.aiChatDailyCount,
    monthlyRemaining: settings.aiChatbot.monthlyLimit - student.aiChatMonthlyCount,
  };
}

module.exports = { checkUsageLimit, incrementUsage, sendMessage };
