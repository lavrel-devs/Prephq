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
  // v1.11 secondary track: per-subject breakdown of a JAMB / WAEC / NECO / school paper.
  sec: {
    type: {
      _id: false,
      exam: String, kind: String, year: Number, utme: Number,
      rows: [{ _id: false, course: String, correct: Number, total: Number, pct: Number, scaled: Number, grade: String }],
    },
    default: undefined,
  },
  ts:      { type: Date, default: Date.now },
});
ScoreSchema.index({ matric: 1, ts: -1 });

module.exports = mongoose.model('Score', ScoreSchema);
