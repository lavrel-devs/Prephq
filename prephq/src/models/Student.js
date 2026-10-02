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

  // ── v1.4 additions: extended profile ────────────────────────
  // Purely additive — existing accounts simply have these fields
  // absent/undefined until the student (or the mandatory completion
  // prompt) fills them in. No migration required.
  university:  { type: String, default: '', trim: true },
  department:  { type: String, default: '', trim: true },
  currentGPA:  { type: Number, default: null },
  targetGPA:   { type: Number, default: null },

  // v1.4.1: multi-university support. Different schools use different
  // GPA scales (4.0 vs 5.0 are the common ones in Nigeria, but this is
  // a free number, not an enum, so any scale a school actually uses
  // works) and different score-to-grade boundaries (70+ is an A at
  // some schools, 80+ at others). Each student sets their own to match
  // their school — there's no single shared standard across users.
  // gradingScale is sorted descending by minScore when saved (see
  // /api/profile/grading-system) so the highest matching band always
  // wins when converting a score to a grade point.
  gpaScale: { type: Number, default: 5.0 },
  gradingScale: {
    type: [{
      grade:    { type: String, required: true },  // e.g. 'A', 'B', 'C'
      minScore: { type: Number, required: true },   // lowest score (inclusive) that earns this grade
      point:    { type: Number, required: true },   // grade point on this student's gpaScale
    }],
    // Sensible Nigerian 5.0-scale default — replaced entirely the
    // first time a student saves their own grading system.
    default: [
      { grade: 'A', minScore: 70, point: 5 },
      { grade: 'B', minScore: 60, point: 4 },
      { grade: 'C', minScore: 50, point: 3 },
      { grade: 'D', minScore: 45, point: 2 },
      { grade: 'E', minScore: 40, point: 1 },
      { grade: 'F', minScore: 0,  point: 0 },
    ],
  },

  // Courses the student is offering this semester — replaces the
  // "show every course" dashboard view once set. `[]` (empty/unset)
  // is treated as "not yet selected", which is what triggers the
  // profile-completion prompt below. No cap on how many can be picked.
  selectedCourses: { type: [String], default: [] },

  // Settings-level override: lets a student who already selected
  // courses opt back into seeing the full course catalog on the
  // dashboard without clearing their selection.
  showAllCoursesOverride: { type: Boolean, default: false },

  // Drives the blocking "complete your profile" modal on login.
  // Set true once university/department/selectedCourses are all
  // filled — checked server-side (see auth middleware) so it can't
  // be bypassed by editing client state. Applies to existing accounts
  // too: any account created before v1.4 starts with this at false.
  profileCompleted: { type: Boolean, default: false },

  // ── v1.4 additions: subscription tier & usage counters ──────
  // Replaces the old activation-code-gated Premium/Pro split. Every
  // account — new or pre-v1.4 — starts on 'free'. tierExpiresAt is
  // null for free (never expires) and for lifetime grants; for paid
  // tiers it's set on upgrade and checked to auto-revert to 'free'
  // once passed (see tier.service.js).
  tier:          { type: String, enum: ['free', 'premium'], default: 'free' },
  // Which Premium billing period is active. 'lifetime' is a permanent entitlement (tierExpiresAt is
  // ignored); null on a premium account = manual/legacy grant.
  premiumPlan:   { type: String, enum: ['weekly', 'monthly', 'yearly', 'lifetime', null], default: null },
  tierExpiresAt: { type: Date, default: null },

  // Daily practice-question usage (free tier: 20/day). Mirrors the
  // aiChatDailyCount/aiChatDailyDate pattern above — reset on WAT
  // date change, checked+incremented server-side so it can't be
  // bypassed client-side.
  dailyQuestionCount: { type: Number, default: 0 },
  dailyQuestionDate:  { type: String, default: null },

  // Daily AI-quiz generations (free tier: 2/day) — separate from and
  // in addition to the existing per-generation credit cost.
  dailyAIQuizCount: { type: Number, default: 0 },
  dailyAIQuizDate:  { type: String, default: null },

  // ── Cosmetics shop (routes/cosmetics.routes.js) ─────────────
  // These three fields were referenced by the shop routes but never
  // defined on the schema, so Mongoose's strict mode dropped them:
  // `student.ownedCosmetics.push(...)` threw *after* the credits had
  // already been deducted.
  ownedCosmetics: { type: [mongoose.Schema.Types.ObjectId], ref: 'CosmeticItem', default: [] },
  equippedBadge:  { type: mongoose.Schema.Types.ObjectId, ref: 'CosmeticItem', default: null },
  equippedFrame:  { type: mongoose.Schema.Types.ObjectId, ref: 'CosmeticItem', default: null },

  // Set when an admin issues a temporary password; the student must choose a new one before using the app.
  mustChangePassword: { type: Boolean, default: false },

  // Earned achievements (services/achievements.service.js) and the one shown next to their name on the leaderboard.
  achievements:       { type: [{ _id: false, key: String, earnedAt: { type: Date, default: Date.now } }], default: [] },
  equippedAchievement: { type: String, default: '' },

  createdAt: { type: Date, default: Date.now },
});

// Sparse unique indexes: many existing accounts will have username/referralCode
// = null until migrated, and sparse means only non-null values are checked
// for uniqueness (multiple nulls are allowed).
StudentSchema.index({ username: 1 }, { unique: true, sparse: true });
StudentSchema.index({ referralCode: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Student', StudentSchema);
