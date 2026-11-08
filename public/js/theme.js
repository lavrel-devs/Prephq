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

  // v1.10: keep the browser / status-bar colour matched to the page canvas (--bg in tokens.css).
  function syncBarColor(){
    var m = document.querySelector('meta[name="theme-color"]');
    if(m) m.setAttribute('content', document.documentElement.dataset.theme === 'dark' ? '#000000' : '#f2f2f7');
  }
  document.addEventListener('DOMContentLoaded', syncBarColor);
  new MutationObserver(syncBarColor).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});

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

// ── Low-power mode (v1.9.1) ─────────────────────────────────────
// For cheap phones: switches off the glass blur, animations and transitions. Same rule as the theme: a device
// preference, applied before first paint on every page, saved on this phone only.
(function(){
  const KEY = 'phq-lowpower';
  function stored(){ try { return localStorage.getItem(KEY) === '1'; } catch(e){ return false; } }
  const LITE = 'phq-lite';
  function lite(){ try { return localStorage.getItem(LITE) === '1'; } catch(e){ return false; } }
  function apply(on){
    const root = document.documentElement;
    if (on || lite()) root.setAttribute('data-lowpower', ''); else root.removeAttribute('data-lowpower');   // lite mode implies low-power
    if (lite()) root.setAttribute('data-lite', ''); else root.removeAttribute('data-lite');
  }
  const css = document.createElement('style');
  css.id = 'phq-lowpower-css';
  css.textContent = 'html[data-lowpower] *,html[data-lowpower] *::before,html[data-lowpower] *::after{' +
    'backdrop-filter:none!important;-webkit-backdrop-filter:none!important;animation:none!important;transition:none!important;scroll-behavior:auto!important;}';
  document.head.appendChild(css);
  apply(stored());
  window.PhqPerf = {
    get: stored,
    set: (on) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch(e){} apply(!!on); return !!on; },
    lite,
    setLite: (on) => { try { localStorage.setItem(LITE, on ? '1' : '0'); } catch(e){} apply(stored()); if (on) holdImages(); return !!on; },
  };

  // Lite mode, images: pictures inside questions, notes and chat wait behind a "tap to load" box instead of downloading.
  const PIC = '#quiz img,.np-card img,#chat-msgs img,.cn-body img';
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  function holdImages(){
    if (!lite()) return;
    document.querySelectorAll(PIC).forEach(img => {
      if (img.dataset.liteSrc || !img.getAttribute('src') || img.src === BLANK) return;
      img.dataset.liteSrc = img.getAttribute('src'); img.src = BLANK; img.removeAttribute('srcset');
      img.style.cssText += ';min-height:64px;min-width:140px;border:1px dashed var(--t3);border-radius:10px;cursor:pointer;';
      img.alt = 'Tap to load image (lite mode)';
      img.addEventListener('click', () => { if (img.dataset.liteSrc) { img.src = img.dataset.liteSrc; delete img.dataset.liteSrc; img.style.minHeight = ''; } }, { once: true });
    });
  }
  document.addEventListener('DOMContentLoaded', () => { holdImages(); new MutationObserver(holdImages).observe(document.body, { childList: true, subtree: true }); });
})();

// ── Data meter (v1.9.2) ─────────────────────────────────────────
// Adds up what the browser reports it downloaded (page, scripts, API calls, images) so students can see what the app costs
// them. It is an estimate: cached files cost nothing and some browsers hide sizes. Totals are kept per day on this phone.
(function(){
  const KEY = 'phq-data';
  const day = () => new Date().toISOString().slice(0, 10);
  let visit = 0, today = 0, seen = 0, t = null;
  try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); if (o.day === day()) today = o.bytes || 0; } catch(e){}
  function save(){ t = null; try { localStorage.setItem(KEY, JSON.stringify({ day: day(), bytes: today })); } catch(e){} }
  function add(list){
    let n = 0;
    list.forEach(e => { n += (e.transferSize || 0) || 0; });
    if (!n) return; visit += n; today += n;
    if (!t) t = setTimeout(save, 3000);
  }
  try {
    add(performance.getEntriesByType('navigation').concat(performance.getEntriesByType('resource')));
    seen = performance.getEntriesByType('resource').length;
    new PerformanceObserver(l => add(l.getEntries())).observe({ type: 'resource', buffered: false });
  } catch(e){}
  const fmt = b => b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB';
  window.PhqData = { visit: () => visit, today: () => today, format: fmt };
})();
