const mongoose = require('mongoose');
const crypto = require('crypto'); // For generating secure tokens

// ── Session ───────────────────────────────────────────────────
// v1.1.0 Session Model — No duplicate key errors
const SessionSchema = new mongoose.Schema({
  subjectId:   { type: String, required: true },   // matric (student) or admin username
  role:        { type: String, enum: ['student', 'admin'], required: true },
  refreshHash: { type: String, required: true },   // sha256 of refresh token — NEVER store raw tokens
  ip:                  { type: String, default: '' },
  userAgent:           { type: String, default: '' },
  deviceFingerprint:   { type: String, default: '' },
  isNewDevice:         { type: Boolean, default: false },
  createdAt:           { type: Date, default: Date.now },
  lastActiveAt:        { type: Date, default: Date.now },
  expiresAt:           { type: Date, required: true },
  revoked:             { type: Boolean, default: false },
  revokedAt:           { type: Date, default: null },
});

// ✅ Your indexes — clean, safe, no duplicates
SessionSchema.index({ subjectId: 1, revoked: 1 });
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL uses expiresAt directly

module.exports = mongoose.model('Session', SessionSchema);