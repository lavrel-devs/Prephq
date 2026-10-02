const mongoose = require('mongoose');

// ── StudentBackup ─────────────────────────────────────────────
// New in v1.3.1. Server-side backup for data that was previously kept
// only in the browser's localStorage — bookmarked questions, personal
// notes, the daily quiz goal, and exam-date/notification settings.
// Purely local storage meant a cleared browser, a new device, or a
// reinstalled app silently wiped this data with no way to recover it.
// Shape is intentionally loose (Mixed) since it mirrors whatever the
// frontend's local cache already stores — this is a backup, not a new
// schema design, so it stays flexible as the frontend's local shape
// evolves rather than requiring a migration each time.
const StudentBackupSchema = new mongoose.Schema({
  matric:    { type: String, required: true, unique: true, uppercase: true },
  bookmarks: { type: mongoose.Schema.Types.Mixed, default: [] },
  notes:     { type: mongoose.Schema.Types.Mixed, default: {} },
  goal:      { type: mongoose.Schema.Types.Mixed, default: {} },
  settings:  { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now },
});

StudentBackupSchema.pre('save', function (next) { this.updatedAt = new Date(); next(); });

module.exports = mongoose.model('StudentBackup', StudentBackupSchema);
