const mongoose = require('mongoose');

// ── CreditTransaction ─────────────────────────────────────────
// New in v1.1.0. Every change to a student's credit balance is logged
// here — admin top-ups, quiz-generation spend, refunds, etc. This is
// the audit trail behind Student.credits.
const CreditTransactionSchema = new mongoose.Schema({
  matric:        { type: String, required: true, uppercase: true },
  delta:         { type: Number, required: true },   // positive = credit, negative = debit
  balanceAfter:  { type: Number, required: true },
  reason:        {
    type: String,
    enum: ['admin_credit', 'admin_debit', 'quiz_generation', 'refund', 'bonus'],
    required: true,
  },
  note:          { type: String, default: '' },
  actor:         { type: String, default: '' },   // admin username, or 'system'
  createdAt:     { type: Date, default: Date.now },
});

CreditTransactionSchema.index({ matric: 1, createdAt: -1 });

module.exports = mongoose.model('CreditTransaction', CreditTransactionSchema);
