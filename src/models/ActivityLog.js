const mongoose = require('mongoose');

// ── ActivityLog ───────────────────────────────────────────────
// Append-only record of everything that happens on the site: every API
// request (who, what, result, from where), page views, realtime socket
// events, credit movements and scheduled/system jobs. Read-only for
// everyone — there is deliberately NO update/delete route; old rows are
// only removed by the retention job (ACTIVITY_LOG_RETENTION_DAYS).
// Only the owner admin can view or download it.
const ActivityLogSchema = new mongoose.Schema({
  ts:        { type: Date, default: Date.now },
  day:       { type: String, required: true },        // WAT calendar day, YYYY-MM-DD — what "per day" downloads filter on
  source:    { type: String, default: 'http' },       // http | page | socket | system | credit
  actorType: { type: String, default: 'anonymous' },  // student | admin | anonymous | system
  actor:     { type: String, default: '' },           // matric / admin username / 'scheduler' / attempted login name
  action:    { type: String, default: '' },           // e.g. "POST /api/quiz/generate", "credit.transfer_sent"
  method:    { type: String, default: '' },
  path:      { type: String, default: '' },
  query:     { type: String, default: '' },
  status:    { type: Number, default: 0 },
  ip:        { type: String, default: '' },
  ua:        { type: String, default: '' },
  ms:        { type: Number, default: 0 },
  detail:    { type: String, default: '' },           // redacted, truncated JSON
}, { versionKey: false });

ActivityLogSchema.index({ day: 1, ts: 1 });
ActivityLogSchema.index({ actor: 1, ts: -1 });
ActivityLogSchema.index({ ts: -1 });

module.exports = mongoose.model('ActivityLog', ActivityLogSchema);
