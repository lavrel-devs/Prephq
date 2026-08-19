/**
 * PrepHQ Boot Kit — v1.2.0 "Liquid Glass"
 * Shared by every page (landing, login, register, dashboard, admin,
 * question-uploader). Pure vanilla JS, no dependencies, no build step.
 *
 * Responsibilities:
 *  - Apply the saved theme (light/dark) BEFORE first paint, so there's
 *    never a flash of the wrong theme on load or refresh.
 *  - Render + tear down the full-screen liquid-glass boot loader.
 *  - Provide a themeToggle() helper that persists the choice.
 *  - Provide a reusable toast() helper (glass pill, slides in/out).
 *  - Provide skeleton() helpers for shimmering placeholder content.
 *
 * PhqBoot.applyTheme() runs immediately on script load (synchronously,
 * head-of-document) — everything else attaches to window.PhqBoot for
 * pages to call once the DOM is ready.
 */
(function (global) {
  const THEME_KEY = 'phq_theme';

  // ── Theme: applied instantly, no flash ──────────────────────────
  function getSavedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch { return null; }
  }
  function applyTheme(theme) {
    const t = theme || getSavedTheme() || document.documentElement.getAttribute('data-theme') || 'light';
    document.documentElement.setAttribute('data-theme', t);
    return t;
  }
  function setTheme(theme) {
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
    applyTheme(theme);
    document.dispatchEvent(new CustomEvent('phq:theme', { detail: { theme } }));
  }
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
    return next;
  }

  // Run immediately — before DOMContentLoaded — so the correct theme
  // is set before the browser paints anything.
  applyTheme();

  // ── Boot / load screen ──────────────────────────────────────────
  const BOOT_ID = 'phq-boot';
  function mountBootScreen() {
    if (document.getElementById(BOOT_ID)) return;
    const el = document.createElement('div');
    el.id = BOOT_ID;
    el.innerHTML = `
      <div class="phq-boot-blob phq-boot-blob-a"></div>
      <div class="phq-boot-blob phq-boot-blob-b"></div>
      <div class="phq-boot-card">
        <div class="phq-boot-mark"><i class="fa-solid fa-graduation-cap"></i></div>
        <div class="phq-boot-word">PrepHQ</div>
        <div class="phq-boot-bar"><div class="phq-boot-bar-fill"></div></div>
      </div>`;
    // Insert as the very first element so it sits on top of everything
    // else already in <body> while assets/data are still loading.
    document.body.insertBefore(el, document.body.firstChild);
  }

  function hideBootScreen() {
    const el = document.getElementById(BOOT_ID);
    if (!el) return;
    el.classList.add('phq-boot-out');
    setTimeout(() => el.remove(), 480);
  }

  // Mount as early as possible (script is loaded in <head>, before body
  // paints), then auto-hide once the window fully loads — with a small
  // minimum-display floor so it never just flickers on fast connections.
  const bootStart = Date.now();
  const MIN_BOOT_MS = 420;
  function readyToHide() {
    const elapsed = Date.now() - bootStart;
    const wait = Math.max(0, MIN_BOOT_MS - elapsed);
    setTimeout(hideBootScreen, wait);
  }

  // ── Toast ────────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(message, opts = {}) {
    const { type = 'info', duration = 2600 } = opts;
    let el = document.getElementById('phq-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'phq-toast';
      el.className = 'phq-toast';
      document.body.appendChild(el);
    }
    const icons = { info: 'fa-circle-info', success: 'fa-circle-check', error: 'fa-circle-exclamation', warn: 'fa-triangle-exclamation' };
    el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${message}</span>`;
    el.dataset.type = type;
    clearTimeout(toastTimer);
    requestAnimationFrame(() => el.classList.add('on'));
    toastTimer = setTimeout(() => el.classList.remove('on'), duration);
  }

  // ── Skeletons ────────────────────────────────────────────────────
  // skeletonLines(n) -> HTML string of n shimmering placeholder bars.
  function skeletonLines(n = 3, opts = {}) {
    const { widths = ['92%', '76%', '58%'] } = opts;
    let html = '';
    for (let i = 0; i < n; i++) {
      const w = widths[i % widths.length];
      html += `<div class="phq-sk-line" style="width:${w}"></div>`;
    }
    return html;
  }
  function skeletonCard() {
    return `<div class="phq-sk-card"><div class="phq-sk-avatar"></div><div class="phq-sk-body">${skeletonLines(2, { widths: ['70%', '45%'] })}</div></div>`;
  }

  // ── Liquid sheen: subtle pointer-reactive highlight on .glass-card ──
  // Cheap, throttled with rAF, and skipped entirely on touch-only
  // devices (no pointer to react to, and it's a perf cost for nothing).
  function initLiquidSheen() {
    if (window.matchMedia && window.matchMedia('(hover: none)').matches) return;
    let raf = null;
    document.addEventListener('pointermove', (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const card = el && el.closest ? el.closest('.glass-card, .glass') : null;
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        card.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      });
    }, { passive: true });
  }

  global.PhqBoot = {
    applyTheme, setTheme, toggleTheme, getSavedTheme,
    mountBootScreen, hideBootScreen, readyToHide,
    toast, skeletonLines, skeletonCard,
    initLiquidSheen,
  };
})(window);
