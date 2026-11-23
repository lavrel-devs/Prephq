/* System & controls (admin, v1.14): live monitor · controls · errors · database · cleanup · audit. */
(function () {
  'use strict';
  var U = window.AdminUI, E = U.E, api = U.api, card = U.card, badge = U.badge, val = U.val, chk = U.chk;
  var tab = 'monitor', root, timer = null, auto = true;
  var fail = function (r, f) { toast((r.data && r.data.error) || f || 'Something went wrong'); };
  var body = function () { return document.getElementById('sys-body'); };

  var SWITCHES = [
    ['signups', 'New sign-ups', 'Off = nobody can create an account (university or Secondary).'],
    ['logins', 'Student sign-in', 'Off = students cannot sign in. Admins are never affected.'],
    ['aiChat', 'AI assistant (chat + Brainiac)', 'Off = the AI tutor stops answering. Use if the AI bill or provider is misbehaving.'],
    ['aiQuiz', 'AI quizzes, notes & study guides', 'Off = anything the AI generates is paused. Bank questions still work.'],
    ['contests', 'Contests', 'Off = joining or playing contests is paused (viewing still works).'],
    ['studyRooms', 'Study rooms', 'Off = creating or joining live rooms is paused.'],
    ['creditTransfers', 'Credit transfers', 'Off = students cannot send credits to each other.'],
  ];

  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function shell() {
    var tabs = [['monitor', 'Live monitor'], ['controls', 'Controls'], ['errors', 'Errors'], ['database', 'Database'], ['cleanup', 'Cleanup'], ['audit', 'Audit trail']];
    root.innerHTML = '<div class="xt">' + tabs.map(function (t) { return '<button class="' + (tab === t[0] ? 'on' : '') + '" onclick="AdminSystem.show(\'' + t[0] + '\')">' + t[1] + '</button>'; }).join('') + '</div><div id="sys-body"><div class="xmut">Loading…</div></div>';
  }
  async function show(t) {
    tab = t || tab; stop(); shell();
    try { await ({ monitor: monitorTab, controls: controlsTab, errors: errorsTab, database: dbTab, cleanup: cleanupTab, audit: auditTab })[tab](); }
    catch (e) { console.error(e); body().innerHTML = '<div class="xal danger">Could not load this tab. ' + E(e.message || '') + '</div>'; }
  }
  async function open() { root = document.getElementById('sys-root'); if (!root) return; await show(tab); }

  // ══ MONITOR ════════════════════════════════════════════════
  var upTxt = function (s) { return s > 86400 ? Math.floor(s / 86400) + 'd ' + Math.floor(s % 86400 / 3600) + 'h' : s > 3600 ? Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm' : Math.floor(s / 60) + 'm'; };
  function spark(vals, color, max) {
    if (!vals.length) return '';
    var w = 300, h = 54, m = max || Math.max.apply(null, vals.concat([1])), step = w / Math.max(1, vals.length - 1);
    var pts = vals.map(function (v, i) { return (i * step).toFixed(1) + ',' + (h - 3 - (v / m) * (h - 8)).toFixed(1); }).join(' ');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:' + h + 'px"><polyline fill="none" stroke="' + color + '" stroke-width="2" points="' + pts + '"/></svg>';
  }
  async function monitorTab() {
    body().innerHTML = '<div class="xbar"><button class="btn-main" style="width:auto;padding:9px 16px;font-size:13px" onclick="AdminSystem.refreshMonitor()">Refresh</button><label style="font-size:13px"><input type="checkbox" id="mon-auto" ' + (auto ? 'checked' : '') + ' onchange="AdminSystem.setAuto(this.checked)"> Auto-refresh every 10 s</label><span class="xmut" id="mon-at"></span></div><div id="mon-body"></div>';
    await refreshMonitor(); setAuto(auto);
  }
  function setAuto(on) { auto = on; stop(); if (on && tab === 'monitor') timer = setInterval(function () { if (document.getElementById('mon-body') && !document.hidden) refreshMonitor(); else if (!document.getElementById('mon-body')) stop(); }, 10000); }
  async function refreshMonitor() {
    var r = await api('GET', '/api/admin/platform/monitor'); if (!r.ok) return fail(r, 'Could not load the monitor');
    var d = r.data, s = d.snapshot, el = document.getElementById('mon-body'); if (!el) return;
    var maxN = Math.max.apply(null, s.series.map(function (x) { return x.n; }).concat([1]));
    var reqBars = '<div class="xbars">' + s.series.map(function (x) { var hh = Math.max(x.n ? 4 : 1, Math.round(x.n / maxN * 100)); return '<div title="' + E(new Date(x.t).toLocaleTimeString() + ' — ' + x.n + ' requests, ' + x.e5 + ' errors') + '" style="height:' + hh + '%">' + (x.e5 ? '<i style="height:' + Math.min(100, Math.round(x.e5 / x.n * 100)) + '%"></i>' : '') + '</div>'; }).join('') + '</div>';
    var sm = s.samples;
    var ok = function (v, warn, bad) { return v >= bad ? 'b-no' : v >= warn ? 'b-warn' : 'b-ok'; };
    el.innerHTML =
      (d.alerts.length ? d.alerts.map(function (a) { return '<div class="xal ' + a.level + '">' + E(a.text) + '</div>'; }).join('') : '<div class="xal ok">All systems normal.</div>') +
      '<div class="sg">' + card(d.online.five, 'Online (5 min)') + card(d.online.secondaryFive, 'Secondary online') + card(d.online.thirty, 'Active (30 min)') + card(s.rpm5, 'Requests / min') + card(s.errorRate5 + '%', 'Server errors (5 min)') + card(s.avgMs15 + ' ms', 'Avg response') + card(s.p95Ms15 + ' ms', 'Slowest 5%') +
      card(d.dbPingMs === null ? 'down' : d.dbPingMs + ' ms', 'Database ping') + card(s.now.rss + ' MB', 'Memory') + card(s.now.cpu + '%', 'CPU') + card(s.now.lag + ' ms', 'Event-loop lag') + card(upTxt(s.uptimeSec), 'Uptime') + card(d.sessions.students, 'Student sessions') + card(d.pendingSupport, 'Open support') + card(d.secondaryPapersLastHour, 'Secondary papers (1 h)') + '</div>' +
      '<div class="xgrid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">' +
      '<div class="xcard"><h3>Requests per minute · last hour</h3>' + reqBars + '<div class="xmut" style="margin-top:6px">Red = server errors. ' + s.requests60 + ' requests in the hour.</div></div>' +
      '<div class="xcard"><h3>Memory (MB)</h3>' + spark(sm.map(function (x) { return x.rss; }), '#6366f1') + '<h3 style="margin-top:10px">Event-loop lag (ms)</h3>' + spark(sm.map(function (x) { return x.lag; }), '#f59e0b') + '<h3 style="margin-top:10px">CPU (%)</h3>' + spark(sm.map(function (x) { return x.cpu; }), '#10b981', 100) + '</div></div>' +
      '<div class="xcard"><h3>Server</h3><div class="xs">Node ' + E(d.server.node) + ' · app v' + E(d.server.appVersion) + ' · ' + E(d.server.platform) + ' · ' + E(d.server.env) + ' · started ' + new Date(s.startedAt).toLocaleString() + ' · ' + d.accounts.secondary + ' Secondary and ' + ((d.accounts.university || 0)) + ' university accounts · ' + d.sessions.admins + ' admin session(s)</div></div>' +
      routeTable('Busiest endpoints', s.topRoutes) + routeTable('Slowest endpoints (avg)', s.slowestRoutes) + (s.errorRoutes.length ? routeTable('Endpoints with server errors', s.errorRoutes) : '');
    var at = document.getElementById('mon-at'); if (at) at.textContent = 'Updated ' + new Date().toLocaleTimeString() + ' · resets when the server restarts';
  }
  function routeTable(title, rows) {
    return '<div class="tw"><div class="th"><div class="th-title">' + E(title) + '</div></div><div class="tbl-wrap"><table><thead><tr><th>Endpoint</th><th>Calls</th><th>Avg</th><th>Max</th><th>4xx</th><th>5xx</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (x) { return '<tr><td style="font-family:ui-monospace,Menlo,monospace;font-size:12px">' + E(x.route) + '</td><td>' + x.n + '</td><td>' + x.avg + ' ms</td><td>' + x.max + ' ms</td><td>' + x.e4 + '</td><td>' + (x.e5 ? badge(x.e5, 'b-no') : 0) + '</td></tr>'; }).join('') : '<tr class="empty-row"><td colspan="6">Nothing yet</td></tr>') + '</tbody></table></div></div>';
  }

  // ══ CONTROLS ═══════════════════════════════════════════════
  async function controlsTab() {
    var r = await api('GET', '/api/admin/platform/controls'); if (!r.ok) return fail(r);
    var c = r.data, m = c.maintenance, b = c.banner;
    var sel = function (id, cur, list) { return '<select class="f-input" id="' + id + '">' + list.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === cur ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>'; };
    var sw = function (id, t, h, on) { return '<label class="xsw"><div><b>' + E(t) + '</b><small>' + E(h) + '</small></div><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '></label>'; };
    body().innerHTML =
      '<div class="xcard" style="' + (m.enabled ? 'border-color:var(--no)' : '') + '"><h3>Maintenance mode ' + (m.enabled ? badge('ON', 'b-no') : badge('off', 'b-ok')) + '</h3><div class="xs">Locks every student out behind an “we’re updating” page. Admins keep full access, so you can switch it off again. Students already signed in stay signed in.</div>' +
      '<div class="xf"><span>Message students see</span><textarea class="f-input" id="mt-msg" maxlength="400" placeholder="We are upgrading Wreddi. Back shortly.">' + E(m.message) + '</textarea></div><div class="xf"><span>Back online by (optional)</span><input class="f-input" id="mt-eta" maxlength="60" placeholder="e.g. 6:00 PM" value="' + E(m.eta) + '"></div>' +
      '<button class="btn-main" style="width:auto;padding:10px 22px;font-size:14px;' + (m.enabled ? '' : 'background:var(--no)!important') + '" onclick="AdminSystem.setMaintenance(' + !m.enabled + ')">' + (m.enabled ? 'Turn maintenance OFF' : 'Turn maintenance ON') + '</button></div>' +
      '<div class="xcard"><h3>Site banner ' + (b.enabled ? badge('showing', 'b-warn') : badge('hidden', 'b-gray')) + '</h3><div class="xs">A message strip at the top of the student app and sign-in page. Students can dismiss it for the session.</div>' +
      '<div class="xf"><span>Text</span><textarea class="f-input" id="bn-text" maxlength="300">' + E(b.text) + '</textarea></div><div class="xrow2"><div class="xf"><span>Style</span>' + sel('bn-tone', b.tone, [['info', 'Info (blue)'], ['warn', 'Warning (amber)'], ['danger', 'Urgent (red)']]) + '</div><div class="xf"><span>Show to</span>' + sel('bn-aud', b.audience, [['all', 'Everyone'], ['university', 'University students'], ['secondary', 'Secondary students']]) + '</div></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn-main" style="width:auto;padding:10px 22px;font-size:14px" onclick="AdminSystem.saveBanner(true)">' + (b.enabled ? 'Update banner' : 'Show banner') + '</button>' + (b.enabled ? '<button class="btn-cancel" style="flex:none;padding:10px 22px" onclick="AdminSystem.saveBanner(false)">Hide banner</button>' : '') + '</div></div>' +
      '<div class="xcard"><h3>Feature switches</h3><div class="xs">Instant kill switches. A switched-off feature tells students it is paused; nothing is deleted.</div>' + SWITCHES.map(function (s) { return sw('fs-' + s[0], s[1], s[2], c.switches[s[0]] !== false); }).join('') +
      sw('fs-secondary', 'Wreddi Secondary (whole app)', 'Off = every Secondary screen shows “paused”. More Secondary options live in the Secondary control centre.', c.secondary.enabled) +
      '<div style="margin-top:12px"><button class="btn-main" style="width:auto;padding:10px 22px;font-size:14px" onclick="AdminSystem.saveSwitches()">Save switches</button></div></div>' +
      '<div class="xcard" style="border-color:var(--warn)"><h3>Emergency: sign students out</h3><div class="xs">Ends every signed-in session for the group you choose. They are returned to the sign-in page within about 30 seconds. Use after a security scare.</div><div class="xrow2"><div class="xf"><span>Who</span>' + sel('so-track', 'all', [['all', 'All students'], ['university', 'University students'], ['secondary', 'Secondary students']]) + '</div><div class="xf"><span>Type SIGN OUT to confirm</span><input class="f-input" id="so-confirm" autocomplete="off"></div></div><button class="btn-main" style="width:auto;padding:10px 22px;font-size:14px;background:var(--no)!important" onclick="AdminSystem.signOutAll()">Sign them out</button></div>';
  }
  async function setMaintenance(on) {
    if (on && !confirm('Turn maintenance ON? Every student is locked out until you switch it off.')) return;
    var r = await api('PUT', '/api/admin/platform/controls', { maintenance: { enabled: on, message: val('mt-msg'), eta: val('mt-eta') } });
    if (r.ok) { toast(on ? 'Maintenance mode is ON' : 'Maintenance mode is OFF'); controlsTab(); } else fail(r);
  }
  async function saveBanner(on) {
    var r = await api('PUT', '/api/admin/platform/controls', { banner: { enabled: on, text: val('bn-text'), tone: val('bn-tone'), audience: val('bn-aud') } });
    if (r.ok) { toast(on ? 'Banner is live' : 'Banner hidden'); controlsTab(); } else fail(r);
  }
  async function saveSwitches() {
    var sw = {}; SWITCHES.forEach(function (s) { sw[s[0]] = chk('fs-' + s[0]); });
    var off = Object.keys(sw).filter(function (k) { return !sw[k]; }); var secOff = !chk('fs-secondary');
    if ((off.length || secOff) && !confirm('Switch OFF: ' + off.concat(secOff ? ['secondary'] : []).join(', ') + '?')) return;
    var r = await api('PUT', '/api/admin/platform/controls', { switches: sw, secondary: { enabled: chk('fs-secondary') } });
    if (r.ok) { toast('Switches saved — live now'); controlsTab(); } else fail(r);
  }
  async function signOutAll() {
    var t = val('so-track'); if (!confirm('Sign out ' + (t === 'all' ? 'ALL students' : t + ' students') + ' now?')) return;
    var r = await api('POST', '/api/admin/platform/sessions/signout-all', { track: t, confirm: val('so-confirm') });
    if (r.ok) toast('Signed out ' + r.data.signedOut + ' session(s)'); else fail(r);
  }

  // ══ ERRORS ═════════════════════════════════════════════════
  async function errorsTab() {
    var r = await api('GET', '/api/admin/platform/errors'); if (!r.ok) return fail(r);
    body().innerHTML = '<div class="xbar"><button class="btn-main" style="width:auto;padding:9px 16px;font-size:13px" onclick="AdminSystem.show(\'errors\')">Refresh</button><button class="ab ab-del" onclick="AdminSystem.clearErrors()">Clear list</button><span class="xmut">Kept in memory (last 100). Clears when the server restarts.</span></div>' +
      '<div class="tw"><div class="th"><div class="th-title">Server errors</div></div><div class="tbl-wrap"><table><thead><tr><th>When</th><th>Endpoint</th><th>Status</th><th>What happened</th></tr></thead><tbody>' +
      (r.data.errors.length ? r.data.errors.map(function (x) { return '<tr><td class="xmut" style="white-space:nowrap">' + new Date(x.t).toLocaleString() + '</td><td style="font-family:ui-monospace,Menlo,monospace;font-size:12px">' + E(x.route) + '</td><td>' + badge(x.status, 'b-no') + '</td><td style="font-size:12px;max-width:380px">' + E(x.message || '—') + (x.where ? '<div class="xmut">' + E(x.where) + '</div>' : '') + '</td></tr>'; }).join('') : '<tr class="empty-row"><td colspan="4">No server errors since the last restart 🎉</td></tr>') + '</tbody></table></div></div>' +
      '<div class="tw"><div class="th"><div class="th-title">Slow requests (over 1.5 s)</div></div><div class="tbl-wrap"><table><thead><tr><th>When</th><th>Endpoint</th><th>Status</th><th>Took</th></tr></thead><tbody>' +
      (r.data.slow.length ? r.data.slow.map(function (x) { return '<tr><td class="xmut">' + new Date(x.t).toLocaleTimeString() + '</td><td style="font-family:ui-monospace,Menlo,monospace;font-size:12px">' + E(x.route) + '</td><td>' + x.status + '</td><td><b>' + x.ms + ' ms</b></td></tr>'; }).join('') : '<tr class="empty-row"><td colspan="4">Nothing slow</td></tr>') + '</tbody></table></div></div>';
  }
  async function clearErrors() { if (!confirm('Clear the error and slow-request lists?')) return; var r = await api('POST', '/api/admin/platform/errors/clear'); if (r.ok) { toast('Cleared'); errorsTab(); } else fail(r); }

  // ══ DATABASE ═══════════════════════════════════════════════
  async function dbTab() {
    var r = await api('GET', '/api/admin/platform/db'); if (!r.ok) return fail(r);
    var t = r.data.total, kb = function (v) { return v === null ? '—' : v >= 1024 ? (v / 1024).toFixed(1) + ' MB' : v + ' KB'; };
    body().innerHTML = (t ? '<div class="sg">' + card(t.dataMB + ' MB', 'Data size') + card(t.storageMB + ' MB', 'Storage used') + card(t.indexMB + ' MB', 'Indexes') + card(r.data.collections.length, 'Collections') + '</div>' : '') +
      '<div class="tw"><div class="th"><div class="th-title">Collections</div></div><div class="tbl-wrap"><table><thead><tr><th>Collection</th><th>Documents</th><th>Size</th><th>Indexes</th></tr></thead><tbody>' + r.data.collections.map(function (c) { return '<tr><td style="font-family:ui-monospace,Menlo,monospace;font-size:12px"><b>' + E(c.name) + '</b></td><td>' + c.count.toLocaleString() + '</td><td>' + kb(c.sizeKB) + '</td><td>' + kb(c.indexKB) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
  }

  // ══ CLEANUP ════════════════════════════════════════════════
  var TOOLS = [['sessions', 'Old sessions', 'Expired and signed-out sessions that are only taking space.', 1], ['notifications', 'Read notifications', 'Notifications students have already read.', 14], ['activity', 'Activity log rows', 'Old rows of the activity log (the owner’s audit record).', 30]];
  async function cleanupTab() {
    body().innerHTML = '<div class="xs" style="margin-bottom:14px;color:var(--t3);font-size:13px">Every tool shows a preview first. Nothing is deleted until you confirm the preview.</div><div class="xgrid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">' +
      TOOLS.map(function (t) { return '<div class="xcard"><h3>' + t[1] + '</h3><div class="xs">' + t[2] + '</div><div class="xf"><span>Older than (days, min ' + t[3] + ')</span><input class="f-input" id="cl-' + t[0] + '" value="' + Math.max(t[3], t[0] === 'sessions' ? 7 : t[0] === 'notifications' ? 60 : 180) + '"></div><div id="cl-out-' + t[0] + '" class="xmut" style="margin-bottom:10px"></div><div style="display:flex;gap:8px"><button class="ab ab-edit" onclick="AdminSystem.preview(\'' + t[0] + '\')">Preview</button><button class="ab ab-del" id="cl-go-' + t[0] + '" disabled onclick="AdminSystem.purge(\'' + t[0] + '\')">Delete</button></div></div>'; }).join('') + '</div>';
  }
  async function preview(what) {
    var r = await api('POST', '/api/admin/platform/maintenance/purge', { what: what, days: val('cl-' + what), dryRun: true });
    var out = document.getElementById('cl-out-' + what), go = document.getElementById('cl-go-' + what);
    if (!r.ok) { out.textContent = (r.data && r.data.error) || 'Could not preview'; go.disabled = true; return; }
    out.innerHTML = '<b>' + r.data.matched.toLocaleString() + '</b> row(s) would be deleted.'; go.disabled = !r.data.matched;
  }
  async function purge(what) {
    if (!confirm('Permanently delete these rows? This cannot be undone.')) return;
    var r = await api('POST', '/api/admin/platform/maintenance/purge', { what: what, days: val('cl-' + what), dryRun: false });
    if (r.ok) { toast('Deleted ' + r.data.deleted.toLocaleString()); cleanupTab(); } else fail(r);
  }

  // ══ AUDIT ══════════════════════════════════════════════════
  async function auditTab() {
    var r = await api('GET', '/api/admin/platform/audit'); if (!r.ok) return fail(r);
    body().innerHTML = '<div class="tw"><div class="th"><div class="th-title">Recent control changes</div></div><div class="tbl-wrap"><table><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Detail</th></tr></thead><tbody>' +
      (r.data.length ? r.data.map(function (x) { return '<tr><td class="xmut" style="white-space:nowrap">' + new Date(x.ts).toLocaleString() + '</td><td><b>' + E(x.actor) + '</b></td><td style="font-family:ui-monospace,Menlo,monospace;font-size:12px">' + E(x.action) + '</td><td class="xmut" style="max-width:340px;word-break:break-word">' + E(x.detail) + '</td></tr>'; }).join('') : '<tr class="empty-row"><td colspan="4">No control changes recorded yet</td></tr>') + '</tbody></table></div></div>';
  }

  window.AdminSystem = { open: open, show: show, stop: stop, refreshMonitor: refreshMonitor, setAuto: setAuto, setMaintenance: setMaintenance, saveBanner: saveBanner, saveSwitches: saveSwitches, signOutAll: signOutAll, clearErrors: clearErrors, preview: preview, purge: purge };
})();
