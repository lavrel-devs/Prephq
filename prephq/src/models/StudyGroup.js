const mongoose = require('mongoose');

// ── StudyGroup ────────────────────────────────────────────────
// v1.7. Deliberately separate from StudyRoom: a StudyRoom is one live, timed quiz session that ends
// when the quiz does; a StudyGroup is a small persistent group around a shared goal ("Finish CHM101
// Ch.3 by Friday") that outlives any single session, with each member tracking their own progress
// toward it. Free — no credits, no entry fee, same spirit as Study Rooms.
const GroupMemberSchema = new mongoose.Schema({
  matric:   { type: String, required: true, uppercase: true },
  username: { type: String, default: '' },
  progress: { type: Number, default: 0, min: 0, max: 100 }, // self-reported, 0-100
  joinedAt: { type: Date, default: Date.now },
}, { _id: false });

const StudyGroupSchema = new mongoose.Schema({
  code:       { type: String, required: true, unique: true }, // shareable join code
  name:       { type: String, required: true, trim: true, maxlength: 60 },
  hostMatric: { type: String, required: true, uppercase: true },
  course:     { type: String, default: '' },
  goalText:   { type: String, required: true, trim: true, maxlength: 140 },
  goalDueAt:  { type: Date, default: null },
  members:    { type: [GroupMemberSchema], default: [] },
  archived:   { type: Boolean, default: false }, // host "closed" it, or the goal date passed — kept for history, hidden from active lists
  createdAt:  { type: Date, default: Date.now },
});
StudyGroupSchema.index({ hostMatric: 1, createdAt: -1 });

module.exports = mongoose.model('StudyGroup', StudyGroupSchema);
