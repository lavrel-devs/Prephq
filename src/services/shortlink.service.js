'use strict';
// v1.18 — Short links: pure helpers (no database), so they are easy to test.
const crypto = require('crypto');

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';   // no 0/o/1/l/i — easy to read out or type from a flyer
const CODE_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/;           // 3–32 chars, lowercase
const RESERVED = new Set(['admin', 'api', 'login', 'dashboard', 'profile', 'static', 'public', 'js', 'css', 'vendor', 'assets', 'health', 's']);
const MAX_URL = 2048;

function generateCode(len = 6) {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

// Returns the cleaned code, or throws Error with a message an admin can read.
function cleanCode(raw) {
  const c = String(raw || '').trim().toLowerCase();
  if (!CODE_RE.test(c)) throw new Error('Short code must be 3–32 characters: letters, numbers, dash or underscore.');
  if (RESERVED.has(c)) throw new Error('That short code is reserved. Pick another.');
  return c;
}

// Accepts "example.com/page" (adds https://). Only http(s) is allowed.
// `ownHosts` = hostnames of this app, so a link can never point back at a short link (redirect loop).
function cleanUrl(raw, ownHosts = []) {
  let s = String(raw || '').trim();
  if (!s) throw new Error('Paste the web address to shorten.');
  if (s.length > MAX_URL) throw new Error('That web address is too long (max ' + MAX_URL + ' characters).');
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s)) throw new Error('Only http:// and https:// addresses can be shortened.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (e) { throw new Error('That does not look like a valid web address.'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http:// and https:// addresses can be shortened.');
  if (!u.hostname || (!u.hostname.includes('.') && u.hostname !== 'localhost')) throw new Error('That does not look like a valid web address.');
  if (u.username || u.password) throw new Error('Addresses containing a username or password are not allowed.');
  if (ownHosts.map(h => String(h).toLowerCase()).includes(u.hostname.toLowerCase()) && /^\/s\//i.test(u.pathname)) throw new Error('You cannot shorten a short link.');
  return u.toString();
}

function cleanTitle(raw) { return String(raw || '').trim().slice(0, 120); }

// '' / null → null (no expiry). Must be in the future.
function cleanExpiry(raw, now = Date.now()) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) throw new Error('Expiry date is not valid.');
  if (d.getTime() <= now) throw new Error('Expiry must be in the future.');
  return d;
}

function isLive(link, now = Date.now()) {
  return !!link && link.active !== false && !(link.expiresAt && new Date(link.expiresAt).getTime() <= now);
}

function statusOf(link, now = Date.now()) {
  if (link.active === false) return 'off';
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now) return 'expired';
  return 'live';
}

// Nigerian calendar day (Africa/Lagos is UTC+1, no daylight saving)
function dayKey(ts = Date.now()) { return new Date(ts + 3600000).toISOString().slice(0, 10); }

function baseUrl(req) {
  const env = (process.env.SHORT_BASE_URL || '').trim().replace(/\/+$/, '');
  return env || (req.protocol + '://' + req.get('host'));
}

module.exports = { generateCode, cleanCode, cleanUrl, cleanTitle, cleanExpiry, isLive, statusOf, dayKey, baseUrl, RESERVED, MAX_URL };
