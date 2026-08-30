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

  // ── v1.2 additions ──────────────────────────────────────────
  // username: set at signup (new users) or via the blocking dashboard
  // modal on first login after this update (existing users). null
  // until set — NOT unique-indexed as null, see sparse index below.
  username:          { type: String, default: null, trim: true },
  displayName:       { type: String, default: '', trim: true },
  usernameChangedAt: { type: Date, default: null },

  lastDailyRefresh:  { type: Date, default: null },   // last date the daily 5-credit refresh was applied

  referralCode:      { type: String, default: null }, // this student's own shareable code
  referredBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null },

  isActive:          { type: Boolean, default: true }, // admin deactivation/ban flag (separate from `active`)

  lastActiveAt:      { type: Date, default: Date.now }, // updated on every authenticated request — feeds silent refresh

  createdAt: { type: Date, default: Date.now },
});

// Sparse unique indexes: many existing accounts will have username/referralCode
// = null until migrated, and sparse means only non-null values are checked
// for uniqueness (multiple nulls are allowed).
StudentSchema.index({ username: 1 }, { unique: true, sparse: true });
StudentSchema.index({ referralCode: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Student', StudentSchema);
