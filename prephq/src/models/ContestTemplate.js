const mongoose = require('mongoose');

// ── ContestTemplate ───────────────────────────────────────────
// New in v1.3. Instead of an admin manually re-creating a "Weekly GST
// 101 Leaderboard" every week, they create one template and the
// scheduler spawns a fresh Contest from it on schedule. Each spawned
// Contest is a normal, independent document — editing/ending/canceling
// a spawned instance never touches the template, and vice versa.
const PrizeTierSchema = new mongoose.Schema({
  rank:   { type: Number, required: true },
  amount: { type: Number, required: true },
}, { _id: false });

const ContestTemplateSchema = new mongoose.Schema({
  title:          { type: String, required: true, trim: true },
  description:    { type: String, default: '' },
  type:           { type: String, enum: ['quiz', 'raffle', 'leaderboard', 'timed'], required: true },

  entryFee:        { type: Number, default: 0, min: 0 },
  maxParticipants: { type: Number, default: null },
  prizePool:           { type: Number, default: 0, min: 0 },
  prizeDistribution:   { type: [PrizeTierSchema], default: [] },

  // Quiz-type templates: either a fixed question list (reused every
  // cycle) or an auto-pick course + count, which draws a *fresh*
  // random set of questions from that course each time it spawns —
  // this is what makes a recurring quiz contest actually feel new
  // each week instead of a rerun.
  questions:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
  autoPickCourse: { type: String, default: null },
  autoPickCount:  { type: Number, default: 10 },

  // ── recurrence ──
  frequency:    { type: String, enum: ['daily', 'weekly'], required: true },
  dayOfWeek:    { type: Number, min: 0, max: 6, default: null }, // 0=Sunday, required for weekly
  timeOfDay:    { type: String, required: true }, // 'HH:MM' in WAT (Africa/Lagos)
  durationMinutes: { type: Number, required: true, min: 5 },

  active:          { type: Boolean, default: true },
  lastGeneratedAt: { type: Date, default: null },
  lastSpawnedContestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contest', default: null },

  createdBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('ContestTemplate', ContestTemplateSchema);
