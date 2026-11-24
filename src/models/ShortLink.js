'use strict';
// v1.18 — Short links. One document per link; per-day click counts live in ShortClick so the link stays small.
const mongoose = require('mongoose');

const ShortLinkSchema = new mongoose.Schema({
  code:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  url:         { type: String, required: true },
  title:       { type: String, default: '', maxlength: 120 },
  active:      { type: Boolean, default: true },
  clicks:      { type: Number, default: 0 },
  lastClickAt: { type: Date, default: null },
  expiresAt:   { type: Date, default: null },
  createdBy:   { type: String, default: '' },
}, { timestamps: true });

ShortLinkSchema.index({ createdAt: -1 });

module.exports = mongoose.models.ShortLink || mongoose.model('ShortLink', ShortLinkSchema);
