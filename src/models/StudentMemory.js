const mongoose = require('mongoose');

// v1.8.3 Brainiac — what the companion knows about ONE student, plus that student's Brainiac switches.
// Kept separate from Student (and from the Study Assistant's ChatMessage history) so the two assistants
// never share a conversation. Everything here is visible to, and deletable by, the student.
const StudentMemorySchema = new mongoose.Schema({
  matric: { type: String, required: true, unique: true, uppercase: true, trim: true },

  // The student's own switches (Brainiac sheet ▸ gear). On by default — "always there" — but never forced.
  enabled: { type: Boolean, default: true },    // show the floating companion at all
  sound:   { type: Boolean, default: true },    // little pops/chimes
  nudges:  { type: Boolean, default: true },    // Brainiac speaking first (streak, comeback, weak topic...)
  learn:   { type: Boolean, default: true },    // remember things from chats

  // Durable things Brainiac learned from chatting ("studies best at night", "writing CHM 141 next week").
  facts: { type: [{ text: { type: String, maxlength: 140 }, ts: { type: Date, default: Date.now } }], default: [] },

  // Last ~20 messages of the Brainiac conversation (its own thread, not the Study Assistant's).
  recent: { type: [{ _id: false, role: String, content: String, ts: { type: Date, default: Date.now } }], default: [] },

  msgsSinceLearn: { type: Number, default: 0 },
  nudgeLog:  { type: [{ _id: false, id: String, ts: { type: Date, default: Date.now } }], default: [] },
  introducedAt: { type: Date, default: null },
  lastChatAt:   { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('StudentMemory', StudentMemorySchema);
