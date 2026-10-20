const mongoose = require('mongoose');

// ── PlanCode ──────────────────────────────────────────────────
// v1.7.1. A one-time activation code an admin hands a student over WhatsApp after payment. The student
// types it into Profile → "Activation code" and the plan below is applied to THEIR account.
// (Separate from the legacy v1.0 `Code` signup codes, which are no longer used.)
const PlanCodeSchema = new mongoose.Schema({
  code:   { type: String, required: true, unique: true, uppercase: true },     // e.g. X7K2-9QMP-4RBT
  plan:   { type: String, enum: ['daily', 'weekly', 'monthly', 'yearly', 'lifetime', 'custom'], required: true },
  days:   { type: Number, default: null },                                     // null = lifetime (never expires)
  status: { type: String, enum: ['unused', 'used', 'revoked'], default: 'unused', index: true },
  forMatric:   { type: String, default: '', uppercase: true },                 // optional: only this student may redeem it
  note:        { type: String, default: '' },
  amount:      { type: Number, default: 0 },                                   // ₦ the student paid; logged as a Payment on redeem
  requestCode: { type: String, default: '' },                                  // the upgrade request (PH-XXXXX) this code answers
  createdBy:   { type: String, default: '' },                                  // admin username
  createdAt:   { type: Date, default: Date.now, index: true },
  usedBy:      { type: String, default: '' },
  usedAt:      { type: Date, default: null },
  revokedAt:   { type: Date, default: null },
}, { versionKey: false });

module.exports = mongoose.model('PlanCode', PlanCodeSchema);
