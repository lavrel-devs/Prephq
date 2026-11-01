const mongoose = require('mongoose');

// ── TheoryQuestion (v1.8.1) ───────────────────────────────────
// Admin-approved written (theory) questions, each with its marking scheme and model answer. The Written Exam mixes
// these in with freshly generated questions, so vetted questions get used and fewer AI calls are needed.
const TheoryQuestionSchema = new mongoose.Schema({
  course:    { type: String, required: true, index: true },   // a catalogue course key, e.g. 'chm101'
  tag:       { type: String, default: '' },
  q:         { type: String, required: true },
  rubric:    [{ _id: false, point: String, marks: Number }],
  model:     { type: String, default: '' },
  norm:      { type: String, required: true },
  createdBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });
TheoryQuestionSchema.index({ course: 1, norm: 1 }, { unique: true });

module.exports = mongoose.model('TheoryQuestion', TheoryQuestionSchema);
