const mongoose = require('mongoose');

// ── Payment ───────────────────────────────────────────────────
// Unchanged from v1.0.0.
const PaymentSchema = new mongoose.Schema({
  matric:    { type: String, default: '', uppercase: true },
  name:      { type: String, default: '' },
  amount:    { type: Number, default: 0 },
  method:    { type: String, enum: ['cash', 'bank_transfer', 'opay', 'palmpay', 'other'], default: 'cash' },
  reference: { type: String, default: '' },
  note:      { type: String, default: '' },
  status:    { type: String, enum: ['confirmed', 'pending'], default: 'confirmed' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Payment', PaymentSchema);
