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
    enum: [
      // v1.1.0 original reasons
      'admin_credit', 'admin_debit', 'quiz_generation', 'refund', 'bonus',
      // v1.2 additions
      'welcome_bonus', 'daily_refresh', 'transfer_sent', 'transfer_received',
      'referral_bonus', 'contest_entry', 'contest_prize',
      'admin_grant', 'admin_deduct', 'quiz_cost',
      // reasons the routes were already writing, but that were missing
      // here — every flashcard generation / cosmetic purchase used to
      // charge the student and then fail ledger validation.
      'flashcard_generation', 'cosmetic_purchase',
    ],
    required: true,
  },
  note:          { type: String, default: '' },
  actor:         { type: String, default: '' },   // admin username, or 'system'

  // ── v1.2 linkage fields ─────────────────────────────────────
  relatedTransferId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transfer', default: null },
  contestId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Contest', default: null },

  createdAt:     { type: Date, default: Date.now },
});

CreditTransactionSchema.index({ matric: 1, createdAt: -1 });

module.exports = mongoose.model('CreditTransaction', CreditTransactionSchema);
