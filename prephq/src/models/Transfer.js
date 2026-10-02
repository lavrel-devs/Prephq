const mongoose = require('mongoose');

// ── Transfer ──────────────────────────────────────────────────
// New in v1.2. A dedicated log for user-to-user credit transfers,
// separate from CreditTransaction (which still gets a paired
// transfer_sent / transfer_received row on each side for the
// per-user balance ledger). This model is the canonical record used
// for admin's transfer log/filters and for rate-limit lookups
// (10/day, 30s cooldown) without scanning CreditTransaction.
const TransferSchema = new mongoose.Schema({
  fromMatric:   { type: String, required: true, uppercase: true, index: true },
  toMatric:     { type: String, required: true, uppercase: true, index: true },
  fromUsername: { type: String, default: '' },
  toUsername:   { type: String, default: '' },

  amount:       { type: Number, required: true },   // credits received by recipient (excludes fee)
  fee:          { type: Number, required: true, default: 1 },
  totalDebited: { type: Number, required: true },    // amount + fee, deducted from sender

  status:       { type: String, enum: ['completed', 'failed'], default: 'completed' },
  failReason:   { type: String, default: '' },

  senderTxId:    { type: mongoose.Schema.Types.ObjectId, ref: 'CreditTransaction', default: null },
  recipientTxId: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditTransaction', default: null },

  createdAt:    { type: Date, default: Date.now },
});

TransferSchema.index({ fromMatric: 1, createdAt: -1 });
TransferSchema.index({ toMatric: 1, createdAt: -1 });

module.exports = mongoose.model('Transfer', TransferSchema);
