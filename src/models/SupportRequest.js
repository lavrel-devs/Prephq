const mongoose = require('mongoose');

// ── SupportRequest ────────────────────────────────────────────
// One inbox for everything students ask admins to do by hand over WhatsApp:
//   recovery        — "I can't log in" (admin verifies, issues a temporary password)
//   upgrade         — "I want Premium <plan>" (admin confirms payment offline, grants the plan)
//   question_report — "this question is wrong" (admin fixes/rejects it)
const SupportRequestSchema = new mongoose.Schema({
  type:   { type: String, enum: ['recovery', 'upgrade', 'question_report'], required: true, index: true },
  status: { type: String, enum: ['open', 'resolved', 'rejected'], default: 'open', index: true },
  code:   { type: String, required: true, unique: true },   // short reference the student quotes on WhatsApp
  matric: { type: String, default: '', uppercase: true, index: true },
  name:   { type: String, default: '' },                    // name as typed by the student (recovery) — admin compares it to the account
  studentFound: { type: Boolean, default: true },           // recovery only: did the matric match an account?
  assignedAdmin: { type: String, default: '' },             // admin whose WhatsApp the student was sent to
  // type-specific data
  plan:   { type: String, default: '' },                    // upgrade: weekly | monthly | yearly | lifetime
  report: {
    reason:     { type: String, default: '' },              // wrong_answer | typo | unclear | other
    note:       { type: String, default: '' },
    questionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    course:     { type: String, default: '' },
    q:          { type: String, default: '' },
    opts:       { type: [String], default: [] },
    ans:        { type: Number, default: null },
    tag:        { type: String, default: '' },
  },
  resolvedBy:     { type: String, default: '' },
  resolvedAt:     { type: Date, default: null },
  resolutionNote: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true },
}, { versionKey: false });

module.exports = mongoose.model('SupportRequest', SupportRequestSchema);
