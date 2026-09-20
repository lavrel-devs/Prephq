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
    const { dailyRefresh, referral, welcomeBonus, streakBonus, aiChatbot, tiers, support } = req.body;

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

module.exports = router;
