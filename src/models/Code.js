const mongoose = require('mongoose');

// ── Activation Code ───────────────────────────────────────────
// Unchanged from v1.0.0.
const CodeSchema = new mongoose.Schema({
  code:      { type: String, required: true, unique: true, uppercase: true },
  status:    { type: String, enum: ['unused', 'used', 'expired'], default: 'unused' },
  usedBy:    { type: String, default: '' },     // matric of student who used it
  usedAt:    { type: Date, default: null },
  expiresAt: { type: Date, default: null },     // null = never expires
  batch:     { type: String, default: '' },     // batch label e.g. "Batch 1"
  note:      { type: String, default: '' },
  creditsGranted: { type: Number, default: 0 }, // v1.1.0: credits given to student on redemption (0 = none)
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Code', CodeSchema);
