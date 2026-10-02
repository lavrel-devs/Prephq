const Student = require('../models/Student');
const Settings = require('../models/Settings');

// One-time, idempotent, non-destructive migration run at boot:
//  • students on the removed Basic/Pro plans become Premium (keeping their expiry date, so nobody
//    loses time they already paid for; premiumPlan stays null = "manual/legacy grant");
//  • the settings document gets a `premium` tier seeded from the old Pro tier's limits/prices
//    (the old basic/pro keys are left in the DB, untouched and unused).
async function migratePlans() {
  try {
    const r = await Student.updateMany({ tier: { $in: ['basic', 'pro'] } }, { $set: { tier: 'premium' } });
    if (r.modifiedCount) console.log(`[migrate] ${r.modifiedCount} Basic/Pro students moved to Premium`);

    const raw = await Settings.collection.findOne({ key: 'global' });
    if (raw && raw.tiers && !raw.tiers.premium && (raw.tiers.pro || raw.tiers.basic)) {
      const src = raw.tiers.pro || raw.tiers.basic;
      await Settings.collection.updateOne({ key: 'global' }, { $set: { 'tiers.premium': {
        dailyQuestions: src.dailyQuestions ?? null,
        dailyAIQuizzes: src.dailyAIQuizzes ?? null,
        dailyAIChatMessages: src.dailyAIChatMessages ?? null,
        priceMonthly: src.priceMonthly ?? 2000,
        priceYearly: src.priceYearly ?? 20000,
        priceWeekly: null,      // not offered until an admin sets a price
        priceLifetime: null,
      } } });
      console.log('[migrate] Settings: premium tier seeded from the previous top plan');
    }
  } catch (e) {
    console.error('[migrate] plan migration failed:', e.message);
  }
}

module.exports = { migratePlans };
