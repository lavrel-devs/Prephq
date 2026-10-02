const express = require('express');
const Settings = require('../../models/Settings');
const { requireAdmin } = require('../../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

// ══════════════════════════════════════════════════════════════
//  CREDIT ECONOMY SETTINGS
//  (daily refresh toggle/amount, referral toggle/amounts, welcome
//  bonus amount — all runtime-configurable, no redeploy needed)
// ══════════════════════════════════════════════════════════════

// GET /api/admin/credit-settings
router.get('/credit-settings', async (req, res) => {
  try {
    const settings = await Settings.getGlobal();
    const { FEATURES } = require('../../services/entitlements.service');
    res.json({ ...settings.toObject(), featureDefs: FEATURES.map(f => ({ key: f.key, label: f.label })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/credit-settings — partial update, any subset of fields.
// Body shape mirrors the Settings schema:
// { dailyRefresh: { enabled, amount }, referral: { enabled, referrerReward, refereeBonus }, welcomeBonus }
router.put('/credit-settings', async (req, res) => {
  try {
    const settings = await Settings.getGlobal();
    const { dailyRefresh, referral, welcomeBonus, streakBonus, aiChatbot, tiers, support, notes } = req.body;

    if (dailyRefresh) {
      if (typeof dailyRefresh.enabled === 'boolean') settings.dailyRefresh.enabled = dailyRefresh.enabled;
      if (Number.isFinite(dailyRefresh.amount) && dailyRefresh.amount >= 0) settings.dailyRefresh.amount = dailyRefresh.amount;
    }
    if (referral) {
      if (typeof referral.enabled === 'boolean') settings.referral.enabled = referral.enabled;
      if (Number.isFinite(referral.referrerReward) && referral.referrerReward >= 0) settings.referral.referrerReward = referral.referrerReward;
      if (Number.isFinite(referral.refereeBonus) && referral.refereeBonus >= 0) settings.referral.refereeBonus = referral.refereeBonus;
    }
    if (streakBonus) {
      if (typeof streakBonus.enabled === 'boolean') settings.streakBonus.enabled = streakBonus.enabled;
      if (Number.isFinite(streakBonus.milestoneDays) && streakBonus.milestoneDays > 0) settings.streakBonus.milestoneDays = streakBonus.milestoneDays;
      if (Number.isFinite(streakBonus.amount) && streakBonus.amount >= 0) settings.streakBonus.amount = streakBonus.amount;
    }
    if (Number.isFinite(welcomeBonus) && welcomeBonus >= 0) settings.welcomeBonus = welcomeBonus;
    if (notes && typeof notes === 'object') {
      if (typeof notes.enabled === 'boolean') settings.notes.enabled = notes.enabled;
      for (const k of ['costQuick', 'costStandard', 'costDetailed']) {
        if (Number.isFinite(notes[k]) && notes[k] >= 0 && notes[k] <= 1000) settings.notes[k] = Math.round(notes[k]);
      }
    }
    if (aiChatbot) {
      if (typeof aiChatbot.enabled === 'boolean') settings.aiChatbot.enabled = aiChatbot.enabled;
      if (Number.isFinite(aiChatbot.dailyLimit) && aiChatbot.dailyLimit >= 0) settings.aiChatbot.dailyLimit = aiChatbot.dailyLimit;
      if (Number.isFinite(aiChatbot.monthlyLimit) && aiChatbot.monthlyLimit >= 0) settings.aiChatbot.monthlyLimit = aiChatbot.monthlyLimit;
    }

    // Tier limits, Premium prices and Free-plan feature switches — all admin-editable, no redeploy.
    // Accepts a partial shape, e.g. { premium: { priceWeekly: 500 }, free: { features: { flashcards: true } } }.
    if (tiers) {
      const { FEATURE_KEYS } = require('../../services/entitlements.service');
      const PRICE_FIELDS = ['priceWeekly', 'priceMonthly', 'priceYearly', 'priceLifetime'];
      for (const tierName of ['free', 'premium']) {
        const incoming = tiers[tierName];
        if (!incoming || typeof incoming !== 'object') continue;
        const current = settings.tiers[tierName];
        const fields = ['dailyQuestions', 'dailyAIQuizzes', 'dailyAIChatMessages', ...(tierName === 'premium' ? PRICE_FIELDS : [])];
        for (const field of fields) {
          if (!(field in incoming)) continue;
          const val = incoming[field];
          // null means "unlimited" for daily* fields and "not offered" for prices.
          if (val === null) { current[field] = null; continue; }
          if (Number.isFinite(val) && val >= 0) current[field] = val;
        }
        if (tierName === 'free' && incoming.features && typeof incoming.features === 'object') {
          for (const key of FEATURE_KEYS) {
            if (typeof incoming.features[key] === 'boolean') current.features[key] = incoming.features[key];
          }
        }
      }
    }

    if (support && typeof support.whatsapp === 'string') {
      settings.support.whatsapp = support.whatsapp.replace(/[^0-9]/g, '');
    }

    settings.updatedBy = req.admin.sub;
    await settings.save();

    res.json(settings);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  REFERRAL LEADERBOARD (v1.7) — termly prize settlement
// ══════════════════════════════════════════════════════════════
const Student = require('../../models/Student');
const { applyCreditDelta } = require('../../utils/credits');

// GET /api/admin/referral-leaderboard — same ranking the student endpoint shows, for the admin to preview
// before settling. Includes everyone with a referral this period regardless of the opt-in flag (the
// student leaderboard hides opted-out students; the admin still needs to see the real numbers to pay out).
router.get('/referral-leaderboard', async (req, res) => {
  try {
    const settings = await Settings.getGlobal();
    const periodStart = settings.referral.leaderboard.periodStart || new Date(0);
    const agg = await Student.aggregate([
      { $match: { referredBy: { $ne: null }, createdAt: { $gte: periodStart } } },
      { $group: { _id: '$referredBy', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 50 },
    ]);
    const referrers = await Student.find({ _id: { $in: agg.map(r => r._id) } }).select('matric username displayName').lean();
    const byId = Object.fromEntries(referrers.map(s => [String(s._id), s]));
    const prizes = settings.referral.leaderboard.prizes || [];
    res.json({
      periodStart, prizes,
      leaderboard: agg.map((r, i) => ({
        rank: i + 1, referrals: r.n, prize: prizes[i] || 0,
        matric: byId[String(r._id)]?.matric || '', name: byId[String(r._id)]?.displayName || byId[String(r._id)]?.username || 'Unknown',
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/referral-leaderboard/prizes  { prizes: [number, ...] } — credits for 1st, 2nd, 3rd, ...
router.put('/referral-leaderboard/prizes', async (req, res) => {
  try {
    const prizes = Array.isArray(req.body.prizes) ? req.body.prizes.slice(0, 10).map(n => Math.max(0, Math.round(Number(n) || 0))) : null;
    if (!prizes) return res.status(400).json({ error: 'prizes must be an array of numbers' });
    const settings = await Settings.getGlobal();
    settings.referral.leaderboard.prizes = prizes;
    settings.updatedBy = req.admin.sub;
    await settings.save();
    res.json({ prizes: settings.referral.leaderboard.prizes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/referral-leaderboard/settle — pays out the current top referrers per the configured
// prizes, then resets periodStart to now so a fresh term begins immediately. Irreversible (credits are
// applied via the normal ledger, same as any other credit grant), so this asks for nothing automatic —
// the admin calls it deliberately, same as ending a contest.
router.post('/referral-leaderboard/settle', async (req, res) => {
  try {
    const settings = await Settings.getGlobal();
    const periodStart = settings.referral.leaderboard.periodStart || new Date(0);
    const prizes = settings.referral.leaderboard.prizes || [];
    if (!prizes.some(p => p > 0)) return res.status(400).json({ error: 'Set at least one prize amount before settling.' });

    const agg = await Student.aggregate([
      { $match: { referredBy: { $ne: null }, createdAt: { $gte: periodStart } } },
      { $group: { _id: '$referredBy', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: prizes.length },
    ]);
    const winners = [];
    for (let i = 0; i < agg.length; i++) {
      const prize = prizes[i] || 0;
      if (prize <= 0) continue;
      const st = await Student.findById(agg[i]._id).select('matric').lean();
      if (!st) continue;
      await applyCreditDelta({
        matric: st.matric, delta: prize, reason: 'referral_leaderboard_prize',
        note: `Referral leaderboard — #${i + 1} place, ${agg[i].n} referral${agg[i].n === 1 ? '' : 's'}`, actor: req.admin.sub,
      });
      winners.push({ rank: i + 1, matric: st.matric, referrals: agg[i].n, prize });
    }
    settings.referral.leaderboard.periodStart = new Date();
    settings.updatedBy = req.admin.sub;
    await settings.save();
    res.json({ winners, newPeriodStart: settings.referral.leaderboard.periodStart });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
