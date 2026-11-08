// "Install Wreddi" banner (v1.9.1). Shown once, only when the browser says the app can be installed (Android Chrome)
// or on iPhone Safari with instructions. Dismissing it, or installing, means it never comes back.
(function(){
  const SEEN = 'phq-install-seen';
  const seen = () => { try { return localStorage.getItem(SEEN) === '1'; } catch(e){ return false; } };
  const mark = () => { try { localStorage.setItem(SEEN, '1'); } catch(e){} };
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return;
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  let deferred = null;

  function show(text, onInstall){
    if (seen() || document.getElementById('phq-install')) return;
    const bar = document.createElement('div');
    bar.id = 'phq-install';
    bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(var(--nav-space,96px) + 8px);z-index:900;display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:16px;background:var(--bg);box-shadow:var(--sh-lg);font-family:var(--ff-b);font-size:13px;color:var(--t1);max-width:520px;margin:0 auto;';
    const msg = document.createElement('div'); msg.style.cssText = 'flex:1;line-height:1.4;font-weight:600;'; msg.textContent = text;
    const mk = (label, strong) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'border:none;cursor:pointer;padding:9px 13px;border-radius:11px;background:var(--bg);box-shadow:var(--sh-sm);font-weight:800;font-size:12.5px;font-family:inherit;color:' + (strong ? 'var(--brand)' : 'var(--t3)') + ';'; return b; };
    const close = () => { mark(); bar.remove(); };
    const no = mk('Not now', false); no.onclick = close; bar.append(msg);
    if (onInstall) { const yes = mk('Install', true); yes.onclick = () => { close(); onInstall(); }; bar.append(yes); }
    bar.append(no);
    document.body.appendChild(bar);
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferred = e;
    setTimeout(() => show('Install Wreddi on your home screen for one-tap access.', () => { deferred.prompt(); deferred.userChoice.finally(() => { deferred = null; }); }), 8000);
  });
  window.addEventListener('appinstalled', mark);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  if (ios) setTimeout(() => show('Install Wreddi: tap Share, then "Add to Home Screen".', null), 8000);
})();
