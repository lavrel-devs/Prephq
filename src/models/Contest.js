const mongoose = require('mongoose');

// ── Contest ───────────────────────────────────────────────────
// New in v1.2. Admin-created contests/events. `participants` holds
// per-user join state (score, rank, prize) rather than a separate
// collection, since contest sizes are expected to be small/moderate
// (bounded by maxParticipants) — keeps join/leaderboard reads to a
// single document fetch.
const ParticipantSchema = new mongoose.Schema({
  studentId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  matric:       { type: String, required: true, uppercase: true },
  username:     { type: String, default: '' },
  joinedAt:     { type: Date, default: Date.now },
  score:        { type: Number, default: 0 },
  rank:         { type: Number, default: null },
  prizeAwarded: { type: Number, default: 0 },
  entryFeePaid: { type: Number, default: 0 },
  submittedAt:  { type: Date, default: null }, // set on quiz submission — a 0% score must still count as "submitted"
}, { _id: false });

// v1.3: team-based contests. A team is created by one student (who
// picks a name and gets a shareable teamCode back), and others join
// via that code. Each member pays the entry fee individually — there's
// no shared "team wallet" — but score, rank, and leaderboard position
// are all tracked at the team level. Prizes are split evenly across
// members at settlement.
const TeamMemberSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  matric:    { type: String, required: true, uppercase: true },
  username:  { type: String, default: '' },
  joinedAt:  { type: Date, default: Date.now },
  entryFeePaid: { type: Number, default: null }, // null on pre-fix records; refunds fall back to contest.entryFee
}, { _id: false });

const TeamSchema = new mongoose.Schema({
  teamCode:     { type: String, required: true }, // short shareable code, unique within the contest
  teamName:     { type: String, required: true, trim: true },
  members:      { type: [TeamMemberSchema], default: [] },
  score:        { type: Number, default: 0 },
  rank:         { type: Number, default: null },
  submittedAt:  { type: Date, default: null },
  prizeAwarded: { type: Number, default: 0 }, // total prize for the team, before the even split at payout time
}, { _id: false });

const PrizeTierSchema = new mongoose.Schema({
  rank:   { type: Number, required: true },
  amount: { type: Number, required: true },
}, { _id: false });

const ContestSchema = new mongoose.Schema({
  title:          { type: String, required: true, trim: true },
  description:    { type: String, default: '' },
  bannerImage:    { type: String, default: '' },

  startTime:      { type: Date, required: true },
  endTime:        { type: Date, required: true },

  entryFee:       { type: Number, default: 0, min: 0 },
  maxParticipants:{ type: Number, default: null },   // null = unlimited

  prizePool:          { type: Number, default: 0, min: 0 },
  prizeDistribution:  { type: [PrizeTierSchema], default: [] }, // e.g. [{rank:1,amount:50},{rank:2,amount:30}]

  type:   { type: String, enum: ['quiz', 'raffle', 'leaderboard', 'timed'], required: true },
  status: { type: String, enum: ['draft', 'upcoming', 'live', 'paused', 'ended', 'cancelled'], default: 'draft' },

  questions:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }], // quiz-type contests only

  participants: { type: [ParticipantSchema], default: [] },

  // v1.3: when teamBased is true, `participants` is unused for
  // scoring/ranking purposes — everything happens on `teams` instead.
  // teamSize caps members per team (null = unlimited).
  teamBased: { type: Boolean, default: false },
  teamSize:  { type: Number, default: null },
  teams:     { type: [TeamSchema], default: [] },

  createdBy: { type: String, default: '' }, // admin username
  remindersSent: { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

ContestSchema.index({ status: 1, startTime: 1 });
ContestSchema.index({ 'participants.matric': 1 });

ContestSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Contest', ContestSchema);
