const mongoose = require('mongoose');

// ── Challenge ─────────────────────────────────────────────────
// v1.7.4 "Challenge a friend". A student finishes a quiz, then sends a link that carries THEIR score: the
// friend plays the same questions and sees "you 9/10 vs @ada 8/10". Scores are reported by the app (this is
// a friendly game, not an exam), so the server only sanity-checks them against the quiz length.
const ChallengeSchema = new mongoose.Schema({
  token:   { type: String, required: true, unique: true },
  quizId:  { type: mongoose.Schema.Types.ObjectId, ref: 'GeneratedQuestion', required: true, index: true },
  owner:   { type: String, required: true, uppercase: true, index: true },   // the student who sends the challenge
  correct: { type: Number, required: true },
  total:   { type: Number, required: true },
  // One entry per friend (their best attempt). Capped so a viral link can't grow the document forever.
  results: [{
    _id: false,
    matric:  { type: String, uppercase: true },
    name:    { type: String, default: '' },
    correct: Number,
    total:   Number,
    at:      { type: Date, default: Date.now },
  }],
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

module.exports = mongoose.model('Challenge', ChallengeSchema);
