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
  // modal on first login after this update (existing users).
  //
  // v1.3 FIX: this field must NOT have a `default`. Mongoose applies
  // schema defaults at document-creation time, which means every
  // student created while `default: null` was set got an *explicit*
  // username: null written to Mongo. A sparse index only excludes
  // documents where the field is truly absent — it still indexes an
  // explicit null. So every 2nd+ student ever created collided on
  // the unique sparse index and hit "E11000 duplicate key: username:
  // null". Leaving no default here means the field is simply absent
  // on documents that haven't set a username yet, which is what the
  // sparse index actually needs. See scripts/fix-username-index.js
  // for the one-time cleanup of documents already affected.
  username:          { type: String, trim: true },
  displayName:       { type: String, default: '', trim: true },
  usernameChangedAt: { type: Date, default: null },

  lastDailyRefresh:  { type: Date, default: null },   // last date the daily 5-credit refresh was applied

  // v1.3: server-side streak tracking. The dashboard previously kept
  // streak count in localStorage only — fine for display, but not
  // trustworthy as the basis for awarding credits (trivially edited
  // client-side). This is the source of truth; the client mirrors it.
  streakCount:      { type: Number, default: 0 },
  streakLastDate:   { type: String, default: null }, // WAT YYYY-MM-DD of the last day counted

  // Same sparse-index/default bug as username above — no default here
  // either, for the same reason (see comment on `username`).
  referralCode:      { type: String }, // this student's own shareable code
  referredBy:         {
    type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null,
    set: v => (v === '' ? null : v), // an empty string here would otherwise fail ObjectId casting and crash the whole document's save()
  },

  lastActiveAt:      { type: Date, default: Date.now }, // updated on every authenticated request — feeds silent refresh

  // AI chatbot usage tracking — daily counter resets on WAT date
  // change, monthly counter resets on WAT month change. Server-side
  // so limits can't be bypassed by clearing local storage.
  aiChatDailyCount:    { type: Number, default: 0 },
  aiChatDailyDate:     { type: String, default: null },  // WAT YYYY-MM-DD
  aiChatMonthlyCount:  { type: Number, default: 0 },
  aiChatMonthlyMonth:  { type: String, default: null },  // WAT YYYY-MM

  // v1.3: opt-in only — off by default, students choose to appear on
  // the public/global leaderboard rather than being listed by default.
  publicLeaderboardOptIn: { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now },
});

// Sparse unique indexes: many existing accounts will have username/referralCode
// = null until migrated, and sparse means only non-null values are checked
// for uniqueness (multiple nulls are allowed).
StudentSchema.index({ username: 1 }, { unique: true, sparse: true });
StudentSchema.index({ referralCode: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Student', StudentSchema);
