const mongoose = require('mongoose');

// ── CosmeticItem ──────────────────────────────────────────────
// New in v1.3. Purchasable profile cosmetics — gives credits somewhere
// to go besides transfers and contest entry. Kept deliberately simple
// (no image uploads): a badge is an emoji/short glyph shown next to
// the student's name, a frame is a CSS gradient/color applied as a
// ring around their avatar. Both render entirely client-side from
// `value`, no asset pipeline needed.
const CosmeticItemSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  type:        { type: String, enum: ['badge', 'frame'], required: true },
  value:       { type: String, required: true }, // badge: emoji/glyph; frame: CSS gradient/color string
  price:       { type: Number, required: true, min: 0 },
  description: { type: String, default: '' },
  active:      { type: Boolean, default: true }, // inactive items stay owned by anyone who bought them, just drop from the shop listing

  createdBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('CosmeticItem', CosmeticItemSchema);
