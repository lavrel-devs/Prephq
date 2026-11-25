'use strict';
// Command centre: private admin notes + tags on a student. Never shown to the student, never part of their data export.
const mongoose = require('mongoose');

const AdminNoteSchema = new mongoose.Schema({
  matric: { type: String, required: true, uppercase: true, trim: true, index: true },
  text:   { type: String, required: true, maxlength: 1000 },
  tags:   { type: [String], default: [] },
  pinned: { type: Boolean, default: false },
  by:     { type: String, default: '' },
}, { timestamps: true });

AdminNoteSchema.index({ tags: 1 });

module.exports = mongoose.models.AdminNote || mongoose.model('AdminNote', AdminNoteSchema);
