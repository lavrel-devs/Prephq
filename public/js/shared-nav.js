// ── Shared cross-page nav (v1.3.1) ──────────────────────────────
// One nav, rendered identically wherever it's included, instead of
// each page hand-rolling (or omitting) its own. Fixes the dead-end
// problem where profile/contests/leaderboard/study-rooms previously
// had only a single back button and no way to jump sideways to
// another section without returning to the dashboard hamburger menu
// first.
(function(){
  const TABS = [
    { href: '/dashboard',    icon: 'M12 3l9 8h-3v9h-5v-6H11v6H6v-9H3z',            label: 'Home' },
    { href: '/contests',     icon: 'M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z',                       label: 'Contests' },
    { href: '/study-rooms',  icon: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z', label: 'Rooms' },
    { href: '/chat',         icon: 'M12 2l2.2 6.3L20.5 10.5l-6.3 2.2L12 19l-2.2-6.3L3.5 10.5l6.3-2.2zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9zM5 3l.7 1.6L7.3 5.3 5.7 6 5 7.6 4.3 6 2.7 5.3 4.3 4.6z', label: 'Assistant' },
    { href: '/profile',      icon: 'M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v3h20v-3c0-3.33-6.67-5-10-5z', label: 'Profile', badgeCheck: true },
  ];

  function currentPath(){
    let p = window.location.pathname;
    if (p.endsWith('.html')) p = '/' + p.split('/').pop().replace('.html', '');
    if (p === '/index' || p === '/') p = '/dashboard';
    return p;
  }

  function render(){
    if (document.getElementById('shared-glass-nav')) return; // don't double-render
    const path = currentPath();
    const nav = document.createElement('nav');
    nav.className = 'glass-nav';
    nav.id = 'shared-glass-nav';
    nav.setAttribute('aria-label', 'Primary');

    let who = { name: '' };
    try { who = (typeof PhqAuth !== 'undefined' && PhqAuth.getSession()) || who; } catch (e) {}
    const nm = String(who.name || who.matric || 'Student');
    const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // Desktop-only chrome (css/nest.css shows these at 1024px+; on phones they stay hidden)
    const brand = '<a class="nest-brand" href="/dashboard"><img src="/icons/logo-mark.png" alt=""><b>Wreddi</b></a>';
    const user = `<a class="nest-user" href="/profile"><div class="av">${esc(nm.trim().charAt(0).toUpperCase())}</div><div style="min-width:0"><div class="nm">${esc(nm)}</div><div class="sb">${who.track === 'secondary' ? 'Secondary / JAMB' : 'University'}</div></div><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></a>`;
    // v1.13 desktop extras: Premium card (free plans only, see html[data-tier]), account links, Wrapped
    const extras = `
      <div class="nest-spacer"></div>
      <button type="button" class="nest-upgrade" data-nest="upgrade">
        <img class="nu-art" src="/img/premium-art.svg" alt="" width="120" height="110">
        <span class="nu-h"><i class="fa-solid fa-crown" aria-hidden="true"></i>Upgrade to Premium</span>
        <p>Unlimited questions, AI quizzes &amp; more</p>
        <span class="nu-btn">Go Premium <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span>
      </button>
      <div class="nest-links">
        <button type="button" data-nest="notifications"><i class="fa-regular fa-bell" aria-hidden="true"></i>Notifications<span class="nest-n" id="nest-notif-n" hidden>0</span></button>
        <button type="button" data-nest="settings"><i class="fa-solid fa-gear" aria-hidden="true"></i>Settings</button>
        <button type="button" data-nest="signout"><i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i>Sign Out</button>
      </div>`;
    nav.innerHTML = brand + TABS.map(t => `
      <a class="glass-nav-item ${path === t.href ? 'on' : ''}" href="${t.href}"${path === t.href ? ' aria-current="page"' : ''}>
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="${t.icon}"/></svg>
        <span>${t.label}</span>
        ${t.badgeCheck ? '<div class="glass-nav-badge" id="shared-nav-badge" style="display:none;"></div>' : ''}
      </a>
    `).join('') + '<div class="nest-sep"></div>' + user + extras;

    nav.addEventListener('click', function (e) {
      const b = e.target.closest && e.target.closest('[data-nest]');
      if (b) { e.preventDefault(); nestAction(b.getAttribute('data-nest')); }
    });

    document.body.appendChild(nav);
    document.body.classList.add('has-glass-nav');

    // Backdrop wash, in case the page doesn't already have one.
    if (!document.querySelector('.glass-backdrop')) {
      const bg = document.createElement('div');
      bg.className = 'glass-backdrop';
      document.body.prepend(bg);
    }

    checkUnread();
  }

  // The dashboard's own screens (Settings, Notifications) live inside the dashboard page, so from another tab
  // go Home first, then open the screen.
  function nestAction(what){
    const S = window.PhqShell;
    const run = function(){
      if (what === 'settings' && window.showScr) window.showScr('settings');
      else if (what === 'notifications' && window.showScr) { window.showScr('notifications'); if (window.loadNotifications) window.loadNotifications(); }
    };
    if (what === 'signout') { if (window.doLogout) window.doLogout(); return; }
    if (what === 'upgrade') { if (window.showPaywall) window.showPaywall(); return; }
    if (what === 'wrapped') { if (S) S.go('/wrapped'); else window.location.href = '/wrapped'; return; }
    if (S && S.current && S.current() !== '/dashboard') S.go('/dashboard').then(run); else run();
  }

  async function checkUnread(){
    try {
      if (typeof PhqAuth === 'undefined') return;
      const r = await PhqAuth.authFetch('/api/notifications', {}, 'student');
      if (!r.ok) return;
      const d = await r.json();
      const badge = document.getElementById('shared-nav-badge');
      if (badge) badge.style.display = d.unreadCount > 0 ? 'block' : 'none';
      const nn = document.getElementById('nest-notif-n');
      if (nn) { nn.textContent = d.unreadCount > 99 ? '99+' : String(d.unreadCount || 0); nn.hidden = !(d.unreadCount > 0); }
    } catch (e) {}
  }

  // The shell (js/shell.js) changes tabs without reloading, so keep the highlighted tab in step.
  window.addEventListener('phq:route', function (e) {
    document.querySelectorAll('#shared-glass-nav .glass-nav-item').forEach(function (a) {
      a.classList.toggle('on', a.getAttribute('href') === e.detail.path);
    });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
