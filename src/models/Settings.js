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
    // FREE: daily caps + an ON/OFF switch per feature (Admin ▸ Credit Settings).
    // Premium always gets every feature. Keep `features` in sync with
    // services/entitlements.service.js FEATURES.
    free: {
      dailyQuestions:      { type: Number, default: 20 },
      dailyAIQuizzes:      { type: Number, default: 2 },
      dailyAIChatMessages: { type: Number, default: 5 },
      features: {
        aiTutor:              { type: Boolean, default: true },
        practiceQuestions:    { type: Boolean, default: true },
        aiQuestionGeneration: { type: Boolean, default: true },
        flashcards:           { type: Boolean, default: false }, // paid-only before switches existed
        examMode:             { type: Boolean, default: true },
        examHistory:          { type: Boolean, default: true },
        studyPlan:            { type: Boolean, default: true },
        courseNotes:          { type: Boolean, default: true },
        studyGuide:           { type: Boolean, default: false }, // paid-only before switches existed
        studyRooms:           { type: Boolean, default: true },
        contests:             { type: Boolean, default: true },
        creditTransfers:      { type: Boolean, default: true },
      },
    },
    // PREMIUM: one plan, four billing periods. A null price = "not offered yet".
    premium: {
      dailyQuestions:      { type: Number, default: null }, // unlimited
      dailyAIQuizzes:      { type: Number, default: null },
      dailyAIChatMessages: { type: Number, default: null },
      priceWeekly:         { type: Number, default: null },
      priceMonthly:        { type: Number, default: 2000 },
      priceYearly:         { type: Number, default: 20000 },
      priceLifetime:       { type: Number, default: null },
    },
  },

  // v1.6: students can have the AI write their own study notes for a credit fee (by depth).
  notes: {
    enabled:        { type: Boolean, default: true },
    costQuick:      { type: Number, default: 3 },
    costStandard:   { type: Number, default: 5 },
    costDetailed:   { type: Number, default: 8 },
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
// Upsert (rather than findOne-then-create) so two requests hitting a
// brand-new database at the same moment can't both try to create the
// singleton and have one die on the unique `key` index.
SettingsSchema.statics.getGlobal = async function () {
  return this.findOneAndUpdate(
    { key: 'global' },
    { $setOnInsert: { key: 'global' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};

module.exports = mongoose.model('Settings', SettingsSchema);
