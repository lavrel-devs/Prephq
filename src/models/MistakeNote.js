const mongoose = require('mongoose');

// "Why did I get this wrong?" (v1.9.2). One row per student per bank question: the reason the student picked after a wrong
// answer, plus an optional one-line lesson in their own words. This is the student's personal mistake notebook.
const MistakeNoteSchema = new mongoose.Schema({
  matric:  { type: String, required: true, uppercase: true, index: true },
  qid:     { type: mongoose.Schema.Types.ObjectId, required: true },
  course:  { type: String, default: '' },
  tag:     { type: String, default: '' },
  why:     { type: String, enum: ['', 'didnt_know', 'careless', 'time', 'misread'], default: '' },
  lesson:  { type: String, default: '', maxlength: 240 },
}, { timestamps: true });

MistakeNoteSchema.index({ matric: 1, qid: 1 }, { unique: true });

module.exports = mongoose.model('MistakeNote', MistakeNoteSchema);
