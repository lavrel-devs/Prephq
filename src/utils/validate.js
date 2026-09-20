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

// Canonical course key: "CHM 141" / "chm-141" / "CHM141" -> "chm141". This is the same form the
// Course collection uses for `key`, so attempts, weak topics and the question bank all agree.
function normCourseKey(raw) {
  return String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Generic labels that describe HOW a question was made, not WHAT it is about — they must never
// show up as a "topic" (AI-generated flashcards used to make "AI Generated" a weak topic).
const GENERIC_TAGS = new Set(['ai generated', 'ai', 'general', 'misc', 'other', 'untagged']);
function cleanTag(raw) {
  const t = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  return GENERIC_TAGS.has(t.toLowerCase()) ? '' : t;
}

module.exports = { normCourseKey, cleanTag, GENERIC_TAGS, MATRIC_RE, cleanMatric, cleanName, cleanPhone, isObjectId, escapeRegex, shuffle };
