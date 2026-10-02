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
    { href: '/contests',     icon: 'M5 4v3h5.5v12h3V7H19V4z',                       label: 'Contests' },
    { href: '/study-rooms',  icon: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z', label: 'Rooms' },
    { href: '/chat',         icon: 'M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z', label: 'Assistant' },
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

    nav.innerHTML = TABS.map(t => `
      <a class="glass-nav-item ${path === t.href ? 'on' : ''}" href="${t.href}">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="${t.icon}"/></svg>
        <span>${t.label}</span>
        ${t.badgeCheck ? '<div class="glass-nav-badge" id="shared-nav-badge" style="display:none;"></div>' : ''}
      </a>
    `).join('');

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

  async function checkUnread(){
    try {
      if (typeof PhqAuth === 'undefined') return;
      const r = await PhqAuth.authFetch('/api/notifications', {}, 'student');
      if (!r.ok) return;
      const d = await r.json();
      const badge = document.getElementById('shared-nav-badge');
      if (badge) badge.style.display = d.unreadCount > 0 ? 'block' : 'none';
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
