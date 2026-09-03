// ── Shared theme persistence (v1.3.2) ───────────────────────────
// Every page already has the [data-theme=dark] CSS rules and its own
// disconnected toggleTheme() that only changed the attribute in
// memory — nothing was ever saved, and nothing synced across pages.
// This is the single source of truth instead: it applies the stored
// preference immediately (before the page paints, so there's no flash
// of the wrong theme), and every page's toggle button now calls
// PhqTheme.toggle() so the same preference sticks everywhere,
// including a fresh reload or a brand new tab.
//
// Deliberately NOT tied to student/admin login state — theme is a
// device/browser display preference, not account data, so it applies
// even on the pre-login screens (login, register).
//
// IMPORTANT: this script must be loaded as an early, non-deferred,
// non-async <script> tag in <head> (before the page's own <style>
// block is fine — what matters is that it runs before first paint,
// which a normal blocking <script src> in <head> guarantees).
(function(){
  const KEY = 'phq-theme';

  function getStored(){
    try { return localStorage.getItem(KEY); } catch(e){ return null; }
  }
  function setStored(theme){
    try { localStorage.setItem(KEY, theme); } catch(e){}
  }

  // Apply immediately — this is the line that actually prevents the
  // flash-of-wrong-theme, since it runs synchronously before the
  // browser paints anything.
  document.documentElement.dataset.theme = getStored() || 'light';

  const MOON_PATH = '<path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/>';
  const SUN_PATH  = '<path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2v-2H2v2zm18 0h2v-2h-2v2zM11 2v2h2V2h-2zm0 18v2h2v-2h-2zM5.99 4.58l-1.42 1.42 1.42 1.41 1.41-1.41L5.99 4.58zm12.03 12.03l-1.42 1.42 1.42 1.41 1.41-1.41-1.41-1.42zm1.41-12.44l-1.41-1.41-1.42 1.41 1.42 1.42 1.41-1.42zM5.99 19.42l1.41 1.41 1.42-1.42-1.42-1.41-1.41 1.42z"/>';

  function syncIcon(){
    const ico = document.getElementById('theme-ico');
    if(!ico) return;
    // Preserves each page's original behavior exactly: the icon shown
    // reflects the theme being switched away FROM, not the new one.
    const wasDark = document.documentElement.dataset.theme === 'dark';
    ico.innerHTML = wasDark ? MOON_PATH : SUN_PATH;
  }

  window.PhqTheme = {
    get: () => document.documentElement.dataset.theme,
    set: (theme) => {
      document.documentElement.dataset.theme = theme;
      setStored(theme);
      syncIcon();
    },
    toggle: () => {
      const wasDark = document.documentElement.dataset.theme === 'dark';
      const next = wasDark ? 'light' : 'dark';
      // icon reflects the OLD state, computed before the switch — matches
      // the exact behavior every page already had, just now persisted.
      document.documentElement.dataset.theme = next;
      setStored(next);
      const ico = document.getElementById('theme-ico');
      if(ico) ico.innerHTML = wasDark ? MOON_PATH : SUN_PATH;
      return next;
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncIcon);
  else syncIcon();
})();
