/* Short links (admin, v1.18): create · search · edit · switch off · delete · click stats.
   Depends on admin.html globals: toast, canView, myAccess; and AdminUI (admin-ui.js). */
(function () {
  'use strict';
  var U = window.AdminUI, E = U.E, api = U.api, ago = U.ago;
  var BRAND = '#3E5C8A', GOOD = '#16a34a', WARN = '#d97706', BAD = '#dc2626';
  var root, state = { q: '', status: '', page: 1 }, editing = null, cache = {}, typing;
  var nf = function (n) { return Number(n || 0).toLocaleString('en-NG'); };
  var canChange = function () { return myAccess.fullAccess || (myAccess.permissions || []).indexOf('links') > -1; };
  var $ = function (id) { return document.getElementById(id); };
  var v = function (id) { var e = $(id); return e ? e.value.trim() : ''; };
  var fail = function (r, f) { toast((r.data && r.data.error) || f || 'Something went wrong'); };
  var btn = function (label, fn, cls, style) { return '<button class="' + (cls || 'ab ab-gray') + '" style="' + (style || '') + '" onclick="' + fn + '">' + label + '</button>'; };
  var field = function (label, inner, style) { return '<label class="xf" style="' + (style || '') + '"><span>' + E(label) + '</span>' + inner + '</label>'; };
  var big = function (n, label, color) { return '<div class="xcard" style="margin:0;text-align:center;padding:14px 8px"><div style="font:800 30px/1.1 var(--ff-h,inherit);color:' + (color || BRAND) + '">' + n + '</div><div style="font-weight:700;margin-top:3px;font-size:13px">' + E(label) + '</div></div>'; };
  var short = function (s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  var fmtDate = function (d) { return d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
  var STATUS = { live: ['Live', GOOD], off: ['Off', '#64748b'], expired: ['Expired', WARN] };
  var pill = function (s) { var x = STATUS[s] || STATUS.live; return '<span style="display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:800;color:#fff;background:' + x[1] + '">' + x[0] + '</span>'; };

  async function open() {
    root = $('lnk-root'); if (!root) return;
    if (!canView('links')) { root.innerHTML = '<div class="xal warn">Your account does not have access to Short links.</div>'; return; }
    root.innerHTML =
      '<div id="lnk-totals" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px"></div>' +
      (canChange() ? '<div class="xcard" id="lnk-form"></div>' : '') +
      '<div class="xcard"><div class="xbar" style="margin-bottom:10px">' +
        '<input class="f-input" id="lnk-q" placeholder="Search by code, title or address" value="' + E(state.q) + '" oninput="AdminLinks.search()">' +
        '<select class="f-input" id="lnk-status" onchange="AdminLinks.filter()" style="max-width:160px">' + [['', 'All links'], ['live', 'Live'], ['off', 'Switched off'], ['expired', 'Expired']].map(function (o) { return '<option value="' + o[0] + '"' + (state.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '</div><div id="lnk-list" class="xmut">Loading…</div><div id="lnk-stats"></div></div>';
    form(); load();
  }

  function form() {
    var f = $('lnk-form'); if (!f) return;
    var e = editing;
    f.innerHTML = '<h3>' + (e ? 'Edit link <span class="xmut">/l/' + E(e.code) + '</span>' : 'New short link') + '</h3>' +
      '<div class="xs">' + (e ? 'The short address stays the same, so anything already printed or shared keeps working.' : 'Paste any web address. Leave the code empty and we make one for you.') + '</div>' +
      '<div class="xgrid">' +
        field('Web address to shorten', '<input class="f-input" id="lk-url" placeholder="https://example.com/very/long/page" value="' + E(e ? e.url : '') + '">', 'grid-column:1/-1') +
        (e ? '' : field('Custom code (optional)', '<input class="f-input" id="lk-code" placeholder="e.g. chm101" maxlength="32" autocapitalize="off">')) +
        field('Title (optional)', '<input class="f-input" id="lk-title" placeholder="So you remember what it is" maxlength="120" value="' + E(e ? e.title : '') + '">') +
        field('Stops working on (optional)', '<input class="f-input" id="lk-exp" type="date" value="' + (e && e.expiresAt ? new Date(e.expiresAt).toISOString().slice(0, 10) : '') + '">') +
      '</div><div class="xbar" style="margin-top:10px">' +
        btn(e ? 'Save changes' : 'Shorten', 'AdminLinks.save()', 'btn-main', 'width:auto;padding:9px 18px;font-size:13px') + (e ? btn('Cancel', 'AdminLinks.cancel()') : '') +
      '</div><div id="lk-made"></div>';
  }

  async function load() {
    var qs = 'page=' + state.page + '&q=' + encodeURIComponent(state.q) + '&status=' + state.status;
    var r = await api('GET', '/api/admin/links?' + qs); var list = $('lnk-list'); if (!list) return;
    if (!r.ok) { list.textContent = (r.data && r.data.error) || 'Could not load links'; return; }
    var d = r.data; cache = {}; d.items.forEach(function (l) { cache[l._id] = l; });
    $('lnk-totals').innerHTML = big(nf(d.totals.links), 'Links') + big(nf(d.totals.live), 'Live', GOOD) + big(nf(d.totals.clicks), 'Total opens');
    var ch = canChange();
    list.className = '';
    list.innerHTML = '<div class="tbl-wrap"><table><thead><tr><th>Short link</th><th>Goes to</th><th>Opens</th><th>Last opened</th><th>Status</th><th></th></tr></thead><tbody>' +
      (d.items.length ? d.items.map(function (l) {
        return '<tr><td><b>/l/' + E(l.code) + '</b>' + (l.title ? '<div class="xmut" style="font-size:12px">' + E(short(l.title, 40)) + '</div>' : '') + '<div style="margin-top:4px">' + btn('Copy', 'AdminLinks.copy(\'' + l._id + '\')', 'ab ab-gray', 'padding:3px 10px') + '</div></td>' +
          '<td style="max-width:260px;word-break:break-all"><a href="' + E(l.url) + '" target="_blank" rel="noopener noreferrer">' + E(short(l.url, 70)) + '</a>' + (l.expiresAt ? '<div class="xmut" style="font-size:12px">Ends ' + fmtDate(l.expiresAt) + '</div>' : '') + '</td>' +
          '<td><b>' + nf(l.clicks) + '</b></td><td>' + (l.lastClickAt ? ago(l.lastClickAt) : '<span class="xmut">never</span>') + '</td><td>' + pill(l.status) + '</td>' +
          '<td style="white-space:nowrap">' + btn('Stats', 'AdminLinks.stats(\'' + l._id + '\')') + (ch ? ' ' + btn('Edit', 'AdminLinks.edit(\'' + l._id + '\')') + ' ' + btn(l.active ? 'Turn off' : 'Turn on', 'AdminLinks.toggle(\'' + l._id + '\')') + ' ' + btn('Delete', 'AdminLinks.del(\'' + l._id + '\')', 'ab ab-del') : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="xmut" style="padding:14px">' + (state.q || state.status ? 'No links match.' : 'No short links yet. Make your first one above.') + '</td></tr>') +
      '</tbody></table></div>' +
      (d.pages > 1 ? '<div class="xbar" style="margin-top:10px;align-items:center">' + (d.page > 1 ? btn('‹ Newer', 'AdminLinks.go(' + (d.page - 1) + ')') : '') + '<span class="xmut">Page ' + d.page + ' of ' + d.pages + '</span>' + (d.page < d.pages ? btn('Older ›', 'AdminLinks.go(' + (d.page + 1) + ')') : '') + '</div>' : '');
  }

  function search() { clearTimeout(typing); typing = setTimeout(function () { state.q = v('lnk-q'); state.page = 1; load(); }, 300); }
  function filter() { state.status = $('lnk-status').value; state.page = 1; load(); }
  function go(p) { state.page = p; load(); }

  async function save() {
    var body = { url: v('lk-url'), title: v('lk-title'), expiresAt: v('lk-exp') || null };
    if (!body.url) return toast('Paste the web address first');
    if (editing) {
      var r = await api('PUT', '/api/admin/links/' + editing._id, body); if (!r.ok) return fail(r);
      toast('Link updated'); editing = null; form(); load(); return;
    }
    body.code = v('lk-code');
    var c = await api('POST', '/api/admin/links', body); if (!c.ok) return fail(c);
    cache[c.data._id] = c.data; form();
    $('lk-made').innerHTML = '<div class="xal ok" style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span>Ready: <b>' + E(c.data.shortUrl) + '</b></span>' + btn('Copy', 'AdminLinks.copy(\'' + c.data._id + '\')', 'btn-main', 'width:auto;padding:6px 14px;font-size:13px') + '</div>';
    copyText(c.data.shortUrl, true); load();
  }

  function edit(id) { editing = cache[id]; form(); var f = $('lnk-form'); if (f && f.scrollIntoView) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function cancel() { editing = null; form(); }
  async function toggle(id) { var l = cache[id]; if (!l) return; var r = await api('PUT', '/api/admin/links/' + id, { active: !l.active }); if (!r.ok) return fail(r); toast(l.active ? 'Link switched off' : 'Link switched on'); load(); }
  async function del(id) {
    var l = cache[id]; if (!l) return;
    if (!confirm('Delete /l/' + l.code + '? Anyone opening it afterwards will see a "Link not found" page. This cannot be undone.')) return;
    var r = await api('DELETE', '/api/admin/links/' + id); if (!r.ok) return fail(r); toast('Link deleted'); if (editing && editing._id === id) { editing = null; form(); } $('lnk-stats').innerHTML = ''; load();
  }

  function copyText(t, quiet) {
    var done = function () { toast(quiet ? 'Short link copied' : 'Copied: ' + t); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () { fallback(t, done); }); else fallback(t, done);
  }
  function fallback(t, done) { var a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed — long-press the link instead'); } a.remove(); }
  function copy(id) { var l = cache[id]; if (l) copyText(l.shortUrl); }

  async function stats(id) {
    var out = $('lnk-stats'); out.innerHTML = '<div class="xmut" style="padding:12px">Loading…</div>';
    var r = await api('GET', '/api/admin/links/' + id + '/stats'); if (!r.ok) { out.innerHTML = ''; return fail(r); }
    var s = r.data.series, max = Math.max.apply(null, s.map(function (x) { return x.value; }).concat([1])), sd = function (d) { var p = d.split('-'); return Number(p[2]) + '/' + Number(p[1]); };
    out.innerHTML = '<div style="border-top:1px solid var(--bd);margin-top:14px;padding-top:12px"><h3 style="margin-bottom:2px">/l/' + E(r.data.link.code) + ' · last 30 days</h3>' +
      '<div class="xs"><b>' + nf(r.data.last30) + '</b> opens in the last 30 days · <b>' + nf(r.data.link.clicks) + '</b> in total · Nigerian dates</div>' +
      '<div style="display:flex;align-items:flex-end;gap:3px;height:130px;padding-top:16px">' + s.map(function (x, i) {
        return '<div title="' + E(x.day + ': ' + x.value + ' opens') + '" style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">' +
          '<div style="width:100%;height:' + Math.max(x.value ? 4 : 1, Math.round(x.value / max * 100)) + 'px;border-radius:4px 4px 2px 2px;background:' + (i === s.length - 1 ? GOOD : BRAND) + ';opacity:' + (x.value ? 1 : .25) + '"></div>' +
          '<div style="font-size:9px;color:var(--t3);height:12px;margin-top:3px;white-space:nowrap">' + (i % 6 === 0 || i === s.length - 1 ? sd(x.day) : '') + '</div></div>';
      }).join('') + '</div></div>';
    if (out.scrollIntoView) out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  window.AdminLinks = { open: open, save: save, edit: edit, cancel: cancel, toggle: toggle, del: del, copy: copy, stats: stats, search: search, filter: filter, go: go };
})();
