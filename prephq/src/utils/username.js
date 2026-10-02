const Student = require('../models/Student');

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
const CHANGE_COOLDOWN_DAYS = 30;

function normalizeUsername(raw) {
  return String(raw || '').trim().toLowerCase();
}

function isValidFormat(username) {
  return USERNAME_REGEX.test(username);
}

// Checks uniqueness only (does not validate format). Pass
// `excludeStudentId` when checking during a change, so a student's own
// current username doesn't register as "taken" against themselves.
async function isAvailable(username, excludeStudentId = null) {
  const query = { username };
  if (excludeStudentId) query._id = { $ne: excludeStudentId };
  const existing = await Student.findOne(query).lean();
  return !existing;
}

// Full check used by the real-time signup/availability endpoint.
// Returns { ok, reason } rather than throwing, since this is meant to
// be called on every keystroke-debounce from the frontend.
async function checkAvailability(raw, excludeStudentId = null) {
  const username = normalizeUsername(raw);
  if (!username) return { ok: false, reason: 'Username is required' };
  if (!isValidFormat(username)) {
    return { ok: false, reason: '3–20 characters, letters, numbers, and underscores only' };
  }
  const available = await isAvailable(username, excludeStudentId);
  if (!available) return { ok: false, reason: 'That username is already taken' };
  return { ok: true, username };
}

// Sets or changes a student's username. Enforces the 30-day cooldown
// EXCEPT on first-ever set (usernameChangedAt === null) — the "once per
// 30 days" rule governs changes, not the initial assignment during
// signup or the first-login modal.
// Throws an Error with `.code` set for the frontend to branch on:
//   INVALID_FORMAT | TAKEN | COOLDOWN
async function setUsername(student, rawUsername) {
  const username = normalizeUsername(rawUsername);

  if (!isValidFormat(username)) {
    const err = new Error('3–20 characters, letters, numbers, and underscores only');
    err.code = 'INVALID_FORMAT';
    throw err;
  }

  const isFirstSet = !student.usernameChangedAt;
  if (!isFirstSet) {
    const nextAllowed = new Date(student.usernameChangedAt.getTime() + CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    if (nextAllowed > new Date()) {
      const err = new Error(`You can change your username again on ${nextAllowed.toISOString().slice(0, 10)}`);
      err.code = 'COOLDOWN';
      err.nextAllowedAt = nextAllowed;
      throw err;
    }
  }

  if (username === student.username) {
    const err = new Error('That is already your username');
    err.code = 'UNCHANGED';
    throw err;
  }

  const available = await isAvailable(username, student._id);
  if (!available) {
    const err = new Error('That username is already taken');
    err.code = 'TAKEN';
    throw err;
  }

  student.username = username;
  student.usernameChangedAt = new Date();
  await student.save();

  return student.username;
}

// Admin override: bypasses the cooldown entirely (reset or force-change).
async function adminSetUsername(student, rawUsername) {
  const username = normalizeUsername(rawUsername);
  if (!isValidFormat(username)) {
    const err = new Error('3–20 characters, letters, numbers, and underscores only');
    err.code = 'INVALID_FORMAT';
    throw err;
  }
  const available = await isAvailable(username, student._id);
  if (!available) {
    const err = new Error('That username is already taken');
    err.code = 'TAKEN';
    throw err;
  }
  student.username = username;
  student.usernameChangedAt = new Date();
  await student.save();
  return student.username;
}

module.exports = {
  USERNAME_REGEX,
  CHANGE_COOLDOWN_DAYS,
  normalizeUsername,
  isValidFormat,
  isAvailable,
  checkAvailability,
  setUsername,
  adminSetUsername,
};
