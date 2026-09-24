const mongoose = require('mongoose');

// A background "write every note" run. It lives on the server (not in the admin's browser tab), so it keeps
// going if the tab is closed, waits out AI rate limits by itself, and resumes after a server restart.
const NoteJobSchema = new mongoose.Schema({
  scope:      { type: String, enum: ['course', 'all'], default: 'course' },
  status:     { type: String, enum: ['queued', 'running', 'done', 'cancelled', 'failed'], default: 'queued', index: true },
  message:    { type: String, default: '' },      // human-readable "what is it doing"
  current:    { type: String, default: '' },
  waitUntil:  { type: Date, default: null },      // set while the AI queue is waiting out a rate limit
  courses: [{
    key: String, code: String,
    state: { type: String, default: 'pending' },  // pending | outlining | ready | nodata | failed
    error: { type: String, default: '' },
    topics: { type: Number, default: 0 },
  }],
  items: [{
    courseKey: String, topic: String, tags: [String], questionIds: [String],
    status: { type: String, default: 'pending' }, // pending | done | skipped | failed
    error: { type: String, default: '' },
  }],
  counts: { total: { type: Number, default: 0 }, done: { type: Number, default: 0 }, skipped: { type: Number, default: 0 }, failed: { type: Number, default: 0 } },
  createdBy:  { type: String, default: '' },
  startedAt:  { type: Date, default: null },
  finishedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('NoteJob', NoteJobSchema);
