const mongoose = require('mongoose');

// One Weakness Autopilot plan per student per WAT day (v1.9.0). Built overnight by the scheduler
// (or on first open if the student arrives before it has run). `items` is a snapshot of what was
// planned; whether each item is done is worked out live from the student's real activity, not stored.
const DailyPlanSchema = new mongoose.Schema({
  matric:      { type: String, required: true, uppercase: true },
  day:         { type: String, required: true },                 // WAT 'YYYY-MM-DD'
  budgetMin:   { type: Number, default: 15 },
  totalMin:    { type: Number, default: 0 },
  headline:    { type: String, default: '' },
  items:       { type: [mongoose.Schema.Types.Mixed], default: [] },
  source:      { type: String, enum: ['nightly', 'ondemand', 'refresh'], default: 'ondemand' },
  generatedAt: { type: Date, default: Date.now },
}, { versionKey: false });

DailyPlanSchema.index({ matric: 1, day: 1 }, { unique: true });
DailyPlanSchema.index({ generatedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 45 });   // keep ~6 weeks of history, then drop

module.exports = mongoose.model('DailyPlan', DailyPlanSchema);
