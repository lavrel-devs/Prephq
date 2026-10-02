const mongoose = require('mongoose');

// One record per AI flashcard generation, so every generated card set stays
// permanently tied to the student and the exact course it was generated for.
const FlashcardSetSchema = new mongoose.Schema({
  matric:      { type: String, required: true, index: true },
  courseKey:   { type: String, required: true },   // canonical Course.key, e.g. "chm102"
  courseCode:  { type: String, required: true },   // e.g. "CHM102"
  courseTitle: { type: String, default: '' },
  topic:       { type: String, default: '' },
  questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
  creditCost:  { type: Number, default: 0 },
  model:       { type: String, default: '' },
  createdAt:   { type: Date, default: Date.now },
});
FlashcardSetSchema.index({ matric: 1, courseKey: 1, createdAt: -1 });

module.exports = mongoose.model('FlashcardSet', FlashcardSetSchema);
