const mongoose = require('mongoose');

// ── PlatformConfig ────────────────────────────────────────────
// v1.14. One document (key: 'global') holding the admin's live platform controls: maintenance mode, a site banner,
// feature kill switches and everything the admin can tune for Wreddi Secondary. Changing it needs no redeploy.
// Defaults live in services/platformConfig.service.js (DEFAULTS), which also validates every write.
const n = { type: Number, default: null };
const PaperShape = { _id: false, minutes: n, questions: n, miniMinutes: n, miniQuestions: n };

const PlatformConfigSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'global' },

  maintenance: {
    enabled: { type: Boolean, default: false },
    message: { type: String, default: '' },
    eta:     { type: String, default: '' },
  },
  banner: {
    enabled:  { type: Boolean, default: false },
    text:     { type: String, default: '' },
    tone:     { type: String, enum: ['info', 'warn', 'danger'], default: 'info' },
    audience: { type: String, enum: ['all', 'university', 'secondary'], default: 'all' },
  },
  switches: {
    signups:         { type: Boolean, default: true },
    logins:          { type: Boolean, default: true },
    aiChat:          { type: Boolean, default: true },
    aiQuiz:          { type: Boolean, default: true },
    contests:        { type: Boolean, default: true },
    studyRooms:      { type: Boolean, default: true },
    creditTransfers: { type: Boolean, default: true },
  },
  secondary: {
    enabled:          { type: Boolean, default: true },
    signupsOpen:      { type: Boolean, default: true },
    exams: {
      jamb:   { type: Boolean, default: true },
      waec:   { type: Boolean, default: true },
      neco:   { type: Boolean, default: true },
      school: { type: Boolean, default: true },
    },
    motd:             { type: String, default: '' },
    maxPracticeCount: { type: Number, default: 50 },
    freeDailyMocks:   n,   // null = unlimited. Mock papers a Free-plan Secondary student can start per day.
    papers: {
      jamb:   { _id: false, minutes: n, miniMinutes: n, firstSubjectQs: n, otherSubjectQs: n, miniFirstQs: n, miniOtherQs: n },
      waec:   PaperShape,
      neco:   PaperShape,
      school: PaperShape,
    },
  },

  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: String, default: '' },
}, { minimize: false });

PlatformConfigSchema.statics.getGlobal = async function () {
  return this.findOneAndUpdate({ key: 'global' }, { $setOnInsert: { key: 'global' } }, { new: true, upsert: true, setDefaultsOnInsert: true });
};

module.exports = mongoose.model('PlatformConfig', PlatformConfigSchema);
