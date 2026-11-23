/* Command centre (admin, v1.15): segments & bulk actions · student notes · data & privacy · access control.
   Depends on admin.html globals: adminFetch, toast, canView, myAccess; and AdminUI (admin-ui.js). */
(function () {
  'use strict';
  var U = window.AdminUI, E = U.E, api = U.api, card = U.card, badge = U.badge, val = U.val, ago = U.ago, qs = U.qs;
  var TABS = [['insights', 'Insights', 'analytics'], ['segments', 'Segments & bulk', 'bulk'], ['notes', 'Student notes', 'crm'], ['data', 'Data & privacy', 'data'], ['access', 'Access control', 'access']];
  var tab = '', root, lastFilter = null, lastCount = 0, pendingTag = '';
  var fail = function (r, f) { toast((r.data && r.data.error) || f || 'Something went wrong'); };
  var body = function () { return document.getElementById('cmd-body'); };
  var fmtDate = function (d) { return d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
  var btn = function (label, fn, cls, style) { return '<button class="' + (cls || 'ab ab-gray') + '" style="' + (style || '') + '" onclick="' + fn + '">' + label + '</button>'; };
  var sel = function (id, opts) { return '<select class="f-input" id="' + id + '">' + opts.map(function (o) { return '<option value="' + E(o[0]) + '">' + E(o[1]) + '</option>'; }).join('') + '</select>'; };
  var field = function (label, inner) { return '<label class="xf"><span>' + E(label) + '</span>' + inner + '</label>'; };
  var input = function (id, ph, type) { return '<input class="f-input" id="' + id + '" placeholder="' + E(ph || '') + '"' + (type ? ' type="' + type + '"' : '') + '>'; };

  async function download(url, fallback) {
    try {
      var r = await adminFetch(url, { headers: {} });
      if (!r.ok) { var j = await r.json().catch(function () { return {}; }); return toast(j.error || 'Download failed'); }
      var blob = await r.blob(), m = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '');
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = m ? m[1] : fallback; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    } catch (e) { toast('Download failed'); }
  }

  // ── shell ─────────────────────────────────────────────────────
  function shell() {
    var tabs = TABS.filter(function (t) { return canView(t[2]); });
    root.innerHTML = '<div class="xt">' + tabs.map(function (t) { return '<button class="' + (tab === t[0] ? 'on' : '') + '" onclick="AdminCommand.show(\'' + t[0] + '\')">' + t[1] + '</button>'; }).join('') + '</div><div id="cmd-body"></div>';
  }
  async function show(t) {
    var allowed = TABS.filter(function (x) { return canView(x[2]); });
    if (!allowed.length) { root.innerHTML = '<div class="xal warn">Your account does not have access to any Command centre tools.</div>'; return; }
    tab = allowed.some(function (x) { return x[0] === t; }) ? t : allowed[0][0];
    shell();
    try { await ({ insights: insightsTab, segments: segmentsTab, notes: notesTab, data: dataTab, access: accessTab })[tab](); }
    catch (e) { console.error(e); body().innerHTML = '<div class="xal danger">Could not load this tab. ' + E(e.message || '') + '</div>'; }
  }
  async function open() { root = document.getElementById('cmd-root'); if (!root) return; await show(tab || 'insights'); }

  // ══ INSIGHTS ═════════════════════════════════════════════════
  var BRAND = '#3E5C8A', GOOD = '#16a34a', WARN = '#d97706', BAD = '#dc2626';
  var DOT = { good: GOOD, warn: WARN, bad: BAD, info: '#64748b' };
  var nf = function (n) { return Number(n || 0).toLocaleString('en-NG'); };
  var naira = function (n) { return '₦' + nf(Math.round(n || 0)); };
  var h12 = function (h) { return (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? ' AM' : ' PM'); };
  var shortDay = function (d) { var p = d.split('-'); return Number(p[2]) + '/' + Number(p[1]); };

  function big(n, label, hint, color) {
    return '<div class="xcard" style="margin:0;text-align:center;padding:18px 10px"><div style="font:800 38px/1.1 var(--ff-h,inherit);color:' + (color || BRAND) + '">' + n + '</div><div style="font-weight:700;margin-top:4px">' + E(label) + '</div><div class="xmut" style="font-size:12px;margin-top:2px">' + E(hint) + '</div></div>';
  }
  // vertical bar chart: items [{label, value, tip}]
  function bars(items, o) {
    o = o || {}; var max = Math.max.apply(null, items.map(function (x) { return x.value; }).concat([1])), every = o.every || 1;
    return '<div style="display:flex;align-items:flex-end;gap:' + (items.length > 20 ? 3 : 6) + 'px;height:150px;padding-top:18px">' + items.map(function (x, i) {
      var hgt = Math.max(x.value ? 4 : 1, Math.round((x.value / max) * 120)), hot = o.hot !== undefined && o.hot === i;
      return '<div title="' + E(x.tip || (x.label + ': ' + x.value)) + '" style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">' +
        '<div style="font-size:10px;color:var(--t3);height:14px">' + (items.length <= 14 || x.value === max ? (o.fmt ? o.fmt(x.value) : x.value) : '') + '</div>' +
        '<div style="width:100%;height:' + hgt + 'px;border-radius:5px 5px 2px 2px;background:' + (hot ? GOOD : BRAND) + ';opacity:' + (x.value ? 1 : .25) + '"></div>' +
        '<div style="font-size:10px;color:var(--t3);height:14px;margin-top:3px;white-space:nowrap">' + (i % every === 0 ? E(x.label) : '') + '</div></div>';
    }).join('') + '</div>';
  }
  // horizontal bar: label, percent 0-100, text on the right
  function hbar(label, p, text, color) {
    return '<div style="margin:9px 0"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px"><b>' + E(label) + '</b><span>' + text + '</span></div><div style="height:12px;background:var(--bd,#e5e7eb);border-radius:99px;overflow:hidden"><div style="height:100%;width:' + Math.max(2, Math.min(100, p)) + '%;background:' + (color || BRAND) + ';border-radius:99px"></div></div></div>';
  }
  var panel = function (title, sub, inner) { return '<div class="xcard"><h3 style="margin-bottom:2px">' + title + '</h3>' + (sub ? '<div class="xs" style="margin-bottom:8px">' + sub + '</div>' : '') + inner + '</div>'; };

  async function insightsTab() {
    body().innerHTML = '<div class="xmut" style="padding:20px">Crunching the numbers…</div>';
    var r = await api('GET', '/api/admin/insights/overview'); if (!r.ok) { body().innerHTML = ''; return fail(r, 'Could not load insights'); }
    var d = r.data, n = d.now, f = d.funnel;
    var says = d.says.map(function (x) { return '<div style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--bd)"><span style="flex:none;width:12px;height:12px;border-radius:99px;margin-top:4px;background:' + DOT[x.tone] + '"></span><span style="font-size:15px;line-height:1.45">' + E(x.text) + '</span></div>'; }).join('') || '<div class="xmut">Not enough activity yet to say anything useful.</div>';
    var peakHour = n.peakHour;
    var steps = [['Signed up', f.signedUp], ['Picked their courses', f.picked], ['Took at least 1 quiz', f.tried], ['Took 5 or more quizzes', f.regular], ['Are on Premium', f.premium]];
    var funnelHtml = steps.map(function (s, i) { var p = f.signedUp ? Math.round(s[1] / f.signedUp * 100) : 0, lost = i ? steps[i - 1][1] - s[1] : 0; return hbar(s[0], p, '<b>' + nf(s[1]) + '</b> · ' + p + '%' + (i && lost > 0 ? ' <span class="xmut">(lost ' + nf(lost) + ' on the way)</span>' : ''), i === 4 ? GOOD : BRAND); }).join('');
    var courseList = function (arr, color, emptyMsg) { return arr.length ? arr.map(function (c) { return hbar(c.course, c.accuracy, '<b>' + c.accuracy + '%</b> right <span class="xmut">· ' + nf(c.attempts) + ' answers</span>', color(c.accuracy)); }).join('') : '<div class="xmut">' + emptyMsg + '</div>'; };
    var accColor = function (a) { return a >= 65 ? GOOD : a >= 45 ? WARN : BAD; };
    var busy = d.courses.busiest.length ? d.courses.busiest.map(function (c) { var mx = d.courses.busiest[0].attempts; return hbar(c.course, c.attempts / mx * 100, '<b>' + nf(c.attempts) + '</b> answers <span class="xmut">· ' + c.quizzes + ' quizzes</span>'); }).join('') : '<div class="xmut">No quiz data yet.</div>';

    body().innerHTML =
      '<div class="xmut" style="margin-bottom:8px">Updated ' + ago(d.generatedAt) + ' · all dates are Nigerian time · ' + btn('Refresh', 'AdminCommand.show(\'insights\')') + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px">' +
        big(nf(n.total), 'Students', 'everyone who ever signed up') + big(nf(n.dau), 'Active today', 'opened the app in the last 24 hours', GOOD) + big(nf(n.wau), 'Active this week', 'opened the app in the last 7 days') + big(nf(n.premium.count), 'On Premium', (n.total ? Math.round(n.premium.count / n.total * 100) : 0) + '% of all students', GOOD) + '</div>' +
      panel('What this means', 'Green is good, orange needs a look, red needs action.', says) +
      panel('New students · last 30 days', nf(n.signups7) + ' joined in the last 7 days. Taller bar = more signups that day.', bars(d.signups.map(function (x) { return { label: shortDay(x.day), value: x.value }; }), { every: 5, hot: d.signups.length - 1 })) +
      panel('Quizzes taken · last 14 days', 'Last 30 days: <b>' + nf(n.quiz.count) + '</b> quizzes · average score <b>' + n.quiz.avg + '%</b>' + (n.quiz.passRate !== null ? ' · <b>' + n.quiz.passRate + '%</b> scored 50 or more' : ''), bars(d.quizzes.map(function (x) { return { label: shortDay(x.day), value: x.value, tip: x.day + ': ' + x.value + ' quizzes' + (x.avg !== null ? ', average ' + x.avg + '%' : '') }; }), { every: 2, hot: d.quizzes.length - 1 })) +
      panel('When students study', 'Number of quizzes started in each hour of the day, last 30 days.' + (peakHour !== null ? ' <b>Busiest: ' + h12(peakHour) + '.</b>' : ''), bars(d.hours.map(function (x) { return { label: x.hour % 3 === 0 ? h12(x.hour).replace(' ', '') : '', value: x.value, tip: h12(x.hour) + ': ' + x.value + ' quizzes' }; }), { hot: peakHour === null ? undefined : peakHour })) +
      panel('Where students drop off', 'Of everyone who signed up, how many reached each step. A big drop between two steps is the thing to fix first.', funnelHtml) +
      panel('Money · last 8 weeks', '<b>' + naira(d.money.cur) + '</b> confirmed in the last 30 days from ' + nf(d.money.payments) + ' payments · the 30 days before: ' + naira(d.money.prev), bars(d.weeks.map(function (x) { return { label: x.weeksAgo === 0 ? 'this wk' : x.weeksAgo + 'w ago', value: x.value, tip: naira(x.value) }; }), { fmt: function (v) { return v >= 1000 ? Math.round(v / 1000) + 'k' : v; }, hot: 7 })) +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">' +
        panel('Hardest courses', 'Lowest share of questions answered correctly (last 90 days).', courseList(d.courses.hardest, accColor, 'Not enough answers yet.')) +
        panel('Easiest courses', 'Highest share answered correctly.', courseList(d.courses.easiest, accColor, 'Not enough answers yet.')) +
        panel('Most practised', 'Which courses get the most questions answered.', busy) + '</div>' +
      panel('Credits', 'Credits are the in-app currency.', '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">' + big(nf(d.credits.held), 'Held by students', 'total balance right now') + big(nf(d.credits.given30), 'Given out', 'last 30 days', GOOD) + big(nf(d.credits.spent30), 'Spent', 'last 30 days', WARN) + '</div>');
  }

  // ══ SEGMENTS & BULK ══════════════════════════════════════════
  var FIELDS = ['track', 'tier', 'status', 'course', 'inactiveDays', 'joinedDays', 'expiringDays', 'expiredDays', 'minCredits', 'maxCredits', 'tag', 'q'];
  var PRESETS = [
    ['Inactive 14+ days', { inactiveDays: 14 }], ['Premium ending in 7 days', { tier: 'premium', expiringDays: 7 }], ['New this week', { joinedDays: 7 }],
    ['Premium ended in last 14 days', { expiredDays: 14 }], ['Suspended', { status: 'suspended' }], ['Secondary students', { track: 'secondary' }], ['Zero credits', { maxCredits: 0 }],
  ];
  function readFilter() { var f = {}; FIELDS.forEach(function (k) { var v = val('sg-' + k).trim(); if (v !== '') f[k] = v; }); return f; }
  function setFilter(f) { FIELDS.forEach(function (k) { var e = document.getElementById('sg-' + k); if (e) e.value = f[k] === undefined ? '' : f[k]; }); }

  async function segmentsTab() {
    body().innerHTML =
      '<div class="xcard"><h3>1 · Find a group of students</h3><div class="xs">All conditions combine. Nothing changes until you choose an action and confirm it.</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' + PRESETS.map(function (p, i) { return btn(E(p[0]), 'AdminCommand.preset(' + i + ')'); }).join('') + '</div>' +
      '<div class="xgrid">' +
      field('App', sel('sg-track', [['', 'Any'], ['university', 'University'], ['secondary', 'Secondary']])) +
      field('Plan', sel('sg-tier', [['', 'Any'], ['free', 'Free'], ['premium', 'Premium']])) +
      field('Account', sel('sg-status', [['', 'Any'], ['active', 'Active'], ['suspended', 'Suspended']])) +
      field('Course key', input('sg-course', 'e.g. CHM101')) +
      field('Inactive for at least (days)', input('sg-inactiveDays', '14', 'number')) +
      field('Joined in the last (days)', input('sg-joinedDays', '7', 'number')) +
      field('Premium ends within (days)', input('sg-expiringDays', '7', 'number')) +
      field('Premium ended in the last (days)', input('sg-expiredDays', '14', 'number')) +
      field('Credits at least', input('sg-minCredits', '', 'number')) +
      field('Credits at most', input('sg-maxCredits', '', 'number')) +
      field('Has tag', input('sg-tag', 'from Student notes')) +
      field('Name, matric or username', input('sg-q', 'search')) +
      '</div><div class="xbar" style="margin:6px 0 0">' + btn('Preview group', 'AdminCommand.preview()', 'btn-main', 'width:auto;padding:9px 18px;font-size:13px') + btn('Clear', 'AdminCommand.clearFilter()') + btn('Save this group…', 'AdminCommand.saveGroup()') + '</div>' +
      '<div id="sg-saved" style="margin-top:12px"></div></div>' +
      '<div id="sg-result"></div><div id="sg-history"></div>';
    loadSaved(); loadHistory();
    if (pendingTag) { document.getElementById('sg-tag').value = pendingTag; pendingTag = ''; preview(); }
  }
  var saved = [];
  async function loadSaved() {
    var r = await api('GET', '/api/admin/bulk/saved'); var box = document.getElementById('sg-saved'); if (!box || !r.ok) return; saved = r.data;
    box.innerHTML = saved.length ? '<div class="xmut" style="margin-bottom:6px">Saved groups</div>' + saved.map(function (g, i) { return '<span class="xchip" style="cursor:pointer" onclick="AdminCommand.loadGroup(' + i + ')">' + E(g.name) + '</span><span style="cursor:pointer;margin:0 8px 0 -4px;color:var(--t3)" title="Delete" onclick="AdminCommand.delGroup(\'' + g._id + '\')">×</span>'; }).join('') : '';
  }
  function loadGroup(i) { setFilter(saved[i].filter || {}); preview(); }
  function saveGroup() {
    if (!Object.keys(readFilter()).length) return toast('Set at least one condition first');
    U.modal('<h3 style="margin:0 0 8px;font:800 18px var(--ff-h,inherit)">Save this group</h3>' + input('sv-name', 'e.g. Premium ending soon') + '<div class="xbar" style="margin-top:14px">' + btn('Cancel', 'AdminUI.closeModal()') + btn('Save', 'AdminCommand.saveGroupDo()', 'btn-main', 'width:auto;padding:9px 18px;font-size:13px') + '</div>');
  }
  async function saveGroupDo() { var r = await api('POST', '/api/admin/bulk/saved', { name: val('sv-name'), filter: readFilter() }); U.closeModal(); if (!r.ok) return fail(r); toast('Group saved'); loadSaved(); }
  async function delGroup(id) { if (!confirm('Delete this saved group?')) return; var r = await api('DELETE', '/api/admin/bulk/saved/' + id); if (!r.ok) return fail(r); loadSaved(); }

  async function loadHistory() {
    var r = await api('GET', '/api/admin/bulk/history'); var box = document.getElementById('sg-history'); if (!box || !r.ok) return;
    var NAMES = { notify: 'Message', suspend: 'Suspend', reactivate: 'Reactivate', signout: 'Sign out', 'grant-premium': 'Grant Premium', 'revoke-premium': 'Remove Premium', credits: 'Credits' };
    box.innerHTML = '<div class="tw"><div class="th"><div class="th-title">Bulk history</div></div><div class="tbl-wrap"><table><thead><tr><th>When</th><th>Action</th><th>Students</th><th>By</th><th></th></tr></thead><tbody>' +
      (r.data.length ? r.data.map(function (x) { return '<tr><td>' + ago(x.at) + '</td><td><b>' + E(NAMES[x.action] || x.action) + '</b>' + (x.summary ? '<div class="xmut">' + E(x.summary) + '</div>' : '') + '</td><td>' + E(x.affected) + (x.failed ? ' <span class="xmut">(' + x.failed + ' failed)</span>' : '') + '</td><td>' + E(x.by) + '</td><td>' + (x.undoneAt ? badge('undone', 'b-gray') : x.canUndo ? btn('Undo', 'AdminCommand.undoRun(\'' + x._id + '\')') : '') + '</td></tr>'; }).join('') : '<tr><td colspan="5" class="xmut" style="padding:14px">No bulk actions yet.</td></tr>') + '</tbody></table></div></div>';
  }
  async function undoRun(id) { if (!confirm('Put every student in this run back to how they were before it?')) return; var r = await api('POST', '/api/admin/bulk/history/' + id + '/undo'); if (!r.ok) return fail(r); toast('Restored ' + r.data.restored + ' students'); loadHistory(); }

  function preset(i) { setFilter(PRESETS[i][1]); preview(); }
  function clearFilter() { setFilter({}); document.getElementById('sg-result').innerHTML = ''; lastFilter = null; }

  async function preview() {
    var f = readFilter(), box = document.getElementById('sg-result'); box.innerHTML = '<div class="xmut" style="padding:12px">Loading…</div>';
    var r = await api('GET', '/api/admin/bulk/segment?' + qs(f)); if (!r.ok) { box.innerHTML = ''; return fail(r, 'Could not load the group'); }
    lastFilter = f; lastCount = r.data.count;
    var rows = r.data.rows.map(function (s) {
      return '<tr><td><b>' + E(s.name) + '</b><div class="xmut">' + E(s.matric) + '</div></td><td>' + E(s.track === 'secondary' ? 'Secondary' : 'University') + '</td><td>' + (s.tier === 'premium' ? badge('Premium', 'b-ok') + '<div class="xmut">' + (s.tierExpiresAt ? 'ends ' + fmtDate(s.tierExpiresAt) : 'no end date') + '</div>' : badge('Free', 'b-gray')) + '</td><td>' + (s.active === false ? badge('Suspended', 'b-no') : badge('Active', 'b-ok')) + '</td><td>' + ago(s.lastActiveAt) + '</td><td>' + E(s.credits) + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="xmut" style="padding:14px">No students match.</td></tr>';
    box.innerHTML =
      '<div class="sg">' + card(r.data.count, 'Students in this group') + '</div>' +
      '<div class="tw"><div class="th"><div class="th-title">Preview' + (r.data.capped ? ' (first 50)' : '') + '</div>' + (canView('students') ? btn('Download contact list (CSV)', 'AdminCommand.segmentCsv()') : '') + '</div><div class="tbl-wrap"><table><thead><tr><th>Student</th><th>App</th><th>Plan</th><th>Account</th><th>Last active</th><th>Credits</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' +
      (r.data.count ? actionCard(r.data.count, r.data.maxApply) : '');
    syncAction();
  }
  function segmentCsv() { if (lastFilter) download('/api/admin/bulk/segment.csv?' + qs(lastFilter), 'wreddi-segment.csv'); }

  function actionCard(count, max) {
    var NEEDS = { suspend: 'students', reactivate: 'students', signout: 'students', 'grant-premium': 'payments', 'revoke-premium': 'payments', credits: 'credits' };
    var opts = [['notify', 'Send an in-app message'], ['suspend', 'Suspend accounts'], ['reactivate', 'Reactivate accounts'], ['signout', 'Sign out everywhere'], ['grant-premium', 'Grant Premium'], ['revoke-premium', 'Remove Premium (back to Free)'], ['credits', 'Add or deduct credits']]
      .filter(function (o) { return !NEEDS[o[0]] || canChange2(NEEDS[o[0]]); });
    return '<div class="xcard"><h3>2 · Do something for all ' + E(count) + (count > max ? ' (too many — narrow the group to ' + max + ' or fewer)' : '') + '</h3><div class="xs">You will see exactly how many students are affected before anything happens.</div>' +
      '<div class="xrow2">' + field('Action', '<select class="f-input" id="ac-action" onchange="AdminCommand.syncAction()">' + opts.map(function (o) { return '<option value="' + o[0] + '">' + E(o[1]) + '</option>'; }).join('') + '</select>') + '<div id="ac-params"></div></div>' +
      '<div class="xbar">' + btn('Check what will happen', 'AdminCommand.dryRun()', 'btn-main', 'width:auto;padding:9px 18px;font-size:13px') + '</div><div id="ac-out"></div></div>';
  }
  function canChange2(area) { return myAccess.fullAccess || (myAccess.permissions || []).indexOf(area) > -1; }
  function syncAction() {
    var a = val('ac-action'), p = document.getElementById('ac-params'); if (!p) return;
    p.innerHTML = a === 'notify' ? field('Title', input('ap-title', 'Up to 80 characters')) + field('Message', '<textarea class="f-input" id="ap-message" placeholder="Up to 500 characters"></textarea>')
      : a === 'credits' ? field('Credits (negative to deduct)', input('ap-amount', '10', 'number')) + field('Note', input('ap-note', 'Shown in the credit history'))
      : a === 'grant-premium' ? field('Plan', sel('ap-plan', [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly'], ['lifetime', 'Lifetime'], ['custom', 'Custom days']])) + field('Days (only for Custom, or to override)', input('ap-days', '', 'number'))
      : '<div class="xmut" style="padding-top:22px">No extra details needed.</div>';
    var o = document.getElementById('ac-out'); if (o) o.innerHTML = '';
  }
  function actionBody(dry, extra) {
    var a = val('ac-action'), p = {};
    if (a === 'notify') p = { title: val('ap-title'), message: val('ap-message') };
    if (a === 'credits') p = { amount: Number(val('ap-amount')), note: val('ap-note') };
    if (a === 'grant-premium') p = { plan: val('ap-plan'), durationDays: val('ap-days') === '' ? undefined : Number(val('ap-days')) };
    return Object.assign({ filter: lastFilter, action: a, params: p, dryRun: dry }, extra || {});
  }
  var VERB = { notify: 'receive your message', suspend: 'be suspended and signed out', reactivate: 'be reactivated', signout: 'be signed out on every device', 'grant-premium': 'get Premium', 'revoke-premium': 'go back to the Free plan', credits: 'have their credits changed' };
  async function dryRun() {
    var r = await api('POST', '/api/admin/bulk/apply', actionBody(true)); var o = document.getElementById('ac-out');
    if (!r.ok) { o.innerHTML = '<div class="xal danger">' + E((r.data && r.data.error) || 'Could not check') + '</div>'; return; }
    var a = val('ac-action');
    o.innerHTML = '<div class="xal warn"><b>' + r.data.matched + ' students</b> will ' + E(VERB[a]) + '. First few: ' + E(r.data.sample.map(function (s) { return s.name; }).join(', ')) + (r.data.matched > r.data.sample.length ? '…' : '') + '</div>' +
      '<div class="xbar">' + btn('Apply to ' + r.data.matched + ' students…', 'AdminCommand.confirmApply(' + r.data.matched + ')', 'btn-main', 'width:auto;padding:9px 18px;font-size:13px;background:var(--no,#dc2626)') + '</div>';
  }
  function confirmApply(n) {
    U.modal('<h3 style="margin:0 0 8px;font:800 18px var(--ff-h,inherit)">Apply to ' + n + ' students?</h3><p class="xs" style="font-size:13px;color:var(--t3);line-height:1.5">This changes real accounts' + (val('ac-action') === 'notify' ? ' and cannot be unsent' : '') + '. Type <b>APPLY</b> to confirm.</p>' + input('cf-word', 'APPLY') +
      '<div class="xbar" style="margin-top:14px">' + btn('Cancel', 'AdminUI.closeModal()') + btn('Apply now', 'AdminCommand.doApply(' + n + ')', 'btn-main', 'width:auto;padding:9px 18px;font-size:13px') + '</div>');
  }
  async function doApply(n) {
    var word = val('cf-word').trim(); if (word !== 'APPLY') return toast('Type APPLY to confirm');
    var r = await api('POST', '/api/admin/bulk/apply', actionBody(false, { confirm: word, expectedCount: n }));
    U.closeModal(); if (!r.ok) return fail(r, 'Could not apply');
    loadHistory();
    toast('Done — ' + r.data.affected + ' students' + (r.data.failed ? ', ' + r.data.failed + ' failed' : ''));
    document.getElementById('ac-out').innerHTML = '<div class="xal ok">Applied to ' + r.data.affected + ' students.</div>';
    preview();
  }

  // ══ NOTES ════════════════════════════════════════════════════
  async function notesTab() {
    var r = await api('GET', '/api/admin/crm/tags'); var tags = r.ok ? r.data : [];
    body().innerHTML =
      '<div class="xcard"><h3>Open a student</h3><div class="xs">Private to admins. Students never see notes or tags. Tags let you build groups in Segments.</div><div class="xbar">' + input('nt-matric', 'Matric number') + btn('Open', 'AdminCommand.openNotes()', 'btn-main', 'width:auto;padding:9px 18px;font-size:13px') + '</div><div id="nt-view"></div></div>' +
      '<div class="xcard"><h3>Tags in use</h3><div class="xs">Click a tag to see everyone who has it.</div>' +
      (tags.length ? tags.map(function (t) { return '<button class="xchip" style="border:0;cursor:pointer" onclick="AdminCommand.tagGroup(\'' + E(t.tag).replace(/'/g, '') + '\')">' + E(t.tag) + ' · ' + t.students + '</button>'; }).join('') : '<span class="xmut">No tags yet.</span>') + '</div>';
  }
  function tagGroup(t) { if (!canView('bulk')) return toast('You need Segments & bulk access to build groups'); pendingTag = t; show('segments'); }
  async function openNotes(m) {
    var matric = (m || val('nt-matric')).trim(); if (!matric) return;
    var r = await api('GET', '/api/admin/crm/' + encodeURIComponent(matric)); var box = document.getElementById('nt-view'); if (!box) return;
    if (!r.ok) { box.innerHTML = '<div class="xal danger">' + E((r.data && r.data.error) || 'Not found') + '</div>'; return; }
    var s = r.data.student;
    box.innerHTML = '<div style="margin:12px 0 8px"><b>' + E(s.name) + '</b> <span class="xmut">' + E(s.matric) + ' · ' + (s.tier === 'premium' ? 'Premium' : 'Free') + ' · ' + (s.active === false ? 'suspended' : 'active') + ' · last active ' + ago(s.lastActiveAt) + '</span></div>' +
      (canView('students') ? '<div class="xbar" style="margin:0 0 8px">' + btn('Full profile', 'AdminCommand.profile(\'' + E(s.matric) + '\')') + '</div>' : '') +
      (canChange2('crm') ? '<div class="xrow2">' + field('New note', '<textarea class="f-input" id="nt-text" placeholder="What should the next admin know?"></textarea>') + '<div>' + field('Tags (comma separated)', input('nt-tags', 'class rep, follow up')) + '<label style="font-size:13px"><input type="checkbox" id="nt-pin"> Pin to top</label></div></div><div class="xbar">' + btn('Add note', 'AdminCommand.addNote(\'' + E(s.matric) + '\')', 'btn-main', 'width:auto;padding:9px 18px;font-size:13px') + '</div>' : '') +
      (r.data.notes.length ? r.data.notes.map(function (n) {
        return '<div style="border-top:1px solid var(--bd);padding:10px 0"><div style="white-space:pre-wrap;font-size:14px">' + (n.pinned ? '📌 ' : '') + E(n.text) + '</div><div class="xmut" style="margin-top:4px">' + E(n.by || 'admin') + ' · ' + ago(n.createdAt) + ' ' + (n.tags || []).map(function (t) { return '<span class="xchip">' + E(t) + '</span>'; }).join('') + '</div>' +
          (canChange2('crm') ? '<div style="margin-top:6px">' + btn(n.pinned ? 'Unpin' : 'Pin', 'AdminCommand.pinNote(\'' + n._id + '\',' + !n.pinned + ',\'' + E(s.matric) + '\')') + ' ' + btn('Delete', 'AdminCommand.delNote(\'' + n._id + '\',\'' + E(s.matric) + '\')', 'ab ab-del') + '</div>' : '') + '</div>';
      }).join('') : '<div class="xmut" style="padding:10px 0">No notes yet.</div>');
  }
async function profile(m) {
    var r = await api('GET', '/api/admin/crm/' + encodeURIComponent(m) + '/profile'); if (!r.ok) return fail(r);
    var d = r.data, s = d.student, row = function (a, b) { return '<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px solid var(--bd);font-size:13px"><span class="xmut">' + a + '</span><span style="text-align:right">' + b + '</span></div>'; };
    var list = function (arr, fn, empty) { return arr.length ? arr.map(fn).join('') : '<div class="xmut" style="font-size:13px;padding:4px 0">' + empty + '</div>'; };
    U.modal('<div style="max-height:75vh;overflow:auto"><h3 style="margin:0 0 2px;font:800 18px var(--ff-h,inherit)">' + E(s.name) + '</h3><div class="xmut" style="margin-bottom:10px">' + E(s.matric) + (s.username ? ' · @' + E(s.username) : '') + '</div>' +
      row('Plan', s.tier === 'premium' ? 'Premium' + (s.tierExpiresAt ? ' until ' + fmtDate(s.tierExpiresAt) : '') : 'Free') + row('Account', s.active ? 'Active' : 'Suspended') + row('App', s.track === 'secondary' ? 'Secondary' : 'University') +
      row('Credits', E(s.credits)) + row('Joined', fmtDate(s.createdAt)) + row('Last active', ago(s.lastActiveAt)) + row('Phone / WhatsApp', E(s.phone || '—') + ' / ' + E(s.whatsapp || '—')) +
      row('School', E([s.university, s.department].filter(Boolean).join(' · ') || '—')) + row('Courses chosen', E(s.courses)) + row('Quizzes taken', E(d.stats.quizzes) + (d.stats.recentAverage != null ? ' (recent average ' + d.stats.recentAverage + '%)' : '')) + row('Open support requests', E(d.stats.openSupport)) +
      '<h4 style="margin:14px 0 4px">Recent quizzes</h4>' + list(d.scores, function (x) { return row(fmtDate(x.ts) + ' · ' + E(x.mode || ''), E(x.correct) + '/' + E(x.total) + ' · ' + E(Math.round(x.pct || 0)) + '%'); }, 'None yet') +
      '<h4 style="margin:14px 0 4px">Credit history</h4>' + list(d.credits, function (x) { return row(fmtDate(x.createdAt) + ' · ' + E(x.reason), (x.delta > 0 ? '+' : '') + E(x.delta) + ' → ' + E(x.balanceAfter)); }, 'None yet') +
      '<h4 style="margin:14px 0 4px">Payments</h4>' + list(d.payments, function (x) { return row(fmtDate(x.createdAt) + ' · ' + E(x.method), '₦' + E(x.amount) + ' · ' + E(x.status)); }, 'None') +
      '<h4 style="margin:14px 0 4px">Recent sign-ins</h4>' + list(d.sessions, function (x) { return row(ago(x.createdAt) + ' · ' + E(x.ip || ''), E(x.state)); }, 'None') +
      '</div><div class="xbar" style="margin-top:12px">' + btn('Close', 'AdminUI.closeModal()') + '</div>');
  }
  async function addNote(m) {
    var tags = val('nt-tags').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    var r = await api('POST', '/api/admin/crm/' + encodeURIComponent(m), { text: val('nt-text'), tags: tags, pinned: U.chk('nt-pin') });
    if (!r.ok) return fail(r); toast('Note added'); openNotes(m);
  }
  async function pinNote(id, pinned, m) { var r = await api('PUT', '/api/admin/crm/note/' + id, { pinned: pinned }); if (!r.ok) return fail(r); openNotes(m); }
  async function delNote(id, m) { if (!confirm('Delete this note?')) return; var r = await api('DELETE', '/api/admin/crm/note/' + id); if (!r.ok) return fail(r); openNotes(m); }

  // ══ DATA & PRIVACY ═══════════════════════════════════════════
  async function dataTab() {
    var r = await api('GET', '/api/admin/data/collections'); if (!r.ok) return fail(r);
    body().innerHTML =
      '<div class="xcard"><h3>Export a collection</h3><div class="xs">Full backups you can open in Excel (CSV) or keep as JSON. Passwords, password hashes and device fingerprints are never included.</div><div class="tw" style="box-shadow:none"><div class="tbl-wrap"><table><thead><tr><th>Collection</th><th>Records</th><th></th></tr></thead><tbody>' +
      r.data.map(function (c) { return '<tr><td><b>' + E(c.label) + '</b></td><td>' + (c.count == null ? '—' : E(c.count)) + '</td><td style="white-space:nowrap">' + btn('CSV', 'AdminCommand.exportData(\'' + c.name + '\',\'csv\')') + ' ' + btn('JSON', 'AdminCommand.exportData(\'' + c.name + '\',\'json\')') + '</td></tr>'; }).join('') + '</tbody></table></div></div></div>' +
      '<div class="xcard"><h3>One student\'s data</h3><div class="xs">For a student who asks what Wreddi holds about them, or asks to be forgotten.</div><div class="xbar">' + input('dp-matric', 'Matric number') + btn('Download their data (JSON)', 'AdminCommand.studentExport()') +
      (myAccess.fullAccess ? btn('Erase personal data…', 'AdminCommand.eraseAsk()', 'ab ab-del') : '') + '</div>' +
      '<div class="xmut">Erasing removes the name, phone, WhatsApp, username, notes, chats and study content, suspends the account and ends its sessions. Scores, credit transactions and payment records stay (without the name). ' + (myAccess.fullAccess ? '' : 'Erasing needs a full-access admin.') + '</div></div>';
  }
  function exportData(name, fmt) { download('/api/admin/data/export/' + name + '?format=' + fmt, 'wreddi-' + name + '.' + fmt); }
  function studentExport() { var m = val('dp-matric').trim(); if (!m) return toast('Enter a matric number'); download('/api/admin/data/student/' + encodeURIComponent(m) + '/export', 'wreddi-student.json'); }
  function eraseAsk() {
    var m = val('dp-matric').trim().toUpperCase(); if (!m) return toast('Enter a matric number');
    U.modal('<h3 style="margin:0 0 8px;font:800 18px var(--ff-h,inherit)">Erase ' + E(m) + '\'s personal data?</h3><p style="font-size:13px;color:var(--t3);line-height:1.5">This cannot be undone. Consider downloading their data first. Type the matric number to confirm.</p>' + input('er-word', m) + '<div style="height:8px"></div>' + input('er-reason', 'Reason (optional, goes in the audit trail)') +
      '<div class="xbar" style="margin-top:14px">' + btn('Cancel', 'AdminUI.closeModal()') + btn('Erase', 'AdminCommand.eraseDo(\'' + E(m) + '\')', 'btn-main', 'width:auto;padding:9px 18px;font-size:13px;background:var(--no,#dc2626)') + '</div>');
  }
  async function eraseDo(m) {
    var r = await api('POST', '/api/admin/data/student/' + encodeURIComponent(m) + '/erase', { confirm: val('er-word'), reason: val('er-reason') });
    U.closeModal(); if (!r.ok) return fail(r, 'Could not erase'); toast('Personal data erased for ' + m);
  }

  // ══ ACCESS CONTROL ═══════════════════════════════════════════
  var sessTable = function (rows, revokeFn, empty) {
    return '<div class="tbl-wrap"><table><thead><tr><th>Who</th><th>Network</th><th>Device</th><th>Started</th><th>Last seen</th><th>State</th><th></th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (s) { return '<tr><td>' + E(s.subjectId) + (s.isNewDevice ? ' ' + badge('new device', 'b-warn') : '') + '</td><td>' + E(s.ip || '—') + '</td><td class="xmut" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + E(s.userAgent) + '">' + E(s.userAgent || '—') + '</td><td>' + ago(s.createdAt) + '</td><td>' + ago(s.lastActiveAt) + '</td><td>' + badge(s.state, s.state === 'active' ? 'b-ok' : 'b-gray') + '</td><td>' + (s.state === 'active' && canChange2(revokeFn.area) ? btn('End session', revokeFn.fn + '(\'' + s._id + '\')', 'ab ab-del') : '') + '</td></tr>'; }).join('') : '<tr><td colspan="7" class="xmut" style="padding:14px">' + empty + '</td></tr>') + '</tbody></table></div>';
  };
  async function accessTab() {
    var r = await api('GET', '/api/admin/access/blocks'); if (!r.ok) return fail(r);
    var blocks = r.data;
    body().innerHTML =
      '<div class="xcard"><h3>Blocked network addresses</h3><div class="xs">A blocked address cannot use the student app or sign in. Admin pages are never blocked. Phones switch addresses often, so use this for repeat abuse and set an expiry.</div>' +
      (canChange2('access') ? '<div class="xbar">' + input('bk-ip', 'IP address') + input('bk-reason', 'Reason') + input('bk-hours', 'Hours (blank = until removed)', 'number') + btn('Block', 'AdminCommand.addBlock()', 'btn-main', 'width:auto;padding:9px 18px;font-size:13px') + '</div>' : '') +
      '<div class="tbl-wrap"><table><thead><tr><th>Address</th><th>Reason</th><th>By</th><th>Added</th><th>Expires</th><th></th></tr></thead><tbody>' +
      (blocks.length ? blocks.map(function (b) { return '<tr><td><b>' + E(b.value) + '</b></td><td>' + E(b.reason || '—') + '</td><td>' + E(b.by) + '</td><td>' + ago(b.createdAt) + '</td><td>' + (b.expiresAt ? fmtDate(b.expiresAt) : 'never') + '</td><td>' + (canChange2('access') ? btn('Unblock', 'AdminCommand.delBlock(\'' + b._id + '\')', 'ab ab-del') : '') + '</td></tr>'; }).join('') : '<tr><td colspan="6" class="xmut" style="padding:14px">No addresses are blocked.</td></tr>') + '</tbody></table></div></div>' +
      '<div class="xcard"><h3>A student\'s sessions</h3><div class="xs">See where a student is signed in and end a single session.</div><div class="xbar">' + input('ss-matric', 'Matric number') + btn('Show sessions', 'AdminCommand.studentSessions()', 'btn-main', 'width:auto;padding:9px 18px;font-size:13px') + '</div><div id="ss-out"></div></div>' +
      (myAccess.owner ? '<div class="xcard"><h3>Admins signed in now</h3><div class="xs">Only you, as the owner, can see this.</div><div id="as-out" class="xmut">Loading…</div></div>' : '');
    if (myAccess.owner) adminSessions();
  }
  async function addBlock() {
    var r = await api('POST', '/api/admin/access/blocks', { value: val('bk-ip'), reason: val('bk-reason'), hours: val('bk-hours') });
    if (!r.ok) return fail(r); toast('Blocked ' + r.data.value); accessTab();
  }
  async function delBlock(id) { var r = await api('DELETE', '/api/admin/access/blocks/' + id); if (!r.ok) return fail(r); toast('Unblocked'); accessTab(); }
  async function studentSessions(m) {
    var matric = (m || val('ss-matric')).trim(); if (!matric) return;
    var r = await api('GET', '/api/admin/access/sessions/' + encodeURIComponent(matric)); var o = document.getElementById('ss-out'); if (!r.ok) return fail(r);
    o.innerHTML = sessTable(r.data, { fn: 'AdminCommand.endSession', area: 'access' }, 'No sessions found for ' + E(matric));
  }
  async function endSession(id) { var r = await api('POST', '/api/admin/access/sessions/' + id + '/revoke'); if (!r.ok) return fail(r); toast('Session ended'); studentSessions(); }
  async function adminSessions() {
    var r = await api('GET', '/api/admin/access/admin-sessions'); var o = document.getElementById('as-out'); if (!o) return; if (!r.ok) { o.textContent = (r.data && r.data.error) || 'Could not load'; return; }
    o.className = ''; o.innerHTML = sessTable(r.data, { fn: 'AdminCommand.endAdminSession', area: 'access' }, 'No other admins are signed in.');
  }
  async function endAdminSession(id) { var r = await api('POST', '/api/admin/access/admin-sessions/' + id + '/revoke'); if (!r.ok) return fail(r); toast('Admin session ended'); adminSessions(); }

  window.AdminCommand = { profile: profile, loadGroup: loadGroup, saveGroup: saveGroup, saveGroupDo: saveGroupDo, delGroup: delGroup, undoRun: undoRun, open: open, show: show, preset: preset, clearFilter: clearFilter, preview: preview, segmentCsv: segmentCsv, syncAction: syncAction, dryRun: dryRun, confirmApply: confirmApply, doApply: doApply,
    openNotes: openNotes, addNote: addNote, pinNote: pinNote, delNote: delNote, tagGroup: tagGroup, exportData: exportData, studentExport: studentExport, eraseAsk: eraseAsk, eraseDo: eraseDo,
    addBlock: addBlock, delBlock: delBlock, studentSessions: studentSessions, endSession: endSession, endAdminSession: endAdminSession };
})();
