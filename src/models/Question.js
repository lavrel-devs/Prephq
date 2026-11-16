const mongoose = require('mongoose');

// ── Admin Question ────────────────────────────────────────────
// Unchanged from v1.0.0.
const QuestionSchema = new mongoose.Schema({
  course:    { type: String, required: true },
  q:         { type: String, required: true },
  opts:      { type: [String], required: true },
  ans:       { type: Number, required: true },
  tag:       { type: String, default: '' },
  exp:       { type: String, default: '' },
  createdBy: { type: String, default: '' }, // admin username, v1.1.5 bulk-upload attribution
  batchId:   { type: String, default: '', index: true }, // set by bulk upload, so a whole batch can be reviewed or undone
  // v1.11 secondary track. All optional: a question with none of them is a general question for its subject.
  exam:       { type: String, enum: ['', 'jamb', 'waec', 'neco', 'school'], default: '' },   // which exam body it is written for ('' = any)
  year:       { type: Number, default: null },                                                // past-question year, e.g. 2019
  classLevel: { type: String, enum: ['', 'JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'], default: '' }, // school exams
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Question', QuestionSchema);
