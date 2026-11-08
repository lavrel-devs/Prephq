// Counts FAILED attempts per key (an IP address) and locks the key out after too many inside a window.
// Used for the legacy ADMIN_KEY header (v1.9.1): correct keys are never counted, so scripts that use the key are unaffected;
// only guessing is slowed down. In-memory, so it resets on restart, which is fine for a brute-force brake.
function makeFailGuard({ max = 10, windowMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  const hits = new Map(); // key -> { n, resetAt }
  const live = key => { const h = hits.get(key); if (h && h.resetAt <= now()) { hits.delete(key); return null; } return h || null; };
  return {
    blocked: key => { const h = live(key); return !!h && h.n >= max; },
    fail: key => {
      let h = live(key);
      if (!h) { h = { n: 0, resetAt: now() + windowMs }; hits.set(key, h); }
      h.n++;
      if (hits.size > 2000) for (const [k, v] of hits) if (v.resetAt <= now()) hits.delete(k); // keep the map small
      return h.n;
    },
    clear: key => hits.delete(key),
  };
}
module.exports = { makeFailGuard };
