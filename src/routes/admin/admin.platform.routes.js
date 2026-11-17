'use strict';
// v1.12 admin additions: Secondary / JAMB overview, security & sessions, global search, system health.
//   GET  /api/admin/platform/secondary          students / papers / UTME stats for the Secondary app
//   GET  /api/admin/platform/security           recent student sign-ins, new-device flags, suspended accounts
//   POST /api/admin/platform/security/signout   { matric }  revoke every live session of one student
//   GET  /api/admin/platform/search?q=          students, courses and questions in one box
//   GET  /api/admin/platform/health             uptime, memory, database state and collection sizes
const express = require('express');
const mongoose = require('mongoose');
const Student = require('../../models/Student');
const Session = require('../../models/Session');
const Score = require('../../models/Score');
const Course = require('../../models/Course');
const Question = require('../../models/Question');
const Payment = require('../../models/Payment');
const SupportRequest = require('../../models/SupportRequest');
const { requireAdmin, forgetSubject } = require('../../middleware/auth');
const { cleanMatric, escapeRegex } = require('../../utils/validate');

const router = express.Router();
router.use(requireAdmin);

const day = n => new Date(Date.now() - n * 86400000);

router.get('/platform/secondary', async (req, res) => {
  try {
    const [students, newWeek, byExam, papers, utme, subjects, qByCourse, uniStudents] = await Promise.all([
      Student.countDocuments({ track: 'secondary' }),
      Student.countDocuments({ track: 'secondary', createdAt: { $gte: day(7) } }),
      Student.aggregate([{ $match: { track: 'secondary' } }, { $group: { _id: { $ifNull: ['$secondary.exam', ''] }, n: { $sum: 1 } } }]),
      Score.countDocuments({ sec: { $exists: true } }),
      Score.aggregate([{ $match: { 'sec.exam': 'jamb', 'sec.utme': { $ne: null } } }, { $group: { _id: null, avg: { $avg: '$sec.utme' }, best: { $max: '$sec.utme' }, n: { $sum: 1 } } }]),
      Course.find({ track: 'secondary' }).select('key courseCode courseTitle').sort({ courseTitle: 1 }).lean(),
      Question.aggregate([{ $group: { _id: { $toLower: '$course' }, n: { $sum: 1 } } }]),
      Student.countDocuments({ track: { $ne: 'secondary' } }),
    ]);
    const qMap = new Map(qByCourse.map(r => [r._id, r.n]));
    const rows = subjects.map(c => ({ key: c.key, code: c.courseCode, title: c.courseTitle, questions: (qMap.get(c.key) || 0) + (c.courseCode && c.courseCode.toLowerCase() !== c.key ? (qMap.get(c.courseCode.toLowerCase()) || 0) : 0) }));
    const top = await Score.aggregate([
      { $match: { 'sec.exam': 'jamb', 'sec.utme': { $ne: null } } },
      { $group: { _id: '$matric', best: { $max: '$sec.utme' }, papers: { $sum: 1 } } },
      { $sort: { best: -1 } }, { $limit: 10 },
    ]);
    const names = Object.fromEntries((await Student.find({ matric: { $in: top.map(t => t._id) } }).select('matric name').lean()).map(s => [s.matric, s.name]));
    res.json({
      students, newWeek, universityStudents: uniStudents, papers,
      exams: Object.fromEntries(byExam.map(r => [r._id || 'not set up', r.n])),
      jamb: utme[0] ? { avg: Math.round(utme[0].avg), best: utme[0].best, papers: utme[0].n } : { avg: 0, best: 0, papers: 0 },
      subjects: rows,
      top: top.map(t => ({ matric: t._id, name: names[t._id] || t._id, best: t.best, papers: t.papers })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/platform/security', async (req, res) => {
  try {
    const [sessions, suspended, newDevices24h, live] = await Promise.all([
      Session.find({ role: 'student' }).sort({ createdAt: -1 }).limit(60).lean(),
      Student.find({ active: false }).select('matric name').limit(100).lean(),
      Session.countDocuments({ role: 'student', isNewDevice: true, createdAt: { $gte: day(1) } }),
      Session.countDocuments({ role: 'student', revoked: { $ne: true }, expiresAt: { $gt: new Date() } }),
    ]);
    const names = Object.fromEntries((await Student.find({ matric: { $in: sessions.map(s => s.subjectId) } }).select('matric name track').lean()).map(s => [s.matric, s]));
    res.json({
      live, newDevices24h, suspended,
      sessions: sessions.map(s => ({
        matric: s.subjectId, name: (names[s.subjectId] || {}).name || '', track: (names[s.subjectId] || {}).track || 'university',
        ip: s.ip, ua: String(s.userAgent || '').slice(0, 90), newDevice: !!s.isNewDevice, revoked: !!s.revoked,
        at: s.createdAt, lastActiveAt: s.lastActiveAt,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/platform/security/signout', async (req, res) => {
  try {
    const matric = cleanMatric(req.body && req.body.matric);
    if (!matric) return res.status(400).json({ error: 'Enter a valid matric number' });
    const r = await Session.updateMany({ subjectId: matric, role: 'student', revoked: { $ne: true } }, { revoked: true, revokedAt: new Date() });
    forgetSubject('student', matric);
    res.json({ success: true, signedOut: r.modifiedCount || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/platform/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) return res.json({ students: [], courses: [], questions: [] });
    const rx = new RegExp(escapeRegex(q), 'i');
    const [students, courses, questions] = await Promise.all([
      Student.find({ $or: [{ matric: rx }, { name: rx }, { username: rx }, { phone: rx }] }).select('matric name username track tier').limit(8).lean(),
      Course.find({ $or: [{ courseCode: rx }, { courseTitle: rx }] }).select('courseCode courseTitle track').limit(6).lean(),
      Question.find({ q: rx }).select('q course').limit(6).lean(),
    ]);
    res.json({
      students: students.map(s => ({ matric: s.matric, name: s.name, username: s.username || '', track: s.track || 'university', tier: s.tier || 'free' })),
      courses: courses.map(c => ({ code: c.courseCode, title: c.courseTitle, track: c.track || 'university' })),
      questions: questions.map(x => ({ id: String(x._id), course: x.course, q: String(x.q).slice(0, 110) })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/platform/health', async (req, res) => {
  try {
    const mem = process.memoryUsage();
    const [students, questions, scores, sessions, openSupport, payments] = await Promise.all([
      Student.estimatedDocumentCount(), Question.estimatedDocumentCount(), Score.estimatedDocumentCount(), Session.estimatedDocumentCount(),
      SupportRequest.countDocuments({ status: 'open' }), Payment.estimatedDocumentCount(),
    ]);
    let ai = null; try { ai = require('../../services/groq.service').aiStatus(); } catch (e) { /* optional */ }
    res.json({
      node: process.version, uptimeSec: Math.round(process.uptime()), env: process.env.NODE_ENV || 'development',
      memoryMb: { rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576) },
      db: { state: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown', name: mongoose.connection.name || '' },
      counts: { students, questions, scores, sessions, payments, openSupport },
      telegram: !!process.env.TELEGRAM_BOT_TOKEN, ai,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
