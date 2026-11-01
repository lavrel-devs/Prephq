const mongoose = require('mongoose');

// ── AIQuestionReview (v1.8.1) ─────────────────────────────────
// The admin's review queue for AI-written questions. Two things feed it:
//   • questions a student generated with the AI (an AI quiz, or a Written Exam)  → source 'student-ai'
//   • questions the admin asked the AI to write on demand                        → source 'admin-ai'
// Nothing here is shown to students as practice material until an admin approves it: an approved MCQ becomes a
// normal row in the Question bank, an approved written question goes into the theory bank (TheoryQuestion).
const AIQuestionReviewSchema = new mongoose.Schema({
  kind:       { type: String, enum: ['mcq', 'written'], required: true, index: true },
  course:     { type: String, required: true },               // what the student typed / the admin chose
  courseKey:  { type: String, required: true, index: true },  // normalised (lowercase letters+digits) — used for duplicate checks
  tag:        { type: String, default: '' },                  // topic, when known
  difficulty: { type: String, default: 'medium' },
  q:          { type: String, required: true },
  // MCQ
  opts: { type: [String], default: undefined },
  ans:  { type: Number },
  exp:  { type: String, default: '' },
  // Written
  rubric: { type: [{ _id: false, point: String, marks: Number }], default: undefined },
  model:  { type: String, default: '' },
  source:      { type: String, enum: ['student-ai', 'admin-ai'], required: true, index: true },
  submittedBy: { type: String, default: '' },                 // matric of the student who generated it (admin-ai: admin username)
  status:      { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  norm:        { type: String, required: true },              // question text reduced to lowercase letters+digits
  createdAt:   { type: Date, default: Date.now, index: true },
  reviewedAt:  { type: Date, default: null },
  reviewedBy:  { type: String, default: '' },
  addedId:     { type: String, default: '' },                 // the Question / TheoryQuestion this became
  note:        { type: String, default: '' },
}, { versionKey: false });

// The same question for the same course is only ever queued once — even after it was rejected, so AI junk that
// keeps coming back doesn't keep reappearing.
AIQuestionReviewSchema.index({ courseKey: 1, kind: 1, norm: 1 }, { unique: true });
AIQuestionReviewSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('AIQuestionReview', AIQuestionReviewSchema);
