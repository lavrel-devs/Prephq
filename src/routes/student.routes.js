const express = require('express');
const Question = require('../models/Question');
const Student = require('../models/Student');
const Course = require('../models/Course');
const { requireStudent } = require('../middleware/auth');

const router = express.Router();

// GET /api/questions/:course — public. Different tools have written
// the `course` field differently over time — old bank data uses the
// raw uppercase code (e.g. "GST101"), newer admin CRUD writes the
// normalized lowercase key (e.g. "chm142"). Resolve the real course
// first, then match case-insensitively against every format its
// questions could plausibly have been stored under, so it works
// regardless of which tool wrote them or how the caller's :course
// param happens to be formatted.
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

router.get('/questions/:course', async (req, res) => {
  try {
    const param = req.params.course;
    const normalizedKey = param.toLowerCase().replace(/[^a-z0-9]/g, '');
    const courseDoc = await Course.findOne({ key: normalizedKey });

    const candidates = new Set([param, normalizedKey]);
    if (courseDoc) { candidates.add(courseDoc.key); candidates.add(courseDoc.courseCode); }

    const questions = await Question.find({
      $or: [...candidates].map(c => ({ course: { $regex: new RegExp(`^${escapeRegex(c)}$`, 'i') } })),
    }).lean();
    res.json(questions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/courses — public, new in v1.1.5. The dashboard's course
// grid, search bar, and AI quiz picker all fetch this live instead of
// relying on a hardcoded list.
router.get('/courses', async (req, res) => {
  try {
    const courses = await Course.find().sort({ courseCode: 1 }).lean();
    res.json(courses);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/me — current logged-in student's profile + live credit balance.
// The dashboard calls this on load/refresh so the credits shown are
// never stale after an admin top-up or a quiz spend.
router.get('/me', requireStudent, async (req, res) => {
  try {
    const student = await Student.findOne({ matric: req.student.sub }).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json({
      matric: student.matric,
      name: student.name,
      role: student.role,
      credits: student.credits || 0,
      phone: student.phone,
      whatsapp: student.whatsapp,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
