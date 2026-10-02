const mongoose = require('mongoose');

// A topic that was flagged weak for a student. Kept after recovery (status 'cleared') so the app can
// show what they've turned around, not just what's currently weak.
const RevisionTopicSchema = new mongoose.Schema({
  matric:   { type: String, required: true, uppercase: true },
  course:   { type: String, required: true },       // canonical course key
  tag:      { type: String, required: true },       // display spelling
  tagKey:   { type: String, required: true },       // lower-cased, for matching
  status:   { type: String, enum: ['active', 'cleared'], default: 'active' },
  lastAccuracy: { type: Number, default: null },
  attempts: { type: Number, default: 0 },
  firstFlaggedAt: { type: Date, default: Date.now },
  clearedAt: { type: Date, default: null },
}, { versionKey: false });
RevisionTopicSchema.index({ matric: 1, course: 1, tagKey: 1 }, { unique: true });
RevisionTopicSchema.index({ matric: 1, status: 1 });

module.exports = mongoose.model('RevisionTopic', RevisionTopicSchema);
