const mongoose = require('mongoose');

// ── Score ─────────────────────────────────────────────────────
// Unchanged from v1.0.0.
const ScoreSchema = new mongoose.Schema({
  matric:  { type: String, required: true, uppercase: true },
  correct: Number,
  total:   Number,
  pct:     Number,
  wrong:   Number,
  skip:    Number,
  courses: String,
  mode:    String,
  // Per-topic breakdown of this quiz/exam (course key + tag), shown in exam history.
  topics:  { type: [{ _id: false, course: String, tag: String, correct: Number, total: Number }], default: undefined },
  ts:      { type: Date, default: Date.now },
});
ScoreSchema.index({ matric: 1, ts: -1 });

module.exports = mongoose.model('Score', ScoreSchema);
