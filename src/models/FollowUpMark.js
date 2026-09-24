const mongoose = require('mongoose');

// "I already followed this student up" — so two admins (or the same admin tomorrow) don't send the same
// WhatsApp message twice. `cycle` ties the mark to one specific situation: the plan's expiry date for renewals,
// or the student's last-seen time for win-backs. When the situation changes (they renew, or come back and lapse
// again) the old mark no longer matches and they show up as fresh.
const FollowUpMarkSchema = new mongoose.Schema({
  matric: { type: String, required: true, uppercase: true },
  kind:   { type: String, enum: ['expiring', 'inactive'], required: true },
  cycle:  { type: String, required: true },
  by:     { type: String, default: '' },
  at:     { type: Date, default: Date.now },
});
FollowUpMarkSchema.index({ matric: 1, kind: 1, cycle: 1 }, { unique: true });

module.exports = mongoose.model('FollowUpMark', FollowUpMarkSchema);
