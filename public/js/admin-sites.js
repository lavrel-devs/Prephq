/* Web pages (admin, v1.19): show another website under our own domain at /w/<name>.
   Depends on admin.html globals: toast, canView, myAccess; and AdminUI (admin-ui.js). */
(function () {
  'use strict';
  var U = window.AdminUI, E = U.E, api = U.api, ago = U.ago;
  var BRAND = '#3E5C8A', GOOD = '#16a34a', WARN = '#d97706', BAD = '#dc2626';
  var root, state = { q: '', page: 1 }, editing = null, cache = {}, typing, lastCheck = null;
  var nf = function (n) { return Number(n || 0).toLocaleString('en-NG'); };
  var canChange = function () { return myAccess.fullAccess || (myAccess.permissions || []).indexOf('sites') > -1; };
  var $ = function (id) { return document.getElementById(id); };
  var v = function (id) { var e = $(id); return e ? e.value.trim() : ''; };
  var fail = function (r, f) { toast((r.data && r.data.error) || f || 'Something went wrong'); };
  var btn = function (label, fn, cls, style) { return '<button class="' + (cls || 'ab ab-gray') + '" style="' + (style || '') + '" onclick="' + fn + '">' + label + '</button>'; };
  var field = function (label, inner, style) { return '<label class="xf" style="' + (style || '') + '"><span>' + E(label) + '</span>' + inner + '</label>'; };
  var big = function (n, label, color) { return '<div class="xcard" style="margin:0;text-align:center;padding:14px 8px"><div style="font:800 30px/1.1 var(--ff-h,inherit);color:' + (color || BRAND) + '">' + n + '</div><div style="font-weight:700;margin-top:3px;font-size:13px">' + E(label) + '</div></div>'; };
  var short = function (s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  var chip = function (t, c) { return '<span style="display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:800;color:#fff;background:' + c + '">' + t + '</span>'; };
  var EMB = { yes: ['Can be shown', GOOD], no: ['Blocks framing', BAD], unknown: ['Not sure', WARN] };
  var embChip = function (s) { var x = EMB[s.embeddable] || EMB.unknown; return '<span title="' + E(s.embeddableReason || '') + '">' + chip(x[0], x[1]) + '</span>'; };

  async function open() {
    root = $('sit-root'); if (!root) return;
    if (!canView('sites')) { root.innerHTML = '<div class="xal warn">Your account does not have access to Web pages.</div>'; return; }
    root.innerHTML =
      '<div class="xal" style="margin-bottom:12px">A web page shows another website inside a frame on your own address, like <b>yoursite.com/w/<i>name</i></b>. Some sites (Google, WhatsApp, banks, many big brands) refuse to be shown inside other pages. We check this for you, and for those sites the page sends visitors to the original instead.</div>' +
      '<div id="sit-totals" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px"></div>' +
      (canChange() ? '<div class="xcard" id="sit-form"></div>' : '') +
      '<div class="xcard"><div class="xbar" style="margin-bottom:10px"><input class="f-input" id="sit-q" placeholder="Search by name, title or address" value="' + E(state.q) + '" oninput="AdminSites.search()"></div><div id="sit-list" class="xmut">Loading…</div></div>';
    form(); load();
  }

  function verdict(c) {
    var x = EMB[c.embeddable] || EMB.unknown;
    return '<div class="xal ' + (c.embeddable === 'yes' ? 'ok' : 'warn') + '" style="margin-top:10px"><b>' + x[0] + '.</b> ' + E(c.reason || '') + (c.title ? '<div class="xmut" style="font-size:12px;margin-top:3px">Site title: ' + E(c.title) + '</div>' : '') + '</div>';
  }

  function form() {
    var f = $('sit-form'); if (!f) return; var e = editing;
    f.innerHTML = '<h3>' + (e ? 'Edit page <span class="xmut">/w/' + E(e.slug) + '</span>' : 'New web page') + '</h3>' +
      '<div class="xs">' + (e ? 'The page address stays the same, so shared links keep working.' : 'Paste the address of the website. Leave the page name empty and we make one.') + '</div>' +
      '<div class="xgrid">' +
        field('Website address', '<input class="f-input" id="st-url" placeholder="https://example.com" value="' + E(e ? e.url : '') + '">', 'grid-column:1/-1') +
        (e ? '' : field('Page name (optional)', '<input class="f-input" id="st-slug" placeholder="e.g. cbt practice" maxlength="60" autocapitalize="off" oninput="AdminSites.hint()"><span class="xmut" id="st-hint" style="font-size:12px;text-transform:none;letter-spacing:0;font-weight:500"></span>')) +
        field('Title (optional)', '<input class="f-input" id="st-title" placeholder="Shown at the top of the page" maxlength="120" value="' + E(e ? e.title : '') + '">') +
        field('What visitors get', '<select class="f-input" id="st-mode"><option value="">Choose for me (recommended)</option><option value="embed"' + (e && e.mode === 'embed' ? ' selected' : '') + '>Show the site inside our page</option><option value="redirect"' + (e && e.mode === 'redirect' ? ' selected' : '') + '>Send them to the site</option></select>') +
        field('Short note for you (optional)', '<input class="f-input" id="st-desc" maxlength="300" value="' + E(e ? e.description : '') + '">', 'grid-column:1/-1') +
      '</div><div class="xbar" style="margin-top:10px">' +
        (e ? '' : btn('Check site', 'AdminSites.check()')) + btn(e ? 'Save changes' : 'Create page', 'AdminSites.save()', 'btn-main', 'width:auto;padding:9px 18px;font-size:13px') + (e ? btn('Cancel', 'AdminSites.cancel()') : '') +
      '</div><div id="st-out"></div>';
  }

  async function load() {
    var r = await api('GET', '/api/admin/sites?page=' + state.page + '&q=' + encodeURIComponent(state.q)); var list = $('sit-list'); if (!list) return;
    if (!r.ok) { list.textContent = (r.data && r.data.error) || 'Could not load pages'; return; }
    var d = r.data; cache = {}; d.items.forEach(function (s) { cache[s._id] = s; });
    $('sit-totals').innerHTML = big(nf(d.totals.sites), 'Pages') + big(nf(d.totals.live), 'Live', GOOD) + big(nf(d.totals.views), 'Total visits');
    var ch = canChange(); list.className = '';
    list.innerHTML = '<div class="tbl-wrap"><table><thead><tr><th>Page</th><th>Shows</th><th>Visits</th><th>Framing</th><th>Status</th><th></th></tr></thead><tbody>' +
      (d.items.length ? d.items.map(function (s) {
        return '<tr><td><b>/w/' + E(s.slug) + '</b>' + (s.title ? '<div class="xmut" style="font-size:12px">' + E(short(s.title, 40)) + '</div>' : '') + '<div style="margin-top:4px">' + btn('Copy', 'AdminSites.copy(\'' + s._id + '\')', 'ab ab-gray', 'padding:3px 10px') + ' ' + btn('Open', 'AdminSites.openPage(\'' + s._id + '\')', 'ab ab-gray', 'padding:3px 10px') + '</div></td>' +
          '<td style="max-width:240px;word-break:break-all"><a href="' + E(s.url) + '" target="_blank" rel="noopener noreferrer">' + E(short(s.host, 40)) + '</a><div class="xmut" style="font-size:12px">' + (s.mode === 'redirect' ? 'Sends visitors there' : 'Shown inside our page') + '</div></td>' +
          '<td><b>' + nf(s.views) + '</b>' + (s.lastViewAt ? '<div class="xmut" style="font-size:12px">' + ago(s.lastViewAt) + '</div>' : '') + '</td><td>' + embChip(s) + '</td><td>' + (s.active ? chip('Live', GOOD) : chip('Off', '#64748b')) + '</td>' +
          '<td style="white-space:nowrap">' + (ch ? btn('Edit', 'AdminSites.edit(\'' + s._id + '\')') + ' ' + btn('Re-check', 'AdminSites.recheck(\'' + s._id + '\')') + ' ' + btn(s.active ? 'Turn off' : 'Turn on', 'AdminSites.toggle(\'' + s._id + '\')') + ' ' + btn('Delete', 'AdminSites.del(\'' + s._id + '\')', 'ab ab-del') : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="xmut" style="padding:14px">' + (state.q ? 'No pages match.' : 'No web pages yet. Make your first one above.') + '</td></tr>') + '</tbody></table></div>' +
      (d.pages > 1 ? '<div class="xbar" style="margin-top:10px;align-items:center">' + (d.page > 1 ? btn('‹ Newer', 'AdminSites.go(' + (d.page - 1) + ')') : '') + '<span class="xmut">Page ' + d.page + ' of ' + d.pages + '</span>' + (d.page < d.pages ? btn('Older ›', 'AdminSites.go(' + (d.page + 1) + ')') : '') + '</div>' : '');
  }

  function slugify(s) { return String(s || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-+/, '').slice(0, 40).replace(/-+$/, ''); }
  function hint() { var h = $('st-hint'); if (!h) return; var s = slugify(v('st-slug')); h.textContent = v('st-slug') ? (s.length >= 3 ? 'Your page will be /w/' + s : 'Needs at least 3 letters or numbers') : ''; }
  function search() { clearTimeout(typing); typing = setTimeout(function () { state.q = v('sit-q'); state.page = 1; load(); }, 300); }
  function go(p) { state.page = p; load(); }

  async function check() {
    var url = v('st-url'); if (!url) return toast('Paste the website address first');
    $('st-out').innerHTML = '<div class="xmut" style="margin-top:10px">Checking the site… this can take a few seconds.</div>';
    var r = await api('POST', '/api/admin/sites/check', { url: url }); if (!r.ok) { $('st-out').innerHTML = ''; return fail(r); }
    $('st-out').innerHTML = verdict(r.data);
  }

  async function save() {
    var body = { url: v('st-url'), title: v('st-title'), description: v('st-desc') }; if (v('st-mode')) body.mode = v('st-mode');
    if (!body.url) return toast('Paste the website address first');
    if (editing) {
      $('st-out').innerHTML = '<div class="xmut" style="margin-top:10px">Saving…</div>';
      var r = await api('PUT', '/api/admin/sites/' + editing._id, body); if (!r.ok) { $('st-out').innerHTML = ''; return fail(r); }
      toast('Page updated'); editing = null; form(); load(); return;
    }
    body.slug = v('st-slug');
    $('st-out').innerHTML = '<div class="xmut" style="margin-top:10px">Checking the site and creating the page…</div>';
    var c = await api('POST', '/api/admin/sites', body); if (!c.ok) { $('st-out').innerHTML = ''; return fail(c); }
    cache[c.data._id] = c.data; form();
    $('st-out').innerHTML = '<div class="xal ok" style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span>Ready: <b>' + E(c.data.pageUrl) + '</b></span>' + btn('Copy', 'AdminSites.copy(\'' + c.data._id + '\')', 'btn-main', 'width:auto;padding:6px 14px;font-size:13px') + btn('Open', 'AdminSites.openPage(\'' + c.data._id + '\')') + '</div>' +
      verdict({ embeddable: c.data.embeddable, reason: c.data.embeddableReason }) + (c.data.mode === 'redirect' && c.data.embeddable === 'no' ? '<div class="xs" style="margin-top:6px">Because this site blocks framing, visitors will be sent straight to it.</div>' : '');
    copyText(c.data.pageUrl, true); load();
  }

  function edit(id) { editing = cache[id]; form(); var f = $('sit-form'); if (f && f.scrollIntoView) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function cancel() { editing = null; form(); }
  async function toggle(id) { var s = cache[id]; if (!s) return; var r = await api('PUT', '/api/admin/sites/' + id, { active: !s.active }); if (!r.ok) return fail(r); toast(s.active ? 'Page switched off' : 'Page switched on'); load(); }
  async function recheck(id) { toast('Checking the site…'); var r = await api('POST', '/api/admin/sites/' + id + '/recheck'); if (!r.ok) return fail(r); toast((EMB[r.data.embeddable] || EMB.unknown)[0]); load(); }
  async function del(id) {
    var s = cache[id]; if (!s) return;
    if (!confirm('Delete /w/' + s.slug + '? Anyone opening it afterwards will see a "Page not found" message. This cannot be undone.')) return;
    var r = await api('DELETE', '/api/admin/sites/' + id); if (!r.ok) return fail(r); toast('Page deleted'); if (editing && editing._id === id) { editing = null; form(); } load();
  }

  function copyText(t, quiet) {
    var done = function () { toast(quiet ? 'Page link copied' : 'Copied: ' + t); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () { fb(t, done); }); else fb(t, done);
  }
  function fb(t, done) { var a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed — long-press the link instead'); } a.remove(); }
  function copy(id) { var s = cache[id]; if (s) copyText(s.pageUrl); }
  function openPage(id) { var s = cache[id]; if (s) window.open(s.pageUrl, '_blank', 'noopener'); }

  window.AdminSites = { open: open, save: save, check: check, edit: edit, cancel: cancel, toggle: toggle, recheck: recheck, del: del, copy: copy, openPage: openPage, search: search, hint: hint, go: go };
})();
