const express = require('express');
const Student = require('../models/Student');
const Score = require('../models/Score');
const QuestionAttempt = require('../models/QuestionAttempt');
const StudentBackup = require('../models/StudentBackup');
const FlashcardProgress = require('../models/FlashcardProgress');
const Course = require('../models/Course');
const Settings = require('../models/Settings');
const { requireStudent } = require('../middleware/auth');
const { requireFeature, canUse } = require('../services/entitlements.service');
const { getWeakTopics } = require('../services/weakTopics.service');
const { courseKey } = require('../services/weakTopics.service');
const S = require('../services/study.service');
const { ACHIEVEMENTS, BY_KEY, evaluateAndAward } = require('../services/achievements.service');
const { escapeRegex } = require('../utils/validate');

const router = express.Router();

const dayStartWAT = (d = S.watDay()) => new Date(`${d}T00:00:00+01:00`);

// GET /api/study-plan — today's checklist, revision queue and 14-day progress, all from the student's real data.
router.get('/study-plan', requireStudent, requireFeature('studyPlan'), async (req, res) => {
  try {
    const matric = req.student.sub;
    const [student, backup, settings] = await Promise.all([
      Student.findOne({ matric }).select('matric selectedCourses streakCount tier premiumPlan tierExpiresAt').lean(),
      StudentBackup.findOne({ matric }).lean(),
      Settings.getGlobal(),
    ]);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const sets = (backup && backup.settings) || {};
    const goalTarget = Math.min(Math.max(parseInt(sets.goalTarget, 10) || 20, 1), 500);
    const today0 = dayStartWAT();
    const week0 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const regKeys = (student.selectedCourses || []).map(k => String(k).toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
    const [doneAgg, weak, courses, weekAgg, examsToday, lastExam] = await Promise.all([
      Score.aggregate([{ $match: { matric, ts: { $gte: today0 } } }, { $group: { _id: null, n: { $sum: { $ifNull: ['$total', 0] } } } }]),
      getWeakTopics(matric, 3),
      Course.find({ key: { $in: regKeys } }).select('key courseCode').lean(),
      QuestionAttempt.aggregate([{ $match: { matric, ts: { $gte: week0 } } }, { $addFields: { _c: courseKey } }, { $group: { _id: '$_c', n: { $sum: 1 } } }]),
      Score.countDocuments({ matric, mode: 'exam', ts: { $gte: today0 } }),
      Score.findOne({ matric, mode: 'exam' }).sort({ ts: -1 }).select('ts').lean(),
    ]);

    // Has the top weak topic already been drilled today?
    if (weak[0]) {
      const n = await QuestionAttempt.countDocuments({ matric, ts: { $gte: today0 }, course: weak[0].course, tag: new RegExp(`^${escapeRegex(weak[0].tag)}$`, 'i') });
      weak[0].drilledToday = n >= 5;
    }

    // Exam countdown from what the student saved (date, and the course code they picked) — nothing if unset.
    let exam = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(sets.examDate || '')) {
      const daysLeft = Math.round((dayStartWAT(sets.examDate) - today0) / 86400000);
      const codeKey = String(sets.examCourse || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      exam = { daysLeft, courseCode: sets.examCourse || '', course: codeKey, name: sets.examName || '', date: sets.examDate };
    }

    const cardsEnabled = canUse(student, 'flashcards', settings);
    const dueCards = cardsEnabled && regKeys.length
      ? await FlashcardProgress.countDocuments({ matric, course: { $in: regKeys }, dueDate: { $lte: new Date() } }) : 0;

    const registered = courses.map(c => ({ key: c.key, code: c.courseCode }));
    const practicedWeek = Object.fromEntries(weekAgg.map(r => [r._id, r.n]));
    const doneToday = doneAgg[0] ? doneAgg[0].n : 0;

    const plan = S.buildStudyPlan({
      goalTarget, doneToday, exam, weakTopics: weak, dueCards, cardsEnabled, registered, practicedWeek, examsToday,
      daysSinceExam: lastExam ? Math.floor((Date.now() - lastExam.ts.getTime()) / 86400000) : null,
    });
    const [progress, revision] = await Promise.all([S.progress14(matric), S.revisionQueue(matric)]);

    res.json({ plan, progress, revision, streak: student.streakCount || 0, goalTarget, doneToday, exam });
  } catch (e) { console.error('[study-plan]', e.message); res.status(500).json({ error: 'Could not build your study plan' }); }
});

// GET /api/exams/overview — per-course readiness + mock-exam history with topic breakdowns.
router.get('/exams/overview', requireStudent, requireFeature('examHistory'), async (req, res) => {
  try {
    const matric = req.student.sub;
    const student = await Student.findOne({ matric }).select('selectedCourses').lean();
    const regKeys = (student?.selectedCourses || []).map(k => String(k).toLowerCase().replace(/[^a-z0-9]/g, ''));
    const [readiness, exams] = await Promise.all([
      S.courseReadiness(matric, regKeys),
      Score.find({ matric, mode: 'exam' }).sort({ ts: -1 }).limit(30).lean(),
    ]);
    const cm = await S.courseMap([...new Set(exams.flatMap(e => (e.topics || []).map(t => t.course)))]);
    const history = exams.map(e => ({
      id: e._id, ts: e.ts, courses: e.courses || '', pct: e.pct, correct: e.correct, total: e.total, wrong: e.wrong, skip: e.skip,
      topics: (e.topics || []).map(t => ({
        course: t.course, courseCode: cm[t.course]?.courseCode || String(t.course || '').toUpperCase(), tag: t.tag || 'General',
        correct: t.correct, total: t.total, pct: t.total ? Math.round((t.correct / t.total) * 100) : 0,
      })).sort((a, b) => a.pct - b.pct),
    }));
    const recent = history.slice(0, 5);
    res.json({
      readiness, history,
      average: recent.length ? Math.round(recent.reduce((a, e) => a + (e.pct || 0), 0) / recent.length) : null,
      trend: history.length >= 2 ? Math.round((history[0].pct || 0) - (history[1].pct || 0)) : null,
    });
  } catch (e) { res.status(500).json({ error: 'Could not load your exam history' }); }
});

// GET /api/achievements — every achievement with earned state; also awards anything newly earned.
router.get('/achievements', requireStudent, async (req, res) => {
  try {
    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const { fresh, stats } = await evaluateAndAward(student);
    const fresh2 = await Student.findOne({ matric: student.matric }).select('achievements equippedAchievement').lean();
    const earned = Object.fromEntries((fresh2.achievements || []).map(a => [a.key, a.earnedAt]));
    res.json({
      equipped: fresh2.equippedAchievement || '',
      newlyEarned: fresh.map(a => a.key),
      stats: { questions: stats.questions, quizzes: stats.quizzes, streak: stats.streak, exams: stats.exams },
      achievements: ACHIEVEMENTS.map(a => ({ ...a, earned: !!earned[a.key], earnedAt: earned[a.key] || null })),
    });
  } catch (e) { res.status(500).json({ error: 'Could not load achievements' }); }
});

// PUT /api/achievements/equip { key | null } — pick the achievement shown beside your name on the leaderboard.
router.put('/achievements/equip', requireStudent, async (req, res) => {
  try {
    const key = req.body.key === null || req.body.key === '' ? '' : String(req.body.key);
    if (key && !BY_KEY[key]) return res.status(400).json({ error: 'Unknown achievement' });
    const filter = key ? { matric: req.student.sub, 'achievements.key': key } : { matric: req.student.sub };
    const r = await Student.updateOne(filter, { $set: { equippedAchievement: key } });
    if (!r.matchedCount) return res.status(403).json({ error: "You haven't earned that achievement yet" });
    res.json({ success: true, equipped: key });
  } catch (e) { res.status(500).json({ error: 'Could not update your badge' }); }
});

module.exports = router;
