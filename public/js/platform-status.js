/* Wreddi — live platform notice (v1.14).
   Shows the admin's site banner, the Secondary notice, and a full-screen "we're updating" page while maintenance mode is on.
   Polls /api/platform/status every minute and re-checks right away when an API call comes back as MAINTENANCE. */
(function () {
  'use strict';
  if (window.PhqPlatform) return;
  var bannerEl = null, overlayEl = null, timer = null, lastKey = '';

  function track() {
    try { if (window.curUser && window.curUser.track) return window.curUser.track; } catch (e) {}
    try { var s = window.PhqAuth && PhqAuth.getSession && PhqAuth.getSession(); if (s && s.track) return s.track; } catch (e) {}
    return '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function css() {
    if (document.getElementById('phq-platform-css')) return;
    var st = document.createElement('style'); st.id = 'phq-platform-css';
    st.textContent =
      '#phq-banner{position:sticky;top:0;z-index:9000;padding:9px 40px 9px 14px;font:600 13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;color:#0b2a4a;background:#dbeafe;border-bottom:1px solid #bfdbfe}' +
      '#phq-banner.warn{background:#fef3c7;color:#6b3f00;border-color:#fde68a}#phq-banner.danger{background:#fee2e2;color:#7f1d1d;border-color:#fecaca}' +
      '#phq-banner button{position:absolute;right:8px;top:50%;transform:translateY(-50%);border:0;background:transparent;font-size:18px;line-height:1;cursor:pointer;color:inherit;opacity:.7;padding:6px 10px}' +
      '#phq-maint{position:fixed;inset:0;z-index:99999;background:var(--bg,#f6f7fb);color:var(--t1,#14182b);display:flex;align-items:center;justify-content:center;padding:28px;text-align:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
      '#phq-maint .box{max-width:420px}#phq-maint h1{font-size:24px;margin:14px 0 8px;letter-spacing:-.02em}#phq-maint p{font-size:15px;line-height:1.55;color:var(--t3,#5b6178);margin:6px 0}' +
      '#phq-maint .eta{display:inline-block;margin-top:10px;padding:6px 12px;border-radius:999px;background:rgba(99,102,241,.12);font-weight:700;font-size:13px}' +
      '#phq-maint button{margin-top:18px;padding:11px 22px;border:0;border-radius:12px;background:linear-gradient(140deg,#4f46e5,#7c3aed);color:#fff;font-weight:700;font-size:14px;cursor:pointer}';
    document.head.appendChild(st);
  }

  function render(d) {
    if (!d) return;
    css();
    // Maintenance: full-screen for students. (Admin pages never load this file.)
    if (d.maintenance) {
      if (!overlayEl) { overlayEl = document.createElement('div'); overlayEl.id = 'phq-maint'; document.body.appendChild(overlayEl); }
      overlayEl.innerHTML = '<div class="box"><div style="font-size:46px">🛠️</div><h1>We’re updating Wreddi</h1><p>' + esc(d.maintenance.message) + '</p>' +
        (d.maintenance.eta ? '<div class="eta">Back by ' + esc(d.maintenance.eta) + '</div>' : '') + '<br><button type="button" id="phq-maint-retry">Check again</button></div>';
      var b = document.getElementById('phq-maint-retry'); if (b) b.onclick = function () { refresh(); };
    } else if (overlayEl) { overlayEl.remove(); overlayEl = null; }

    // Banner (admin's message, then the Secondary notice when on the Secondary app).
    var parts = [], tone = 'info';
    if (d.banner && d.banner.text) { parts.push(d.banner.text); tone = d.banner.tone || 'info'; }
    if (track() === 'secondary' && d.secondary && d.secondary.motd) parts.push(d.secondary.motd);
    var key = parts.join('||') + '|' + tone;
    if (!parts.length) { if (bannerEl) { bannerEl.remove(); bannerEl = null; } lastKey = ''; return; }
    if (key === lastKey && bannerEl) return;
    if (sessionStorage.getItem('phq-banner-x') === key) return;   // dismissed for this session
    lastKey = key;
    if (!bannerEl) { bannerEl = document.createElement('div'); bannerEl.id = 'phq-banner'; document.body.insertBefore(bannerEl, document.body.firstChild); }
    bannerEl.className = tone;
    bannerEl.innerHTML = parts.map(esc).join(' · ') + '<button type="button" aria-label="Dismiss">×</button>';
    bannerEl.querySelector('button').onclick = function () { try { sessionStorage.setItem('phq-banner-x', key); } catch (e) {} bannerEl.remove(); bannerEl = null; };
  }

  function refresh() {
    var t = track();
    return fetch('/api/platform/status' + (t ? '?track=' + encodeURIComponent(t) : ''), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; }).then(render).catch(function () {});
  }

  function start() {
    refresh();
    if (!timer) timer = setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    // An API call that comes back "maintenance" should not wait up to a minute for the next poll.
    try {
      if (window.PhqAuth && PhqAuth.authFetch && !PhqAuth.__platformWrapped) {
        var orig = PhqAuth.authFetch; PhqAuth.__platformWrapped = true;
        PhqAuth.authFetch = function () {
          return orig.apply(this, arguments).then(function (r) {
            if (r && r.status === 503) r.clone().json().then(function (d) { if (d && d.code === 'MAINTENANCE') refresh(); }).catch(function () {});
            return r;
          });
        };
      }
    } catch (e) {}
  }

  window.PhqPlatform = { refresh: refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
