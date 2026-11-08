const mongoose = require('mongoose');

// Sponsor link (v1.9.2): a student's opt-in, read-only weekly progress page for the person who pays for their plan.
// The token is the only thing in the URL. Turning it off (or making a new one) kills the old link at once.
const SponsorLinkSchema = new mongoose.Schema({
  matric:       { type: String, required: true, uppercase: true, unique: true },
  token:        { type: String, required: true, unique: true, index: true },
  enabled:      { type: Boolean, default: true },
  views:        { type: Number, default: 0 },
  lastViewedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('SponsorLink', SponsorLinkSchema);
