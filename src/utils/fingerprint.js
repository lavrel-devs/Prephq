// Resolve the real client IP, respecting Render/other proxies' x-forwarded-for.
function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || '';
}

// Given a subject's known device list and the fingerprint sent on this
// login, decide whether this counts as a "new device" for flagging.
function isNewDevice(knownDevices, fingerprint) {
  if (!fingerprint) return false;
  return !knownDevices.some(d => d.fingerprint === fingerprint);
}

module.exports = { getClientIp, isNewDevice };
