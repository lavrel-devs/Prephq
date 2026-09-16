const express = require('express');
const Student = require('../models/Student');
const StudyGuide = require('../models/StudyGuide');
const QuestionAttempt = require('../models/QuestionAttempt');
const { requireStudent } = require('../middleware/auth');
const { generateStudyGuide } = require('../services/groq.service');

const router = express.Router();
// NOTE: requireStudent is applied per-route below, NOT via router.use()
// here. This router is mounted at the shared '/api' prefix alongside
// student.routes.js (which has genuinely public routes like /courses
// and /plans) — a blanket router.use(requireStudent) would intercept
// and 401 EVERY /api/* request that reaches this router first,
// including those public ones, before Express even gets to matching
// them against their real (public) route definitions elsewhere.

// v1.4: GPA + AI study guide. Free users can save/edit their GPA
// fields (see /api/profile/details in student.routes.js) but the
// *generated* plan itself is Basic/Pro only — enforced here, not by
// hiding the GPA inputs, so a free user always sees what they're
// unlocking.
function requirePaidTier(student) {
  if (student.tier === 'free') {
    const err = new Error('The AI study guide is a Basic/Pro feature. Upgrade to unlock it.');
    err.code = 'TIER_REQUIRED';
    throw err;
  }
}

// GET /api/study-guide/latest — the student's most recent saved plan,
// if any (so the profile/dashboard can show it without regenerating).
router.get('/study-guide/latest', requireStudent, async (req, res) => {
  try {
    const guide = await StudyGuide.findOne({ matric: req.student.sub }).sort({ createdAt: -1 }).lean();
    res.json(guide || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/study-guide/generate — builds a fresh 4-week plan from the
// student's saved currentGPA/targetGPA/selectedCourses (must already
// be set via /api/profile/details), optionally weighted toward their
// weakest courses if we have QuestionAttempt data for them.
router.post('/study-guide/generate', requireStudent, async (req, res) => {
  try {
    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    try {
      requirePaidTier(student);
    } catch (e) {
      return res.status(403).json({ error: e.message, code: e.code });
    }

    if (student.currentGPA == null || student.targetGPA == null) {
      return res.status(400).json({ error: 'Set your current and target GPA in your profile first.', code: 'GPA_NOT_SET' });
    }
    if (!student.selectedCourses || !student.selectedCourses.length) {
      return res.status(400).json({ error: 'Select your courses for the semester in your profile first.', code: 'COURSES_NOT_SET' });
    }

    // Best-effort: find up to 3 courses this student is weakest in
    // recently, to weight the plan toward them. Failure here (e.g. no
    // attempts yet) should never block guide generation.
    let weakCourses = [];
    try {
      const agg = await QuestionAttempt.aggregate([
        { $match: { matric: student.matric, course: { $in: student.selectedCourses } } },
        { $group: { _id: '$course', total: { $sum: 1 }, correct: { $sum: { $cond: ['$correct', 1, 0] } } } },
        { $project: { pct: { $divide: ['$correct', '$total'] } } },
        { $match: { total: { $gte: 3 } } },
        { $sort: { pct: 1 } },
        { $limit: 3 },
      ]);
      weakCourses = agg.map(a => a._id);
    } catch (e) { /* non-fatal */ }

    let guideData;
    try {
      guideData = await generateStudyGuide({
        currentGPA: student.currentGPA,
        targetGPA: student.targetGPA,
        gpaScale: student.gpaScale,
        department: student.department,
        courses: student.selectedCourses,
        weakCourses,
      });
    } catch (e) {
      const status = e.code === 'GROQ_NOT_CONFIGURED' ? 503 : 502;
      return res.status(status).json({ error: e.message, code: e.code || 'GROQ_ERROR' });
    }

    const record = await StudyGuide.create({
      matric: student.matric,
      currentGPA: student.currentGPA,
      targetGPA: student.targetGPA,
      courses: student.selectedCourses,
      summary: guideData.summary,
      weeks: guideData.weeks,
      model: guideData.model,
    });

    res.status(201).json(record);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
