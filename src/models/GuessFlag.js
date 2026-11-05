const mongoose = require('mongoose');

// v1.8.6 "I guessed" — a bank question the student admitted they did not really know (they picked an answer anyway).
// One row per (student, question): the latest word from the student wins, and answering the question again WITHOUT the
// guess mark clears it. Kept separate from QuestionAttempt so scores, leaderboards and weak topics are untouched.
const GuessFlagSchema = new mongoose.Schema({
  matric:  { type: String, required: true, uppercase: true, trim: true },
  qid:     { type: mongoose.Schema.Types.ObjectId, required: true },
  course:  { type: String, default: '' },
  tag:     { type: String, default: '' },
  correct: { type: Boolean, default: false },   // did the guess happen to be right?
  ts:      { type: Date, default: Date.now },
}, { timestamps: false });
GuessFlagSchema.index({ matric: 1, qid: 1 }, { unique: true });
GuessFlagSchema.index({ matric: 1, ts: -1 });

module.exports = mongoose.model('GuessFlag', GuessFlagSchema);
