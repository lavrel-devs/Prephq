'use strict';
// Command centre: one row per bulk action that was applied. suspend/reactivate keep each student's previous state (prevActive) so the run can be undone.
const mongoose = require('mongoose');

const BulkRunSchema = new mongoose.Schema({
  action:     { type: String, required: true },
  by:         { type: String, default: '' },
  matched:    { type: Number, default: 0 },
  affected:   { type: Number, default: 0 },
  failed:     { type: Number, default: 0 },
  summary:    { type: String, default: '' },
  matrics:    { type: [String], default: [] },
  prevActive: { type: [{ _id: false, m: String, a: Boolean }], default: undefined },
  undoneAt:   { type: Date, default: null },
  undoneBy:   { type: String, default: '' },
  at:         { type: Date, default: Date.now, expires: 60 * 60 * 24 * 180 },   // history is kept for 180 days
});
BulkRunSchema.index({ at: -1 });

module.exports = mongoose.models.BulkRun || mongoose.model('BulkRun', BulkRunSchema);
