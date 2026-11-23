/* Shared helpers for the v1.14 admin modules (Secondary control centre + System & controls).
   Depends on admin.html globals: adminFetch, toast, escHtml, downloadCsv. */
(function () {
  'use strict';
  if (window.AdminUI) return;
  var E = function (s) { return escHtml(s == null ? '' : String(s)); };

  var css = document.createElement('style');
  css.textContent =
    '.xt{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 18px;border-bottom:1px solid var(--bd);padding-bottom:10px}' +
    '.xt button{border:1px solid var(--bd);background:var(--surf);color:var(--t2);padding:8px 14px;border-radius:10px;font:600 13px var(--ff,inherit);cursor:pointer}' +
    '.xt button.on{background:var(--brand-lt);color:var(--brand);border-color:transparent}' +
    '.xbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}.xbar .f-input{width:auto;min-width:120px;flex:0 1 auto}' +
    '.xcard{background:var(--surf);border:1px solid var(--bd);border-radius:14px;padding:18px;margin-bottom:18px;box-shadow:var(--sh)}' +
    '.xcard h3{margin:0 0 4px;font:800 15px var(--ff-h,inherit)}.xcard .xs{font-size:12px;color:var(--t3);margin-bottom:12px;line-height:1.5}' +
    '.xgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}' +
    '.xf{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}.xf>span{font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.05em}' +
    '.xf .f-input,.xf textarea,.xf select{width:100%;box-sizing:border-box}.xf textarea{min-height:70px;resize:vertical}' +
    '.xrow2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.xrow3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}' +
    '.xsw{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--bd)}.xsw:last-child{border-bottom:0}' +
    '.xsw b{font-size:13px}.xsw small{display:block;color:var(--t3);font-size:11px;margin-top:2px;line-height:1.4}' +
    '.xsw input{appearance:none;width:42px;height:24px;border-radius:99px;background:var(--surf3,#cbd5e1);position:relative;cursor:pointer;flex:none;transition:.15s}' +
    '.xsw input:after{content:"";position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.15s;box-shadow:0 1px 3px rgba(0,0,0,.3)}' +
    '.xsw input:checked{background:var(--ok,#16a34a)}.xsw input:checked:after{left:21px}' +
    '.xbars{display:flex;align-items:flex-end;gap:3px;height:90px}.xbars>div{flex:1;min-width:3px;background:var(--brand);border-radius:3px 3px 0 0;position:relative;opacity:.85}' +
    '.xbars>div i{position:absolute;left:0;right:0;bottom:0;background:var(--no,#dc2626);border-radius:3px 3px 0 0}' +
    '.xhb{display:flex;align-items:center;gap:8px;margin:5px 0;font-size:12px}.xhb>span:first-child{width:78px;color:var(--t3);flex:none}.xhb>div{flex:1;height:14px;background:var(--surf2);border-radius:7px;overflow:hidden}.xhb>div>i{display:block;height:100%;background:linear-gradient(90deg,var(--brand),var(--purple))}.xhb>b{width:44px;text-align:right;flex:none}' +
    '.xal{padding:10px 14px;border-radius:10px;font-size:13px;font-weight:600;margin-bottom:8px}.xal.warn{background:var(--warn-lt);color:var(--warn)}.xal.danger{background:var(--no-lt);color:var(--no)}.xal.ok{background:var(--ok-lt);color:var(--ok)}' +
    '.xmut{color:var(--t4);font-size:11px}.xdot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:7px;vertical-align:middle}' +
    '.xchip{display:inline-block;padding:2px 8px;border-radius:99px;background:var(--surf2);font-size:10px;font-weight:700;margin:1px 2px 1px 0;text-transform:uppercase}' +
    '.xpg{display:flex;gap:10px;align-items:center;justify-content:center;padding:12px;font-size:12px;color:var(--t3)}' +
    '.xwide{max-width:760px !important}.xpre{white-space:pre-wrap;font:12px/1.5 ui-monospace,Menlo,monospace;background:var(--surf2);padding:10px;border-radius:8px;max-height:160px;overflow:auto}' +
    '@media(max-width:640px){.xrow2,.xrow3{grid-template-columns:1fr}}';
  document.head.appendChild(css);

  // ── network ──
  async function api(method, url, body) {
    try {
      var r = await adminFetch(url, { method: method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
      var d = await r.json().catch(function () { return {}; });
      return { ok: r.ok, status: r.status, data: d };
    } catch (e) { return { ok: false, status: 0, data: { error: 'Network problem' } }; }
  }

  // ── modal ──
  var bg;
  function modal(html, wide) {
    if (!bg) {
      bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = 'xm-bg';
      bg.addEventListener('click', function (e) { if (e.target === bg) closeModal(); });
      document.body.appendChild(bg);
    }
    bg.innerHTML = '<div class="modal' + (wide ? ' xwide' : '') + '">' + html + '</div>';
    requestAnimationFrame(function () { bg.classList.add('on'); });
  }
  function closeModal() { if (bg) bg.classList.remove('on'); }

  // ── bits ──
  var card = function (v, l) { return '<div class="sc"><div class="sc-val">' + E(v) + '</div><div class="sc-lbl">' + E(l) + '</div></div>'; };
  var badge = function (t, cls) { return '<span class="badge ' + (cls || 'b-brand') + '">' + E(t) + '</span>'; };
  function bars(rows, fmt) {   // [{label, n}] -> horizontal bars
    var max = Math.max(1, Math.max.apply(null, rows.map(function (r) { return r.n; })));
    return rows.map(function (r) { return '<div class="xhb"><span>' + E(r.label) + '</span><div><i style="width:' + Math.round((r.n / max) * 100) + '%"></i></div><b>' + E(fmt ? fmt(r.n) : r.n) + '</b></div>'; }).join('') || '<div class="xmut">Nothing yet</div>';
  }
  function pager(p, fn) {
    if (!p || p.pages <= 1) return '';
    return '<div class="xpg"><button class="ab ab-gray" ' + (p.page <= 1 ? 'disabled' : '') + ' onclick="' + fn + '(' + (p.page - 1) + ')">‹ Prev</button>Page ' + p.page + ' of ' + p.pages + ' · ' + p.total + ' total<button class="ab ab-gray" ' + (p.page >= p.pages ? 'disabled' : '') + ' onclick="' + fn + '(' + (p.page + 1) + ')">Next ›</button></div>';
  }
  var ago = function (d) {
    if (!d) return '—'; var s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
    if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago';
  };
  var qs = function (o) { return Object.keys(o).filter(function (k) { return o[k] !== '' && o[k] !== undefined && o[k] !== null; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); };
  var val = function (id) { var e = document.getElementById(id); return e ? e.value : ''; };
  var chk = function (id) { var e = document.getElementById(id); return !!(e && e.checked); };

  // Minimal RFC-4180 CSV reader (quotes, escaped quotes, commas and newlines inside quotes).
  function parseCsv(text) {
    var rows = [], row = [], cell = '', q = false, i = 0, c;
    text = String(text).replace(/^\uFEFF/, '');
    for (; i < text.length; i++) {
      c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(function (x) { return x.trim(); })) rows.push(row); row = []; }
      else cell += c;
    }
    row.push(cell); if (row.some(function (x) { return x.trim(); })) rows.push(row);
    return rows;
  }

  window.AdminUI = { E: E, api: api, modal: modal, closeModal: closeModal, card: card, badge: badge, bars: bars, pager: pager, ago: ago, qs: qs, val: val, chk: chk, parseCsv: parseCsv };
})();
