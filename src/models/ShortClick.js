'use strict';
// v1.18 — one row per link per day (Nigerian date), incremented on every redirect. Rows expire after 120 days.
const mongoose = require('mongoose');

const ShortClickSchema = new mongoose.Schema({
  link: { type: mongoose.Schema.Types.ObjectId, ref: 'ShortLink', required: true },
  day:  { type: String, required: true },                 // YYYY-MM-DD
  n:    { type: Number, default: 0 },
  at:   { type: Date, default: Date.now, expires: 60 * 60 * 24 * 120 },
});
ShortClickSchema.index({ link: 1, day: 1 }, { unique: true });

module.exports = mongoose.models.ShortClick || mongoose.model('ShortClick', ShortClickSchema);
