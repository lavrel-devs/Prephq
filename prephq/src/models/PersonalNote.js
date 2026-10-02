const mongoose = require('mongoose');

// A note a student paid credits to have the AI write for a topic they typed. Private to that student.
const PersonalNoteSchema = new mongoose.Schema({
  matric:    { type: String, required: true, uppercase: true, index: true },
  courseKey: { type: String, required: true },
  topic:     { type: String, required: true },
  topicKey:  { type: String, required: true },      // lower-cased, whitespace-collapsed topic (for "already have it")
  title:     { type: String, required: true, maxlength: 140 },
  depth:     { type: String, enum: ['quick', 'standard', 'detailed'], default: 'standard' },
  body:      { type: String, required: true, maxlength: 12000 },
  cost:      { type: Number, default: 0 },
  model:     { type: String, default: '' },
}, { timestamps: true });

PersonalNoteSchema.index({ matric: 1, courseKey: 1, topicKey: 1, depth: 1 }, { unique: true });

module.exports = mongoose.model('PersonalNote', PersonalNoteSchema);
