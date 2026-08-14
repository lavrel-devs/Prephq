const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const ACCESS_TTL_MIN = parseInt(process.env.JWT_ACCESS_TTL_MIN || '15', 10);

function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: `${ACCESS_TTL_MIN}m`,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

// Refresh tokens are opaque-ish JWTs signed with a separate secret.
// The actual source of truth for validity/expiry is the Session
// document (sliding inactivity window) — the JWT signature just proves
// the client holds a token that maps to a real, unrevoked session.
function signRefreshToken(payload) {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  ACCESS_TTL_MIN,
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
};
