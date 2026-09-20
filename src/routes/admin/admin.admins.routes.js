const express = require('express');
const bcrypt = require('bcryptjs');
const Admin = require('../../models/Admin');
const Session = require('../../models/Session');
const { requireAdmin, forgetSubject } = require('../../middleware/auth');
const { AREAS, normalizePermissions } = require('../../utils/adminAccess');

const router = express.Router();
router.use(requireAdmin);
// NOTE: who may call what is decided centrally by adminGate (server.js):
// /admins/me is open to every admin, everything else under /admins needs
// full access.

const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,29}$/;

function publicAdmin(a, lastActive) {
  return {
    username: a.username,
    fullAccess: a.fullAccess !== false,
    permissions: a.fullAccess !== false ? [] : (a.permissions || []),
    active: a.active !== false,
    createdAt: a.createdAt,
    createdBy: a.createdBy || '',
    lastActiveAt: lastActive || null,
  };
}

// True if, after the change, at least one active full-access admin remains.
async function otherFullAdminExists(excludeUsername) {
  const n = await Admin.countDocuments({
    username: { $ne: excludeUsername },
    active: { $ne: false },
    fullAccess: { $ne: false },
  });
  return n > 0;
}

// GET /api/admin/admins/me — the caller's own access (drives which tabs the panel shows).
router.get('/admins/me', (req, res) => {
  const { access, sub } = req.admin;
  res.json({
    username: sub,
    fullAccess: !!access.full,
    permissions: access.full ? [] : access.permissions,
    areas: AREAS,
  });
});

// GET /api/admin/admins — every admin account
router.get('/admins', async (req, res) => {
  try {
    const [admins, sessions] = await Promise.all([
      Admin.find().sort({ createdAt: 1 }).lean(),
      Session.aggregate([
        { $match: { role: 'admin' } },
        { $group: { _id: '$subjectId', last: { $max: '$lastActiveAt' } } },
      ]),
    ]);
    const last = Object.fromEntries(sessions.map(s => [s._id, s.last]));
    res.json({ admins: admins.map(a => publicAdmin(a, last[a.username])), areas: AREAS });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/admins — { username, password, fullAccess, permissions[] }
router.post('/admins', async (req, res) => {
  try {
    const username = typeof req.body.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const { password } = req.body;
    const fullAccess = req.body.fullAccess === true;

    if (!USERNAME_RE.test(username))
      return res.status(400).json({ error: 'Username must be 3–30 characters: letters, numbers, dot, dash or underscore' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 72)
      return res.status(400).json({ error: 'Password must be 8–72 characters' });

    let permissions = [];
    if (!fullAccess) {
      permissions = normalizePermissions(req.body.permissions);
      if (!permissions) return res.status(400).json({ error: 'Invalid permissions list' });
      if (!permissions.length) return res.status(400).json({ error: 'Pick at least one area, or grant full access' });
    }

    if (await Admin.exists({ username })) return res.status(409).json({ error: 'That username is already taken' });

    const passwordHash = await bcrypt.hash(password, 10);
    let admin;
    try {
      admin = await Admin.create({ username, passwordHash, fullAccess, permissions, createdBy: req.admin.sub });
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: 'That username is already taken' });
      throw e;
    }
    res.status(201).json(publicAdmin(admin));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/admins/:username — { fullAccess?, permissions?, active?, password? }
router.put('/admins/:username', async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();
    const admin = await Admin.findOne({ username });
    if (!admin) return res.status(404).json({ error: 'Admin not found' });

    const isSelf = username === req.admin.sub;
    const wasFull = admin.fullAccess !== false;
    const wasActive = admin.active !== false;
    const { fullAccess, permissions, active, password } = req.body;

    if (fullAccess !== undefined) {
      if (typeof fullAccess !== 'boolean') return res.status(400).json({ error: 'fullAccess must be true or false' });
      admin.fullAccess = fullAccess;
    }
    if (permissions !== undefined) {
      const norm = normalizePermissions(permissions);
      if (!norm) return res.status(400).json({ error: 'Invalid permissions list' });
      admin.permissions = norm;
    }
    if (admin.fullAccess === false && !(admin.permissions || []).length)
      return res.status(400).json({ error: 'Pick at least one area, or grant full access' });
    if (active !== undefined) {
      if (typeof active !== 'boolean') return res.status(400).json({ error: 'active must be true or false' });
      admin.active = active;
    }

    const nowFull = admin.fullAccess !== false;
    const nowActive = admin.active !== false;
    const losingFull = wasFull && wasActive && (!nowFull || !nowActive);
    if (losingFull) {
      // Lock-out protection: never demote/deactivate yourself, and never remove the last full admin.
      if (isSelf) return res.status(400).json({ error: "You can't remove your own full access or deactivate yourself" });
      if (!(await otherFullAdminExists(username))) return res.status(400).json({ error: 'At least one active full-access admin must remain' });
    }

    let passwordChanged = false;
    if (password !== undefined && password !== '') {
      if (typeof password !== 'string' || password.length < 8 || password.length > 72)
        return res.status(400).json({ error: 'Password must be 8–72 characters' });
      admin.passwordHash = await bcrypt.hash(password, 10);
      passwordChanged = true;
    }

    await admin.save();

    // Sign the admin out everywhere if they were deactivated or their password was reset;
    // otherwise just make sure the new permissions apply immediately.
    if ((wasActive && !nowActive) || passwordChanged) {
      await Session.updateMany({ subjectId: username, role: 'admin', revoked: { $ne: true } }, { revoked: true, revokedAt: new Date() });
    }
    forgetSubject('admin', username);

    res.json(publicAdmin(admin));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/admin/admins/:username
router.delete('/admins/:username', async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();
    if (username === req.admin.sub) return res.status(400).json({ error: "You can't delete your own account" });
    const admin = await Admin.findOne({ username });
    if (!admin) return res.status(404).json({ error: 'Admin not found' });
    if (admin.fullAccess !== false && admin.active !== false && !(await otherFullAdminExists(username)))
      return res.status(400).json({ error: 'At least one active full-access admin must remain' });

    await Admin.deleteOne({ _id: admin._id });
    await Session.deleteMany({ subjectId: username, role: 'admin' });
    forgetSubject('admin', username);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
