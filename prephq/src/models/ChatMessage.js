const mongoose = require('mongoose');

// ── ChatMessage ───────────────────────────────────────────────
// New in v1.3.1. Persisted AI chatbot conversation history — kept
// server-side (not localStorage) so a student's chat survives a
// device switch, browser clear, or app reinstall.
const ChatMessageSchema = new mongoose.Schema({
  matric:  { type: String, required: true, uppercase: true, index: true },
  role:    { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  ts:      { type: Date, default: Date.now },
});

ChatMessageSchema.index({ matric: 1, ts: 1 });

module.exports = mongoose.model('ChatMessage', ChatMessageSchema);
