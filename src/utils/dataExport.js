'use strict';
// Command centre: makes database documents safe and flat for export. Secrets never leave, whatever the caller asks for.
const ALWAYS_DROP = ['__v', 'password', 'passwordHash', 'refreshHash', 'resetToken', 'resetTokenHash', 'token', 'tokens', 'deviceFingerprint', 'devices'];

function plain(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') {
    if (typeof v.toHexString === 'function') return v.toHexString();                 // ObjectId
    if (v._bsontype) return String(v);
    const o = {}; for (const k of Object.keys(v)) o[k] = plain(v[k]); return o;
  }
  return v;
}

// drop: extra field names to remove for this collection
function cleanDoc(doc, drop = []) {
  const skip = new Set(ALWAYS_DROP.concat(drop || []));
  const out = {};
  for (const k of Object.keys(doc || {})) if (!skip.has(k)) out[k] = plain(doc[k]);
  return out;
}

// one CSV cell: objects and lists become JSON text
function flat(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

module.exports = { cleanDoc, flat, ALWAYS_DROP };
