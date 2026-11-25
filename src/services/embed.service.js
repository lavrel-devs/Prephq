'use strict';
// v1.19 — Web pages (show another website under our domain). No database access in here.
//  - cleanEmbedUrl / cleanSlug : validate what an admin types
//  - probe                    : fetch the target's headers server-side (SSRF-safe) to learn whether it allows being framed
//  - frameVerdict             : read X-Frame-Options / CSP frame-ancestors
//  - renderPage / renderFallback / renderMessage : the public HTML
const dns = require('dns'), net = require('net'), http = require('http'), https = require('https');
const crypto = require('crypto');
const S = require('./shortlink.service');

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;                       // 3–40 chars, no leading/trailing dash
const RESERVED = new Set([...S.RESERVED, 'new', 'edit', 'embed', 'preview', 'w']);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── input cleaning ─────────────────────────────────────────────
// "Wreddi Holiday Tutorial!" → "wreddi-holiday-tutorial" (also used by the admin form's live preview)
function slugify(raw) {
  return String(raw || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ')
    .replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-+/, '').slice(0, 40).replace(/-+$/, '');
}
function cleanSlug(raw) {
  const s = slugify(raw);
  if (!SLUG_RE.test(s)) throw new Error('Page name needs at least 3 letters or numbers (spaces become dashes).');
  if (RESERVED.has(s)) throw new Error('That page address is reserved. Pick another.');
  return s;
}
function autoSlug(url) {
  let base = 'site';
  try { base = new URL(url).hostname.replace(/^www\./, '').split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'site'; } catch (e) {}
  if (base.length < 3) base = base + 'site';
  let tail = ''; for (let i = 0; i < 4; i++) tail += 'abcdefghjkmnpqrstuvwxyz23456789'[crypto.randomInt(31)];
  return base + '-' + tail;
}
function cleanTitle(raw) { return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 120); }
function cleanDescription(raw) { return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 300); }
function cleanMode(raw) { if (raw === 'embed' || raw === 'redirect') return raw; throw new Error('Mode must be "embed" or "redirect".'); }

// Only public http(s) addresses on normal web ports; never our own site.
function cleanEmbedUrl(raw, ownHosts = []) {
  const url = S.cleanUrl(raw, []);                       // scheme, length, no credentials
  const u = new URL(url);
  if (!ALLOWED_PORTS.has(u.port)) throw new Error('Only normal web addresses can be used (no custom ports).');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('That address is not a public website.');
  if (net.isIP(host.replace(/^\[|\]$/g, '')) && isPrivateIp(host.replace(/^\[|\]$/g, ''))) throw new Error('That address is not a public website.');
  if (ownHosts.map(h => String(h).toLowerCase()).includes(host)) throw new Error('You cannot show this site inside itself.');
  return url;
}

// ── SSRF guard ─────────────────────────────────────────────────
function isPrivateIp(ip) {
  ip = String(ip).toLowerCase();
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    if (ip === '::' || ip === '::1') return true;
    const m = ip.match(/^(?:0{0,4}:){0,5}(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/) || ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m && net.isIPv4(m[1])) return isPrivateIp(m[1]);
    const first = parseInt(ip.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || ip.startsWith('64:ff9b:') || ip.startsWith('::ffff:');
  }
  return true;   // not an IP at all
}

// Used as the socket's DNS lookup, so the address that is actually connected to is the one that was checked (no DNS-rebinding gap).
function guardedLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) return cb(new Error('That address is not a public website.'));
    if (options && options.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

// ── probe: ask the target site about itself ────────────────────
// Follows up to 4 redirects, re-checking every hop. Reads only the first 64 KB (for the <title>). `_allowPrivate` exists for tests only.
function probe(rawUrl, opts = {}) {
  const deadline = Date.now() + (opts.totalMs || 9000);
  const maxHops = opts.maxHops == null ? 4 : opts.maxHops;
  const allowPrivate = opts._allowPrivate === true;

  const hop = (urlStr, n) => new Promise(resolve => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return resolve({ error: 'Not a valid web address.' }); }
    if (!/^https?:$/.test(u.protocol)) return resolve({ error: 'Only http(s) addresses are allowed.' });
    if (!allowPrivate && !ALLOWED_PORTS.has(u.port)) return resolve({ error: 'The site redirected to an address that is not allowed.' });
    const bare = u.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate && net.isIP(bare) && isPrivateIp(bare)) return resolve({ error: 'That address is not a public website.' });
    const left = deadline - Date.now(); if (left <= 0) return resolve({ error: 'The site took too long to answer.' });
    const lib = u.protocol === 'https:' ? https : http;
    let done = false; const finish = v => { if (!done) { done = true; resolve(v); } };
    const req = lib.request({
      method: 'GET', hostname: bare, port: u.port || undefined, path: u.pathname + u.search, timeout: left,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; WreddiEmbedCheck/1.0)', accept: 'text/html,*/*;q=0.5', 'accept-encoding': 'identity' },
      lookup: allowPrivate ? undefined : guardedLookup,
    }, res => {
      const status = res.statusCode, h = res.headers;
      if ([301, 302, 303, 307, 308].includes(status) && h.location) {
        res.resume();
        if (n >= maxHops) return finish({ error: 'The site redirects too many times.' });
        let next; try { next = new URL(h.location, u).toString(); } catch (e) { return finish({ error: 'The site sent a broken redirect.' }); }
        return hop(next, n + 1).then(finish);
      }
      const isHtml = /html/i.test(h['content-type'] || '');
      let size = 0, buf = [];
      const end = () => {
        let title = '';
        if (isHtml) { const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(Buffer.concat(buf).toString('utf8')); if (m) title = m[1].replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim().slice(0, 120); }
        finish({ finalUrl: u.toString(), status, headers: h, title });
      };
      res.on('data', c => { if (!isHtml) { res.destroy(); return; } size += c.length; buf.push(c); if (size >= 65536 || /<\/title>/i.test(c.toString('utf8'))) res.destroy(); });
      res.on('end', end); res.on('close', end); res.on('error', end);
    });
    req.on('timeout', () => { req.destroy(); finish({ error: 'The site took too long to answer.' }); });
    req.on('error', e => finish({ error: /not a public/.test(e.message) ? e.message : 'Could not reach that site (' + (e.code || e.message) + ').' }));
    req.end();
  });
  return hop(rawUrl, 0);
}

// ── can the target be framed? ──────────────────────────────────
function hostMatches(token, host) {
  if (/^[a-z][a-z0-9+.-]*:$/.test(token)) return true;                  // "https:" allows any host on that scheme
  let t = token.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/\/.*$/, '').replace(/:(\*|\d+)$/, '');
  if (t === '*') return true;
  if (t.startsWith('*.')) return host.endsWith(t.slice(1));
  return t === host;
}
// h: lower-case response headers; ourHost: the host name pages are served from. Returns { embeddable: 'yes'|'no', reason }
function frameVerdict(h, ourHost) {
  ourHost = String(ourHost || '').toLowerCase().replace(/:\d+$/, '');
  const xfo = String(h['x-frame-options'] || '').toLowerCase();
  if (xfo) {
    const af = /allow-from\s+(\S+)/.exec(xfo);
    if (!(af && hostMatches(af[1], ourHost))) return { embeddable: 'no', reason: 'The site forbids being shown inside other pages (X-Frame-Options: ' + xfo.toUpperCase().slice(0, 40) + ').' };
  }
  const csp = h['content-security-policy'];
  for (const policy of String(Array.isArray(csp) ? csp.join(',') : csp || '').split(',')) {
    const m = /(?:^|;)\s*frame-ancestors\s+([^;]*)/i.exec(policy);
    if (!m) continue;
    const tokens = m[1].trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.includes("'none'") || !tokens.some(t => hostMatches(t, ourHost))) return { embeddable: 'no', reason: 'The site only allows itself or chosen sites to frame it (Content-Security-Policy: frame-ancestors).' };
  }
  return { embeddable: 'yes', reason: 'The site does not block being shown inside other pages.' };
}

// Full check used by the admin routes. Never throws.
async function checkSite(url, ourHost, ourProto = 'https', probeFn = probe) {
  let r; try { r = await probeFn(url); } catch (e) { r = { error: 'Check failed.' }; }
  if (r.error) return { embeddable: 'unknown', reason: r.error + ' It may still work; open the page to see.', title: '', finalUrl: '', status: 0 };
  const v = frameVerdict(r.headers || {}, ourHost);
  let out = { ...v, title: r.title || '', finalUrl: r.finalUrl, status: r.status };
  if (v.embeddable === 'yes' && ourProto === 'https' && /^http:/i.test(r.finalUrl)) out = { ...out, embeddable: 'no', reason: 'This site is plain http://, and browsers refuse to show http:// sites inside an https:// page. Use its https:// address if it has one.' };
  else if (v.embeddable === 'yes' && r.status >= 400) out = { ...out, embeddable: 'unknown', reason: 'The site answered with an error (HTTP ' + r.status + '). Check that the address is right.' };
  return out;
}

// ── public pages ───────────────────────────────────────────────
const BRAND = '#3E5C8A';
const BASE_CSS = 'html,body{height:100%;margin:0}body{display:flex;flex-direction:column;background:#f4f6fa;color:#1e293b;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}';
const head = (title, desc) => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="strict-origin-when-cross-origin"><title>' + esc(title) + '</title>' + (desc ? '<meta name="description" content="' + esc(desc) + '">' : '');
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

// A slim bar that always names the real site being shown (so visitors can tell whose content it is) + the framed site.
function renderPage(site) {
  const host = hostOf(site.url), title = site.title || host;
  return head(title, site.description) +
    '<style>' + BASE_CSS + '.bar{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:8px 14px;padding-top:max(8px,env(safe-area-inset-top));background:#fff;border-bottom:1px solid #e2e8f0;font-size:13px}' +
    '.bar b{color:' + BRAND + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:55%}.host{color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.bar a{margin-left:auto;white-space:nowrap;color:' + BRAND + ';font-weight:700;text-decoration:none}.wrap{position:relative;flex:1 1 auto;min-height:0}' +
    'iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}.ld{position:absolute;left:0;top:0;height:3px;width:40%;background:' + BRAND + ';animation:s 1.1s ease-in-out infinite;z-index:2}@keyframes s{0%{left:-40%}100%{left:100%}}' +
    '.slow{display:none;position:absolute;left:50%;bottom:16px;transform:translateX(-50%);background:#1e293b;color:#fff;padding:9px 14px;border-radius:12px;font-size:13px;z-index:3;text-align:center}.slow a{color:#fff;text-decoration:underline}</style></head><body>' +
    '<div class="bar"><b>' + esc(title) + '</b><span class="host">' + esc(host) + '</span><a href="' + esc(site.url) + '" target="_blank" rel="noopener noreferrer">Open original ↗</a></div>' +
    '<div class="wrap"><div class="ld" id="ld"></div>' +
    '<iframe id="f" src="' + esc(site.url) + '" title="' + esc(title) + '" referrerpolicy="strict-origin-when-cross-origin" allow="fullscreen; clipboard-write" allowfullscreen ' +
    'sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-top-navigation-by-user-activation"></iframe>' +
    '<div class="slow" id="sl">Taking long, or blank? <a href="' + esc(site.url) + '" target="_blank" rel="noopener noreferrer">Open ' + esc(host) + ' directly</a></div></div>' +
    '<script>var f=document.getElementById("f"),l=document.getElementById("ld"),s=document.getElementById("sl");f.addEventListener("load",function(){l.style.display="none";setTimeout(function(){s.style.display="none"},0)});setTimeout(function(){if(l.style.display!=="none")s.style.display="block"},10000);</script>' +
    '<noscript><p style="padding:16px"><a href="' + esc(site.url) + '">Open ' + esc(host) + '</a></p></noscript></body></html>';
}

function card(title, msg, btn) {
  return head(title) + '<style>' + BASE_CSS + 'body{align-items:center;justify-content:center;padding:24px}.c{max-width:400px;text-align:center}h1{font-size:22px;margin:0 0 8px;color:' + BRAND + '}p{margin:0 0 18px;line-height:1.5;color:#475569}.b{display:inline-block;background:' + BRAND + ';color:#fff;text-decoration:none;padding:11px 22px;border-radius:12px;font-weight:700}</style></head><body><div class="c"><h1>' + esc(title) + '</h1><p>' + esc(msg) + '</p>' + (btn || '') + '</div></body></html>';
}
// Shown instead of the frame when the target site refuses to be framed
function renderFallback(site) {
  const host = hostOf(site.url);
  return card(site.title || host, host + ' cannot be shown inside another page. You can open it directly.', '<a class="b" href="' + esc(site.url) + '" rel="noopener noreferrer">Open ' + esc(host) + '</a>');
}
const renderMessage = (title, msg) => card(title, msg, '<a class="b" href="/">Go to Wreddi</a>');

module.exports = { slugify, cleanSlug, autoSlug, cleanTitle, cleanDescription, cleanMode, cleanEmbedUrl, isPrivateIp, guardedLookup, probe, frameVerdict, checkSite, renderPage, renderFallback, renderMessage, hostOf, esc, RESERVED };
