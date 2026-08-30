const mongoose = require('mongoose');

// ── Announcement ──────────────────────────────────────────────
// New in v1.2. Admin broadcasts shown to students in the dashboard
// notification feed. `expiresAt` is optional — when set, the
// announcement is filtered out of active lists past that time (TTL
// index also physically removes the doc so the collection doesn't
// grow unbounded).
const AnnouncementSchema = new mongoose.Schema({
  title:   { type: String, required: true, trim: true },
  content: { type: String, required: true },

  targetAudience: {
    type: String,
    enum: ['all', 'active_users', 'new_users'],
    default: 'all',
  },

  createdBy: { type: String, default: '' }, // admin username
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: null },
});

AnnouncementSchema.index({ createdAt: -1 });
// TTL index: only applies to docs where expiresAt is a real Date (partialFilterExpression
// avoids trying to expire docs where expiresAt is null).
AnnouncementSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } }
);

module.exports = mongoose.model('Announcement', AnnouncementSchema);
