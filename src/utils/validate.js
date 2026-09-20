const mongoose = require('mongoose');

// Matric numbers are typed by students at signup and later interpolated
// into admin-panel HTML, so they are restricted to a safe charset.
const MATRIC_RE = /^[A-Z0-9][A-Z0-9 /\-_.]{2,29}$/;

function cleanMatric(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().replace(/\s+/g, ' ').toUpperCase();
  return MATRIC_RE.test(m) ? m : null;
}

// Display names: 2–80 chars, no angle brackets or control characters.
function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const n = raw.trim().replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > 80) return null;
  if (/[<>\u0000-\u001f\u007f]/.test(n)) return null;
  return n;
}

// Phone / WhatsApp: optional, digits and common separators only.
function cleanPhone(raw) {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const p = String(raw).trim();
  return /^[0-9+\-() ]{0,20}$/.test(p) ? p : null;
}

function isObjectId(id) {
  return typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id) && mongoose.isValidObjectId(id);
}

// Escape user text for use inside a RegExp.
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Fisher–Yates. `arr.sort(() => Math.random() - 0.5)` is biased.
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { MATRIC_RE, cleanMatric, cleanName, cleanPhone, isObjectId, escapeRegex, shuffle };
