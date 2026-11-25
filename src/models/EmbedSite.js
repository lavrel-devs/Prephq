'use strict';
// v1.19 — Web pages: a page on our own domain (/w/<slug>) that shows another website inside a frame, or sends visitors to it.
const mongoose = require('mongoose');

const EmbedSiteSchema = new mongoose.Schema({
  slug:             { type: String, required: true, unique: true, lowercase: true, trim: true },
  url:              { type: String, required: true },
  title:            { type: String, default: '', maxlength: 120 },
  description:      { type: String, default: '', maxlength: 300 },
  mode:             { type: String, enum: ['embed', 'redirect'], default: 'embed' },
  active:           { type: Boolean, default: true },
  views:            { type: Number, default: 0 },
  lastViewAt:       { type: Date, default: null },
  embeddable:       { type: String, enum: ['yes', 'no', 'unknown'], default: 'unknown' },   // result of the last check of the target site
  embeddableReason: { type: String, default: '' },
  checkedAt:        { type: Date, default: null },
  createdBy:        { type: String, default: '' },
}, { timestamps: true });

EmbedSiteSchema.index({ createdAt: -1 });

module.exports = mongoose.models.EmbedSite || mongoose.model('EmbedSite', EmbedSiteSchema);
