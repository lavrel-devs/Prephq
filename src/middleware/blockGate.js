'use strict';
// Command centre: refuses requests from blocked IP addresses (set in Command centre → Access).
// Admin pages and the admin sign-in are never blocked, so an admin can always get in and lift a block.
// The block list is cached for 30 seconds and refreshed immediately when an admin changes it. If the database is unreachable it lets traffic through.
const Block = require('../models/Block');

let cache = null, loadedAt = 0, loading = null;
const TTL = 30000;

function normIp(ip) {
  let s = String(ip || '').trim().toLowerCase();
  if (s.startsWith('::ffff:') && s.includes('.')) s = s.slice(7);   // IPv4 written as IPv6
  return s;
}
function invalidate() { cache = null; loadedAt = 0; }

async function load() {
  if (cache && Date.now() - loadedAt < TTL) return cache;
  if (!loading) {
    loading = Block.find({ kind: 'ip', $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).select('value').lean()
      .then(rows => { cache = new Set(rows.map(r => normIp(r.value))); loadedAt = Date.now(); return cache; })
      .catch(() => cache || new Set())
      .finally(() => { loading = null; });
  }
  return loading;
}

const ADMIN_PATH = /^\/(api\/admin(\/|$)|api\/auth\/admin(\/|$)|admin(\.html)?(\/|$))/i;
const ASSET = /\.(js|css|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|map|json)$/i;

async function blockGate(req, res, next) {
  try {
    if (ADMIN_PATH.test(req.path) || ASSET.test(req.path)) return next();
    const set = await load();
    if (!set.size || !set.has(normIp(req.ip))) return next();
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Access from this address has been blocked.', code: 'IP_BLOCKED' });
    res.status(403).type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Access blocked</title><body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f4f6fa;color:#1e293b;margin:0;padding:24px;text-align:center"><div><h1 style="color:#3E5C8A">Access blocked</h1><p>Access from this address has been blocked. If you think this is a mistake, contact support.</p></div>');
  } catch (e) { next(); }
}

module.exports = blockGate;
module.exports.invalidate = invalidate;
module.exports.normIp = normIp;
