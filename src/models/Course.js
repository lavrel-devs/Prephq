const mongoose = require('mongoose');

// ── Course ────────────────────────────────────────────────────
// New in v1.1.5. Courses used to be a hardcoded object baked into
// dashboard.html. They now live here so admins can add/edit/remove
// courses without touching code, and the dashboard/admin course
// pickers fetch this list live.
//
// `key` is the lowercase, no-space identifier the frontend has always
// used internally (localStorage perf tracking, BANK lookups, selected-
// course state, etc.) — derived from courseCode so existing client
// logic that keyed everything off e.g. "chm141" keeps working.
// `color` and `icon` preserve the visual identity the old hardcoded
// list had (icon is a key into the frontend's existing CICO icon set).
const CourseSchema = new mongoose.Schema({
  courseCode:  { type: String, required: true, unique: true, uppercase: true, trim: true },
  key:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  courseTitle: { type: String, required: true, trim: true },
  department:  { type: String, default: '', trim: true },
  level:       { type: String, default: '', trim: true },
  topics:      { type: [String], default: [] },
  color:       { type: String, default: '#3E5C8A' },
  icon:        { type: String, default: 'star' },
  // v1.11: 'university' (every course that existed before) or 'secondary' (JAMB / WAEC / NECO / school subjects).
  // Courses saved before v1.11 have no value at all, so every university query uses { track: { $ne: 'secondary' } }.
  track:       { type: String, enum: ['university', 'secondary'], default: 'university' },
  // v1.14 admin controls for Secondary subjects: hide a subject without deleting it, and override which exams examine it
  // (empty list = use the built-in list in utils/secondary.js).
  disabled:    { type: Boolean, default: false },
  exams:       { type: [String], default: [] },
  createdAt:   { type: Date, default: Date.now },
});

CourseSchema.pre('validate', function (next) {
  if (this.courseCode && !this.key) {
    this.key = this.courseCode.toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  next();
});

module.exports = mongoose.model('Course', CourseSchema);
