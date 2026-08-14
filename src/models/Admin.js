const mongoose = require('mongoose');

// ── Admin ─────────────────────────────────────────────────────
// New in v1.1.0. Admin accounts now log in with username + password
// (JWT), instead of only the shared ADMIN_KEY. The very first admin
// is auto-seeded from ADMIN_KEY on server boot — see server.js.
const AdminSchema = new mongoose.Schema({
  username:     { type: String, required: true, unique: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role:         { type: String, default: 'admin' },
  active:       { type: Boolean, default: true },
  createdAt:    { type: Date, default: Date.now },
});

module.exports = mongoose.model('Admin', AdminSchema);
