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
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Question', QuestionSchema);
