const crypto = require('crypto');
const { verifyAccessToken } = require('../utils/jwt');
const Session = require('../models/Session');
const Student = require('../models/Student');
const Admin = require('../models/Admin');

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

// Constant-time string comparison (for the legacy ADMIN_KEY header).
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Fire-and-forget activity touch — never blocks or fails the request.
// v1.2: previously lastActiveAt was only updated during explicit
// /api/auth/refresh calls. Updating it on authenticated requests gives
// an accurate "last seen" signal (used by the admin activity log and
// the retention analytics). Throttled to once a minute per session so a
// chatty page doesn't turn every API call into two extra DB writes.
const TOUCH_EVERY_MS = 60 * 1000;
const lastTouch = new Map();
function touchActivity(sid, matric) {
  const key = `${sid || ''}|${matric || ''}`;
  const nowMs = Date.now();
  if (nowMs - (lastTouch.get(key) || 0) < TOUCH_EVERY_MS) return;
  lastTouch.set(key, nowMs);
  if (lastTouch.size > 10000) {
    for (const [k, t] of lastTouch) if (nowMs - t > TOUCH_EVERY_MS) lastTouch.delete(k);
  }
  const now = new Date();
  if (sid) Session.updateOne({ _id: sid }, { lastActiveAt: now }).catch(() => {});
  if (matric) Student.updateOne({ matric }, { lastActiveAt: now }).catch(() => {});
}

// A valid JWT alone isn't enough: a suspended student, a deactivated
// admin, or a logged-out/revoked session must lose access without
// waiting out the rest of the 15-minute access token. Checked against
// the DB, but cached for 30s per subject+session so it costs one small
// read per user per half-minute rather than one per request.
const ALLOW_CACHE_MS = 30 * 1000;
const allowCache = new Map();

async function isSessionAllowed(payload) {
  const key = `${payload.role}:${payload.sub}:${payload.sid || ''}`;
  const hit = allowCache.get(key);
  if (hit && Date.now() - hit.ts < ALLOW_CACHE_MS) return hit.ok;

  let ok = true;
  let access = null;
  if (payload.sid) {
    const s = await Session.findById(payload.sid).select('revoked').lean();
    if (!s || s.revoked) ok = false;
  }
  if (ok) {
    if (payload.role === 'student') {
      const st = await Student.findOne({ matric: payload.sub }).select('active').lean();
      ok = !!st && st.active !== false;
    } else if (payload.role === 'admin') {
      const a = await Admin.findOne({ username: payload.sub }).select('active fullAccess permissions').lean();
      ok = !!a && a.active !== false;
      // Missing field (admin created before roles existed) = full access.
      if (ok) access = { full: a.fullAccess !== false, permissions: a.permissions || [] };
    }
  }

  allowCache.set(key, { ok, ts: Date.now(), access });
  if (allowCache.size > 5000) {
    const cutoff = Date.now() - ALLOW_CACHE_MS;
    for (const [k, v] of allowCache) if (v.ts < cutoff) allowCache.delete(k);
  }
  return ok;
}

// Drop cached decisions for a subject immediately (called when an admin
// suspends a student etc.) so the change doesn't wait for the TTL.
function forgetSubject(role, sub) {
  const prefix = `${role}:${sub}:`;
  for (const k of allowCache.keys()) if (k.startsWith(prefix)) allowCache.delete(k);
}

// Access level for an admin whose session was just approved by isSessionAllowed.
function cachedAccess(payload) {
  const hit = allowCache.get(`${payload.role}:${payload.sub}:${payload.sid || ''}`);
  return (hit && hit.access) || { full: false, permissions: [] };
}

function tokenError(e) {
  return {
    error: 'Invalid or expired token',
    code: e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
  };
}

// Protects student-facing routes. Requires a valid, unexpired access token.
async function requireStudent(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Missing access token' });

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (e) {
    return res.status(401).json(tokenError(e));
  }
  if (payload.role !== 'student') return res.status(403).json({ error: 'Forbidden' });

  try {
    if (!(await isSessionAllowed(payload))) {
      return res.status(401).json({ error: 'Session no longer valid', code: 'SESSION_REVOKED' });
    }
  } catch (e) {
    console.error('[auth] session check failed:', e.message);
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }

  req.student = payload; // { sub: matric, role, sid }
  touchActivity(payload.sid, payload.sub);
  next();
}

// Protects admin routes. Accepts EITHER:
//   a) Authorization: Bearer <admin JWT>   (used by admin.html going forward)
//   b) x-admin-key: <ADMIN_KEY from .env>  (legacy, kept alive for
//      question-uploader.html and any external scripts)
async function requireAdmin(req, res, next) {
  const legacyKey = req.headers['x-admin-key'] || req.body?.adminKey;
  if (legacyKey && process.env.ADMIN_KEY && typeof legacyKey === 'string' && safeEqual(legacyKey, process.env.ADMIN_KEY)) {
    req.admin = { username: 'legacy-key', sub: 'legacy-key', role: 'admin', access: { full: true, permissions: [] } };
    return next();
  }

  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Missing admin credentials' });

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (e) {
    return res.status(401).json(tokenError(e));
  }
  if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  try {
    if (!(await isSessionAllowed(payload))) {
      return res.status(401).json({ error: 'Session no longer valid', code: 'SESSION_REVOKED' });
    }
  } catch (e) {
    console.error('[auth] session check failed:', e.message);
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }

  req.admin = { ...payload, access: cachedAccess(payload) }; // { sub: username, role, sid, access }
  touchActivity(payload.sid, null);
  next();
}

// Permission gate for the whole /api/admin tree (mounted once in server.js,
// after requireAdmin). See utils/adminAccess.js for the path → area table.
function adminGate(req, res, next) {
  const { checkAccess } = require('../utils/adminAccess');
  if (checkAccess(req.admin.access, req.method, req.path)) return next();
  return res.status(403).json({ error: "You don't have permission to do that", code: 'FORBIDDEN_AREA' });
}

module.exports = { adminGate, requireStudent, requireAdmin, getBearerToken, isSessionAllowed, forgetSubject, safeEqual };
