// PhqShell — single-page navigation for the signed-in app.
//
// The dashboard is the shell. Its own screens are already hidden <div class="scr"> blocks; the other tabs
// (Contests, Study Rooms, Assistant, Profile, Leaderboard) are the same kind of block, added to the page
// the first time they're opened and only shown/hidden after that. No page reloads between tabs, so the
// scripts, styles, session and socket connection all stay alive.
//
// A view lives in /views/<name>.html as: <style> (scoped to #view-<name>) + markup + <script>. The script
// runs once, inside a function that gives it a scoped `document` (see scope()), so two views can never
// reach each other's elements even if they use the same ids or class names.
(function () {
  'use strict';

  const HOME = '/dashboard';
  const VIEWS = {
    '/contests':    { id: 'view-contests',    file: '/views/contests.html',    title: 'Contests' },
    '/study-rooms': { id: 'view-study-rooms', file: '/views/study-rooms.html', title: 'Study Rooms', deps: ['/socket.io/socket.io.js'] },
    '/chat':        { id: 'view-chat',        file: '/views/chat.html',        title: 'Study Assistant' },
    '/profile':     { id: 'view-profile',     file: '/views/profile.html',     title: 'Profile' },
    '/leaderboard': { id: 'view-leaderboard', file: '/views/leaderboard.html', title: 'Leaderboard' },
  };

  const state = { current: null, seq: 0, mounted: {}, texts: {}, pending: {}, deps: {} };

  const norm = p => {
    p = String(p || '').replace(/\.html$/, '').replace(/\/+$/, '');
    return (p === '' || p === '/' || p === '/index') ? HOME : p;
  };
  const isRoute = p => p === HOME || Object.prototype.hasOwnProperty.call(VIEWS, p);
  const say = msg => { try { if (typeof window.toast === 'function') window.toast(msg); } catch (e) { /* no toast available */ } };

  // A `document` look-alike that only searches inside one view. Everything else (createElement, body,
  // addEventListener, ...) passes straight through to the real document.
  function scope(root) {
    const own = {
      getElementById: id => root.querySelector('#' + CSS.escape(id)),
      querySelector: s => root.querySelector(s),
      querySelectorAll: s => root.querySelectorAll(s),
      getElementsByClassName: c => root.getElementsByClassName(c),
      getElementsByTagName: t => root.getElementsByTagName(t),
    };
    return new Proxy(document, {
      get(target, key) {
        if (Object.prototype.hasOwnProperty.call(own, key)) return own[key];
        const v = target[key];
        return typeof v === 'function' ? v.bind(target) : v;
      },
      set(target, key, value) { target[key] = value; return true; },
    });
  }

  // fetch a view fragment once; also reused by the idle prefetch below
  function fetchText(url) {
    if (state.texts[url] != null) return Promise.resolve(state.texts[url]);
    if (!state.pending[url]) {
      state.pending[url] = fetch(url, { credentials: 'same-origin' })
        .then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.text(); })
        .then(t => { state.texts[url] = t; return t; })
        .finally(() => { delete state.pending[url]; });
    }
    return state.pending[url];
  }
  function loadScript(src) {
    if (!state.deps[src]) {
      state.deps[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = resolve; s.onerror = () => { delete state.deps[src]; reject(new Error('could not load ' + src)); };
        document.head.appendChild(s);
      });
    }
    return state.deps[src];
  }

  function container(v) {
    let el = document.getElementById(v.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'scr view';
      el.id = v.id;
      el.innerHTML = '<div style="padding:60px 20px;text-align:center;color:var(--t3);font-size:13px;font-weight:600;">Loading…</div>';
      document.getElementById('home').parentNode.appendChild(el);
    }
    return el;
  }

  async function mount(path, el) {
    const v = VIEWS[path];
    const [text] = await Promise.all([fetchText(v.file), ...(v.deps || []).map(loadScript)]);
    const tpl = document.createElement('template');
    tpl.innerHTML = text;                              // scripts inside a <template> stay inert
    const script = tpl.content.querySelector('script');
    const code = script ? script.textContent : '';
    if (script) script.remove();
    el.innerHTML = '';
    el.appendChild(tpl.content);
    // Runs once, in a function scope: the view's `const document = PhqShell.scope(root)` shadows the real one.
    const api = new Function('root', 'PhqShell', code)(el, PhqShell) || {};
    state.mounted[path] = { el, api };
  }

  function announce(path) {
    const v = VIEWS[path];
    document.title = v ? v.title + ' · PrepHQ' : 'PrepHQ';
    document.querySelectorAll('#shared-glass-nav .glass-nav-item').forEach(a => a.classList.toggle('on', norm(a.getAttribute('href')) === path));
    window.dispatchEvent(new CustomEvent('phq:route', { detail: { path } }));
  }

  async function show(path) {
    const seq = ++state.seq;
    if (path === HOME) { state.current = HOME; window.showScr('home'); announce(HOME); return; }
    const v = VIEWS[path];
    const known = state.mounted[path];
    const el = container(v);
    state.current = path;
    window.showScr(v.id);
    announce(path);
    if (known) { try { if (known.api.onShow) known.api.onShow(); } catch (e) { console.error(path, e); } return; }
    try {
      await mount(path, el);
    } catch (e) {
      console.error('Could not open ' + path, e);
      el.remove();
      say('Could not open that page. Check your connection and try again.');
      if (seq === state.seq) { history.replaceState({ phq: 1 }, '', HOME); show(HOME); }
    }
  }

  // Navigate to a tab without reloading. Anything that isn't a shell route falls back to a normal page load.
  function go(to, opts) {
    opts = opts || {};
    let u;
    try { u = new URL(to, location.origin); } catch (e) { location.href = to; return Promise.resolve(); }
    const p = norm(u.pathname);
    if (u.origin !== location.origin || !isRoute(p)) { location.href = to; return Promise.resolve(); }
    const full = p + u.search;
    if (opts.replace || full === location.pathname + location.search) history.replaceState({ phq: 1 }, '', full);
    else history.pushState({ phq: 1 }, '', full);
    return show(p);
  }

  // Called once the dashboard has booted: opens the tab named in the URL (so /contests still works as a link).
  function start() {
    const p = norm(location.pathname);
    history.replaceState({ phq: 1 }, '', location.pathname + location.search);
    if (p !== HOME && VIEWS[p]) show(p); else announce(HOME);
    prefetchLater();
  }

  // Warm the other tabs while the phone is idle, so the first tap is instant. Skipped on Data Saver / slow links.
  function prefetchLater() {
    const c = navigator.connection;
    if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return;
    const run = async () => { for (const p of Object.keys(VIEWS)) { try { await fetchText(VIEWS[p].file); } catch (e) { /* retried on first open */ } } };
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 8000 }); else setTimeout(run, 3000);
  }

  window.addEventListener('popstate', () => { show(norm(location.pathname)); });

  // Plain <a href="/contests"> links (including the bottom nav) navigate in place.
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    let u;
    try { u = new URL(a.href, location.href); } catch (err) { return; }
    if (u.origin !== location.origin || !isRoute(norm(u.pathname))) return;
    e.preventDefault();
    go(u.pathname + u.search);
  });

  const PhqShell = { go, start, scope, routes: Object.keys(VIEWS).concat(HOME), current: () => state.current, isMounted: p => !!state.mounted[p] };
  window.PhqShell = PhqShell;
})();
