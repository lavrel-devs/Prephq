// Resolve the real client IP. `app.set('trust proxy', 1)` (server.js)
// makes Express's req.ip pick the correct hop out of x-forwarded-for.
// The old version trusted the *first* x-forwarded-for entry directly,
// which any client can forge by sending the header themselves — so a
// session's recorded IP (and anything keyed off it) could be spoofed.
function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

// Given a subject's known device list and the fingerprint sent on this
// login, decide whether this counts as a "new device" for flagging.
function isNewDevice(knownDevices, fingerprint) {
  if (!fingerprint) return false;
  return !knownDevices.some(d => d.fingerprint === fingerprint);
}

module.exports = { getClientIp, isNewDevice };
