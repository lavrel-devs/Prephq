const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const Student = require('../models/Student');
const Admin = require('../models/Admin');
const Session = require('../models/Session');

const { signAccessToken, signRefreshToken, verifyRefreshToken, hashToken } = require('../utils/jwt');
const { getClientIp, isNewDevice } = require('../utils/fingerprint');
const { applyCreditDelta } = require('../utils/credits');
const { activateNewStudent } = require('../services/credit.service');
const { checkAvailability } = require('../utils/username');
const { usernameCheckLimiter } = require('../middleware/rateLimit');
const { cleanMatric, cleanName, cleanPhone } = require('../utils/validate');
const SupportRequest = require('../models/SupportRequest');
const Settings = require('../models/Settings');
const { requireStudent, forgetSubject } = require('../middleware/auth');
const { uniqueCode, pickAdminContact, waUrl } = require('../services/support.service');

const router = express.Router();

const SESSION_INACTIVITY_MIN = parseInt(process.env.SESSION_INACTIVITY_MIN || '180', 10);

// Brute-force protection on login. Keyed by IP *and* the account being
// tried: students routinely share one campus/hostel NAT address, and a
// plain per-IP cap of 30 would lock a whole hall out of the app.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.matric || req.body?.username || '').toLowerCase().slice(0, 40)}`,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

// Silent token refresh runs in the background for every open tab, so it
// must NOT share the (much tighter) login bucket — hitting the login
// cap used to make refresh 429 and the client would log the student out.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many refresh attempts. Try again shortly.', code: 'RATE_LIMITED' },
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

// POST /api/auth/register — free, open signup. Every new account starts on the free tier.
router.post('/register', async (req, res) => {
  try {
    const { password, referralCode, username } = req.body;

    const matric = cleanMatric(req.body.matric);
    const name = cleanName(req.body.name);
    const phone = cleanPhone(req.body.phone);
    const whatsapp = cleanPhone(req.body.whatsapp);

    if (!req.body.matric || !req.body.name)
      return res.status(400).json({ error: 'Matric number and name are required' });
    if (!matric)
      return res.status(400).json({ error: 'Matric number can only contain letters, numbers, spaces and / - _ . (3–30 characters)' });
    if (!name)
      return res.status(400).json({ error: 'Please enter your name (2–80 characters, no < or > symbols)' });
    if (phone === null || whatsapp === null)
      return res.status(400).json({ error: 'Phone numbers can only contain digits, +, -, ( ) and spaces' });
    // Self-registration requires the student to choose their own password (the old default
    // "your matric is your password" was guessable by anyone who knew a matric number).
    if (typeof password !== 'string' || password.length < 8 || password.length > 72)
      return res.status(400).json({ error: 'Choose a password of 8–72 characters' });
    if (password.trim().toUpperCase() === matric)
      return res.status(400).json({ error: "Your password can't be the same as your matric number" });

    // v1.3: username is now required at signup. Validate format and
    // availability BEFORE creating the
    // account, so a taken/invalid username fails fast with a clear
    // message instead of a half-finished registration.
    if (typeof username !== 'string' || !username.trim())
      return res.status(400).json({ error: 'Please choose a username' });

    const usernameCheck = await checkAvailability(username);
    if (!usernameCheck.ok)
      return res.status(409).json({ error: usernameCheck.reason === 'That username is already taken'
        ? 'Username already taken'
        : usernameCheck.reason });

    const exists = await Student.findOne({ matric });
    if (exists)
      return res.status(409).json({ error: 'This matric number is already registered' });

    const passwordHash = await bcrypt.hash(password, 10); // bcrypt only — the plaintext is never stored or returned

    let student;
    try {
      student = await Student.create({
        matric,
        passwordHash,
        name,
        phone,
        whatsapp,
        credits:           0,
        tier:              'free',
        username:          usernameCheck.username,
        usernameChangedAt: new Date(),
      });
    } catch (e) {
      // Two signups racing for the same matric/username slip past the
      // pre-checks above; the unique indexes catch them here.
      if (e.code === 11000) {
        const dupUser = e.keyPattern && e.keyPattern.username;
        return res.status(409).json({ error: dupUser ? 'Username already taken' : 'This matric number is already registered' });
      }
      throw e;
    }

    // v1.2: welcome bonus + referral payout. Assigns the student their
    // own referralCode, credits the welcome bonus (stacked with the
    // referee bonus if they signed up via a valid referral link), and
    // pays the referrer's reward — all amounts driven by Settings.
    await activateNewStudent(student, referralCode);

    res.status(201).json({
      matric:   student.matric,
      name:     student.name,
      message:  'Account created successfully',
    });
  } catch (e) { console.error('[auth] register', e); res.status(500).json({ error: 'Could not create the account. Please try again.' }); }
});

// ── Account recovery (no email, no automated reset) ───────────
// POST /api/auth/recovery  { matric, name }
// Files a request and returns a WhatsApp link to one of the admins, who verifies the student and issues a
// temporary password from the Support inbox. The response is IDENTICAL whether or not the matric exists, so
// this can't be used to find out who has an account.
const recoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests from this device. Please try again in a while.' },
});
router.post('/recovery', recoveryLimiter, async (req, res) => {
  try {
    const matric = cleanMatric(req.body.matric);
    const name = cleanName(req.body.name) || '';
    if (!matric) return res.status(400).json({ error: 'Enter your matric number exactly as you registered it' });

    const student = await Student.findOne({ matric }).select('name').lean();
    let reqDoc = await SupportRequest.findOne({ type: 'recovery', matric, status: 'open', createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } });
    let contact = await pickAdminContact();
    if (!reqDoc) {
      reqDoc = await SupportRequest.create({
        type: 'recovery', code: await uniqueCode(), matric, name, studentFound: !!student,
        assignedAdmin: contact ? contact.username : '',
      });
    }
    const msg = `Hi PrepHQ support, I can't log in and need help with my password.\nRequest: ${reqDoc.code}\nMatric: ${matric}${name ? '\nName: ' + name : ''}`;
    res.status(201).json({
      code: reqDoc.code,
      whatsappUrl: contact ? waUrl(contact.number, msg) : '',
      hasContact: !!contact,
      message: msg,
    });
  } catch (e) { res.status(500).json({ error: 'Could not send your request. Please try again.' }); }
});

// POST /api/auth/change-password  { currentPassword, newPassword }
// Used for the forced change after an admin-issued temporary password, and for changing it any time.
router.post('/change-password', requireStudent, rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' } }), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') return res.status(400).json({ error: 'Enter your current and new password' });
    if (newPassword.length < 8 || newPassword.length > 72) return res.status(400).json({ error: 'Choose a password of 8–72 characters' });

    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    if (!student.passwordHash || !(await bcrypt.compare(currentPassword, student.passwordHash)))
      return res.status(401).json({ error: 'Your current password is incorrect' });
    if (newPassword === currentPassword) return res.status(400).json({ error: 'Your new password must be different from the current one' });
    if (newPassword.trim().toUpperCase() === student.matric) return res.status(400).json({ error: "Your password can't be the same as your matric number" });

    student.passwordHash = await bcrypt.hash(newPassword, 10);
    student.password = '';
    student.mustChangePassword = false;
    await student.save();
    // Every other device is signed out; this one stays.
    await Session.updateMany({ subjectId: student.matric, role: 'student', _id: { $ne: req.student.sid }, revoked: { $ne: true } }, { revoked: true, revokedAt: new Date() });
    forgetSubject('student', student.matric);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Could not change your password. Please try again.' }); }
});

// GET /api/auth/username-check/:username — public availability check for
// the signup form and the admin "Add Student" form, both of which run
// before any login session exists. Read-only, rate-limited; same check
// the logged-in dashboard modal uses (src/routes/student.routes.js),
// just without requiring a session.
router.get('/username-check/:username', usernameCheckLimiter, async (req, res) => {
  try {
    const result = await checkAvailability(req.params.username);
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Could not check that username right now' }); }
});

// POST /api/auth/login — student login, issues JWT access + refresh tokens
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { matric, password, deviceFingerprint } = req.body;
    if (!matric || !password)
      return res.status(400).json({ error: 'Matric and password required' });
    // A JSON body can carry objects/arrays here; only plain strings are
    // valid credentials (and keep objects out of the Mongo query).
    if (typeof matric !== 'string' || typeof password !== 'string')
      return res.status(400).json({ error: 'Matric and password required' });

    const student = await Student.findOne({ matric: matric.trim().replace(/\s+/g, ' ').toUpperCase() });
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

    const fp = typeof deviceFingerprint === 'string' ? deviceFingerprint.slice(0, 128) : '';
    const flaggedNewDevice = isNewDevice(student.devices, fp);
    if (fp) {
      const known = student.devices.find(d => d.fingerprint === fp);
      if (known) known.lastSeenAt = new Date();
      else {
        student.devices.push({ fingerprint: fp });
        if (student.devices.length > 20) student.devices.splice(0, student.devices.length - 20); // don't let the list grow forever
      }
    }
    await student.save();

    const { accessToken, refreshToken } = await issueSession({
      subjectId: student.matric,
      role: 'student',
      req,
      deviceFingerprint: fp,
      flaggedNewDevice,
    });

    res.json({
      mustChangePassword: !!student.mustChangePassword,
      matric: student.matric,
      name: student.name,
      role: student.role,
      credits: student.credits,
      accessToken,
      refreshToken,
      expiresInMin: parseInt(process.env.JWT_ACCESS_TTL_MIN || '15', 10),
      newDeviceFlagged: flaggedNewDevice,
      // v1.4: false for every pre-v1.4 account by default, and for new
      // signups until they fill university/department/selectedCourses —
      // dashboard.html reads this to show the blocking completion modal.
      profileCompleted: student.profileCompleted,
    });
  } catch (e) { console.error('[auth]', e); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/auth/refresh — silently rotate a student's access token
router.post('/refresh', refreshLimiter, async (req, res) => {
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
    if (typeof username !== 'string' || typeof password !== 'string')
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
      deviceFingerprint: typeof req.body.deviceFingerprint === 'string' ? req.body.deviceFingerprint.slice(0, 128) : '',
      flaggedNewDevice: false,
    });

    res.json({
      username: admin.username,
      fullAccess: admin.fullAccess !== false,
      permissions: admin.fullAccess !== false ? [] : (admin.permissions || []),
      accessToken,
      refreshToken,
      expiresInMin: parseInt(process.env.JWT_ACCESS_TTL_MIN || '15', 10),
    });
  } catch (e) { console.error('[auth]', e); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/auth/admin/refresh
router.post('/admin/refresh', refreshLimiter, async (req, res) => {
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
    if (!refreshToken || typeof refreshToken !== 'string') return res.status(400).json({ error: 'Refresh token required' });

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

    // A suspended student / deactivated admin must not be able to keep a
    // session alive just by refreshing it (the sliding window would
    // otherwise let them stay signed in for up to 30 days).
    const subject = expectedRole === 'admin'
      ? await Admin.findOne({ username: payload.sub }).select('active').lean()
      : await Student.findOne({ matric: payload.sub }).select('active').lean();
    if (!subject || subject.active === false) {
      session.revoked = true;
      session.revokedAt = new Date();
      await session.save();
      return res.status(401).json({ error: 'This account is no longer active', code: 'SESSION_REVOKED' });
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
    if (!refreshToken || typeof refreshToken !== 'string') return res.json({ success: true });
    try {
      const payload = verifyRefreshToken(refreshToken);
      await Session.updateOne({ _id: payload.sid }, { revoked: true, revokedAt: new Date() });
    } catch (e) { /* token already invalid — nothing to revoke */ }
    res.json({ success: true });
  } catch (e) { console.error('[auth]', e); res.status(500).json({ error: 'Server error' }); }
}

module.exports = router;