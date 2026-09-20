const mongoose = require('mongoose');

// ── FlashcardProgress ────────────────────────────────────────────
// v1.4. One row per (student, question) the student has reviewed as
// a flashcard. Cards are just existing bank Questions viewed front
// (question) / back (answer + explanation) — no separate content to
// author. Scheduling uses a lightweight SM-2-style algorithm: each
// review updates easeFactor/interval/dueDate so weak cards resurface
// sooner and strong cards drift further apart.
const FlashcardProgressSchema = new mongoose.Schema({
  matric:       { type: String, required: true, uppercase: true },
  questionId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
  course:       { type: String, required: true },
  easeFactor:   { type: Number, default: 2.5 },
  interval:     { type: Number, default: 0 },   // days until next due
  repetitions:  { type: Number, default: 0 },
  dueDate:      { type: Date, default: Date.now }, // due immediately until first review
  lastReviewed: { type: Date, default: null },
  lastQuality:  { type: Number, default: null }, // 0-3, last self-rating (Again/Hard/Good/Easy)
});

FlashcardProgressSchema.index({ matric: 1, questionId: 1 }, { unique: true });
FlashcardProgressSchema.index({ matric: 1, dueDate: 1 });

module.exports = mongoose.model('FlashcardProgress', FlashcardProgressSchema);
