/* Secondary control centre (admin, v1.14): overview · subjects · questions · students · papers · settings. */
(function () {
  'use strict';
  var U = window.AdminUI, E = U.E, api = U.api, card = U.card, badge = U.badge, val = U.val, chk = U.chk;
  var EXAMS = { jamb: 'JAMB', waec: 'WAEC', neco: 'NECO', school: 'School' };
  var CLASSES = ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'];
  var tab = 'overview', subjects = [], root;
  var qState = { page: 1, sel: {} }, stState = { page: 1, sel: {} }, ppState = { page: 1 };

  var opt = function (list, cur, blank) { return (blank ? '<option value="">' + E(blank) + '</option>' : '') + list.map(function (x) { var v = x.v !== undefined ? x.v : x, l = x.l !== undefined ? x.l : x; return '<option value="' + E(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + E(l) + '</option>'; }).join(''); };
  var subjOpts = function (cur, blank) { return opt(subjects.map(function (s) { return { v: s.key, l: s.title + (s.disabled ? ' (hidden)' : '') }; }), cur, blank); };
  var examOpts = function (cur, blank) { return opt(Object.keys(EXAMS).map(function (k) { return { v: k, l: EXAMS[k] }; }), cur, blank); };
  var fail = function (r, fallback) { toast((r.data && r.data.error) || fallback || 'Something went wrong'); };

  async function loadSubjects() { var r = await api('GET', '/api/admin/secondary/subjects'); if (r.ok) subjects = r.data; return r; }

  function shell() {
    var tabs = [['overview', 'Overview'], ['subjects', 'Subjects'], ['questions', 'Questions'], ['students', 'Students'], ['papers', 'Papers'], ['settings', 'Settings']];
    root.innerHTML = '<div class="xt">' + tabs.map(function (t) { return '<button data-t="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '" onclick="AdminSecondary.show(\'' + t[0] + '\')">' + t[1] + '</button>'; }).join('') + '</div><div id="sxa-body"><div class="xmut">Loading…</div></div>';
  }
  var body = function () { return document.getElementById('sxa-body'); };

  async function show(t) {
    tab = t || tab; shell();
    try {
      if (!subjects.length) await loadSubjects();
      await ({ overview: overview, subjects: subjectsTab, questions: questionsTab, students: studentsTab, papers: papersTab, settings: settingsTab })[tab]();
    } catch (e) { console.error(e); body().innerHTML = '<div class="xal danger">Could not load this tab. ' + E(e.message || '') + '</div>'; }
  }
  async function open() {
    root = document.getElementById('sxa-root'); if (!root) return;
    await show(tab);
  }

  // ══ OVERVIEW ═══════════════════════════════════════════════
  async function overview() {
    var r = await api('GET', '/api/admin/secondary/overview'); if (!r.ok) return fail(r, 'Could not load the overview');
    var d = r.data, t = d.totals, p = d.papers;
    var trend = p.trend.length ? '<div class="xbars">' + p.trend.map(function (x) { var m = Math.max.apply(null, p.trend.map(function (y) { return y.n; })); return '<div title="' + E(x.day + ': ' + x.n) + '" style="height:' + Math.max(4, Math.round(x.n / m * 100)) + '%"></div>'; }).join('') + '</div><div class="xmut" style="margin-top:6px">Papers per day, last 14 days</div>' : '<div class="xmut">No papers in the last 14 days</div>';
    var bands = { 0: 'Under 150', 150: '150–199', 200: '200–249', 250: '250–299', 300: '300+' };
    body().innerHTML =
      (d.lowCoverage.length ? '<div class="xal warn">Thin question banks (under 30 questions): ' + E(d.lowCoverage.join(', ')) + '</div>' : '') +
      '<div class="sg">' + card(t.total, 'Secondary students') + card(t.active7, 'Active (7 days)') + card(t.new7, 'New this week') + card(t.new30, 'New this month') + card(t.setUp, 'Finished setup') + card(t.notSetUp, 'Not set up') + card(t.suspended, 'Suspended') +
      Object.keys(EXAMS).map(function (k) { return card((p.byExam[k] || { papers: 0 }).papers, EXAMS[k] + ' papers'); }).join('') + card(d.credits.passRate === null ? '—' : d.credits.passRate + '%', 'WAEC/NECO credit rate') + '</div>' +
      '<div class="xgrid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">' +
      '<div class="xcard"><h3>Activity</h3>' + trend + '</div>' +
      '<div class="xcard"><h3>Students by exam</h3>' + U.bars(Object.keys(d.byExam).map(function (k) { return { label: EXAMS[k] || 'Not set', n: d.byExam[k] }; })) + '<h3 style="margin-top:14px">By class (school)</h3>' + U.bars(CLASSES.filter(function (c) { return d.byClass[c]; }).map(function (c) { return { label: c, n: d.byClass[c] }; })) + '</div>' +
      '<div class="xcard"><h3>JAMB UTME best scores</h3>' + U.bars(d.utmeBands.map(function (b) { return { label: bands[b.from] || b.from, n: b.n }; })) + '<h3 style="margin-top:14px">WAEC / NECO grades</h3>' + U.bars(['A1', 'B2', 'B3', 'C4', 'C5', 'C6', 'D7', 'E8', 'F9'].filter(function (g) { return d.grades[g]; }).map(function (g) { return { label: g, n: d.grades[g] }; })) + '</div>' +
      '<div class="xcard"><h3>Plans</h3>' + U.bars(Object.keys(d.byTier).map(function (k) { return { label: k, n: d.byTier[k] }; })) + '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn-main" style="width:auto;padding:9px 16px;font-size:13px" onclick="AdminSecondary.announce()">Message all Secondary students</button></div></div></div>' +
      '<div class="tw"><div class="th"><div class="th-title">Subjects</div></div><div class="tbl-wrap"><table><thead><tr><th>Subject</th><th>Questions</th><th>Paper results</th><th>Accuracy</th><th></th></tr></thead><tbody>' +
      d.subjects.map(function (s) { return '<tr><td style="font-weight:700">' + E(s.title) + ' <span class="xmut">' + E(s.code) + '</span></td><td>' + (s.questions < 30 ? badge(s.questions, 'b-warn') : s.questions) + '</td><td>' + s.papers + '</td><td>' + (s.accuracy === null ? '—' : s.accuracy + '%') + '</td><td>' + (s.disabled ? badge('Hidden', 'b-no') : '') + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +
      '<div class="tw"><div class="th"><div class="th-title">Top JAMB mock results</div></div><div class="tbl-wrap"><table><thead><tr><th>#</th><th>Student</th><th>Best UTME</th><th>Papers</th></tr></thead><tbody>' +
      (d.top.length ? d.top.map(function (x, i) { return '<tr><td>' + (i + 1) + '</td><td>' + E(x.name) + ' <span class="xmut">' + E(x.matric) + '</span></td><td><b>' + x.best + '</b>/400</td><td>' + x.papers + '</td></tr>'; }).join('') : '<tr class="empty-row"><td colspan="4">No JAMB mock results yet</td></tr>') + '</tbody></table></div></div>';
  }

  function announce() {
    U.modal('<div class="modal-title">Message Secondary students</div><div class="modal-sub">Appears in their notifications. Suspended accounts are skipped.</div>' +
      '<div class="xf"><span>Who</span><select class="f-input" id="an-exam">' + examOpts('', 'All Secondary students') + '</select></div>' +
      '<div class="xf"><span>Title</span><input class="f-input" id="an-title" maxlength="120"></div><div class="xf"><span>Message</span><textarea class="f-input" id="an-msg" maxlength="1000"></textarea></div>' +
      '<div style="display:flex;gap:10px"><button class="btn-cancel" onclick="AdminUI.closeModal()">Cancel</button><button class="btn-confirm" onclick="AdminSecondary.sendAnnounce()">Send</button></div>');
  }
  async function sendAnnounce() {
    var r = await api('POST', '/api/admin/secondary/announce', { title: val('an-title'), message: val('an-msg'), exam: val('an-exam') });
    if (r.ok) { U.closeModal(); toast('Sent to ' + r.data.sentTo + ' student' + (r.data.sentTo === 1 ? '' : 's')); } else fail(r);
  }

  // ══ SUBJECTS ═══════════════════════════════════════════════
  async function subjectsTab() {
    var r = await loadSubjects(); if (!r.ok) return fail(r);
    body().innerHTML = '<div class="xbar"><button class="btn-main" style="width:auto;padding:9px 16px;font-size:13px" onclick="AdminSecondary.subjectForm()">+ Add subject</button><span class="xmut">Hide a subject to remove it from students’ screens without losing its questions.</span></div>' +
      '<div class="tw"><div class="tbl-wrap"><table><thead><tr><th>Subject</th><th>Exams</th><th>Questions</th><th>Students</th><th>Accuracy</th><th>Status</th><th></th></tr></thead><tbody>' +
      subjects.map(function (s) {
        return '<tr><td><span class="xdot" style="background:' + E(s.color) + '"></span><b>' + E(s.title) + '</b> <span class="xmut">' + E(s.code) + (s.core ? ' · core' : '') + '</span></td>' +
          '<td>' + s.exams.map(function (e) { return '<span class="xchip">' + E(EXAMS[e] || e) + '</span>'; }).join('') + (s.customExams ? '<span class="xmut"> custom</span>' : '') + '</td>' +
          '<td>' + (s.questions < 30 ? badge(s.questions, 'b-warn') : s.questions) + '</td><td>' + s.students + '</td><td>' + (s.accuracy === null ? '—' : s.accuracy + '%') + '</td>' +
          '<td>' + (s.disabled ? badge('Hidden', 'b-no') : badge('Live', 'b-ok')) + '</td>' +
          '<td style="white-space:nowrap"><button class="ab ab-edit" onclick="AdminSecondary.subjectForm(\'' + s.id + '\')">Edit</button> <button class="ab ab-warn" onclick="AdminSecondary.toggleSubject(\'' + s.id + '\',' + !s.disabled + ')">' + (s.disabled ? 'Show' : 'Hide') + '</button> <button class="ab ab-del" onclick="AdminSecondary.deleteSubject(\'' + s.id + '\')">Delete</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  function subjectForm(id) {
    var s = id ? subjects.filter(function (x) { return x.id === id; })[0] : { code: '', title: '', color: '#3E5C8A', icon: 'star', topics: [], exams: Object.keys(EXAMS), customExams: false };
    U.modal('<div class="modal-title">' + (id ? 'Edit subject' : 'Add subject') + '</div><div class="modal-sub">' + (id ? E(s.code) + ' — the code cannot change.' : 'Students see it in setup once it is live.') + '</div>' +
      (id ? '' : '<div class="xf"><span>Code (e.g. SEC-LAW)</span><input class="f-input" id="sf-code" maxlength="20"></div>') +
      '<div class="xf"><span>Title</span><input class="f-input" id="sf-title" value="' + E(s.title) + '" maxlength="80"></div>' +
      '<div class="xrow2"><div class="xf"><span>Colour</span><input type="color" class="f-input" id="sf-color" value="' + E(s.color) + '" style="height:42px;padding:3px"></div><div class="xf"><span>Icon name</span><input class="f-input" id="sf-icon" value="' + E(s.icon) + '"></div></div>' +
      '<div class="xf"><span>Topics (comma separated)</span><textarea class="f-input" id="sf-topics">' + E((s.topics || []).join(', ')) + '</textarea></div>' +
      '<div class="xf"><span>Examined by</span><div>' + Object.keys(EXAMS).map(function (k) { return '<label style="margin-right:14px;font-size:13px"><input type="checkbox" class="sf-exam" value="' + k + '"' + (s.exams.indexOf(k) >= 0 ? ' checked' : '') + '> ' + EXAMS[k] + '</label>'; }).join('') + '</div></div>' +
      '<div style="display:flex;gap:10px"><button class="btn-cancel" onclick="AdminUI.closeModal()">Cancel</button><button class="btn-confirm" onclick="AdminSecondary.saveSubject(' + (id ? "'" + id + "'" : 'null') + ')">Save</button></div>');
  }
  async function saveSubject(id) {
    var exams = [].slice.call(document.querySelectorAll('.sf-exam')).filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
    var b = { title: val('sf-title'), color: val('sf-color'), icon: val('sf-icon'), topics: val('sf-topics'), exams: exams };
    if (!id) b.code = val('sf-code');
    var r = await api(id ? 'PUT' : 'POST', '/api/admin/secondary/subjects' + (id ? '/' + id : ''), b);
    if (r.ok) { U.closeModal(); toast('Saved'); subjects = []; subjectsTab(); } else fail(r);
  }
  async function toggleSubject(id, hide) { var r = await api('PUT', '/api/admin/secondary/subjects/' + id, { disabled: hide }); if (r.ok) { toast(hide ? 'Hidden from students' : 'Now live'); subjectsTab(); } else fail(r); }
  async function deleteSubject(id) {
    var r = await api('DELETE', '/api/admin/secondary/subjects/' + id);
    if (r.ok) { toast('Deleted'); subjects = []; return subjectsTab(); }
    if (r.status === 409 && r.data.code === 'IN_USE') {
      var withQ = confirm(r.data.error + '\n\nOK = delete the subject AND its ' + r.data.questions + ' question(s).\nCancel = choose again.');
      if (withQ) { var r2 = await api('DELETE', '/api/admin/secondary/subjects/' + id + '?force=1&questions=1'); if (r2.ok) { toast('Deleted'); subjects = []; subjectsTab(); } else fail(r2); }
      else if (confirm('Delete the subject but KEEP its questions in the bank?')) { var r3 = await api('DELETE', '/api/admin/secondary/subjects/' + id + '?force=1'); if (r3.ok) { toast('Deleted'); subjects = []; subjectsTab(); } else fail(r3); }
    } else fail(r);
  }

  // ══ QUESTIONS ══════════════════════════════════════════════
  function qFilters() { return { course: val('qf-course'), exam: val('qf-exam'), year: val('qf-year'), classLevel: val('qf-class'), tag: val('qf-tag'), q: val('qf-q'), sort: val('qf-sort') }; }
  async function questionsTab(page) {
    if (page) qState.page = page;
    var keep = qState.f || {};
    body().innerHTML = '<div class="xbar"><button class="btn-main" style="width:auto;padding:9px 16px;font-size:13px" onclick="AdminSecondary.questionForm()">+ Add question</button><button class="ab ab-edit" onclick="AdminSecondary.importForm()">Import CSV / JSON</button><button class="ab ab-gray" onclick="AdminSecondary.coverage()">Coverage grid</button><button class="ab ab-gray" onclick="AdminSecondary.exportCsv(\'questions\')">Export CSV</button></div>' +
      '<div class="xbar"><select class="f-input" id="qf-course">' + subjOpts(keep.course, 'All subjects') + '</select><select class="f-input" id="qf-exam">' + examOpts(keep.exam, 'Any exam') + '<option value="untagged"' + (keep.exam === 'untagged' ? ' selected' : '') + '>Untagged (no exam)</option></select>' +
      '<input class="f-input" id="qf-year" placeholder="Year / none" style="width:100px" value="' + E(keep.year || '') + '"><select class="f-input" id="qf-class">' + opt(CLASSES, keep.classLevel, 'Any class') + '</select>' +
      '<input class="f-input" id="qf-tag" placeholder="Topic" style="width:130px" value="' + E(keep.tag || '') + '"><input class="f-input" id="qf-q" placeholder="Search text" style="width:150px" value="' + E(keep.q || '') + '">' +
      '<select class="f-input" id="qf-sort">' + opt([{ v: 'newest', l: 'Newest' }, { v: 'oldest', l: 'Oldest' }, { v: 'year', l: 'Year' }], keep.sort) + '</select><button class="btn-main" style="width:auto;padding:9px 16px;font-size:13px" onclick="AdminSecondary.applyQ()">Filter</button></div>' +
      '<div id="q-bulk"></div><div class="tw"><div class="tbl-wrap"><table><thead><tr><th style="width:30px"><input type="checkbox" onchange="AdminSecondary.pickAllQ(this.checked)"></th><th>Question</th><th>Subject</th><th>Exam</th><th>Year</th><th>Topic</th><th></th></tr></thead><tbody id="q-rows"><tr class="empty-row"><td colspan="7">Loading…</td></tr></tbody></table></div><div id="q-pg"></div></div>';
    var f = qState.f = Object.keys(keep).length ? keep : {};
    var r = await api('GET', '/api/admin/secondary/questions?' + U.qs(Object.assign({}, f, { page: qState.page, limit: 25 }))); if (!r.ok) return fail(r);
    qState.rows = r.data.rows; qState.total = r.data.total; qState.sel = {};
    document.getElementById('q-rows').innerHTML = r.data.rows.length ? r.data.rows.map(function (q) {
      var sj = subjects.filter(function (s) { return s.key === String(q.course).toLowerCase().replace(/[^a-z0-9]/g, ''); })[0];
      return '<tr><td><input type="checkbox" class="q-pick" value="' + q._id + '" onchange="AdminSecondary.pickQ()"></td><td style="max-width:380px"><div style="font-weight:600;font-size:13px">' + E(String(q.q).slice(0, 140)) + (q.q.length > 140 ? '…' : '') + '</div></td><td>' + E(sj ? sj.title : q.course) + '</td><td>' + (q.exam ? badge(EXAMS[q.exam], 'b-brand') : '<span class="xmut">any</span>') + (q.classLevel ? ' ' + badge(q.classLevel, 'b-gray') : '') + '</td><td>' + (q.year || '<span class="xmut">—</span>') + '</td><td>' + E(q.tag || '') + '</td>' +
        '<td style="white-space:nowrap"><button class="ab ab-edit" onclick="AdminSecondary.questionForm(\'' + q._id + '\')">Edit</button> <button class="ab ab-del" onclick="AdminSecondary.delQ(\'' + q._id + '\')">Delete</button></td></tr>';
    }).join('') : '<tr class="empty-row"><td colspan="7">No questions match</td></tr>';
    document.getElementById('q-pg').innerHTML = U.pager({ page: r.data.page, pages: r.data.pages, total: r.data.total }, 'AdminSecondary.questionsTab');
    bulkBar();
  }
  function applyQ() { qState.f = qFilters(); qState.page = 1; questionsTab(); }
  function pickAllQ(on) { [].slice.call(document.querySelectorAll('.q-pick')).forEach(function (c) { c.checked = on; }); pickQ(); }
  function picked() { return [].slice.call(document.querySelectorAll('.q-pick')).filter(function (c) { return c.checked; }).map(function (c) { return c.value; }); }
  function pickQ() { bulkBar(); }
  function bulkBar() {
    var n = picked().length, el = document.getElementById('q-bulk'); if (!el) return;
    var hasFilter = Object.keys(qState.f || {}).some(function (k) { return k !== 'sort' && qState.f[k]; });
    el.innerHTML = '<div class="xbar" style="background:var(--surf2);padding:10px 12px;border-radius:10px">' +
      '<b style="font-size:13px">' + (n ? n + ' ticked' : qState.total + ' match') + '</b>' +
      (n ? '<button class="ab ab-edit" onclick="AdminSecondary.bulkTag(\'ids\')">Tag ticked…</button><button class="ab ab-del" onclick="AdminSecondary.bulkDelete(\'ids\')">Delete ticked</button>' : '') +
      (hasFilter ? '<button class="ab ab-edit" onclick="AdminSecondary.bulkTag(\'filter\')">Tag all ' + qState.total + ' matching…</button><button class="ab ab-del" onclick="AdminSecondary.bulkDelete(\'filter\')">Delete all ' + qState.total + ' matching</button>' : '<span class="xmut">Set a filter to act on every matching question.</span>') + '</div>';
  }
  function scope(kind) { return kind === 'ids' ? { ids: picked() } : { filter: qState.f }; }
  function bulkTag(kind) {
    U.modal('<div class="modal-title">Tag questions</div><div class="modal-sub">Only the fields you fill are changed. Leave blank to keep as is.</div>' +
      '<div class="xrow3"><div class="xf"><span>Exam</span><select class="f-input" id="bt-exam">' + examOpts('', 'No change') + '</select></div><div class="xf"><span>Year</span><input class="f-input" id="bt-year" placeholder="No change"></div><div class="xf"><span>Class</span><select class="f-input" id="bt-class">' + opt(CLASSES, '', 'No change') + '</select></div></div>' +
      '<div id="bt-out" class="xmut" style="margin-bottom:12px"></div><div style="display:flex;gap:10px"><button class="btn-cancel" onclick="AdminUI.closeModal()">Cancel</button><button class="btn-confirm" onclick="AdminSecondary.runBulkTag(\'' + kind + '\')">Preview &amp; apply</button></div>');
  }
  async function runBulkTag(kind) {
    var set = {}; if (val('bt-exam')) set.exam = val('bt-exam'); if (val('bt-year')) set.year = val('bt-year'); if (val('bt-class')) set.classLevel = val('bt-class');
    if (!Object.keys(set).length) return toast('Choose something to set');
    var pre = await api('POST', '/api/admin/secondary/questions/bulk-action', Object.assign({ action: 'tag', set: set, dryRun: true }, scope(kind))); if (!pre.ok) return fail(pre);
    if (!confirm('Apply to ' + pre.data.matched + ' question(s)?')) return;
    var r = await api('POST', '/api/admin/secondary/questions/bulk-action', Object.assign({ action: 'tag', set: set, dryRun: false }, scope(kind)));
    if (r.ok) { U.closeModal(); toast('Updated ' + r.data.modified + ' question(s)'); questionsTab(); } else fail(r);
  }
  async function bulkDelete(kind) {
    var pre = await api('POST', '/api/admin/secondary/questions/bulk-action', Object.assign({ action: 'delete', dryRun: true }, scope(kind))); if (!pre.ok) return fail(pre);
    if (!pre.data.matched) return toast('Nothing matches');
    if (!confirm('Permanently delete ' + pre.data.matched + ' question(s)? This cannot be undone.')) return;
    var r = await api('POST', '/api/admin/secondary/questions/bulk-action', Object.assign({ action: 'delete', dryRun: false }, scope(kind)));
    if (r.ok) { toast('Deleted ' + r.data.deleted); questionsTab(); } else fail(r);
  }
  async function delQ(id) { if (!confirm('Delete this question?')) return; var r = await api('DELETE', '/api/admin/secondary/questions/' + id); if (r.ok) { toast('Deleted'); questionsTab(); } else fail(r); }

  function questionForm(id) {
    var q = id ? (qState.rows || []).filter(function (x) { return x._id === id; })[0] : { course: (qState.f && qState.f.course) || '', q: '', opts: ['', '', '', ''], ans: 0, tag: '', exp: '', exam: (qState.f && EXAMS[qState.f.exam]) ? qState.f.exam : '', year: '', classLevel: '' };
    var key = String(q.course).toLowerCase().replace(/[^a-z0-9]/g, ''); var o = q.opts.slice(); while (o.length < 5) o.push('');
    U.modal('<div class="modal-title">' + (id ? 'Edit question' : 'Add question') + '</div><div class="modal-sub">Options A–E: leave unused ones blank.</div>' +
      '<div class="xf"><span>Subject</span><select class="f-input" id="qq-course">' + subjOpts(key, 'Choose…') + '</select></div>' +
      '<div class="xf"><span>Question</span><textarea class="f-input" id="qq-q">' + E(q.q) + '</textarea></div>' +
      ['A', 'B', 'C', 'D', 'E'].map(function (L, i) { return '<div class="xf" style="margin-bottom:8px"><span>Option ' + L + '</span><input class="f-input qq-opt" value="' + E(o[i]) + '"></div>'; }).join('') +
      '<div class="xrow2"><div class="xf"><span>Correct answer</span><select class="f-input" id="qq-ans">' + opt(['A', 'B', 'C', 'D', 'E'].map(function (L, i) { return { v: i, l: L }; }), q.ans) + '</select></div><div class="xf"><span>Topic</span><input class="f-input" id="qq-tag" value="' + E(q.tag) + '"></div></div>' +
      '<div class="xrow3"><div class="xf"><span>Exam</span><select class="f-input" id="qq-exam">' + examOpts(q.exam, 'Any') + '</select></div><div class="xf"><span>Year</span><input class="f-input" id="qq-year" value="' + E(q.year || '') + '"></div><div class="xf"><span>Class</span><select class="f-input" id="qq-class">' + opt(CLASSES, q.classLevel, 'Any') + '</select></div></div>' +
      '<div class="xf"><span>Explanation (optional)</span><textarea class="f-input" id="qq-exp">' + E(q.exp) + '</textarea></div>' +
      '<div style="display:flex;gap:10px"><button class="btn-cancel" onclick="AdminUI.closeModal()">Cancel</button><button class="btn-confirm" onclick="AdminSecondary.saveQ(' + (id ? "'" + id + "'" : 'null') + ')">Save</button></div>');
  }
  async function saveQ(id) {
    var raw = [].slice.call(document.querySelectorAll('.qq-opt')).map(function (i) { return i.value.trim(); });
    var ansRaw = parseInt(val('qq-ans'), 10), opts = [], ans = 0;
    raw.forEach(function (t, i) { if (t) { if (i === ansRaw) ans = opts.length; opts.push(t); } });
    if (raw[ansRaw] === '') return toast('The correct answer cannot be a blank option');
    var b = { course: val('qq-course'), q: val('qq-q'), opts: opts, ans: ans, tag: val('qq-tag'), exp: val('qq-exp'), exam: val('qq-exam'), year: val('qq-year'), classLevel: val('qq-class') };
    var r = await api(id ? 'PUT' : 'POST', '/api/admin/secondary/questions' + (id ? '/' + id : ''), b);
    if (r.ok) { U.closeModal(); toast('Saved'); questionsTab(); } else fail(r);
  }

  async function coverage() {
    var r = await api('GET', '/api/admin/secondary/coverage'); if (!r.ok) return fail(r);
    var ex = r.data.exams;
    U.modal('<div class="modal-title">Question coverage</div><div class="modal-sub">Questions per subject and exam. Red = fewer than 20.</div><div class="tbl-wrap"><table><thead><tr><th>Subject</th>' + ex.map(function (e) { return '<th>' + E(e === 'any' ? 'Any' : EXAMS[e]) + '</th>'; }).join('') + '<th>Total</th><th>No year</th></tr></thead><tbody>' +
      r.data.rows.map(function (s) { return '<tr><td><b>' + E(s.title) + '</b>' + (s.disabled ? ' <span class="xmut">hidden</span>' : '') + '</td>' + ex.map(function (e) { var n = s.byExam[e] || 0; return '<td' + (e !== 'any' && n < 20 ? ' style="color:var(--no);font-weight:700"' : '') + '>' + n + '</td>'; }).join('') + '<td><b>' + s.total + '</b></td><td>' + s.noYear + '</td></tr>'; }).join('') + '</tbody></table></div><div style="margin-top:14px"><button class="btn-cancel" onclick="AdminUI.closeModal()">Close</button></div>', true);
  }

  // Import: CSV columns — subject, question, A, B, C, D, E, answer (A–E or 1–5), topic, explanation, exam, year, class. Subject/exam/year/class may instead come from the defaults.
  function importForm() {
    U.modal('<div class="modal-title">Import questions</div><div class="modal-sub">Paste CSV (first row = headers) or a JSON array. Up to 500 at a time; duplicates are skipped.</div>' +
      '<div class="xrow3"><div class="xf"><span>Default subject</span><select class="f-input" id="im-course">' + subjOpts('', 'From the file') + '</select></div><div class="xf"><span>Default exam</span><select class="f-input" id="im-exam">' + examOpts('', 'From the file') + '</select></div><div class="xf"><span>Default year</span><input class="f-input" id="im-year" placeholder="From the file"></div></div>' +
      '<div class="xf"><span>Default class (school)</span><select class="f-input" id="im-class">' + opt(CLASSES, '', 'From the file') + '</select></div>' +
      '<div class="xf"><span>Data</span><textarea class="f-input" id="im-data" style="min-height:160px;font:12px ui-monospace,Menlo,monospace" placeholder="question,A,B,C,D,answer,topic,explanation&#10;What is 2+2?,3,4,5,6,B,Arithmetic,Because 2+2=4"></textarea></div>' +
      '<div id="im-out" class="xpre" style="display:none;margin-bottom:12px"></div>' +
      '<div style="display:flex;gap:10px"><button class="btn-cancel" onclick="AdminUI.closeModal()">Cancel</button><button class="btn-cancel" onclick="AdminSecondary.runImport(true)">Preview</button><button class="btn-confirm" onclick="AdminSecondary.runImport(false)">Import</button></div>', true);
  }
  function toItems(text) {
    text = String(text).trim(); if (!text) throw new Error('Paste some questions first');
    if (text[0] === '[') { var j = JSON.parse(text); if (!Array.isArray(j)) throw new Error('JSON must be an array'); return j; }
    var rows = U.parseCsv(text); if (rows.length < 2) throw new Error('Need a header row and at least one question');
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); }), col = function (n) { return head.indexOf(n); };
    var iq = Math.max(col('question'), col('q')); if (iq < 0) throw new Error('Missing a "question" column');
    var optCols = ['a', 'b', 'c', 'd', 'e'].map(col);
    return rows.slice(1).map(function (r) {
      var g = function (n) { var i = col(n); return i >= 0 ? (r[i] || '').trim() : ''; };
      var opts = optCols.map(function (i) { return i >= 0 ? (r[i] || '').trim() : ''; });
      var a = (g('answer') || g('ans')).toUpperCase(), ai = /^[A-E]$/.test(a) ? 'ABCDE'.indexOf(a) : (parseInt(a, 10) - 1);
      var keep = [], ans = -1; opts.forEach(function (t, i) { if (t) { if (i === ai) ans = keep.length; keep.push(t); } });
      var it = { q: (r[iq] || '').trim(), opts: keep, ans: ans, tag: g('topic') || g('tag'), exp: g('explanation') || g('exp') };
      if (g('subject') || g('course')) it.course = g('subject') || g('course'); if (g('exam')) it.exam = g('exam').toLowerCase(); if (g('year')) it.year = parseInt(g('year'), 10); if (g('class')) it.classLevel = g('class').toUpperCase();
      return it;
    });
  }
  async function runImport(dry) {
    var out = document.getElementById('im-out'); out.style.display = 'block';
    try {
      var items = toItems(val('im-data')), defaults = {};
      if (val('im-course')) defaults.course = val('im-course'); if (val('im-exam')) defaults.exam = val('im-exam'); if (val('im-year')) defaults.year = val('im-year'); if (val('im-class')) defaults.classLevel = val('im-class');
      var r = await api('POST', '/api/admin/secondary/questions/import', { items: items, defaults: defaults, dryRun: dry });
      if (!r.ok) { out.textContent = r.data.error || 'Import failed'; return; }
      var d = r.data, rej = (d.rejected || []).slice(0, 8).map(function (x) { return '• row ' + ((x.index !== undefined ? x.index + 1 : '?')) + ': ' + (x.reason || x.error || 'rejected'); }).join('\n');
      out.textContent = (dry ? 'Would add ' + d.wouldAdd : 'Added ' + d.added) + ' of ' + d.total + ' · ' + (d.rejected || []).length + ' skipped' + (rej ? '\n' + rej : '');
      if (!dry && d.added) { toast('Imported ' + d.added); questionsTab(); }
    } catch (e) { out.textContent = e.message; }
  }

  // ══ STUDENTS ═══════════════════════════════════════════════
  async function studentsTab(page) {
    if (page) stState.page = page; var keep = stState.f || {};
    body().innerHTML = '<div class="xbar"><input class="f-input" id="sf-search" placeholder="Name, matric, school…" style="width:200px" value="' + E(keep.search || '') + '"><select class="f-input" id="sf-exam">' + examOpts(keep.exam, 'Any exam') + '<option value="none"' + (keep.exam === 'none' ? ' selected' : '') + '>Not set up</option></select><select class="f-input" id="sf-class">' + opt(CLASSES, keep.classLevel, 'Any class') + '</select>' +
      '<select class="f-input" id="sf-tier">' + opt([{ v: 'free', l: 'Free' }, { v: 'premium', l: 'Premium' }], keep.tier, 'Any plan') + '</select><select class="f-input" id="sf-status">' + opt([{ v: 'active', l: 'Active' }, { v: 'suspended', l: 'Suspended' }], keep.status, 'Any status') + '</select><select class="f-input" id="sf-sort">' + opt([{ v: 'newest', l: 'Newest' }, { v: 'recent', l: 'Recently active' }, { v: 'name', l: 'Name' }], keep.sort) + '</select>' +
      '<button class="btn-main" style="width:auto;padding:9px 16px;font-size:13px" onclick="AdminSecondary.applyS()">Filter</button><button class="ab ab-gray" onclick="AdminSecondary.exportCsv(\'students\')">Export CSV</button></div>' +
      '<div id="st-bulk"></div><div class="tw"><div class="tbl-wrap"><table><thead><tr><th style="width:30px"><input type="checkbox" onchange="AdminSecondary.pickAllS(this.checked)"></th><th>Student</th><th>Exam</th><th>Papers</th><th>Best / avg</th><th>Last active</th><th>Status</th><th></th></tr></thead><tbody id="st-rows"><tr class="empty-row"><td colspan="8">Loading…</td></tr></tbody></table></div><div id="st-pg"></div></div>';
    stState.f = keep;
    var r = await api('GET', '/api/admin/secondary/students?' + U.qs(Object.assign({}, keep, { page: stState.page, limit: 25 }))); if (!r.ok) return fail(r);
    stState.total = r.data.total;
    document.getElementById('st-rows').innerHTML = r.data.rows.length ? r.data.rows.map(function (s) {
      return '<tr><td><input type="checkbox" class="s-pick" value="' + E(s.matric) + '" onchange="AdminSecondary.sBar()"></td><td><b>' + E(s.name) + '</b><div class="xmut">' + E(s.matric) + (s.school ? ' · ' + E(s.school) : '') + '</div></td><td>' + (s.exam ? badge(EXAMS[s.exam], 'b-brand') : badge('Not set up', 'b-gray')) + (s.classLevel ? ' ' + badge(s.classLevel, 'b-gray') : '') + '</td><td>' + s.papers + '</td><td>' + (s.bestUtme ? s.bestUtme + '/400 · ' : '') + (s.avg === null ? '—' : s.avg + '%') + '</td><td class="xmut">' + U.ago(s.lastActiveAt) + '</td><td>' + (s.active ? badge('Active', 'b-ok') : badge('Suspended', 'b-no')) + (s.tier === 'premium' ? ' ' + badge('Premium', 'b-warn') : '') + '</td><td><button class="ab ab-edit" onclick="AdminSecondary.studentDetail(\'' + E(s.matric) + '\')">Open</button></td></tr>';
    }).join('') : '<tr class="empty-row"><td colspan="8">No Secondary students match</td></tr>';
    document.getElementById('st-pg').innerHTML = U.pager({ page: r.data.page, pages: r.data.pages, total: r.data.total }, 'AdminSecondary.studentsTab'); sBar();
  }
  function applyS() { stState.f = { search: val('sf-search'), exam: val('sf-exam'), classLevel: val('sf-class'), tier: val('sf-tier'), status: val('sf-status'), sort: val('sf-sort') }; stState.page = 1; studentsTab(); }
  function pickedS() { return [].slice.call(document.querySelectorAll('.s-pick')).filter(function (c) { return c.checked; }).map(function (c) { return c.value; }); }
  function pickAllS(on) { [].slice.call(document.querySelectorAll('.s-pick')).forEach(function (c) { c.checked = on; }); sBar(); }
  function sBar() {
    var n = pickedS().length, el = document.getElementById('st-bulk'); if (!el) return;
    el.innerHTML = '<div class="xbar" style="background:var(--surf2);padding:10px 12px;border-radius:10px"><b style="font-size:13px">' + (n ? n + ' ticked' : stState.total + ' students') + '</b>' + (n ? '<button class="ab ab-warn" onclick="AdminSecondary.bulkS(\'suspend\')">Suspend</button><button class="ab ab-ok" onclick="AdminSecondary.bulkS(\'activate\')">Activate</button><button class="ab ab-gray" onclick="AdminSecondary.bulkS(\'signout\')">Sign out</button><button class="ab ab-edit" onclick="AdminSecondary.notifyS()">Message…</button>' : '<span class="xmut">Tick students to act on several at once (max 200).</span>') + '</div>';
  }
  async function bulkS(action, extra) {
    var m = pickedS(); if (!m.length) return;
    if (!extra && !confirm((action === 'suspend' ? 'Suspend and sign out ' : action === 'activate' ? 'Re-activate ' : 'Sign out ') + m.length + ' student(s)?')) return;
    var r = await api('POST', '/api/admin/secondary/students/bulk', Object.assign({ action: action, matrics: m }, extra || {}));
    if (r.ok) { U.closeModal(); toast(r.data.affected + ' updated'); studentsTab(); } else fail(r);
  }
  function notifyS() {
    U.modal('<div class="modal-title">Message ticked students</div><div class="xf"><span>Title</span><input class="f-input" id="ns-title" maxlength="120"></div><div class="xf"><span>Message</span><textarea class="f-input" id="ns-msg" maxlength="1000"></textarea></div><div style="display:flex;gap:10px"><button class="btn-cancel" onclick="AdminUI.closeModal()">Cancel</button><button class="btn-confirm" onclick="AdminSecondary.sendNotifyS()">Send</button></div>');
  }
  function sendNotifyS() { bulkS('notify', { title: val('ns-title'), message: val('ns-msg') }); }

  async function studentDetail(m) {
    var r = await api('GET', '/api/admin/secondary/students/' + encodeURIComponent(m)); if (!r.ok) return fail(r);
    var s = r.data.student, p = s.secondary || {};
    U.modal('<div class="modal-title">' + E(s.name) + '</div><div class="modal-sub">' + E(s.matric) + (s.username ? ' · @' + E(s.username) : '') + ' · joined ' + fmtDate(s.createdAt) + ' · ' + r.data.openSessions + ' open session(s)</div>' +
      '<div class="sg" style="margin-bottom:14px">' + card(s.credits || 0, 'Credits') + card(s.tier || 'free', 'Plan') + card(EXAMS[p.exam] || '—', 'Exam') + card(p.classLevel || '—', 'Class') + '</div>' +
      '<div class="xmut" style="margin-bottom:10px">Subjects: ' + ((p.subjects || []).map(function (k) { var sj = subjects.filter(function (x) { return x.key === k; })[0]; return E(sj ? sj.title : k); }).join(', ') || 'none') + (p.school ? ' · School: ' + E(p.school) : '') + (p.targetScore ? ' · Target: ' + p.targetScore : '') + (p.courseOfStudy ? ' · Wants: ' + E(p.courseOfStudy) : '') + '</div>' +
      '<h3 style="font-size:13px;margin:12px 0 6px">Subject accuracy</h3>' + U.bars(r.data.perSubject.map(function (x) { return { label: x.course, n: x.accuracy }; }), function (n) { return n + '%'; }) +
      '<h3 style="font-size:13px;margin:14px 0 6px">Recent papers</h3><div class="tbl-wrap" style="max-height:200px"><table><tbody>' + (r.data.papers.length ? r.data.papers.map(function (x) { return '<tr><td class="xmut">' + U.ago(x.ts) + '</td><td>' + E(EXAMS[x.exam] || x.exam) + ' ' + E(x.kind) + (x.year ? ' ' + x.year : '') + '</td><td><b>' + (x.utme ? x.utme + '/400' : Math.round(x.pct) + '%') + '</b></td></tr>'; }).join('') : '<tr class="empty-row"><td colspan="3">No papers yet</td></tr>') + '</tbody></table></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px"><button class="ab ab-warn" onclick="AdminSecondary.oneS(\'' + E(s.matric) + '\',\'' + (s.active === false ? 'activate' : 'suspend') + '\')">' + (s.active === false ? 'Re-activate' : 'Suspend') + '</button><button class="ab ab-gray" onclick="AdminSecondary.oneS(\'' + E(s.matric) + '\',\'signout\')">Sign out everywhere</button><button class="ab ab-edit" onclick="AdminSecondary.resetSetup(\'' + E(s.matric) + '\')">Reset exam setup</button><button class="ab ab-del" onclick="AdminSecondary.clearPapers(\'' + E(s.matric) + '\')">Clear all papers</button></div>' +
      '<div style="margin-top:14px"><button class="btn-cancel" onclick="AdminUI.closeModal()">Close</button></div>', true);
  }
  async function oneS(m, action) { var r = await api('POST', '/api/admin/secondary/students/bulk', { action: action, matrics: [m] }); if (r.ok) { U.closeModal(); toast('Done'); studentsTab(); } else fail(r); }
  async function resetSetup(m) { if (!confirm('Reset ' + m + '’s exam setup? They will choose their exam and subjects again. Their papers are kept.')) return; var r = await api('POST', '/api/admin/secondary/students/' + encodeURIComponent(m) + '/reset-setup'); if (r.ok) { toast('Setup reset'); studentDetail(m); } else fail(r); }
  async function clearPapers(m) { if (!confirm('Delete ALL of ' + m + '’s Secondary papers? This cannot be undone.')) return; var r = await api('DELETE', '/api/admin/secondary/students/' + encodeURIComponent(m) + '/papers'); if (r.ok) { toast('Deleted ' + r.data.deleted + ' paper(s)'); studentDetail(m); } else fail(r); }

  // ══ PAPERS ═════════════════════════════════════════════════
  async function papersTab(page) {
    if (page) ppState.page = page; var keep = ppState.f || {};
    body().innerHTML = '<div class="xbar"><select class="f-input" id="pp-exam">' + examOpts(keep.exam, 'Any exam') + '</select><select class="f-input" id="pp-kind">' + opt([{ v: 'mock', l: 'Mock' }, { v: 'practice', l: 'Practice' }], keep.kind, 'Any kind') + '</select><input class="f-input" id="pp-matric" placeholder="Matric" style="width:130px" value="' + E(keep.matric || '') + '"><input class="f-input" id="pp-min" placeholder="Min %" style="width:80px" value="' + E(keep.minPct || '') + '"><input class="f-input" id="pp-max" placeholder="Max %" style="width:80px" value="' + E(keep.maxPct || '') + '"><button class="btn-main" style="width:auto;padding:9px 16px;font-size:13px" onclick="AdminSecondary.applyP()">Filter</button><button class="ab ab-gray" onclick="AdminSecondary.exportCsv(\'papers\')">Export CSV</button></div>' +
      '<div class="tw"><div class="tbl-wrap"><table><thead><tr><th>When</th><th>Student</th><th>Paper</th><th>Result</th><th>Subjects</th><th></th></tr></thead><tbody id="pp-rows"><tr class="empty-row"><td colspan="6">Loading…</td></tr></tbody></table></div><div id="pp-pg"></div></div>';
    ppState.f = keep;
    var r = await api('GET', '/api/admin/secondary/papers?' + U.qs(Object.assign({}, keep, { page: ppState.page, limit: 25 }))); if (!r.ok) return fail(r);
    document.getElementById('pp-rows').innerHTML = r.data.rows.length ? r.data.rows.map(function (x) { return '<tr><td class="xmut">' + U.ago(x.ts) + '</td><td><b>' + E(x.name || x.matric) + '</b><div class="xmut">' + E(x.matric) + '</div></td><td>' + E(EXAMS[x.exam] || x.exam) + ' ' + badge(x.kind, 'b-gray') + (x.year ? ' ' + x.year : '') + '</td><td><b>' + (x.utme ? x.utme + '/400' : Math.round(x.pct) + '%') + '</b> <span class="xmut">' + x.correct + '/' + x.total + '</span></td><td class="xmut" style="max-width:220px">' + E(x.subjects) + '</td><td><button class="ab ab-del" onclick="AdminSecondary.delPaper(\'' + x.id + '\')">Delete</button></td></tr>'; }).join('') : '<tr class="empty-row"><td colspan="6">No papers match</td></tr>';
    document.getElementById('pp-pg').innerHTML = U.pager({ page: r.data.page, pages: r.data.pages, total: r.data.total }, 'AdminSecondary.papersTab');
  }
  function applyP() { ppState.f = { exam: val('pp-exam'), kind: val('pp-kind'), matric: val('pp-matric'), minPct: val('pp-min'), maxPct: val('pp-max') }; ppState.page = 1; papersTab(); }
  async function delPaper(id) { if (!confirm('Delete this paper result?')) return; var r = await api('DELETE', '/api/admin/secondary/papers/' + id); if (r.ok) { toast('Deleted'); papersTab(); } else fail(r); }

  // ══ SETTINGS ═══════════════════════════════════════════════
  var sw = function (id, title, hint, on) { return '<label class="xsw"><div><b>' + E(title) + '</b><small>' + E(hint) + '</small></div><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '></label>'; };
  async function settingsTab() {
    var r = await api('GET', '/api/admin/secondary/config'); if (!r.ok) return fail(r);
    var c = r.data.config, b = r.data.builtIn, num = function (id, v, ph) { return '<input class="f-input" id="' + id + '" inputmode="numeric" value="' + (v === null || v === undefined ? '' : v) + '" placeholder="' + E(ph) + '">'; };
    var shape = function (k) {
      var o = c.papers[k] || {}, d = b[k];
      if (k === 'jamb') return '<div class="xcard"><h3>JAMB UTME</h3><div class="xs">Four subjects. Blank = built-in default shown in grey.</div><div class="xrow3"><div class="xf"><span>Minutes (full)</span>' + num('p-jamb-minutes', o.minutes, d.minutes) + '</div><div class="xf"><span>English questions</span>' + num('p-jamb-firstSubjectQs', o.firstSubjectQs, d.firstSubjectQs) + '</div><div class="xf"><span>Other subjects</span>' + num('p-jamb-otherSubjectQs', o.otherSubjectQs, d.otherSubjectQs) + '</div></div><div class="xrow3"><div class="xf"><span>Mini: minutes</span>' + num('p-jamb-miniMinutes', o.miniMinutes, d.mini.minutes) + '</div><div class="xf"><span>Mini: English Qs</span>' + num('p-jamb-miniFirstQs', o.miniFirstQs, d.mini.first) + '</div><div class="xf"><span>Mini: others</span>' + num('p-jamb-miniOtherQs', o.miniOtherQs, d.mini.other) + '</div></div></div>';
      return '<div class="xcard"><h3>' + EXAMS[k] + '</h3><div class="xrow2"><div class="xf"><span>Minutes</span>' + num('p-' + k + '-minutes', o.minutes, d.minutes) + '</div><div class="xf"><span>Questions</span>' + num('p-' + k + '-questions', o.questions, d.questions) + '</div></div><div class="xrow2"><div class="xf"><span>Mini: minutes</span>' + num('p-' + k + '-miniMinutes', o.miniMinutes, d.mini.minutes) + '</div><div class="xf"><span>Mini: questions</span>' + num('p-' + k + '-miniQuestions', o.miniQuestions, d.mini.questions) + '</div></div></div>';
    };
    body().innerHTML = '<div class="xgrid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))"><div class="xcard"><h3>Access</h3><div class="xs">Takes effect within seconds, no redeploy.</div>' +
      sw('c-enabled', 'Wreddi Secondary is on', 'Off = every Secondary screen shows “paused”. University is unaffected.', c.enabled) + sw('c-signups', 'Open for new sign-ups', 'Off = nobody can create a Secondary account.', c.signupsOpen) +
      '<div style="margin:12px 0 4px;font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase">Exams available</div>' + Object.keys(EXAMS).map(function (k) { return sw('c-ex-' + k, EXAMS[k] + ' papers', 'Students cannot start ' + EXAMS[k] + ' papers when off.', c.exams[k] !== false); }).join('') + '</div>' +
      '<div class="xcard"><h3>Limits &amp; notice</h3><div class="xs">Practice size, daily mock cap for Free accounts, and a note on the Secondary home.</div><div class="xrow2"><div class="xf"><span>Max practice questions</span>' + num('c-maxprac', c.maxPracticeCount, '50') + '</div><div class="xf"><span>Free: mock papers / day</span>' + num('c-freemock', c.freeDailyMocks, 'Unlimited') + '</div></div><div class="xf"><span>Notice shown to Secondary students</span><textarea class="f-input" id="c-motd" maxlength="300" placeholder="e.g. JAMB 2027 registration closes soon. Keep practising!">' + E(c.motd) + '</textarea></div></div></div>' +
      '<h3 style="margin:6px 0 10px;font:800 15px var(--ff-h,inherit)">Paper sizes</h3><div class="xgrid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">' + ['jamb', 'waec', 'neco', 'school'].map(shape).join('') + '</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px"><button class="btn-main" style="width:auto;padding:10px 22px;font-size:14px" onclick="AdminSecondary.saveConfig()">Save settings</button></div>';
  }
  async function saveConfig() {
    var n = function (id) { var v = val(id).trim(); return v === '' ? null : v; };
    var papers = {};
    ['jamb', 'waec', 'neco', 'school'].forEach(function (k) {
      var f = k === 'jamb' ? ['minutes', 'firstSubjectQs', 'otherSubjectQs', 'miniMinutes', 'miniFirstQs', 'miniOtherQs'] : ['minutes', 'questions', 'miniMinutes', 'miniQuestions'];
      papers[k] = {}; f.forEach(function (x) { papers[k][x] = n('p-' + k + '-' + x); });
    });
    var body_ = { secondary: { enabled: chk('c-enabled'), signupsOpen: chk('c-signups'), exams: { jamb: chk('c-ex-jamb'), waec: chk('c-ex-waec'), neco: chk('c-ex-neco'), school: chk('c-ex-school') }, motd: val('c-motd'), maxPracticeCount: n('c-maxprac') === null ? 50 : n('c-maxprac'), freeDailyMocks: n('c-freemock'), papers: papers } };
    if (!body_.secondary.enabled && !confirm('Switch Wreddi Secondary OFF? Every Secondary student will see it as paused.')) return;
    var r = await api('PUT', '/api/admin/secondary/config', body_); if (r.ok) toast('Saved — live now'); else fail(r);
  }

  function exportCsv(what) { downloadCsv('/api/admin/secondary/export/' + what + (what === 'questions' ? '?' + U.qs(qState.f || {}) : ''), 'secondary-' + what + '.csv'); }

  window.AdminSecondary = {
    open: open, show: show, announce: announce, sendAnnounce: sendAnnounce,
    subjectForm: subjectForm, saveSubject: saveSubject, toggleSubject: toggleSubject, deleteSubject: deleteSubject,
    questionsTab: questionsTab, applyQ: applyQ, pickAllQ: pickAllQ, pickQ: pickQ, bulkTag: bulkTag, runBulkTag: runBulkTag, bulkDelete: bulkDelete, delQ: delQ, questionForm: questionForm, saveQ: saveQ, coverage: coverage, importForm: importForm, runImport: runImport,
    studentsTab: studentsTab, applyS: applyS, pickAllS: pickAllS, sBar: sBar, bulkS: bulkS, notifyS: notifyS, sendNotifyS: sendNotifyS, studentDetail: studentDetail, oneS: oneS, resetSetup: resetSetup, clearPapers: clearPapers,
    papersTab: papersTab, applyP: applyP, delPaper: delPaper, saveConfig: saveConfig, exportCsv: exportCsv,
    _toItems: toItems,
  };
})();
