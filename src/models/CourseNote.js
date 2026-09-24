const mongoose = require('mongoose');

// Admin-written study notes for a course. `topic` (optional) matches the tag used on questions
// in the bank, which is what links "read this" to "practise this".
const CourseNoteSchema = new mongoose.Schema({
  courseKey: { type: String, required: true, index: true },   // canonical Course.key, e.g. "chm102"
  topic:     { type: String, default: '' },
  title:     { type: String, required: true, maxlength: 120 },
  body:      { type: String, required: true, maxlength: 12000 },
  order:     { type: Number, default: 0 },
  published: { type: Boolean, default: true },   // false = draft (not visible to students)
  // 'ai' notes are written by the AI note builder as drafts and only go live once an admin approves them.
  source:    { type: String, enum: ['manual', 'ai'], default: 'manual' },
  updatedBy: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('CourseNote', CourseNoteSchema);
