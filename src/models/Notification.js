const mongoose = require('mongoose');

// ── Notification ──────────────────────────────────────────────
// New in v1.2. Lightweight per-student notification feed. Covers all
// four UI notification triggers from the spec: credits received,
// daily credits added, contest reminders, and admin announcements.
const NotificationSchema = new mongoose.Schema({
  matric:  { type: String, required: true, uppercase: true, index: true },

  type: {
    type: String,
    enum: ['transfer_received', 'daily_credit', 'contest_reminder', 'contest_result', 'announcement'],
    required: true,
  },

  title:   { type: String, required: true },
  message: { type: String, default: '' },

  // Optional pointer to whatever caused this notification, so the
  // frontend can deep-link (e.g. open the contest, or the transfer
  // history entry) without parsing the message text.
  relatedId:   { type: mongoose.Schema.Types.ObjectId, default: null },
  relatedType: { type: String, default: '' }, // 'Transfer' | 'Contest' | 'Announcement'

  read:      { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

NotificationSchema.index({ matric: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);
