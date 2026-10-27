const mongoose = require('mongoose');

// ── WrittenExam (v1.8.0) ──────────────────────────────────────
// A theory/essay exam: AI-set questions with a hidden marking scheme, typed answers, AI marking.
// The rubric and model answers stay on the server until the student has submitted — GET only ever returns the
// bare questions while the exam is open.
const WrittenExamSchema = new mongoose.Schema({
  matric:     { type: String, required: true, uppercase: true, index: true },
  course:     { type: String, required: true },
  topic:      { type: String, default: '' },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
  durationMin:{ type: Number, required: true },
  startedAt:  { type: Date, default: Date.now },
  status:     { type: String, enum: ['open', 'marked'], default: 'open', index: true },
  questions: [{
    _id: false,
    q:      { type: String, required: true },
    marks:  { type: Number, required: true },                                     // = sum of the rubric marks
    rubric: [{ _id: false, point: String, marks: Number }],                       // the marking scheme (hidden until marked)
    model:  { type: String, default: '' },                                        // model answer (hidden until marked)
  }],
  // Saved the moment the student submits, BEFORE marking, so an AI outage never loses what they wrote.
  answers:     { type: [String], default: [] },
  submittedAt: { type: Date, default: null },
  late:        { type: Boolean, default: false },                               // submitted after the time was up
  results: [{
    _id: false,
    score:    Number,
    met:      [Number],                                                           // rubric points the answer earned
    feedback: String,
    tip:      String,
  }],
  total:    { type: Number, default: 0 },
  maxTotal: { type: Number, default: 0 },
  markedAt: { type: Date, default: null },
}, { versionKey: false });

WrittenExamSchema.index({ matric: 1, startedAt: -1 });
module.exports = mongoose.model('WrittenExam', WrittenExamSchema);
