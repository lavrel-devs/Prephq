const mongoose = require('mongoose');

// ── GeneratedQuestion ─────────────────────────────────────────
// New in v1.1.0. Stores each AI-generated quiz (Groq) so students can
// revisit past quizzes via GET /api/quiz/history.
const GeneratedQuestionSchema = new mongoose.Schema({
  matric:     { type: String, required: true, uppercase: true },
  course:     { type: String, required: true },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
  model:      { type: String, default: '' },
  creditCost: { type: Number, default: 0 },
  // v1.4: 'ai' = generated via Groq (existing behavior). 'manual' = a
  // regular/weak-topics quiz the student chose to save for later
  // instead of playing immediately. Both show up in /api/quiz/history
  // and can be replayed the same way.
  source: { type: String, enum: ['ai', 'manual'], default: 'ai' },
  questions: [{
    q:    String,
    opts: [String],
    ans:  Number,
    exp:  { type: String, default: '' },
    tag:  { type: String, default: '' },
    course: { type: String, default: '' },
  }],
  // Populated once the student finishes this quiz (v1.1.5). Optional —
  // a record with no `submittedAt` just means the student generated
  // the quiz but hasn't finished/submitted it yet.
  userAnswers: { type: [Number], default: undefined }, // index into opts, or null for skipped
  score:          { type: Number, default: undefined },
  totalQuestions: { type: Number, default: undefined },
  submittedAt:    { type: Date, default: undefined },
  // v1.7.1: shareable link. `shareToken` is absent until the owner taps Share (so the sparse unique
  // index below ignores every quiz that was never shared) and is $unset — never set to null — on revoke.
  shareToken: { type: String },
  sharedAt:   { type: Date, default: undefined },
  shareOpens: { type: Number, default: 0 },   // times someone other than the owner opened the link
  createdAt: { type: Date, default: Date.now },
});

GeneratedQuestionSchema.index({ matric: 1, createdAt: -1 });
GeneratedQuestionSchema.index({ shareToken: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('GeneratedQuestion', GeneratedQuestionSchema);
