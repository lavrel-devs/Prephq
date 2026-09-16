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
    res.json(settings);
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

    // v1.4: tier limits/pricing — fully admin-editable, no redeploy.
    // Accepts a partial shape, e.g. { basic: { priceMonthly: 600 } }.
    if (tiers) {
      for (const tierName of ['free', 'basic', 'pro']) {
        const incoming = tiers[tierName];
        if (!incoming) continue;
        const current = settings.tiers[tierName];
        for (const field of ['dailyQuestions', 'dailyAIQuizzes', 'dailyAIChatMessages', 'priceMonthly', 'priceYearly']) {
          if (!(field in incoming)) continue;
          const val = incoming[field];
          // null explicitly means "unlimited" for the daily* fields — allow it through.
          if (val === null && field.startsWith('daily')) { current[field] = null; continue; }
          if (Number.isFinite(val) && val >= 0) current[field] = val;
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
