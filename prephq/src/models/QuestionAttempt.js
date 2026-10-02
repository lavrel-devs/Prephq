const mongoose = require('mongoose');

// ── QuestionAttempt ───────────────────────────────────────────
// New in v1.3. Records each individual question a student answers
// (course + tag + right/wrong), separate from the aggregate-only
// Score model. This is what weak-topic drilling reads from — Score
// only ever stored whole-quiz percentages, with no way to tell which
// specific topics within a course a student is actually weak on.
const QuestionAttemptSchema = new mongoose.Schema({
  matric:  { type: String, required: true, uppercase: true, index: true },
  course:  { type: String, required: true },
  tag:     { type: String, default: '' }, // Question.tag — the sub-topic label
  correct: { type: Boolean, required: true },
  ts:      { type: Date, default: Date.now },
});

QuestionAttemptSchema.index({ matric: 1, course: 1, tag: 1 });

module.exports = mongoose.model('QuestionAttempt', QuestionAttemptSchema);
