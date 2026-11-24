'use strict';
// v1.15 — Command centre (admin). Four tools that give the admin more reach, each behind its own permission area:
//   bulk   Segments & bulk actions   — find a group of students and act on all of them at once (dry-run first)
//   crm    Student notes & tags      — private admin notes and tags on a student
//   data   Data & privacy            — export a collection, export one student's data, erase one student's personal data
//   access Access control            — block a network address, see and revoke a student's sessions (owner: admin sessions)
// Permission rules for every path live in utils/adminAccess.js. Every change is written to the audit trail as command.*
const express = require('express');
const net = require('net');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const Student = require('../../models/Student');
const Score = require('../../models/Score');
const CreditTransaction = require('../../models/CreditTransaction');
const Payment = require('../../models/Payment');
const Notification = require('../../models/Notification');
const SupportRequest = require('../../models/SupportRequest');
const Question = require('../../models/Question');
const Course = require('../../models/Course');
const Session = require('../../models/Session');
const AdminNote = require('../../models/AdminNote');
const Block = require('../../models/Block');
const SavedSegment = require('../../models/SavedSegment');
const BulkRun = require('../../models/BulkRun');

const { buildFilter, cleanTags } = require('../../services/segment.service');
const { cleanDoc, flat } = require('../../utils/dataExport');
const { canChange } = require('../../utils/adminAccess');
const { applyCreditDelta } = require('../../utils/credits');
const { csvRow } = require('../../utils/csv');
const { forgetSubject } = require('../../middleware/auth');
const { invalidate: invalidateBlocks, normIp } = require('../../middleware/blockGate');
const { fillDays, buildSays, DAY, TZ } = require('../../services/insights.service');
const { logActivity } = require('../../services/activity.service');

const router = express.Router();
const who = req => (req.admin && req.admin.sub) || '';
const audit = (req, action, detail) => { try { logActivity({ source: 'admin', actorType: 'admin', actor: who(req), action, detail, ip: req.ip, status: 200 }); } catch (e) {} };
const up = s => String(s || '').trim().toUpperCase();
const fail = (res, e) => { console.error('[admin command]', e); res.status(500).json({ error: e.message }); };

const MAX_APPLY = 2000;      // most students one bulk action may touch
const MAX_CREDIT_APPLY = 500; // credits are written one by one, so the cap matches the existing bulk-grant
const MAX_EXPORT_ROWS = 200000;

// ══════════════════════════════════════════════════════════════
//  0. INSIGHTS — plain-English numbers and simple charts
// ══════════════════════════════════════════════════════════════
router.get('/insights/overview', async (req, res) => {
  try {
    const now = Date.now(), nowD = new Date(now), ago = d => new Date(now - d * DAY);
    const day = f => ({ $dateToString: { format: '%Y-%m-%d', date: '$' + f, timezone: TZ } });
    const [total, dau, wau, mau, premium, expiring7, signupRows, cohortSize, cohortActive, scoreRows, hourRows, quiz30, courseRows,
           picked, takers, payRows, payWeeks, credits, grants] = await Promise.all([
      Student.countDocuments({}),
      Student.countDocuments({ lastActiveAt: { $gte: ago(1) } }),
      Student.countDocuments({ lastActiveAt: { $gte: ago(7) } }),
      Student.countDocuments({ lastActiveAt: { $gte: ago(30) } }),
      Student.countDocuments({ tier: 'premium' }),
      Student.countDocuments({ tier: 'premium', tierExpiresAt: { $gt: nowD, $lte: ago(-7) } }),
      Student.aggregate([{ $match: { createdAt: { $gte: ago(31) } } }, { $group: { _id: day('createdAt'), n: { $sum: 1 } } }]),
      Student.countDocuments({ createdAt: { $gte: ago(30), $lte: ago(7) } }),
      Student.countDocuments({ createdAt: { $gte: ago(30), $lte: ago(7) }, lastActiveAt: { $gte: ago(7) } }),
      Score.aggregate([{ $match: { ts: { $gte: ago(15) } } }, { $group: { _id: day('ts'), n: { $sum: 1 }, avg: { $avg: '$pct' } } }]),
      Score.aggregate([{ $match: { ts: { $gte: ago(30) } } }, { $group: { _id: { $hour: { date: '$ts', timezone: TZ } }, n: { $sum: 1 } } }]),
      Score.aggregate([{ $match: { ts: { $gte: ago(30) } } }, { $group: { _id: null, n: { $sum: 1 }, avg: { $avg: '$pct' }, pass: { $sum: { $cond: [{ $gte: ['$pct', 50] }, 1, 0] } } } }]),
      Score.aggregate([{ $match: { ts: { $gte: ago(90) }, topics: { $exists: true } } }, { $unwind: '$topics' },
        { $group: { _id: '$topics.course', attempts: { $sum: '$topics.total' }, correct: { $sum: '$topics.correct' }, quizzes: { $sum: 1 } } }, { $match: { _id: { $ne: null }, attempts: { $gte: 20 } } }]),
      Student.countDocuments({ 'selectedCourses.0': { $exists: true } }),
      Score.aggregate([{ $group: { _id: '$matric', n: { $sum: 1 } } }, { $group: { _id: null, one: { $sum: 1 }, five: { $sum: { $cond: [{ $gte: ['$n', 5] }, 1, 0] } } } }]),
      Payment.aggregate([{ $match: { status: 'confirmed', createdAt: { $gte: ago(60) } } }, { $group: { _id: { $cond: [{ $gte: ['$createdAt', ago(30)] }, 'cur', 'prev'] }, total: { $sum: '$amount' }, n: { $sum: 1 } } }]),
      Payment.aggregate([{ $match: { status: 'confirmed', createdAt: { $gte: ago(56) } } }, { $group: { _id: { $floor: { $divide: [{ $subtract: [nowD, '$createdAt'] }, 7 * DAY] } }, total: { $sum: '$amount' } } }]),
      Student.aggregate([{ $group: { _id: null, held: { $sum: '$credits' } } }]),
      CreditTransaction.aggregate([{ $match: { createdAt: { $gte: ago(30) } } }, { $group: { _id: { $cond: [{ $gt: ['$delta', 0] }, 'in', 'out'] }, total: { $sum: '$delta' } } }]),
    ]);

    const signups = fillDays(signupRows, 30, now);
    const signups7 = signups.slice(-7).reduce((a, x) => a + x.value, 0), signupsPrev7 = signups.slice(-14, -7).reduce((a, x) => a + x.value, 0);
    const quizzes = fillDays(scoreRows, 14, now).map(x => ({ day: x.day, value: x.value, avg: x.row ? Math.round(x.row.avg || 0) : null }));
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, value: (hourRows.find(r => r._id === h) || {}).n || 0 }));
    const peak = hours.reduce((b, x) => (x.value > b.value ? x : b), { hour: null, value: 0 });
    const q = quiz30[0] || { n: 0, avg: 0, pass: 0 };
    const courseStats = courseRows.map(c => ({ course: c._id, attempts: c.attempts, quizzes: c.quizzes, accuracy: Math.round((c.correct / c.attempts) * 100) }));
    const byAcc = [...courseStats].sort((a, b) => a.accuracy - b.accuracy);
    const rev = k => (payRows.find(r => r._id === k) || {}).total || 0;
    const weeks = Array.from({ length: 8 }, (_, i) => ({ weeksAgo: 7 - i, value: (payWeeks.find(r => r._id === 7 - i) || {}).total || 0 }));
    const tk = takers[0] || { one: 0, five: 0 };
    const funnel = { signedUp: total, picked, tried: tk.one, regular: tk.five, premium };
    const d = {
      total, dau, wau, mau, signups7, signupsPrev7, cohort: { size: cohortSize, active: cohortActive }, funnel,
      premium: { count: premium, expiring7 }, revenue: { cur: rev('cur'), prev: rev('prev') },
      quiz: { count: q.n, avg: Math.round(q.avg || 0), passRate: q.n ? Math.round((q.pass / q.n) * 100) : null },
      peakHour: peak.value ? peak.hour : null, hardest: byAcc[0] || null, easiest: byAcc.length > 1 ? byAcc[byAcc.length - 1] : null,
    };
    res.json({
      generatedAt: new Date().toISOString(), now: d, says: buildSays(d),
      signups, quizzes, hours, weeks, funnel,
      courses: { hardest: byAcc.slice(0, 5), easiest: byAcc.slice(-5).reverse(), busiest: [...courseStats].sort((a, b) => b.attempts - a.attempts).slice(0, 5) },
      money: { cur: rev('cur'), prev: rev('prev'), payments: (payRows.find(r => r._id === 'cur') || {}).n || 0 },
      credits: { held: (credits[0] || {}).held || 0, given30: (grants.find(r => r._id === 'in') || {}).total || 0, spent30: Math.abs((grants.find(r => r._id === 'out') || {}).total || 0) },
    });
  } catch (e) { fail(res, e); }
});

// ══════════════════════════════════════════════════════════════
//  1. SEGMENTS & BULK ACTIONS
// ══════════════════════════════════════════════════════════════
async function resolveFilter(q) {
  let matricIn = null;
  if (q.tag !== undefined && q.tag !== '') {
    const t = String(q.tag).toLowerCase().trim().slice(0, 24);
    matricIn = await AdminNote.distinct('matric', { tags: t });
  }
  return buildFilter(q, Date.now(), matricIn);
}

const SEG_KEYS = ['track', 'tier', 'status', 'course', 'inactiveDays', 'activeDays', 'joinedDays', 'expiringDays', 'expiredDays', 'minCredits', 'maxCredits', 'tag', 'q'];
const SEG_FIELDS = 'matric name track tier tierExpiresAt active lastActiveAt credits createdAt';

router.get('/bulk/segment', async (req, res) => {
  try {
    const { filter, error } = await resolveFilter(req.query);
    if (error) return res.status(400).json({ error });
    const [count, rows] = await Promise.all([
      Student.countDocuments(filter),
      Student.find(filter).sort({ lastActiveAt: -1 }).limit(50).select(SEG_FIELDS).lean(),
    ]);
    res.json({ count, rows, capped: count > rows.length, maxApply: MAX_APPLY });
  } catch (e) { fail(res, e); }
});

// Contact list for outreach (includes phone / WhatsApp), so it needs the Students permission.
router.get('/bulk/segment.csv', async (req, res) => {
  try {
    const { filter, error } = await resolveFilter(req.query);
    if (error) return res.status(400).json({ error });
    const rows = await Student.find(filter).sort({ name: 1 }).limit(MAX_EXPORT_ROWS).select(SEG_FIELDS + ' phone whatsapp university department').lean();
    const head = ['matric', 'name', 'phone', 'whatsapp', 'track', 'tier', 'premium_ends', 'active', 'last_active', 'credits', 'joined', 'university', 'department'];
    const lines = [csvRow(head)].concat(rows.map(s => csvRow([s.matric, s.name, s.phone, s.whatsapp, s.track || 'university', s.tier || 'free', s.tierExpiresAt, s.active !== false ? 'yes' : 'no', s.lastActiveAt, s.credits, s.createdAt, s.university, s.department])));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="wreddi-segment-${new Date().toISOString().slice(0, 10)}.csv"`);
    audit(req, 'command.segment.csv', `${rows.length} students`);
    res.send(lines.join('\n') + '\n');
  } catch (e) { fail(res, e); }
});

// Each action needs the matching change permission on top of Bulk, so Bulk alone cannot move money or suspend people.
const ACTIONS = {
  suspend:          { area: 'students' },
  reactivate:       { area: 'students' },
  signout:          { area: 'students' },
  'grant-premium':  { area: 'payments' },
  'revoke-premium': { area: 'payments' },
  credits:          { area: 'credits' },
  notify:           { area: 'bulk' },
};

function checkParams(action, p) {
  p = p || {};
  if (action === 'notify') {
    const title = String(p.title || '').trim(), message = String(p.message || '').trim();
    if (!title || title.length > 80) return { error: 'Title is required (up to 80 characters)' };
    if (!message || message.length > 500) return { error: 'Message is required (up to 500 characters)' };
    return { params: { title, message } };
  }
  if (action === 'credits') {
    const amount = Number(p.amount);
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100000) return { error: 'Amount must be a non-zero whole number (up to 100,000)' };
    return { params: { amount, note: String(p.note || '').trim().slice(0, 120) || 'Bulk admin adjustment' } };
  }
  if (action === 'grant-premium') {
    const { resolvePlanDays, planText } = require('../../services/entitlements.service');
    const r = resolvePlanDays(p.plan, p.durationDays);
    if (r.error) return { error: r.error };
    return { params: { plan: p.plan, days: r.days, label: planText(p.plan, r.days) } };
  }
  return { params: {} };
}

router.post('/bulk/apply', async (req, res) => {
  try {
    const b = req.body || {};
    const rule = ACTIONS[b.action];
    if (!rule) return res.status(400).json({ error: 'Choose an action' });
    if (rule.area !== 'bulk' && !canChange(req.admin.access, rule.area)) {
      return res.status(403).json({ error: `This action also needs change access to "${rule.area}"`, code: 'FORBIDDEN_AREA' });
    }
    const pr = checkParams(b.action, b.params);
    if (pr.error) return res.status(400).json({ error: pr.error });

    const { filter, error } = await resolveFilter(b.filter || {});
    if (error) return res.status(400).json({ error });
    const count = await Student.countDocuments(filter);
    if (!count) return res.status(400).json({ error: 'No students match this segment' });
    if (count > MAX_APPLY) return res.status(400).json({ error: `${count} students match. Narrow the segment to ${MAX_APPLY} or fewer.` });
    if (b.action === 'credits' && count > MAX_CREDIT_APPLY) return res.status(400).json({ error: `Credit changes are limited to ${MAX_CREDIT_APPLY} students at a time (${count} match).` });

    if (b.dryRun !== false) {
      const sample = await Student.find(filter).limit(10).select('matric name').lean();
      return res.json({ dryRun: true, action: b.action, matched: count, sample });
    }
    if (b.confirm !== 'APPLY') return res.status(400).json({ error: 'Type APPLY to confirm' });
    if (Number(b.expectedCount) !== count) return res.status(409).json({ error: `The segment changed (${count} match now, you previewed ${Number(b.expectedCount) || 0}). Preview it again.` });

    const matrics = (await Student.find(filter).select('matric').lean()).map(s => s.matric);
    const inList = { $in: matrics };
    const p = pr.params;
    let affected = matrics.length, failed = 0, prevActive;
    if (b.action === 'suspend' || b.action === 'reactivate') {
      prevActive = (await Student.find({ matric: inList }).select('matric active').lean()).map(x => ({ m: x.matric, a: x.active !== false }));
    }

    if (b.action === 'suspend') {
      await Student.updateMany({ matric: inList }, { active: false });
      await Session.updateMany({ subjectId: inList, role: 'student', revoked: { $ne: true } }, { revoked: true, revokedAt: new Date() });
      matrics.forEach(m => forgetSubject('student', m));
    } else if (b.action === 'reactivate') {
      await Student.updateMany({ matric: inList }, { active: true });
      matrics.forEach(m => forgetSubject('student', m));
    } else if (b.action === 'signout') {
      const r = await Session.updateMany({ subjectId: inList, role: 'student', revoked: { $ne: true } }, { revoked: true, revokedAt: new Date() });
      matrics.forEach(m => forgetSubject('student', m));
      affected = r.modifiedCount;
    } else if (b.action === 'revoke-premium') {
      const r = await Student.updateMany({ matric: inList, tier: 'premium' }, { tier: 'free', premiumPlan: null, tierExpiresAt: null });
      affected = r.modifiedCount;
    } else if (b.action === 'grant-premium') {
      await Student.updateMany({ matric: inList }, { tier: 'premium', premiumPlan: p.plan, tierExpiresAt: p.days == null ? null : new Date(Date.now() + p.days * 86400000) });
    } else if (b.action === 'notify') {
      await Notification.insertMany(matrics.map(m => ({ matric: m, type: 'announcement', title: p.title, message: p.message })), { ordered: false });
    } else if (b.action === 'credits') {
      affected = 0;
      for (const matric of matrics) {
        try { await applyCreditDelta({ matric, delta: p.amount, reason: p.amount > 0 ? 'admin_grant' : 'admin_deduct', note: p.note, actor: who(req) }); affected++; }
        catch (e) { failed++; }
      }
    }
    const summary = b.action === 'notify' ? p.title : b.action === 'credits' ? `${p.amount > 0 ? '+' : ''}${p.amount} credits` : b.action === 'grant-premium' ? p.label : '';
    const run = await BulkRun.create({ action: b.action, by: who(req), matched: count, affected, failed, summary: String(summary || '').slice(0, 80), matrics, prevActive }).catch(() => null);
    audit(req, `command.bulk.${b.action}`, JSON.stringify({ matched: count, affected, failed, segment: Object.keys(b.filter || {}).filter(k => b.filter[k] !== ''), params: b.action === 'notify' ? { title: p.title } : p }).slice(0, 500));
    res.json({ success: true, action: b.action, matched: count, affected, failed, runId: run && run._id });
  } catch (e) { fail(res, e); }
});


// ── Saved segments ───────────────────────────────────────────
router.get('/bulk/saved', async (req, res) => {
  try { res.json(await SavedSegment.find({}).sort({ name: 1 }).limit(100).lean()); } catch (e) { fail(res, e); }
});
router.post('/bulk/saved', async (req, res) => {
  try {
    const name = String((req.body || {}).name || '').trim();
    if (!name || name.length > 40) return res.status(400).json({ error: 'Give the group a name (up to 40 characters)' });
    const filter = {}; for (const k of SEG_KEYS) { const v = (req.body.filter || {})[k]; if (v !== undefined && v !== '' && v !== null) filter[k] = String(v).slice(0, 60); }
    const check = await resolveFilter(filter); if (check.error) return res.status(400).json({ error: check.error });
    if (!Object.keys(filter).length) return res.status(400).json({ error: 'Set at least one condition before saving' });
    if ((await SavedSegment.countDocuments({})) >= 100) return res.status(400).json({ error: 'You already have 100 saved groups' });
    const doc = await SavedSegment.findOneAndUpdate({ name }, { name, filter, by: who(req), createdAt: new Date() }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
    audit(req, 'command.segment.save', name);
    res.status(201).json(doc);
  } catch (e) { fail(res, e); }
});
router.delete('/bulk/saved/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid group' });
    const d = await SavedSegment.findByIdAndDelete(req.params.id).lean(); if (!d) return res.status(404).json({ error: 'Not found' });
    audit(req, 'command.segment.delete', d.name); res.json({ success: true });
  } catch (e) { fail(res, e); }
});

// ── History and undo ─────────────────────────────────────────
router.get('/bulk/history', async (req, res) => {
  try {
    const rows = await BulkRun.find({}).sort({ at: -1 }).limit(30).select('-matrics -prevActive').lean();
    const undoable = new Set((await BulkRun.find({ _id: { $in: rows.map(r => r._id) }, prevActive: { $exists: true, $ne: [] } }).select('_id').lean()).map(r => String(r._id)));
    res.json(rows.map(r => ({ ...r, canUndo: undoable.has(String(r._id)) && !r.undoneAt })));
  } catch (e) { fail(res, e); }
});

// Undo works for suspend and reactivate: each student goes back to the state they had before that run.
router.post('/bulk/history/:id/undo', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid run' });
    if (!canChange(req.admin.access, 'students')) return res.status(403).json({ error: 'Undoing this needs change access to "students"', code: 'FORBIDDEN_AREA' });
    const run = await BulkRun.findById(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.undoneAt) return res.status(400).json({ error: 'This run was already undone' });
    if (!run.prevActive || !run.prevActive.length) return res.status(400).json({ error: 'Only suspend and reactivate can be undone' });
    const on = run.prevActive.filter(x => x.a).map(x => x.m), off = run.prevActive.filter(x => !x.a).map(x => x.m);
    if (on.length) await Student.updateMany({ matric: { $in: on } }, { active: true });
    if (off.length) {
      await Student.updateMany({ matric: { $in: off } }, { active: false });
      await Session.updateMany({ subjectId: { $in: off }, role: 'student', revoked: { $ne: true } }, { revoked: true, revokedAt: new Date() });
    }
    run.prevActive.forEach(x => forgetSubject('student', x.m));
    run.undoneAt = new Date(); run.undoneBy = who(req); await run.save();
    audit(req, 'command.bulk.undo', `${run.action}: ${run.prevActive.length} students restored`);
    res.json({ success: true, restored: run.prevActive.length });
  } catch (e) { fail(res, e); }
});

// ══════════════════════════════════════════════════════════════
//  2. STUDENT NOTES & TAGS
// ══════════════════════════════════════════════════════════════
router.get('/crm/tags', async (req, res) => {
  try {
    const rows = await AdminNote.aggregate([{ $unwind: '$tags' }, { $group: { _id: '$tags', students: { $addToSet: '$matric' }, notes: { $sum: 1 } } }, { $project: { _id: 0, tag: '$_id', notes: 1, students: { $size: '$students' } } }, { $sort: { students: -1, tag: 1 } }, { $limit: 200 }]);
    res.json(rows);
  } catch (e) { fail(res, e); }
});

router.put('/crm/note/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid note' });
    const patch = {};
    if (typeof req.body.pinned === 'boolean') patch.pinned = req.body.pinned;
    if (req.body.tags !== undefined) { const t = cleanTags(req.body.tags); if (t.error) return res.status(400).json({ error: t.error }); patch.tags = t.tags; }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change' });
    const n = await AdminNote.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
    if (!n) return res.status(404).json({ error: 'Note not found' });
    res.json(n);
  } catch (e) { fail(res, e); }
});

router.delete('/crm/note/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid note' });
    const n = await AdminNote.findByIdAndDelete(req.params.id).lean();
    if (!n) return res.status(404).json({ error: 'Note not found' });
    audit(req, 'command.note.delete', n.matric);
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

// One-screen picture of a student: account, plan, recent quizzes, credits, payments, sessions, notes.
router.get('/crm/:matric/profile', async (req, res) => {
  try {
    const matric = up(req.params.matric);
    const student = await Student.findOne({ matric }).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const [scores, quizCount, credits, payments, sessions, notes, openSupport] = await Promise.all([
      Score.find({ matric }).sort({ ts: -1 }).limit(8).select('pct correct total mode courses ts').lean(),
      Score.countDocuments({ matric }),
      CreditTransaction.find({ matric }).sort({ createdAt: -1 }).limit(8).select('delta balanceAfter reason note actor createdAt').lean(),
      Payment.find({ matric }).sort({ createdAt: -1 }).limit(5).select('amount method status reference createdAt').lean(),
      Session.find({ subjectId: matric, role: 'student' }).sort({ createdAt: -1 }).limit(5).select('ip userAgent createdAt lastActiveAt revoked expiresAt').lean(),
      AdminNote.find({ matric }).sort({ pinned: -1, createdAt: -1 }).limit(5).lean(),
      SupportRequest.countDocuments({ matric, status: 'open' }).catch(() => 0),
    ]);
    const avg = scores.length ? Math.round(scores.reduce((a, x) => a + (x.pct || 0), 0) / scores.length) : null;
    res.json({
      student: { matric: student.matric, name: student.name, username: student.username, phone: student.phone, whatsapp: student.whatsapp, track: student.track || 'university', university: student.university, department: student.department,
        tier: student.tier || 'free', tierExpiresAt: student.tierExpiresAt, active: student.active !== false, credits: student.credits, createdAt: student.createdAt, lastActiveAt: student.lastActiveAt, courses: (student.selectedCourses || []).length },
      stats: { quizzes: quizCount, recentAverage: avg, openSupport },
      scores, credits, payments, sessions: sessions.map(sessionRow), notes,
    });
  } catch (e) { fail(res, e); }
});

router.get('/crm/:matric', async (req, res) => {
  try {
    const matric = up(req.params.matric);
    const [student, notes] = await Promise.all([
      Student.findOne({ matric }).select('matric name track tier active lastActiveAt').lean(),
      AdminNote.find({ matric }).sort({ pinned: -1, createdAt: -1 }).limit(100).lean(),
    ]);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json({ student, notes });
  } catch (e) { fail(res, e); }
});

router.post('/crm/:matric', async (req, res) => {
  try {
    const matric = up(req.params.matric);
    const text = String((req.body || {}).text || '').trim();
    if (!text || text.length > 1000) return res.status(400).json({ error: 'Write a note (up to 1000 characters)' });
    const t = cleanTags(req.body.tags); if (t.error) return res.status(400).json({ error: t.error });
    if (!(await Student.exists({ matric }))) return res.status(404).json({ error: 'Student not found' });
    if ((await AdminNote.countDocuments({ matric })) >= 200) return res.status(400).json({ error: 'This student already has 200 notes' });
    const note = await AdminNote.create({ matric, text, tags: t.tags, pinned: req.body.pinned === true, by: who(req) });
    audit(req, 'command.note.add', matric);
    res.status(201).json(note);
  } catch (e) { fail(res, e); }
});

// ══════════════════════════════════════════════════════════════
//  3. DATA & PRIVACY
// ══════════════════════════════════════════════════════════════
const EXPORTS = {
  students:               { label: 'Students',            model: Student,          drop: ['password', 'passwordHash', 'devices', 'telegramChatId', 'gradingScale'] },
  scores:                 { label: 'Quiz scores',         model: Score },
  'credit-transactions':  { label: 'Credit transactions', model: CreditTransaction },
  payments:               { label: 'Payments',            model: Payment },
  notifications:          { label: 'Notifications',       model: Notification },
  'support-requests':     { label: 'Support requests',    model: SupportRequest },
  questions:              { label: 'Question bank',       model: Question },
  courses:                { label: 'Courses',             model: Course },
};

router.get('/data/collections', async (req, res) => {
  try {
    const rows = await Promise.all(Object.entries(EXPORTS).map(async ([name, d]) => ({ name, label: d.label, count: await d.model.estimatedDocumentCount().catch(() => null) })));
    res.json(rows);
  } catch (e) { fail(res, e); }
});

// Streams the collection so a big export never sits in memory. Secrets (password hashes, device fingerprints, tokens) are never included.
router.get('/data/export/:name', async (req, res) => {
  const def = EXPORTS[req.params.name];
  if (!def) return res.status(404).json({ error: 'Unknown collection' });
  const csv = req.query.format === 'csv';
  try {
    let cols = null;
    if (csv) {
      const sample = await def.model.find({}).limit(200).lean();
      cols = [...new Set(sample.flatMap(d => Object.keys(cleanDoc(d, def.drop))))];
    }
    res.setHeader('Content-Type', csv ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="wreddi-${req.params.name}-${new Date().toISOString().slice(0, 10)}.${csv ? 'csv' : 'json'}"`);
    if (csv) res.write(csvRow(cols) + '\n'); else res.write('[');
    let n = 0;
    for await (const raw of def.model.find({}).lean().cursor()) {
      if (n >= MAX_EXPORT_ROWS) break;
      const d = cleanDoc(raw, def.drop);
      if (csv) res.write(csvRow(cols.map(c => flat(d[c]))) + '\n'); else res.write((n ? ',\n' : '\n') + JSON.stringify(d));
      n++;
    }
    if (!csv) res.write('\n]');
    res.end();
    audit(req, 'command.export', `${req.params.name} ${csv ? 'csv' : 'json'}: ${n} rows`);
  } catch (e) {
    console.error('[admin export]', e);
    if (!res.headersSent) return res.status(500).json({ error: e.message });
    res.end();
  }
});

// Everything Wreddi holds about one student, for a data-access request. Internal admin notes are not part of it.
router.get('/data/student/:matric/export', async (req, res) => {
  try {
    const matric = up(req.params.matric);
    const student = await Student.findOne({ matric }).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const pick = (M, n = 5000) => M.find({ matric }).sort({ _id: -1 }).limit(n).lean().then(rows => rows.map(r => cleanDoc(r)));
    const StudentNote = require('../../models/StudentNote'), PersonalNote = require('../../models/PersonalNote'), MistakeNote = require('../../models/MistakeNote');
    const [scores, credits, payments, notifications, studyNotes, personalNotes, mistakes, support] = await Promise.all([
      pick(Score), pick(CreditTransaction), pick(Payment), pick(Notification, 1000), pick(StudentNote, 1000), pick(PersonalNote, 1000), pick(MistakeNote, 1000), pick(SupportRequest, 500),
    ]);
    const bundle = { exportedAt: new Date().toISOString(), student: cleanDoc(student, EXPORTS.students.drop), scores, creditTransactions: credits, payments, notifications, studyNotes, personalNotes, mistakeNotebook: mistakes, supportRequests: support };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="wreddi-student-${matric}.json"`);
    audit(req, 'command.student.export', matric);
    res.send(JSON.stringify(bundle, null, 2));
  } catch (e) { fail(res, e); }
});

// Right to erasure. Removes personal details and personal content, keeps the money trail. Full-access admins only (adminAccess.js).
// The matric stays as the record key; the account is suspended and its password replaced with a random one nobody knows.
const ERASE_MODELS = ['StudentNote', 'PersonalNote', 'ChatMessage', 'StudentMemory', 'TelegramReminder', 'StudentBackup', 'SponsorLink', 'DailyPlan', 'MistakeNote', 'FlashcardSet', 'FlashcardProgress', 'StudyGuide', 'GuessFlag', 'Notification'];
router.post('/data/student/:matric/erase', async (req, res) => {
  try {
    const matric = up(req.params.matric);
    if (up((req.body || {}).confirm) !== matric) return res.status(400).json({ error: 'Type the matric number exactly to confirm' });
    const student = await Student.findOne({ matric }).select('_id').lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const randomHash = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);
    await Student.updateOne({ matric }, {
      $set: { name: 'Deleted student', displayName: '', phone: '', whatsapp: '', telegramUsername: '', password: '', passwordHash: randomHash, university: '', department: '', active: false, devices: [], selectedCourses: [], publicLeaderboardOptIn: false },
      $unset: { username: '', telegramChatId: '', referralCode: '' },
    });
    const removed = {};
    for (const name of ERASE_MODELS) {
      try { const r = await require(`../../models/${name}`).deleteMany({ matric }); removed[name] = r.deletedCount; } catch (e) { removed[name] = 'skipped'; }
    }
    removed.AdminNote = (await AdminNote.deleteMany({ matric })).deletedCount;
    await Payment.updateMany({ matric }, { name: 'Deleted student' });
    const s = await Session.updateMany({ subjectId: matric, role: 'student', revoked: { $ne: true } }, { revoked: true, revokedAt: new Date() });
    forgetSubject('student', matric);
    audit(req, 'command.student.erase', `${matric}${(req.body.reason ? ' — ' + String(req.body.reason).slice(0, 120) : '')}`);
    res.json({ success: true, matric, removed, sessionsRevoked: s.modifiedCount, kept: 'Quiz scores, credit transactions and payment records are kept (without the name) as financial and aggregate records.' });
  } catch (e) { fail(res, e); }
});

// ══════════════════════════════════════════════════════════════
//  4. ACCESS CONTROL
// ══════════════════════════════════════════════════════════════
router.get('/access/blocks', async (req, res) => {
  try { res.json(await Block.find({ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).sort({ createdAt: -1 }).limit(500).lean()); }
  catch (e) { fail(res, e); }
});

router.post('/access/blocks', async (req, res) => {
  try {
    const value = normIp((req.body || {}).value);
    if (!net.isIP(value)) return res.status(400).json({ error: 'Enter a valid IPv4 or IPv6 address' });
    if (value === normIp(req.ip)) return res.status(400).json({ error: 'That is your own address. Blocking it would be a mistake.' });
    const hours = req.body.hours === undefined || req.body.hours === '' ? null : Number(req.body.hours);
    if (hours !== null && (!Number.isFinite(hours) || hours < 1 || hours > 24 * 365)) return res.status(400).json({ error: 'Hours must be between 1 and 8760, or empty for no expiry' });
    const doc = { kind: 'ip', value, reason: String(req.body.reason || '').trim().slice(0, 200), by: who(req), createdAt: new Date(), expiresAt: hours === null ? null : new Date(Date.now() + hours * 3600000) };
    const b = await Block.findOneAndUpdate({ kind: 'ip', value }, doc, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
    invalidateBlocks();
    audit(req, 'command.block.add', `${value}${doc.reason ? ' — ' + doc.reason : ''}`);
    res.status(201).json(b);
  } catch (e) { fail(res, e); }
});

router.delete('/access/blocks/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid block' });
    const b = await Block.findByIdAndDelete(req.params.id).lean();
    if (!b) return res.status(404).json({ error: 'Block not found' });
    invalidateBlocks();
    audit(req, 'command.block.remove', b.value);
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

const sessionRow = s => ({ _id: s._id, subjectId: s.subjectId, role: s.role, ip: s.ip, userAgent: s.userAgent, isNewDevice: s.isNewDevice, createdAt: s.createdAt, lastActiveAt: s.lastActiveAt, expiresAt: s.expiresAt, state: s.revoked ? 'signed out' : (s.expiresAt <= new Date() ? 'expired' : 'active') });

router.get('/access/sessions/:matric', async (req, res) => {
  try {
    const rows = await Session.find({ subjectId: up(req.params.matric), role: 'student' }).sort({ createdAt: -1 }).limit(30).select('-refreshHash').lean();
    res.json(rows.map(sessionRow));
  } catch (e) { fail(res, e); }
});

async function revokeSession(req, res, role) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid session' });
    const s = await Session.findById(req.params.id);
    if (!s || s.role !== role) return res.status(404).json({ error: 'Session not found' });
    if (role === 'admin' && s.subjectId === who(req)) return res.status(400).json({ error: 'That is your own session. Use Sign Out instead.' });
    s.revoked = true; s.revokedAt = new Date(); await s.save();
    forgetSubject(role, s.subjectId);
    audit(req, 'command.session.revoke', `${role} ${s.subjectId}`);
    res.json({ success: true });
  } catch (e) { fail(res, e); }
}
router.post('/access/sessions/:id/revoke', (req, res) => revokeSession(req, res, 'student'));

// Owner only: who is signed in to the admin panel right now.
router.get('/access/admin-sessions', async (req, res) => {
  try {
    const rows = await Session.find({ role: 'admin', revoked: { $ne: true }, expiresAt: { $gt: new Date() } }).sort({ lastActiveAt: -1 }).limit(100).select('-refreshHash').lean();
    res.json(rows.map(sessionRow));
  } catch (e) { fail(res, e); }
});
router.post('/access/admin-sessions/:id/revoke', (req, res) => revokeSession(req, res, 'admin'));

// v1.18 Short links (permission area "links")
router.use(require('./admin.links.routes'));

module.exports = router;
module.exports.MAX_APPLY = MAX_APPLY;
