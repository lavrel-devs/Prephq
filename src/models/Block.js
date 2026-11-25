'use strict';
// Command centre: blocked IP addresses (optionally for a limited time). Enforced by middleware/blockGate.js.
const mongoose = require('mongoose');

const BlockSchema = new mongoose.Schema({
  kind:      { type: String, enum: ['ip'], default: 'ip' },
  value:     { type: String, required: true },
  reason:    { type: String, default: '', maxlength: 200 },
  by:        { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: null },
});
BlockSchema.index({ kind: 1, value: 1 }, { unique: true });

module.exports = mongoose.models.Block || mongoose.model('Block', BlockSchema);
