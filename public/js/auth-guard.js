/**
 * PrepHQ Auth Guard — v1.1.0
 * Shared by login.html and dashboard.html.
 *
 * Responsibilities:
 *  - Store/read the JWT access + refresh tokens (localStorage)
 *  - Generate a stable per-browser device fingerprint
 *  - Silently refresh the access token in the background while the
 *    user is active, so a 3-hour work session never gets interrupted
 *  - Provide authFetch() — a fetch() wrapper that attaches the bearer
 *    token and retries once after a silent refresh on 401
 *  - Hard-redirect to /login.html if there's no valid session
 */
(function (global) {
  const STORAGE_KEY = 'phq_session';
  const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
  const REFRESH_MARGIN_MS = 60 * 1000; // refresh 60s before access token actually expires
  const ACTIVITY_WINDOW_MS = 5 * 60 * 1000; // "active" = interacted in the last 5 min

  let lastActivityAt = Date.now();
  let refreshTimer = null;

  function getSession() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
  }
  function setSession(s) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }
  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
  }

  // ── Device fingerprint ────────────────────────────────────────
  // A lightweight, dependency-free fingerprint: hashes a handful of
  // stable browser/device signals (not perfect, but enough to flag
  // "this login came from a device we haven't seen for this account").
  async function getDeviceFingerprint() {
    const cached = localStorage.getItem('phq_device_fp');
    if (cached) return cached;

    let canvasSig = '';
    try {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillText('PrepHQ-fp', 2, 2);
      canvasSig = c.toDataURL();
    } catch { /* canvas unavailable — fine, we still have other signals */ }

    const raw = [
      navigator.userAgent,
      navigator.language,
      navigator.platform,
      screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.hardwareConcurrency || '',
      canvasSig,
    ].join('||');

    let hash;
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // SubtleCrypto unavailable (very old browser) — fall back to a simple checksum
      hash = String(raw.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0));
    }

    localStorage.setItem('phq_device_fp', hash);
    return hash;
  }

  // ── Refresh ──────────────────────────────────────────────────
  async function silentRefresh(role) {
    const session = getSession();
    if (!session || !session.refreshToken) return false;
    try {
      const res = await fetch(`/api/auth/${role === 'admin' ? 'admin/' : ''}refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (!res.ok) { clearSession(); return false; }
      const data = await res.json();
      setSession({ ...session, accessToken: data.accessToken, refreshToken: data.refreshToken, expiresInMin: data.expiresInMin, issuedAt: Date.now() });
      scheduleRefresh(role);
      return true;
    } catch {
      return false; // network hiccup — don't nuke the session, just try again next cycle
    }
  }

  function scheduleRefresh(role) {
    if (refreshTimer) clearTimeout(refreshTimer);
    const session = getSession();
    if (!session) return;
    const ttlMs = (session.expiresInMin || 15) * 60 * 1000;
    const fireIn = Math.max(5000, ttlMs - REFRESH_MARGIN_MS);
    refreshTimer = setTimeout(async () => {
      const idleFor = Date.now() - lastActivityAt;
      if (idleFor < ACTIVITY_WINDOW_MS) {
        await silentRefresh(role);
      } else {
        // User's been idle a while — still attempt a refresh (server
        // enforces the real 3-hour inactivity cutoff), so a quiet tab
        // doesn't get logged out over nothing.
        await silentRefresh(role);
      }
    }, fireIn);
  }

  function trackActivity() {
    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, () => { lastActivityAt = Date.now(); }, { passive: true }));
  }

  // ── authFetch: attaches bearer token, retries once after refresh ──
  async function authFetch(url, opts = {}, role = 'student') {
    const session = getSession();
    if (!session) { redirectToLogin(role); throw new Error('No session'); }

    const doFetch = (token) => fetch(url, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
    });

    let res = await doFetch(session.accessToken);
    if (res.status === 401) {
      const ok = await silentRefresh(role);
      if (ok) {
        const fresh = getSession();
        res = await doFetch(fresh.accessToken);
      } else {
        redirectToLogin(role);
        throw new Error('Session expired');
      }
    }
    return res;
  }

  function redirectToLogin(role) {
    clearSession();
    window.location.href = role === 'admin' ? '/login.html?as=admin' : '/login.html';
  }

  // ── Guard: call at the very top of dashboard.html / admin app ──
  function requireSession(role = 'student') {
    const session = getSession();
    if (!session || !session.accessToken) {
      redirectToLogin(role);
      return null;
    }
    trackActivity();
    scheduleRefresh(role);
    return session;
  }

  function logout(role = 'student') {
    const session = getSession();
    const done = () => { clearSession(); window.location.href = role === 'admin' ? '/login.html?as=admin' : '/login.html'; };
    if (!session) return done();
    fetch(`/api/auth/${role === 'admin' ? 'admin/' : ''}logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    }).catch(() => {}).finally(done);
  }

  global.PhqAuth = {
    getSession, setSession, clearSession,
    getDeviceFingerprint,
    authFetch, requireSession, logout,
    scheduleRefresh, silentRefresh,
  };
})(window);
