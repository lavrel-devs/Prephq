const mongoose = require('mongoose');

// ── Student ───────────────────────────────────────────────────
// v1.1.0: additive fields only — nothing removed from v1.0.0.
//   - `password`     : legacy plaintext field, kept read-only for old
//                       accounts. New/updated accounts use `passwordHash`.
//   - `passwordHash` : bcrypt hash, used for all logins going forward.
//   - `credits`      : new PrepHQ Credits balance, starts at 0.
//   - `devices`      : known device fingerprints seen at login, for
//                       the "flag new device" security feature.
const StudentSchema = new mongoose.Schema({
  matric:       { type: String, required: true, unique: true, uppercase: true, trim: true },
  password:     { type: String, default: '' },       // legacy plaintext (deprecated, do not write to this anymore)
  passwordHash: { type: String, default: '' },        // bcrypt hash (v1.1.0+)
  name:         { type: String, required: true, trim: true },
  phone:        { type: String, default: '' },
  whatsapp:     { type: String, default: '' },
  role:         { type: String, default: 'student' },
  active:       { type: Boolean, default: true },
  codeUsed:     { type: String, default: '' },
  credits:      { type: Number, default: 0 },          // PrepHQ Credits — new users start at 0
  devices: [{
    fingerprint: String,
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt:  { type: Date, default: Date.now },
    label:       { type: String, default: '' },
  }],
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Student', StudentSchema);
