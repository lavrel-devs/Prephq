const mongoose = require('mongoose');

// A study note a student paid credits to have the AI write for themselves. Private to that student.
const StudentNoteSchema = new mongoose.Schema({
  matric:    { type: String, required: true, uppercase: true, index: true },
  courseKey: { type: String, required: true, index: true },
  topic:     { type: String, required: true, maxlength: 100 },
  depth:     { type: String, enum: ['quick', 'standard', 'detailed'], default: 'standard' },
  body:      { type: String, required: true, maxlength: 8000 },
  cost:      { type: Number, default: 0 },
}, { timestamps: true });

StudentNoteSchema.index({ matric: 1, courseKey: 1, createdAt: -1 });

module.exports = mongoose.model('StudentNote', StudentNoteSchema);
