const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const Student = require('../models/Student');
const Admin = require('../models/Admin');
const Code = require('../models/Code');
const Session = require('../models/Session');

const { signAccessToken, signRefreshToken, verifyRefreshToken, hashToken } = require('../utils/jwt');
const { getClientIp, isNewDevice } = require('../utils/fingerprint');
const { applyCreditDelta } = require('../utils/credits');

const router = express.Router();

const SESSION_INACTIVITY_MIN = parseInt(process.env.SESSION_INACTIVITY_MIN || '180', 10);

// Light brute-force protection on login/refresh endpoints.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

// ── helpers ──────────────────────────────────────────────────
function sessionExpiry() {
  return new Date(Date.now() + SESSION_INACTIVITY_MIN * 60 * 1000);
}

async function issueSession({ subjectId, role, req, deviceFingerprint, flaggedNewDevice }) {
  const accessToken = signAccessToken({ sub: subjectId, role });
  const refreshToken = signRefreshToken({ sub: subjectId, role });

  const session = await Session.create({
    subjectId,
    role,
    refreshHash: hashToken(refreshToken),
    ip: getClientIp(req),
    userAgent: req.headers['user-agent'] || '',
    deviceFingerprint: deviceFingerprint || '',
    isNewDevice: !!flaggedNewDevice,
    expiresAt: sessionExpiry(),
  });

  // attach session id into the tokens by re-signing with sid included
  const accessTokenWithSid = signAccessToken({ sub: subjectId, role, sid: session._id.toString() });
  const refreshTokenWithSid = signRefreshToken({ sub: subjectId, role, sid: session._id.toString() });
  session.refreshHash = hashToken(refreshTokenWithSid);
  await session.save();

  return { accessToken: accessTokenWithSid, refreshToken: refreshTokenWithSid, session };
}

// ══════════════════════════════════════════════════════════════
//  STUDENT AUTH
// ══════════════════════════════════════════════════════════════

// POST /api/auth/register — student self-registration with activation code
router.post('/register', async (req, res) => {
  try {
    const { matric, name, phone, whatsapp, code, password } = req.body;

    if (!matric || !name || !code)
      return res.status(400).json({ error: 'Matric, name and activation code are required' });

    const exists = await Student.findOne({ matric: matric.toUpperCase() });
    if (exists)
      return res.status(409).json({ error: 'This matric number is already registered' });

    const codeDoc = await Code.findOne({ code: code.trim().toUpperCase() });
    if (!codeDoc)
      return res.status(404).json({ error: 'Invalid activation code' });
    if (codeDoc.status === 'used')
      return res.status(409).json({ error: 'This code has already been used' });
    if (codeDoc.status === 'expired')
      return res.status(410).json({ error: 'This code has expired' });
    if (codeDoc.expiresAt && new Date() > codeDoc.expiresAt)
      return res.status(410).json({ error: 'This code has expired' });

    const pw = password || matric.toUpperCase();
    const passwordHash = await bcrypt.hash(pw, 10);

    const student = await Student.create({
      matric:       matric.toUpperCase().trim(),
      passwordHash,
      name:         name.trim(),
      phone:        phone?.trim() || '',
      whatsapp:     whatsapp?.trim() || '',
      codeUsed:     codeDoc.code,
      credits:      0,
    });

    await Code.updateOne({ _id: codeDoc._id }, {
      status: 'used',
      usedBy: student.matric,
      usedAt: new Date(),
    });

    // If this code was configured with a starting credit grant, apply it.
    if (codeDoc.creditsGranted > 0) {
      await applyCreditDelta({
        matric: student.matric,
        delta: codeDoc.creditsGranted,
        reason: 'admin_credit',
        note: `Starting credits from activation code ${codeDoc.code}`,
        actor: 'system',
      });
    }

    res.status(201).json({
      matric:   student.matric,
      name:     student.name,
      password: pw,
      message:  'Account created successfully',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/auth/login — student login, issues JWT access + refresh tokens
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { matric, password, deviceFingerprint } = req.body;
    if (!matric || !password)
      return res.status(400).json({ error: 'Matric and password required' });

    const student = await Student.findOne({ matric: matric.toUpperCase() });
    if (!student) return res.status(401).json({ error: 'Invalid matric number or password' });

    let valid = false;
    if (student.passwordHash) {
      valid = await bcrypt.compare(password, student.passwordHash);
    } else if (student.password) {
      // Legacy plaintext account (pre-v1.1.0). Verify against the old
      // field, then transparently migrate to a proper hash so this
      // branch is never hit again for this student.
      valid = password === student.password;
      if (valid) {
        student.passwordHash = await bcrypt.hash(password, 10);
        student.password = '';
      }
    }

    if (!valid) return res.status(401).json({ error: 'Invalid matric number or password' });
    if (!student.active) return res.status(403).json({ error: 'Account suspended. Contact admin.' });

    const flaggedNewDevice = isNewDevice(student.devices, deviceFingerprint);
    if (deviceFingerprint) {
      const known = student.devices.find(d => d.fingerprint === deviceFingerprint);
      if (known) known.lastSeenAt = new Date();
      else student.devices.push({ fingerprint: deviceFingerprint });
    }
    await student.save();

    const { accessToken, refreshToken } = await issueSession({
      subjectId: student.matric,
      role: 'student',
      req,
      deviceFingerprint,
      flaggedNewDevice,
    });

    res.json({
      matric: student.matric,
      name: student.name,
      role: student.role,
      credits: student.credits,
      accessToken,
      refreshToken,
      expiresInMin: parseInt(process.env.JWT_ACCESS_TTL_MIN || '15', 10),
      newDeviceFlagged: flaggedNewDevice,
    });
  } catch (e) { console.error('[auth]', e); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/auth/refresh — silently rotate a student's access token
router.post('/refresh', loginLimiter, async (req, res) => {
  await handleRefresh(req, res, 'student');
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  await handleLogout(req, res);
});

// ══════════════════════════════════════════════════════════════
//  ADMIN AUTH (JWT)
// ══════════════════════════════════════════════════════════════

// POST /api/auth/admin/login — username + password
router.post('/admin/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });

    const admin = await Admin.findOne({ username: username.toLowerCase().trim() });
    if (!admin || !admin.active)
      return res.status(401).json({ error: 'Invalid username or password' });

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

    const { accessToken, refreshToken } = await issueSession({
      subjectId: admin.username,
      role: 'admin',
      req,
      deviceFingerprint: req.body.deviceFingerprint,
      flaggedNewDevice: false,
    });

    res.json({
      username: admin.username,
      accessToken,
      refreshToken,
      expiresInMin: parseInt(process.env.JWT_ACCESS_TTL_MIN || '15', 10),
    });
  } catch (e) { console.error('[auth]', e); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/auth/admin/refresh
router.post('/admin/refresh', loginLimiter, async (req, res) => {
  await handleRefresh(req, res, 'admin');
});

// POST /api/auth/admin/logout
router.post('/admin/logout', async (req, res) => {
  await handleLogout(req, res);
});

// ── shared refresh/logout logic ─────────────────────────────
async function handleRefresh(req, res, expectedRole) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired refresh token', code: 'REFRESH_INVALID' });
    }

    if (payload.role !== expectedRole) return res.status(403).json({ error: 'Forbidden' });

    const session = await Session.findById(payload.sid);
    if (!session || session.revoked) {
      return res.status(401).json({ error: 'Session no longer valid', code: 'SESSION_REVOKED' });
    }
    if (session.refreshHash !== hashToken(refreshToken)) {
      return res.status(401).json({ error: 'Token mismatch', code: 'REFRESH_INVALID' });
    }
    if (session.expiresAt < new Date()) {
      session.revoked = true;
      session.revokedAt = new Date();
      await session.save();
      return res.status(401).json({ error: 'Session expired from inactivity. Please log in again.', code: 'SESSION_EXPIRED' });
    }

    // Sliding window: still active, so extend the session and rotate tokens.
    const newAccessToken = signAccessToken({ sub: payload.sub, role: payload.role, sid: session._id.toString() });
    const newRefreshToken = signRefreshToken({ sub: payload.sub, role: payload.role, sid: session._id.toString() });

    session.refreshHash = hashToken(newRefreshToken);
    session.lastActiveAt = new Date();
    session.expiresAt = sessionExpiry();
    session.ip = getClientIp(req);
    await session.save();

    res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresInMin: parseInt(process.env.JWT_ACCESS_TTL_MIN || '15', 10),
    });
  } catch (e) { console.error('[auth]', e); res.status(500).json({ error: 'Server error' }); }
}

async function handleLogout(req, res) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.json({ success: true });
    try {
      const payload = verifyRefreshToken(refreshToken);
      await Session.updateOne({ _id: payload.sid }, { revoked: true, revokedAt: new Date() });
    } catch (e) { /* token already invalid — nothing to revoke */ }
    res.json({ success: true });
  } catch (e) { console.error('[auth]', e); res.status(500).json({ error: 'Server error' }); }
}

module.exports = router;