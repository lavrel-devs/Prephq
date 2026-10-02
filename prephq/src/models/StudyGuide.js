const mongoose = require('mongoose');

// ── StudyGuide ────────────────────────────────────────────────
// New in v1.4. Stores each AI-generated GPA study plan so a student
// can revisit it rather than regenerating (regeneration still costs
// a fresh Groq call — this is just the persisted record of past ones).
// Premium only (or when the Free-plan study-guide switch is on) — gated in the route, not here.
const StudyGuideSchema = new mongoose.Schema({
  matric:     { type: String, required: true, uppercase: true },
  currentGPA: { type: Number, required: true },
  targetGPA:  { type: Number, required: true },
  courses:    { type: [String], default: [] },
  summary:    { type: String, default: '' },
  weeks: [{
    title: String,
    focus: String,
    tasks: [String],
  }],
  model:     { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

StudyGuideSchema.index({ matric: 1, createdAt: -1 });

module.exports = mongoose.model('StudyGuide', StudyGuideSchema);
