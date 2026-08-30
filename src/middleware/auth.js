const { verifyAccessToken } = require('../utils/jwt');
const Session = require('../models/Session');
const Student = require('../models/Student');

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

// Fire-and-forget activity touch — never blocks or fails the request.
// v1.2: previously lastActiveAt was only updated during explicit
// /api/auth/refresh calls. Updating it on every authenticated request
// gives an accurate "last seen" signal (used by the admin activity log
// and as the real source of truth for "has this user actually been
// active", independent of whether/when the frontend happens to refresh).
function touchActivity(sid, matric) {
  const now = new Date();
  if (sid) Session.updateOne({ _id: sid }, { lastActiveAt: now }).catch(() => {});
  if (matric) Student.updateOne({ matric }, { lastActiveAt: now }).catch(() => {});
}

// Protects student-facing routes. Requires a valid, unexpired access token.
function requireStudent(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Missing access token' });
  try {
    const payload = verifyAccessToken(token);
    if (payload.role !== 'student') return res.status(403).json({ error: 'Forbidden' });
    req.student = payload; // { sub: matric, role, sid }
    touchActivity(payload.sid, payload.sub);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token', code: e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID' });
  }
}

// Protects admin routes. Accepts EITHER:
//   a) Authorization: Bearer <admin JWT>   (used by admin.html going forward)
//   b) x-admin-key: <ADMIN_KEY from .env>  (legacy, kept alive for
//      question-uploader.html and any external scripts)
function requireAdmin(req, res, next) {
  const legacyKey = req.headers['x-admin-key'] || req.body?.adminKey;
  if (legacyKey && process.env.ADMIN_KEY && legacyKey === process.env.ADMIN_KEY) {
    req.admin = { username: 'legacy-key', sub: 'legacy-key', role: 'admin' };
    return next();
  }

  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Missing admin credentials' });
  try {
    const payload = verifyAccessToken(token);
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    req.admin = payload; // { sub: username, role, sid }
    touchActivity(payload.sid, null);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token', code: e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID' });
  }
}

module.exports = { requireStudent, requireAdmin, getBearerToken };
