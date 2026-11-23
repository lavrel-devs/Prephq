'use strict';
// v1.14 — Secondary control centre (admin). Everything an admin needs to run Wreddi Secondary end to end:
// subjects, the question bank, students, papers, live settings and exports. Mounted on /api/admin; permission area 'secondary'
// (see utils/adminAccess.js). Student-facing behaviour is in routes/secondary.routes.js and reads the same settings.
const express = require('express');
const Course = require('../../models/Course');
const Question = require('../../models/Question');
const Student = require('../../models/Student');
const Score = require('../../models/Score');
const QuestionAttempt = require('../../models/QuestionAttempt');
const Session = require('../../models/Session');
const Notification = require('../../models/Notification');
const S = require('../../utils/secondary');
const cfgSvc = require('../../services/platformConfig.service');
const { planBulk, dupeKey, invalidateCounts } = require('../../services/questionBank.service');
const { escapeRegex, isObjectId } = require('../../utils/validate');
const { logActivity } = require('../../services/activity.service');

const router = express.Router();
const SECONDARY = { track: 'secondary' };
const keyOf = code => String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const who = req => (req.admin && req.admin.sub) || '';
const audit = (req, action, detail) => { try { logActivity({ source: 'admin', actorType: 'admin', actor: who(req), action, detail, ip: req.ip, status: 200 }); } catch (e) {} };
const page = (req, def = 25, max = 100) => { const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || def, max)); const p = Math.max(1, parseInt(req.query.page, 10) || 1); return { limit, skip: (p - 1) * limit, page: p }; };
const dayAgo = d => new Date(Date.now() - d * 86400000);
const csvCell = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const sendCsv = (res, name, header, rows) => { res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` }); res.send([header.join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\n')); };
const secStudentFilter = { track: 'secondary' };

// ══ OVERVIEW ═════════════════════════════════════════════════
router.get('/secondary/overview', async (req, res) => {
  try {
    const [total, active7, new7, new30, suspended, setUp, byExam, byClass, byTier, papersByExam, trend, utmeBands, gradeRows, subjAgg, courses, qCounts, top] = await Promise.all([
      Student.countDocuments(secStudentFilter),
      Student.countDocuments({ ...secStudentFilter, lastActiveAt: { $gte: dayAgo(7) } }),
      Student.countDocuments({ ...secStudentFilter, createdAt: { $gte: dayAgo(7) } }),
      Student.countDocuments({ ...secStudentFilter, createdAt: { $gte: dayAgo(30) } }),
      Student.countDocuments({ ...secStudentFilter, active: false }),
      Student.countDocuments({ ...secStudentFilter, 'secondary.exam': { $in: S.EXAM_KEYS } }),
      Student.aggregate([{ $match: secStudentFilter }, { $group: { _id: '$secondary.exam', n: { $sum: 1 } } }]),
      Student.aggregate([{ $match: { ...secStudentFilter, 'secondary.classLevel': { $ne: '' } } }, { $group: { _id: '$secondary.classLevel', n: { $sum: 1 } } }]),
      Student.aggregate([{ $match: secStudentFilter }, { $group: { _id: '$tier', n: { $sum: 1 } } }]),
      Score.aggregate([{ $match: { sec: { $exists: true } } }, { $group: { _id: '$sec.exam', papers: { $sum: 1 }, avg: { $avg: '$pct' } } }]),
      Score.aggregate([{ $match: { sec: { $exists: true }, ts: { $gte: dayAgo(14) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      Score.aggregate([{ $match: { 'sec.exam': 'jamb', 'sec.utme': { $gt: 0 } } }, { $bucket: { groupBy: '$sec.utme', boundaries: [0, 150, 200, 250, 300, 401], default: 'other', output: { n: { $sum: 1 } } } }]),
      Score.aggregate([{ $match: { 'sec.exam': { $in: ['waec', 'neco'] } } }, { $unwind: '$sec.rows' }, { $group: { _id: '$sec.rows.grade', n: { $sum: 1 } } }]),
      Score.aggregate([{ $match: { sec: { $exists: true } } }, { $unwind: '$sec.rows' }, { $group: { _id: '$sec.rows.course', correct: { $sum: '$sec.rows.correct' }, total: { $sum: '$sec.rows.total' }, papers: { $sum: 1 } } }]),
      Course.find(SECONDARY).select('courseCode courseTitle key disabled').lean(),
      Question.aggregate([{ $group: { _id: '$course', n: { $sum: 1 } } }]),
      Score.aggregate([{ $match: { 'sec.exam': 'jamb', 'sec.kind': 'mock', 'sec.utme': { $gt: 0 } } }, { $group: { _id: '$matric', best: { $max: '$sec.utme' }, papers: { $sum: 1 } } }, { $sort: { best: -1 } }, { $limit: 10 }]),
    ]);
    const nBy = new Map(qCounts.map(r => [String(r._id).toLowerCase().replace(/[^a-z0-9]/g, ''), r.n]));
    const perf = new Map(subjAgg.map(r => [String(r._id), r]));
    const subjects = courses.map(c => { const p = perf.get(c.key); return { key: c.key, code: c.courseCode, title: c.courseTitle, disabled: !!c.disabled, questions: nBy.get(c.key) || 0, papers: p ? p.papers : 0, accuracy: p && p.total ? Math.round((p.correct / p.total) * 100) : null }; });
    const names = await Student.find({ matric: { $in: top.map(t => t._id) } }).select('matric name').lean();
    const nm = new Map(names.map(s => [s.matric, s.name]));
    const grade = Object.fromEntries(gradeRows.map(r => [r._id, r.n]));
    res.json({
      totals: { total, active7, new7, new30, suspended, setUp, notSetUp: total - setUp },
      byExam: Object.fromEntries(byExam.map(r => [r._id || 'none', r.n])), byClass: Object.fromEntries(byClass.map(r => [r._id, r.n])), byTier: Object.fromEntries(byTier.map(r => [r._id || 'free', r.n])),
      papers: { byExam: Object.fromEntries(papersByExam.map(r => [r._id || 'unknown', { papers: r.papers, avg: Math.round(r.avg || 0) }])), trend: trend.map(r => ({ day: r._id, n: r.n })) },
      utmeBands: utmeBands.map(b => ({ from: b._id, n: b.n })), grades: grade,
      credits: { passRate: (() => { const t = Object.values(grade).reduce((a, b) => a + b, 0); const c = ['A1', 'B2', 'B3', 'C4', 'C5', 'C6'].reduce((a, g) => a + (grade[g] || 0), 0); return t ? Math.round((c / t) * 100) : null; })() },
      subjects, lowCoverage: subjects.filter(s => !s.disabled && s.questions < 30).map(s => s.title),
      top: top.map(t => ({ matric: t._id, name: nm.get(t._id) || '', best: t.best, papers: t.papers })),
    });
  } catch (e) { console.error('[admin secondary overview]', e); res.status(500).json({ error: e.message }); }
});

// ══ SUBJECTS ═════════════════════════════════════════════════
const cleanTopics = t => (Array.isArray(t) ? t : String(t || '').split(',')).map(x => String(x).trim()).filter(Boolean).slice(0, 80);
const cleanExams = e => (Array.isArray(e) ? e : []).filter(x => S.EXAM_KEYS.includes(x));

router.get('/secondary/subjects', async (req, res) => {
  try {
    const [courses, qRows, studs, attempts] = await Promise.all([
      Course.find(SECONDARY).sort({ courseTitle: 1 }).lean(),
      Question.aggregate([{ $group: { _id: { course: '$course', exam: '$exam' }, n: { $sum: 1 } } }]),
      Student.aggregate([{ $match: secStudentFilter }, { $unwind: '$secondary.subjects' }, { $group: { _id: '$secondary.subjects', n: { $sum: 1 } } }]),
      QuestionAttempt.aggregate([{ $match: { course: { $exists: true } } }, { $group: { _id: '$course', n: { $sum: 1 }, ok: { $sum: { $cond: ['$correct', 1, 0] } } } }]),
    ]);
    const q = new Map(); for (const r of qRows) { const k = keyOf(r._id.course); const o = q.get(k) || { total: 0, byExam: {} }; o.total += r.n; o.byExam[r._id.exam || 'any'] = (o.byExam[r._id.exam || 'any'] || 0) + r.n; q.set(k, o); }
    const st = new Map(studs.map(r => [r._id, r.n])), at = new Map(attempts.map(r => [keyOf(r._id), r]));
    res.json(courses.map(c => {
      const m = S.SUBJECTS.find(s => s.code === c.courseCode); const a = at.get(c.key); const qq = q.get(c.key) || { total: 0, byExam: {} };
      return { id: String(c._id), key: c.key, code: c.courseCode, title: c.courseTitle, color: c.color, icon: c.icon, topics: c.topics || [], disabled: !!c.disabled,
        exams: (c.exams && c.exams.length) ? c.exams : (m ? m.exams : S.EXAM_KEYS), customExams: !!(c.exams && c.exams.length), core: !!(m && m.core), builtIn: !!m,
        questions: qq.total, questionsByExam: qq.byExam, students: st.get(c.key) || 0, attempts: a ? a.n : 0, accuracy: a && a.n ? Math.round((a.ok / a.n) * 100) : null };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/secondary/subjects', async (req, res) => {
  try {
    const { code, title, color, icon, topics, exams } = req.body || {};
    if (typeof code !== 'string' || typeof title !== 'string' || !code.trim() || !title.trim()) return res.status(400).json({ error: 'Subject code and title are required' });
    const courseCode = code.toUpperCase().trim().slice(0, 20); const key = keyOf(courseCode);
    if (!key) return res.status(400).json({ error: 'That code has no letters or numbers' });
    if (await Course.findOne({ $or: [{ courseCode }, { key }] })) return res.status(409).json({ error: 'That subject code already exists' });
    const c = await Course.create({ courseCode, key, courseTitle: title.trim().slice(0, 80), department: 'Secondary', level: 'SS', topics: cleanTopics(topics), color: /^#[0-9a-f]{6}$/i.test(color) ? color : '#3E5C8A', icon: typeof icon === 'string' && icon ? icon.slice(0, 20) : 'star', track: 'secondary', exams: cleanExams(exams) });
    audit(req, 'secondary.subject.create', courseCode); invalidateCounts();
    res.status(201).json({ id: String(c._id), key: c.key });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/secondary/subjects/:id', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Subject not found' });
    const c = await Course.findOne({ _id: req.params.id, ...SECONDARY }); if (!c) return res.status(404).json({ error: 'Subject not found' });
    const b = req.body || {}; const set = {};
    if (typeof b.title === 'string' && b.title.trim()) set.courseTitle = b.title.trim().slice(0, 80);
    if (b.topics !== undefined) set.topics = cleanTopics(b.topics);
    if (typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color)) set.color = b.color;
    if (typeof b.icon === 'string' && b.icon) set.icon = b.icon.slice(0, 20);
    if (typeof b.disabled === 'boolean') set.disabled = b.disabled;
    if (b.exams !== undefined) set.exams = cleanExams(b.exams);
    await Course.updateOne({ _id: c._id }, { $set: set });
    audit(req, 'secondary.subject.update', `${c.courseCode} ${Object.keys(set).join(',')}`); invalidateCounts();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Deleting a subject that students or questions still use needs ?force=1; ?questions=1 also deletes its questions.
router.delete('/secondary/subjects/:id', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Subject not found' });
    const c = await Course.findOne({ _id: req.params.id, ...SECONDARY }); if (!c) return res.status(404).json({ error: 'Subject not found' });
    const [qn, sn] = await Promise.all([Question.countDocuments({ course: { $in: [c.key, c.courseCode] } }), Student.countDocuments({ ...secStudentFilter, 'secondary.subjects': c.key })]);
    if ((qn || sn) && req.query.force !== '1') return res.status(409).json({ error: `${c.courseTitle} has ${qn} question(s) and ${sn} student(s). Hide it instead, or confirm to delete.`, questions: qn, students: sn, code: 'IN_USE' });
    let deletedQ = 0;
    if (req.query.questions === '1') deletedQ = (await Question.deleteMany({ course: { $in: [c.key, c.courseCode] } })).deletedCount;
    if (sn) await Student.updateMany({ ...secStudentFilter, 'secondary.subjects': c.key }, { $pull: { 'secondary.subjects': c.key } });
    await Course.deleteOne({ _id: c._id });
    audit(req, 'secondary.subject.delete', `${c.courseCode} questions=${deletedQ} students=${sn}`); invalidateCounts();
    res.json({ success: true, deletedQuestions: deletedQ, studentsUpdated: sn });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══ QUESTION BANK ════════════════════════════════════════════
async function courseKeys(courseParam) {
  const k = keyOf(courseParam); const c = await Course.findOne({ key: k, ...SECONDARY }).lean();
  return c ? [c.key, c.courseCode] : null;
}
async function qFilter(src) {
  const f = {};
  const secKeys = (await Course.find(SECONDARY).select('key courseCode').lean()).flatMap(c => [c.key, c.courseCode]);
  f.course = { $in: secKeys };
  if (src.course) { const ks = await courseKeys(src.course); f.course = { $in: ks || ['__none__'] }; }
  if (S.EXAM_KEYS.includes(src.exam)) f.exam = src.exam; else if (src.exam === 'untagged') f.exam = '';
  if (src.year === 'none') f.year = null; else if (Number.parseInt(src.year, 10)) f.year = Number.parseInt(src.year, 10);
  if (S.CLASS_LEVELS.includes(src.classLevel)) f.classLevel = src.classLevel;
  if (src.tag) f.tag = { $regex: new RegExp(escapeRegex(String(src.tag).slice(0, 80)), 'i') };
  if (src.q) f.q = { $regex: new RegExp(escapeRegex(String(src.q).slice(0, 100)), 'i') };
  if (src.batch) f.batchId = String(src.batch).slice(0, 40);
  return f;
}
const qMeta = b => {
  const o = {};
  if ('exam' in b) { if (b.exam && !S.EXAM_KEYS.includes(b.exam)) throw new Error('Unknown exam'); o.exam = b.exam || ''; }
  if ('year' in b) { const y = b.year === '' || b.year === null ? null : Number.parseInt(b.year, 10); if (y !== null && (!Number.isInteger(y) || y < 1980 || y > new Date().getFullYear() + 1)) throw new Error('Year looks wrong'); o.year = y; }
  if ('classLevel' in b) { if (b.classLevel && !S.CLASS_LEVELS.includes(b.classLevel)) throw new Error('Unknown class level'); o.classLevel = b.classLevel || ''; }
  return o;
};

router.get('/secondary/questions', async (req, res) => {
  try {
    const f = await qFilter(req.query), pg = page(req, 25, 100);
    const sortKey = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, year: { year: -1, createdAt: -1 } }[req.query.sort] || { createdAt: -1 };
    const [rows, total] = await Promise.all([Question.find(f).sort(sortKey).skip(pg.skip).limit(pg.limit).lean(), Question.countDocuments(f)]);
    res.json({ total, page: pg.page, pages: Math.max(1, Math.ceil(total / pg.limit)), rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Subject × exam grid so the admin can see at a glance where the bank is thin.
router.get('/secondary/coverage', async (req, res) => {
  try {
    const courses = await Course.find(SECONDARY).sort({ courseTitle: 1 }).select('key courseCode courseTitle disabled').lean();
    const rows = await Question.aggregate([{ $group: { _id: { course: '$course', exam: '$exam' }, n: { $sum: 1 }, noYear: { $sum: { $cond: [{ $eq: ['$year', null] }, 1, 0] } } } }]);
    const m = new Map();
    for (const r of rows) { const k = keyOf(r._id.course); const o = m.get(k) || { total: 0, noYear: 0, ex: {} }; o.total += r.n; o.noYear += r.noYear; o.ex[r._id.exam || 'any'] = (o.ex[r._id.exam || 'any'] || 0) + r.n; m.set(k, o); }
    res.json({ exams: ['any', ...S.EXAM_KEYS], rows: courses.map(c => { const o = m.get(c.key) || { total: 0, noYear: 0, ex: {} }; return { key: c.key, code: c.courseCode, title: c.courseTitle, disabled: !!c.disabled, total: o.total, noYear: o.noYear, byExam: o.ex }; }) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/secondary/questions', async (req, res) => {
  try {
    const { course, q, opts, ans, tag, exp } = req.body || {};
    const ks = typeof course === 'string' ? await courseKeys(course) : null;
    if (!ks) return res.status(400).json({ error: 'Pick one of the Secondary subjects' });
    if (typeof q !== 'string' || !q.trim() || !Array.isArray(opts) || opts.length < 2 || opts.length > 6 || opts.some(o => typeof o !== 'string' || !o.trim())) return res.status(400).json({ error: 'A question needs text and 2–6 non-empty options' });
    const a = Number.parseInt(ans, 10); if (!Number.isInteger(a) || a < 0 || a >= opts.length) return res.status(400).json({ error: 'The correct answer must be one of the options' });
    const doc = await Question.create({ course: ks[0], q: q.trim(), opts: opts.map(o => o.trim()), ans: a, tag: String(tag || '').trim().slice(0, 80), exp: String(exp || '').trim().slice(0, 1500), createdBy: who(req), ...qMeta(req.body) });
    invalidateCounts(); res.status(201).json(doc);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/secondary/questions/:id', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Question not found' });
    const ex = await Question.findById(req.params.id); if (!ex) return res.status(404).json({ error: 'Question not found' });
    const b = req.body || {};
    if (b.q !== undefined) { if (typeof b.q !== 'string' || !b.q.trim()) return res.status(400).json({ error: 'Question text cannot be empty' }); ex.q = b.q.trim(); }
    if (b.opts !== undefined) { if (!Array.isArray(b.opts) || b.opts.length < 2 || b.opts.length > 6 || b.opts.some(o => typeof o !== 'string' || !o.trim())) return res.status(400).json({ error: 'Options must be 2–6 non-empty texts' }); ex.opts = b.opts.map(o => o.trim()); }
    if (b.ans !== undefined) ex.ans = Number.parseInt(b.ans, 10);
    if (!Number.isInteger(ex.ans) || ex.ans < 0 || ex.ans >= ex.opts.length) return res.status(400).json({ error: 'The correct answer must be one of the options' });
    if (b.tag !== undefined) ex.tag = String(b.tag).trim().slice(0, 80);
    if (b.exp !== undefined) ex.exp = String(b.exp).trim().slice(0, 1500);
    Object.assign(ex, qMeta(b));
    await ex.save(); invalidateCounts(); res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/secondary/questions/:id', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Question not found' });
    await Question.deleteOne({ _id: req.params.id }); invalidateCounts(); res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk actions on a filter or an id list. dryRun (default true for deletes) only counts, so the admin sees the blast radius first.
router.post('/secondary/questions/bulk-action', async (req, res) => {
  try {
    const b = req.body || {}; const action = b.action;
    if (!['tag', 'delete'].includes(action)) return res.status(400).json({ error: 'action must be tag or delete' });
    let f;
    if (Array.isArray(b.ids) && b.ids.length) { if (b.ids.length > 1000 || !b.ids.every(isObjectId)) return res.status(400).json({ error: 'Bad id list' }); f = { ...(await qFilter({})), _id: { $in: b.ids } }; }
    else if (b.filter && typeof b.filter === 'object' && Object.keys(b.filter).some(k => b.filter[k] !== '' && b.filter[k] !== undefined)) f = await qFilter(b.filter);
    else return res.status(400).json({ error: 'Choose questions by ticking them or by setting at least one filter' });
    const matched = await Question.countDocuments(f);
    if (b.dryRun !== false) return res.json({ dryRun: true, matched });
    if (action === 'tag') {
      const set = qMeta(b.set || {}); if (!Object.keys(set).length) return res.status(400).json({ error: 'Nothing to set' });
      const r = await Question.updateMany(f, { $set: set }); audit(req, 'secondary.questions.tag', `${matched} ${JSON.stringify(set)}`); invalidateCounts();
      return res.json({ success: true, matched, modified: r.modifiedCount });
    }
    const r = await Question.deleteMany(f); audit(req, 'secondary.questions.delete', `${r.deletedCount}`); invalidateCounts();
    res.json({ success: true, matched, deleted: r.deletedCount });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Import: items [{course,q,opts,ans,tag?,exp?,exam?,year?,classLevel?}] with optional defaults {course, exam, year, classLevel}. Reuses the
// shared planBulk() so duplicate detection and validation match every other upload. dryRun previews without saving.
router.post('/secondary/questions/import', async (req, res) => {
  try {
    const b = req.body || {}; const items = b.items;
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items must be a non-empty array' });
    if (items.length > 500) return res.status(400).json({ error: 'Import at most 500 questions at a time' });
    const d = b.defaults || {}; const meta = qMeta(d);
    const secCourses = await Course.find(SECONDARY).select('key').lean(); const keys = new Set(secCourses.map(c => c.key));
    const merged = items.map(i => ({ ...(d.course ? { course: d.course } : {}), ...meta, ...i }));
    const existing = await Question.find({ course: { $in: [...keys] } }).select('course q').lean();
    const existingKeys = new Set(existing.map(e => dupeKey(keyOf(e.course), e.q)));
    const { accepted, rejected } = planBulk(merged, keys, existingKeys);
    if (b.dryRun) return res.json({ dryRun: true, wouldAdd: accepted.length, rejected, total: items.length });
    const batchId = `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    if (accepted.length) await Question.insertMany(accepted.map(a => ({ ...a, createdBy: who(req), batchId })), { ordered: false });
    audit(req, 'secondary.questions.import', `${accepted.length} added, ${rejected.length} rejected`); invalidateCounts();
    res.status(201).json({ batchId: accepted.length ? batchId : null, added: accepted.length, rejected, total: items.length });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ══ STUDENTS ═════════════════════════════════════════════════
router.get('/secondary/students', async (req, res) => {
  try {
    const f = { ...secStudentFilter }; const pg = page(req, 25, 100); const q = req.query;
    if (S.EXAM_KEYS.includes(q.exam)) f['secondary.exam'] = q.exam; else if (q.exam === 'none') f['secondary.exam'] = { $in: ['', null] };
    if (S.CLASS_LEVELS.includes(q.classLevel)) f['secondary.classLevel'] = q.classLevel;
    if (q.tier === 'free' || q.tier === 'premium') f.tier = q.tier === 'free' ? { $ne: 'premium' } : 'premium';
    if (q.status === 'suspended') f.active = false; else if (q.status === 'active') f.active = { $ne: false };
    if (q.search) { const rx = new RegExp(escapeRegex(String(q.search).slice(0, 60)), 'i'); f.$or = [{ name: rx }, { matric: rx }, { username: rx }, { 'secondary.school': rx }]; }
    const sort = { recent: { lastActiveAt: -1 }, newest: { createdAt: -1 }, name: { name: 1 } }[q.sort] || { createdAt: -1 };
    const [rows, total] = await Promise.all([Student.find(f).sort(sort).skip(pg.skip).limit(pg.limit).select('matric name username active tier credits createdAt lastActiveAt secondary').lean(), Student.countDocuments(f)]);
    const stats = await Score.aggregate([{ $match: { matric: { $in: rows.map(r => r.matric) }, sec: { $exists: true } } }, { $group: { _id: '$matric', papers: { $sum: 1 }, best: { $max: '$sec.utme' }, avg: { $avg: '$pct' }, last: { $max: '$ts' } } }]);
    const sm = new Map(stats.map(s => [s._id, s]));
    res.json({ total, page: pg.page, pages: Math.max(1, Math.ceil(total / pg.limit)), rows: rows.map(r => { const s = sm.get(r.matric); const p = r.secondary || {}; return { matric: r.matric, name: r.name, username: r.username || '', active: r.active !== false, tier: r.tier || 'free', credits: r.credits || 0, createdAt: r.createdAt, lastActiveAt: r.lastActiveAt || null, exam: p.exam || '', classLevel: p.classLevel || '', school: p.school || '', subjects: (p.subjects || []).length, papers: s ? s.papers : 0, bestUtme: s && s.best ? s.best : null, avg: s ? Math.round(s.avg || 0) : null, lastPaper: s ? s.last : null }; }) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/secondary/students/:matric', async (req, res) => {
  try {
    const st = await Student.findOne({ matric: String(req.params.matric).toUpperCase(), ...secStudentFilter }).select('-password -passwordHash').lean();
    if (!st) return res.status(404).json({ error: 'Secondary student not found' });
    const [papers, perSubject, sessions] = await Promise.all([
      Score.find({ matric: st.matric, sec: { $exists: true } }).sort({ ts: -1 }).limit(20).lean(),
      QuestionAttempt.aggregate([{ $match: { matric: st.matric } }, { $group: { _id: '$course', n: { $sum: 1 }, ok: { $sum: { $cond: ['$correct', 1, 0] } } } }, { $sort: { n: -1 } }, { $limit: 20 }]),
      Session.countDocuments({ subjectId: st.matric, role: 'student', revoked: false, expiresAt: { $gt: new Date() } }),
    ]);
    res.json({ student: st, openSessions: sessions, papers: papers.map(p => ({ id: String(p._id), ts: p.ts, pct: p.pct, exam: p.sec.exam, kind: p.sec.kind, year: p.sec.year || null, utme: p.sec.utme || null, rows: p.sec.rows || [] })), perSubject: perSubject.map(r => ({ course: r._id, attempts: r.n, accuracy: Math.round((r.ok / r.n) * 100) })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/secondary/students/:matric/reset-setup', async (req, res) => {
  try {
    const r = await Student.updateOne({ matric: String(req.params.matric).toUpperCase(), ...secStudentFilter }, { $unset: { secondary: '' } });
    if (!r.matchedCount) return res.status(404).json({ error: 'Secondary student not found' });
    audit(req, 'secondary.student.reset-setup', req.params.matric); res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/secondary/students/:matric/papers', async (req, res) => {
  try {
    const m = String(req.params.matric).toUpperCase();
    if (!(await Student.exists({ matric: m, ...secStudentFilter }))) return res.status(404).json({ error: 'Secondary student not found' });
    const r = await Score.deleteMany({ matric: m, sec: { $exists: true } });
    audit(req, 'secondary.student.clear-papers', `${m} ${r.deletedCount}`); res.json({ success: true, deleted: r.deletedCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk account actions for Secondary students only (max 200 at a time). Credits and plans stay in their own admin areas.
router.post('/secondary/students/bulk', async (req, res) => {
  try {
    const { action, matrics } = req.body || {};
    if (!['suspend', 'activate', 'signout', 'notify'].includes(action)) return res.status(400).json({ error: 'Unknown action' });
    if (!Array.isArray(matrics) || !matrics.length || matrics.length > 200) return res.status(400).json({ error: 'Choose 1–200 students' });
    const ms = matrics.map(m => String(m).toUpperCase());
    const valid = (await Student.find({ matric: { $in: ms }, ...secStudentFilter }).select('matric').lean()).map(s => s.matric);
    if (!valid.length) return res.status(404).json({ error: 'None of those are Secondary students' });
    if (action === 'suspend' || action === 'activate') await Student.updateMany({ matric: { $in: valid } }, { $set: { active: action === 'activate' } });
    if (action === 'suspend' || action === 'signout') await Session.updateMany({ subjectId: { $in: valid }, role: 'student', revoked: false }, { $set: { revoked: true, revokedAt: new Date() } });
    if (action === 'notify') {
      const title = String((req.body.title || '')).trim().slice(0, 120), message = String(req.body.message || '').trim().slice(0, 1000);
      if (!title || !message) return res.status(400).json({ error: 'Write a title and a message' });
      await Notification.insertMany(valid.map(matric => ({ matric, type: 'announcement', title, message })), { ordered: false });
    }
    audit(req, `secondary.students.${action}`, `${valid.length}`); res.json({ success: true, affected: valid.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Broadcast to EVERY Secondary student (active accounts only). Shows in their notification feed.
router.post('/secondary/announce', async (req, res) => {
  try {
    const title = String((req.body && req.body.title) || '').trim().slice(0, 120), message = String((req.body && req.body.message) || '').trim().slice(0, 1000);
    if (!title || !message) return res.status(400).json({ error: 'Write a title and a message' });
    const exam = req.body && S.EXAM_KEYS.includes(req.body.exam) ? req.body.exam : '';
    const f = { ...secStudentFilter, active: { $ne: false } }; if (exam) f['secondary.exam'] = exam;
    const targets = await Student.find(f).select('matric').lean();
    if (targets.length) await Notification.insertMany(targets.map(t => ({ matric: t.matric, type: 'announcement', title, message })), { ordered: false });
    audit(req, 'secondary.announce', `${targets.length} ${exam || 'all'}`); res.status(201).json({ sentTo: targets.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══ PAPERS ═══════════════════════════════════════════════════
router.get('/secondary/papers', async (req, res) => {
  try {
    const f = { sec: { $exists: true } }; const pg = page(req, 25, 100); const q = req.query;
    if (S.EXAM_KEYS.includes(q.exam)) f['sec.exam'] = q.exam;
    if (q.kind === 'mock' || q.kind === 'practice') f['sec.kind'] = q.kind;
    if (q.matric) f.matric = String(q.matric).toUpperCase();
    if (q.maxPct !== undefined && q.maxPct !== '') f.pct = { ...(f.pct || {}), $lte: Number(q.maxPct) };
    if (q.minPct !== undefined && q.minPct !== '') f.pct = { ...(f.pct || {}), $gte: Number(q.minPct) };
    const [rows, total] = await Promise.all([Score.find(f).sort({ ts: -1 }).skip(pg.skip).limit(pg.limit).lean(), Score.countDocuments(f)]);
    const names = await Student.find({ matric: { $in: [...new Set(rows.map(r => r.matric))] } }).select('matric name').lean(); const nm = new Map(names.map(s => [s.matric, s.name]));
    res.json({ total, page: pg.page, pages: Math.max(1, Math.ceil(total / pg.limit)), rows: rows.map(r => ({ id: String(r._id), matric: r.matric, name: nm.get(r.matric) || '', ts: r.ts, pct: r.pct, correct: r.correct, total: r.total, exam: r.sec.exam, kind: r.sec.kind, year: r.sec.year || null, utme: r.sec.utme || null, subjects: (r.sec.rows || []).map(x => x.course).join(', ') })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/secondary/papers/:id', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Paper not found' });
    const r = await Score.deleteOne({ _id: req.params.id, sec: { $exists: true } });
    if (!r.deletedCount) return res.status(404).json({ error: 'Paper not found' });
    audit(req, 'secondary.paper.delete', req.params.id); res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══ SETTINGS ═════════════════════════════════════════════════
router.get('/secondary/config', async (req, res) => {
  try { const cfg = await cfgSvc.get(true); res.json({ config: cfg.secondary, defaults: cfgSvc.DEFAULTS.secondary, builtIn: S.PAPERS }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/secondary/config', async (req, res) => {
  try {
    const next = await cfgSvc.update({ secondary: (req.body && req.body.secondary) || {} }, who(req));
    audit(req, 'secondary.config', JSON.stringify(req.body && req.body.secondary || {}).slice(0, 400)); res.json({ config: next.secondary });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ══ EXPORTS ══════════════════════════════════════════════════
router.get('/secondary/export/students', async (req, res) => {
  try {
    const rows = await Student.find(secStudentFilter).sort({ createdAt: -1 }).limit(20000).select('matric name username active tier credits createdAt lastActiveAt secondary').lean();
    sendCsv(res, 'secondary-students.csv', ['matric', 'name', 'username', 'status', 'plan', 'credits', 'exam', 'class', 'school', 'subjects', 'joined', 'last_active'],
      rows.map(r => { const p = r.secondary || {}; return [r.matric, r.name, r.username, r.active === false ? 'suspended' : 'active', r.tier || 'free', r.credits || 0, p.exam || '', p.classLevel || '', p.school || '', (p.subjects || []).join(' '), r.createdAt && r.createdAt.toISOString(), r.lastActiveAt ? r.lastActiveAt.toISOString() : '']; }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/secondary/export/papers', async (req, res) => {
  try {
    const rows = await Score.find({ sec: { $exists: true } }).sort({ ts: -1 }).limit(50000).lean();
    sendCsv(res, 'secondary-papers.csv', ['when', 'matric', 'exam', 'kind', 'year', 'percent', 'correct', 'total', 'utme', 'subjects'],
      rows.map(r => [r.ts && r.ts.toISOString(), r.matric, r.sec.exam, r.sec.kind, r.sec.year || '', r.pct, r.correct, r.total, r.sec.utme || '', (r.sec.rows || []).map(x => `${x.course}:${x.pct}`).join(' ')]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/secondary/export/questions', async (req, res) => {
  try {
    const f = await qFilter(req.query); const rows = await Question.find(f).sort({ course: 1, createdAt: 1 }).limit(50000).lean();
    sendCsv(res, 'secondary-questions.csv', ['course', 'question', 'A', 'B', 'C', 'D', 'answer', 'topic', 'exam', 'year', 'class', 'explanation'],
      rows.map(r => [r.course, r.q, r.opts[0], r.opts[1], r.opts[2] || '', r.opts[3] || '', 'ABCDEF'[r.ans], r.tag, r.exam, r.year || '', r.classLevel, r.exp]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
