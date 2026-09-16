const mongoose = require('mongoose');

// ── Settings ──────────────────────────────────────────────────
// New in v1.2. Singleton document (single row, key: 'global') holding
// admin-runtime-configurable values for the credit economy, so these
// don't require a redeploy to change.
const SettingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'global' },

  dailyRefresh: {
    enabled: { type: Boolean, default: true },
    amount:  { type: Number, default: 5 },
  },

  referral: {
    enabled:        { type: Boolean, default: true },
    referrerReward: { type: Number, default: 15 }, // credits to the person who referred
    refereeBonus:   { type: Number, default: 10 }, // extra credits on top of welcome bonus for the new signup
  },

  welcomeBonus: { type: Number, default: 20 },

  // v1.3: bonus credits every N consecutive days of activity.
  streakBonus: {
    enabled:      { type: Boolean, default: true },
    milestoneDays:{ type: Number, default: 7 },  // award every N-day multiple (7, 14, 21, ...)
    amount:       { type: Number, default: 15 },
  },

  // AI chatbot usage limits — admin-configurable so spend on the Groq
  // API stays bounded without a redeploy.
  aiChatbot: {
    enabled:      { type: Boolean, default: true },
    dailyLimit:   { type: Number, default: 20 },
    monthlyLimit: { type: Number, default: 300 },
  },

  // v1.4: subscription tiers. Replaces the old activation-code gate —
  // signup is now free/open, and these limits gate daily usage instead.
  // `null` on any daily* field means unlimited for that tier. Prices are
  // in naira; admin-editable so pricing/limits never need a redeploy.
  tiers: {
    free: {
      dailyQuestions:      { type: Number, default: 20 },
      dailyAIQuizzes:      { type: Number, default: 2 },
      dailyAIChatMessages: { type: Number, default: 5 },
    },
    basic: {
      dailyQuestions:      { type: Number, default: null }, // unlimited
      dailyAIQuizzes:      { type: Number, default: null },
      dailyAIChatMessages: { type: Number, default: null },
      priceMonthly:        { type: Number, default: 500 },
      priceYearly:         { type: Number, default: 5000 },
    },
    pro: {
      dailyQuestions:      { type: Number, default: null },
      dailyAIQuizzes:      { type: Number, default: null },
      dailyAIChatMessages: { type: Number, default: null },
      priceMonthly:        { type: Number, default: 2000 },
      priceYearly:         { type: Number, default: 20000 },
    },
  },

  // v1.4: contact info surfaced to students (e.g. the upgrade paywall's
  // "message admin" link) — editable here so it's never hardcoded in
  // the frontend.
  support: {
    whatsapp: { type: String, default: '' }, // digits only, e.g. '2348012345678'
  },

  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: String, default: '' },
});

SettingsSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// Fetches the singleton settings doc, creating it with defaults on first use.
SettingsSchema.statics.getGlobal = async function () {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  return doc;
};

module.exports = mongoose.model('Settings', SettingsSchema);
