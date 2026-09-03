const mongoose = require('mongoose');

// ── StudyRoom ─────────────────────────────────────────────────
// New in v1.3. Live, WebSocket-driven group quiz sessions — friends
// study together in real time. Deliberately separate from Contests:
// study rooms are free, casual, credit-free practice (no entry fee,
// no prizes), while Contests remain the credit-economy competitive
// feature. This document is the persistent record (so a page refresh
// or reconnect doesn't lose state); the live moment-to-moment gameplay
// (current question timer, broadcasting) is handled by Socket.io in
// src/realtime/studyRoom.socket.js and never itself the source of
// truth for scores — every score change is written here first.
const RoomParticipantSchema = new mongoose.Schema({
  matric:   { type: String, required: true, uppercase: true },
  username: { type: String, default: '' },
  score:    { type: Number, default: 0 },
  answeredCurrent: { type: Boolean, default: false }, // resets each question
  joinedAt: { type: Date, default: Date.now },
}, { _id: false });

const StudyRoomSchema = new mongoose.Schema({
  code:        { type: String, required: true, unique: true }, // shareable join code
  hostMatric:  { type: String, required: true, uppercase: true },
  course:      { type: String, required: true },

  questions:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
  questionCount:     { type: Number, default: 10 },
  secondsPerQuestion:{ type: Number, default: 20 },

  status:              { type: String, enum: ['waiting', 'active', 'ended'], default: 'waiting' },
  currentQuestionIndex:{ type: Number, default: -1 }, // -1 = not started
  currentQuestionStartedAt: { type: Date, default: null },

  participants: { type: [RoomParticipantSchema], default: [] },

  createdAt: { type: Date, default: Date.now },
  endedAt:   { type: Date, default: null },
});

module.exports = mongoose.model('StudyRoom', StudyRoomSchema);
