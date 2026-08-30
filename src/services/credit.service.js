const Student = require('../models/Student');
const Settings = require('../models/Settings');
const { applyCreditDelta } = require('../utils/credits');
const { generateUniqueReferralCode } = require('../utils/referral');
const { notify } = require('./notification.service');

// ── Welcome bonus + referral payout ─────────────────────────────
// Called once, right after a new Student doc is created during
// registration. Handles:
//   - assigning the new student their own referralCode
//   - crediting the welcome bonus (+ referee bonus on top, if they
//     signed up via a referral link)
//   - crediting the referrer's reward
// All amounts come from Settings so admins can change them without a
// redeploy. If referral is disabled in Settings, `referredBy` is still
// recorded (so it doesn't get lost) but no bonus is paid.
async function activateNewStudent(student, referralCodeUsed) {
  const settings = await Settings.getGlobal();

  // Assign a permanent referral code for this student's own future referrals.
  student.referralCode = await generateUniqueReferralCode();

  let referrer = null;
  if (referralCodeUsed) {
    referrer = await Student.findOne({ referralCode: referralCodeUsed.trim().toUpperCase() });
    if (referrer && referrer.matric === student.matric) referrer = null; // can't refer yourself
    if (referrer) student.referredBy = referrer._id;
  }

  await student.save();

  // Welcome bonus (+ referee bonus stacked on top if applicable).
  const refereeBonusApplies = !!referrer && settings.referral.enabled;
  const welcomeAmount = settings.welcomeBonus + (refereeBonusApplies ? settings.referral.refereeBonus : 0);

  await applyCreditDelta({
    matric: student.matric,
    delta: welcomeAmount,
    reason: 'welcome_bonus',
    note: refereeBonusApplies
      ? `Welcome bonus (${settings.welcomeBonus}) + referral signup bonus (${settings.referral.refereeBonus})`
      : 'Welcome bonus',
    actor: 'system',
  });

  // Referrer's reward — only paid once the referee has actually
  // activated (this function running IS activation), per spec.
  if (referrer && settings.referral.enabled) {
    await applyCreditDelta({
      matric: referrer.matric,
      delta: settings.referral.referrerReward,
      reason: 'referral_bonus',
      note: `Referral reward — ${student.matric} signed up and activated using your link`,
      actor: 'system',
    });
  }

  return { referrer };
}

// ── Daily refresh: lazy per-user check ──────────────────────────
// Called from GET /api/me (and anywhere else that loads the current
// student) so a user's credits top up the moment they show up for the
// day, without waiting on the cron job. Idempotent — checks
// lastDailyRefresh against "today" in WAT (UTC+1) before applying.
// The cron job (scheduler.service.js) does the same thing in bulk at
// midnight WAT for users who aren't actively using the app right then.
function watDateString(d = new Date()) {
  // WAT = UTC+1, no DST. Shift by 1hr then take the UTC date string.
  const shifted = new Date(d.getTime() + 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10); // YYYY-MM-DD in WAT
}

async function maybeApplyDailyRefresh(student) {
  const settings = await Settings.getGlobal();
  if (!settings.dailyRefresh.enabled) return { applied: false };

  const today = watDateString();
  const lastRefresh = student.lastDailyRefresh ? watDateString(student.lastDailyRefresh) : null;
  if (lastRefresh === today) return { applied: false }; // already refreshed today, credits don't stack

  student.lastDailyRefresh = new Date();
  await student.save();

  const { balance } = await applyCreditDelta({
    matric: student.matric,
    delta: settings.dailyRefresh.amount,
    reason: 'daily_refresh',
    note: 'Daily free credit refresh',
    actor: 'system',
    studentDoc: student,
  });

  await notify({
    matric: student.matric,
    type: 'daily_credit',
    title: 'Daily credits added',
    message: `+${settings.dailyRefresh.amount} credits added to your balance`,
  });

  return { applied: true, amount: settings.dailyRefresh.amount, balance };
}

// ── Daily refresh: bulk batch (used by the midnight cron job) ───
// Applies the refresh to every active student who hasn't received it
// yet today, in one pass. Students who log in before the cron runs
// already got it via maybeApplyDailyRefresh, so this only catches
// everyone else once WAT midnight ticks over.
async function runBulkDailyRefresh() {
  const settings = await Settings.getGlobal();
  if (!settings.dailyRefresh.enabled) return { applied: 0, skipped: 'disabled' };

  const today = watDateString();
  const students = await Student.find({ isActive: { $ne: false } });

  let applied = 0;
  for (const student of students) {
    const lastRefresh = student.lastDailyRefresh ? watDateString(student.lastDailyRefresh) : null;
    if (lastRefresh === today) continue;

    student.lastDailyRefresh = new Date();
    await student.save();
    await applyCreditDelta({
      matric: student.matric,
      delta: settings.dailyRefresh.amount,
      reason: 'daily_refresh',
      note: 'Daily free credit refresh',
      actor: 'system',
      studentDoc: student,
    });
    await notify({
      matric: student.matric,
      type: 'daily_credit',
      title: 'Daily credits added',
      message: `+${settings.dailyRefresh.amount} credits added to your balance`,
    });
    applied++;
  }

  return { applied };
}

module.exports = {
  activateNewStudent,
  maybeApplyDailyRefresh,
  runBulkDailyRefresh,
  watDateString,
};
