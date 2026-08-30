const rateLimit = require('express-rate-limit');

// Real-time username availability checks — generous since the frontend
// calls this on every debounce, but still capped to prevent enumeration
// scraping / abuse.
const usernameCheckLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many checks. Slow down a moment.' },
});

// Username set/change — infrequent by nature (30-day cooldown already
// enforces this), so a tight limit just guards against retry storms.
const usernameChangeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again shortly.' },
});

// Transfers — spec caps at 10/day + 30s cooldown (enforced in the route
// itself against the Transfer collection); this limiter is just a
// backstop against rapid-fire request spam distinct from that business
// rule.
const transferLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many transfer requests. Slow down a moment.' },
});

// Contest join — prevents hammering the join endpoint.
const contestJoinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Slow down a moment.' },
});

module.exports = {
  usernameCheckLimiter,
  usernameChangeLimiter,
  transferLimiter,
  contestJoinLimiter,
};
