'use strict';
// v1.14 — enforces the admin's live controls (maintenance mode and the feature kill switches) in front of every student API.
// Admin routes, admin sign-in, the public status endpoint and /api/version are never blocked, so an admin can always get in and
// switch things back on. decide() is pure so it can be unit-tested.
const cfgSvc = require('../services/platformConfig.service');

const ALWAYS = [/^\/admin(\/|$)/, /^\/auth\/admin(\/|$)/, /^\/auth\/(refresh|logout)\/?$/, /^\/platform\/status\/?$/, /^\/version\/?$/];

const off = (error, code = 'FEATURE_OFF', status = 503) => ({ status, code, error });

function decide(cfg, method, path, body) {
  const p = String(path || '').replace(/\/+$/, '') || '/'; const m = String(method || 'GET').toUpperCase();
  if (ALWAYS.some(re => re.test(p))) return null;
  if (cfg.maintenance.enabled) {
    return { status: 503, code: 'MAINTENANCE', error: cfg.maintenance.message || 'Wreddi is being updated. Please check back shortly.', eta: cfg.maintenance.eta || '' };
  }
  const sw = cfg.switches, sec = cfg.secondary;
  if (m === 'POST' && p === '/auth/register') {
    if (sw.signups === false) return off('New sign-ups are paused right now. Please try again later.', 'SIGNUPS_CLOSED', 403);
    if (body && body.track === 'secondary' && (!sec.enabled || !sec.signupsOpen)) return off('Secondary / JAMB sign-ups are closed right now. Please try again later.', 'SIGNUPS_CLOSED', 403);
  }
  if (m === 'POST' && p === '/auth/login' && sw.logins === false) return off('Sign-in is paused for a moment. Please try again shortly.', 'LOGINS_OFF');
  if (/^\/secondary(\/|$)/.test(p) && !sec.enabled) return off('Wreddi Secondary is paused for now. Please check back soon.');
  if (sw.aiChat === false && m === 'POST' && (p === '/chat/message' || /^\/brainiac(\/|$)/.test(p))) return off('The AI assistant is switched off for now.');
  if (sw.aiQuiz === false && m === 'POST' && (p === '/quiz/generate' || p === '/flashcards/generate' || p === '/study-guide/generate' || p === '/my-notes/generate' || p === '/written/start')) return off('AI-made quizzes and notes are switched off for now.');
  if (sw.contests === false && /^\/contests(\/|$)/.test(p) && m !== 'GET') return off('Contests are paused for now.');
  if (sw.studyRooms === false && /^\/study-rooms(\/|$)/.test(p) && m !== 'GET') return off('Study rooms are paused for now.');
  if (sw.creditTransfers === false && m === 'POST' && p === '/transfer') return off('Credit transfers are paused for now.');
  return null;
}

async function platformGate(req, res, next) {
  try {
    const cfg = await cfgSvc.get();
    const hit = decide(cfg, req.method, req.path, req.body);
    if (!hit) return next();
    return res.status(hit.status).json({ error: hit.error, code: hit.code, ...(hit.eta ? { eta: hit.eta } : {}) });
  } catch (e) { return next(); }
}

module.exports = { platformGate, decide };
