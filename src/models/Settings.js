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
