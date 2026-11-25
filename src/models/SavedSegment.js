'use strict';
// Command centre: a named student group (a saved set of conditions) that can be re-run later.
const mongoose = require('mongoose');

const SavedSegmentSchema = new mongoose.Schema({
  name:      { type: String, required: true, unique: true, trim: true, maxlength: 40 },
  filter:    { type: mongoose.Schema.Types.Mixed, default: {} },
  by:        { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.models.SavedSegment || mongoose.model('SavedSegment', SavedSegmentSchema);
