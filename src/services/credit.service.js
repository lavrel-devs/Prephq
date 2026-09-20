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
  if (typeof referralCodeUsed === 'string' && referralCodeUsed.trim()) {
    referrer = await Student.findOne({ referralCode: referralCodeUsed.trim().toUpperCase() });
    if (referrer && referrer.matric === student.matric) referrer = null; // can't refer yourself
    if (referrer) student.referredBy = referrer._id;
  }

  await student.save();

  // Welcome bonus (+ referee bonus stacked on top if applicable).
  const refereeBonusApplies = !!referrer && settings.referral.enabled;
  const welcomeAmount = settings.welcomeBonus + (refereeBonusApplies ? settings.referral.refereeBonus : 0);

  if (welcomeAmount > 0) await applyCreditDelta({
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
  if (referrer && settings.referral.enabled && settings.referral.referrerReward > 0) {
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

// Start of the given WAT calendar day, as a real instant.
function watDayStart(dateStr) {
  return new Date(`${dateStr}T00:00:00+01:00`);
}

async function maybeApplyDailyRefresh(student, settingsArg = null) {
  const settings = settingsArg || await Settings.getGlobal();
  if (!settings.dailyRefresh.enabled) return { applied: false };

  const today = watDateString();
  const lastRefresh = student.lastDailyRefresh ? watDateString(student.lastDailyRefresh) : null;
  if (lastRefresh === today) return { applied: false }; // already refreshed today, credits don't stack

  // Claim today's refresh atomically. The old version checked the date
  // in memory and saved afterwards, so two overlapping /api/me calls (two
  // tabs, or the app + the midnight cron) each saw "not refreshed yet"
  // and both paid out. Only the request whose conditional update
  // actually matches gets to apply the credit.
  const previous = student.lastDailyRefresh || null;
  const claimedAt = new Date();
  const claimed = await Student.findOneAndUpdate(
    { _id: student._id, $or: [{ lastDailyRefresh: null }, { lastDailyRefresh: { $lt: watDayStart(today) } }] },
    { $set: { lastDailyRefresh: claimedAt } },
    { new: true, projection: { _id: 1 } },
  );
  if (!claimed) return { applied: false };
  student.set('lastDailyRefresh', claimedAt);
  student.unmarkModified('lastDailyRefresh');

  let balance;
  try {
    ({ balance } = await applyCreditDelta({
      matric: student.matric,
      delta: settings.dailyRefresh.amount,
      reason: 'daily_refresh',
      note: 'Daily free credit refresh',
      actor: 'system',
      studentDoc: student,
    }));
  } catch (e) {
    // Credit failed — give the day's refresh back so it can be retried.
    await Student.updateOne({ _id: student._id }, { $set: { lastDailyRefresh: previous } }).catch(() => {});
    throw e;
  }

  await notify({
    matric: student.matric,
    type: 'daily_credit',
    title: 'Daily credits added',
    message: `+${settings.dailyRefresh.amount} credits added to your balance`,
  }).catch(() => {});

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

  // Stream students instead of loading the whole collection, and keep
  // going if one account fails — a single bad record used to abort the
  // loop and leave everyone after it without their daily credits.
  let applied = 0;
  let failed = 0;
  const cursor = Student.find({ active: { $ne: false } }).cursor();
  for (let student = await cursor.next(); student; student = await cursor.next()) {
    try {
      const r = await maybeApplyDailyRefresh(student, settings);
      if (r.applied) applied++;
    } catch (e) {
      failed++;
      console.error(`[credit.service] Daily refresh failed for ${student.matric}:`, e.message);
    }
  }

  return { applied, failed };
}

// ── Streak tracking + milestone bonus ────────────────────────────
// Called from GET /api/me, same as the lazy daily refresh. Uses WAT
// calendar days (consistent with the daily refresh) so "today" means
// the same thing across every credit-economy feature. Idempotent per
// day — calling this multiple times in one day is a no-op after the
// first call.
async function updateStreak(student) {
  const settings = await Settings.getGlobal();
  const today = watDateString();

  if (student.streakLastDate === today) {
    return { count: student.streakCount, milestoneHit: false, bonusAwarded: 0 };
  }

  const yesterday = watDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const nextCount = student.streakLastDate === yesterday ? student.streakCount + 1 : 1;

  // Claim today atomically (same double-fire problem as the daily
  // refresh: two overlapping /api/me calls could both award the
  // milestone bonus).
  const claimed = await Student.findOneAndUpdate(
    { _id: student._id, streakLastDate: { $ne: today } },
    { $set: { streakLastDate: today, streakCount: nextCount } },
    { new: true, projection: { streakCount: 1 } },
  );
  if (!claimed) {
    const fresh = await Student.findById(student._id).select('streakCount streakLastDate').lean();
    return { count: fresh ? fresh.streakCount : student.streakCount, milestoneHit: false, bonusAwarded: 0 };
  }
  student.set('streakLastDate', today);
  student.set('streakCount', nextCount);
  student.unmarkModified('streakLastDate');
  student.unmarkModified('streakCount');

  const milestoneDays = settings.streakBonus.milestoneDays || 7;
  const milestoneHit = settings.streakBonus.enabled
    && milestoneDays > 0
    && nextCount > 0
    && nextCount % milestoneDays === 0;

  let bonusAwarded = 0;
  if (milestoneHit && settings.streakBonus.amount > 0) {
    bonusAwarded = settings.streakBonus.amount;
    await applyCreditDelta({
      matric: student.matric,
      delta: bonusAwarded,
      reason: 'bonus',
      note: `${nextCount}-day streak bonus`,
      actor: 'system',
      studentDoc: student,
    });
    await notify({
      matric: student.matric,
      type: 'daily_credit',
      title: `${nextCount}-day streak! 🔥`,
      message: `+${bonusAwarded} bonus credits for staying consistent`,
    }).catch(() => {});
  }

  return { count: nextCount, milestoneHit, bonusAwarded };
}

module.exports = {
  activateNewStudent,
  maybeApplyDailyRefresh,
  runBulkDailyRefresh,
  updateStreak,
  watDateString,
};
