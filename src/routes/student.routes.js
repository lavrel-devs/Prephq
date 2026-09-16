const express = require('express');
const Question = require('../models/Question');
const Student = require('../models/Student');
const Course = require('../models/Course');
const Score = require('../models/Score');
const Transfer = require('../models/Transfer');
const CreditTransaction = require('../models/CreditTransaction');
const Notification = require('../models/Notification');
const StudentBackup = require('../models/StudentBackup');
const Settings = require('../models/Settings');
const { requireStudent } = require('../middleware/auth');
const { maybeApplyDailyRefresh, updateStreak } = require('../services/credit.service');
const { checkAvailability, setUsername } = require('../utils/username');
const { generateUniqueReferralCode } = require('../utils/referral');
const { usernameCheckLimiter, usernameChangeLimiter } = require('../middleware/rateLimit');
const { usageSnapshot } = require('../services/tier.service');

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

// GET /api/usage/limits — v1.4. Current tier + today's usage against
// each daily cap. The dashboard checks this before starting a quiz or
// opening the AI assistant, so a free student at their cap sees the
// upgrade paywall proactively instead of after losing quiz progress.
router.get('/usage/limits', requireStudent, async (req, res) => {
  try {
    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json(await usageSnapshot(student));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/plans — v1.4. Public: tier pricing/limits + support contact,
// exactly as the admin has configured them in Settings.tiers/support.
// Powers the upgrade paywall so pricing and the WhatsApp link are never
// hardcoded in the frontend — the admin can change either anytime
// without a redeploy or a code change on this end.
router.get('/plans', async (req, res) => {
  try {
    const settings = await Settings.getGlobal();
    res.json({ tiers: settings.tiers, support: settings.support });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/profile/grading-system — v1.4.1. Lets a student set their
// own school's GPA scale and score→grade boundaries, since different
// universities grade differently (4.0 vs 5.0 scale; 70+ vs 80+ for an
// A, etc.). Replaces gradingScale entirely rather than merging, since
// a partial/mismatched set of bands would produce wrong grade points.
router.put('/profile/grading-system', requireStudent, async (req, res) => {
  try {
    const { gpaScale, gradingScale } = req.body;

    if (gpaScale !== undefined) {
      const scale = Number(gpaScale);
      if (Number.isNaN(scale) || scale <= 0 || scale > 20) return res.status(400).json({ error: 'gpaScale must be a positive number' });
    }

    if (gradingScale !== undefined) {
      if (!Array.isArray(gradingScale) || !gradingScale.length) return res.status(400).json({ error: 'gradingScale must be a non-empty array' });
      for (const band of gradingScale) {
        if (!band || typeof band.grade !== 'string' || !band.grade.trim()
          || !Number.isFinite(Number(band.minScore)) || !Number.isFinite(Number(band.point))) {
          return res.status(400).json({ error: 'Each grading band needs a grade, minScore, and point' });
        }
      }
    }

    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    if (gpaScale !== undefined) student.gpaScale = Number(gpaScale);
    if (gradingScale !== undefined) {
      // Highest minScore first, so scoring a course always matches the
      // best-fitting band first when converting a score to a grade.
      student.gradingScale = gradingScale
        .map(b => ({ grade: String(b.grade).trim(), minScore: Number(b.minScore), point: Number(b.point) }))
        .sort((a, b) => b.minScore - a.minScore);
    }

    await student.save();
    res.json({ success: true, gpaScale: student.gpaScale, gradingScale: student.gradingScale });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/gpa/calculate — v1.4.1. Given this semester's courses as
// { name, creditUnit, score }, converts each score to a grade point
// using the student's own gradingScale, computes the weighted GPA on
// their own gpaScale, and (if `save` is true) writes the result to
// currentGPA. Doesn't require Basic/Pro — this is a calculator, not
// the AI study guide.
router.post('/gpa/calculate', requireStudent, async (req, res) => {
  try {
    const { courses, save } = req.body;
    if (!Array.isArray(courses) || !courses.length) return res.status(400).json({ error: 'courses must be a non-empty array' });

    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const bands = [...student.gradingScale].sort((a, b) => b.minScore - a.minScore);
    let totalUnits = 0, totalPoints = 0;
    const breakdown = courses.map(c => {
      const creditUnit = Number(c.creditUnit);
      const score = Number(c.score);
      if (!Number.isFinite(creditUnit) || creditUnit <= 0 || !Number.isFinite(score)) {
        const err = new Error(`Invalid creditUnit/score for "${c.name || 'a course'}"`);
        err.code = 'BAD_INPUT';
        throw err;
      }
      const band = bands.find(b => score >= b.minScore) || bands[bands.length - 1];
      totalUnits += creditUnit;
      totalPoints += creditUnit * band.point;
      return { name: c.name || '', creditUnit, score, grade: band.grade, point: band.point };
    });

    const gpa = totalUnits ? Math.round((totalPoints / totalUnits) * 100) / 100 : 0;

    if (save) {
      if (gpa > student.gpaScale) return res.status(400).json({ error: 'Computed GPA exceeds your configured GPA scale — check your grading bands.' });
      student.currentGPA = gpa;
      await student.save();
    }

    res.json({ gpa, gpaScale: student.gpaScale, breakdown });
  } catch (e) {
    if (e.code === 'BAD_INPUT') return res.status(400).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// GET /api/me — current logged-in student's profile + live credit balance.
// The dashboard calls this on load/refresh so the credits shown are
// never stale after an admin top-up or a quiz spend.
router.get('/me', requireStudent, async (req, res) => {
  try {
    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Lazy daily refresh: tops up credits the moment this student is
    // seen today, without waiting on the midnight cron.
    await maybeApplyDailyRefresh(student);

    // v1.3: server-side streak tracking + milestone bonus (see note in
    // credit.service.js on why this can't be client-only).
    const streak = await updateStreak(student);

    // v1.2 backfill: accounts created before v1.2 (or created without
    // going through activateNewStudent for any other reason) may not
    // have a referralCode yet. Generate one on first sight rather than
    // requiring a separate migration step.
    if (!student.referralCode) {
      student.referralCode = await generateUniqueReferralCode();
      await student.save();
    }

    res.json({
      matric: student.matric,
      name: student.name,
      role: student.role,
      credits: student.credits || 0,
      phone: student.phone,
      whatsapp: student.whatsapp,
      username: student.username,
      displayName: student.displayName || '',
      referralCode: student.referralCode,
      needsUsername: !student.username, // drives the blocking dashboard modal
      // v1.4: same pattern as needsUsername — true for every account
      // (old or new) until university/department/selectedCourses are
      // all filled in. Checked server-side via profileCompleted so it
      // can't be bypassed by clearing local state.
      needsProfileCompletion: !student.profileCompleted,
      university: student.university || '',
      department: student.department || '',
      currentGPA: student.currentGPA,
      targetGPA: student.targetGPA,
      selectedCourses: student.selectedCourses || [],
      showAllCoursesOverride: !!student.showAllCoursesOverride,
      gpaScale: student.gpaScale,
      gradingScale: student.gradingScale,
      streak, // { count, milestoneHit, bonusAwarded }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  USERNAMES (v1.2)
// ══════════════════════════════════════════════════════════════

// GET /api/username/check/:username — public-ish (still requires login,
// since it's only ever called from the signup-flow modal or the
// profile settings screen, both of which are post-auth). Real-time
// availability check, debounced on the frontend.
router.get('/username/check/:username', requireStudent, usernameCheckLimiter, async (req, res) => {
  try {
    const student = await Student.findOne({ matric: req.student.sub }).lean();
    const result = await checkAvailability(req.params.username, student?._id);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/username — set (first time) or change (respecting the
// 30-day cooldown) the current student's username.
router.post('/username', requireStudent, usernameChangeLimiter, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username is required' });

    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const finalUsername = await setUsername(student, username);
    res.json({ success: true, username: finalUsername });
  } catch (e) {
    const status = { INVALID_FORMAT: 400, TAKEN: 409, COOLDOWN: 429, UNCHANGED: 400 }[e.code] || 500;
    res.status(status).json({ error: e.message, code: e.code || 'SERVER_ERROR' });
  }
});

// PUT /api/profile/display-name — changeable anytime, unlike username.
router.put('/profile/display-name', requireStudent, async (req, res) => {
  try {
    const { displayName } = req.body;
    if (typeof displayName !== 'string') return res.status(400).json({ error: 'displayName must be a string' });
    const trimmed = displayName.trim().slice(0, 40);

    const student = await Student.findOneAndUpdate(
      { matric: req.student.sub },
      { displayName: trimmed },
      { new: true },
    ).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    res.json({ success: true, displayName: student.displayName });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/profile/leaderboard-optin — v1.3. Toggle visibility on the
// public/global leaderboard. Off by default (see Student model).
router.put('/profile/leaderboard-optin', requireStudent, async (req, res) => {
  try {
    const { optIn } = req.body;
    if (typeof optIn !== 'boolean') return res.status(400).json({ error: 'optIn must be a boolean' });
    const student = await Student.findOneAndUpdate(
      { matric: req.student.sub },
      { publicLeaderboardOptIn: optIn },
      { new: true },
    ).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json({ success: true, optedIn: student.publicLeaderboardOptIn });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/profile/details — v1.4. Sets/updates university, department,
// GPA fields, and selected courses. University/department/at-least-one
// selected course are required to flip profileCompleted to true, which
// is what dismisses the blocking completion modal (see /api/me above).
// GPA fields are optional (a student can skip GPA and still complete
// their profile). Callable repeatedly afterwards from Settings to edit
// any of these fields.
router.put('/profile/details', requireStudent, async (req, res) => {
  try {
    const { university, department, currentGPA, targetGPA, selectedCourses } = req.body;

    const update = {};
    if (university !== undefined) update.university = String(university).trim().slice(0, 120);
    if (department !== undefined) update.department = String(department).trim().slice(0, 120);
    if (Array.isArray(selectedCourses)) update.selectedCourses = selectedCourses.map(c => String(c).trim()).filter(Boolean);

    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    for (const [key, val] of [['currentGPA', currentGPA], ['targetGPA', targetGPA]]) {
      if (val === undefined) continue;
      if (val === null || val === '') { update[key] = null; continue; }
      const n = Number(val);
      if (Number.isNaN(n) || n < 0 || n > student.gpaScale) return res.status(400).json({ error: `${key} must be a number between 0 and ${student.gpaScale}` });
      update[key] = n;
    }

    Object.assign(student, update);

    // Recompute completion from the resulting document state, not just
    // this request's payload — so a student who set university/department
    // earlier and is only adding courses now still gets marked complete.
    const hasCourses = Array.isArray(student.selectedCourses) && student.selectedCourses.length > 0;
    if (student.university && student.department && hasCourses) student.profileCompleted = true;

    await student.save();

    res.json({
      success: true,
      profileCompleted: student.profileCompleted,
      university: student.university,
      department: student.department,
      currentGPA: student.currentGPA,
      targetGPA: student.targetGPA,
      selectedCourses: student.selectedCourses,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/profile/show-all-courses — settings-level toggle, lets a
// student who already selected courses see the full catalog again
// on the dashboard without losing their selection.
router.put('/profile/show-all-courses', requireStudent, async (req, res) => {
  try {
    const { show } = req.body;
    if (typeof show !== 'boolean') return res.status(400).json({ error: 'show must be a boolean' });
    const student = await Student.findOneAndUpdate(
      { matric: req.student.sub },
      { showAllCoursesOverride: show },
      { new: true },
    ).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json({ success: true, showAllCoursesOverride: student.showAllCoursesOverride });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/profile — the full profile page payload: identity, credits,
// quiz stats, transfer history, and referral link/code in one call.
router.get('/profile', requireStudent, async (req, res) => {
  try {
    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    if (!student.referralCode) {
      student.referralCode = await generateUniqueReferralCode();
      await student.save();
    }

    const [scores, transfersOut, transfersIn, referralCount] = await Promise.all([
      Score.find({ matric: student.matric }).sort({ ts: -1 }).lean(),
      Transfer.find({ fromMatric: student.matric }).sort({ createdAt: -1 }).limit(20).lean(),
      Transfer.find({ toMatric: student.matric }).sort({ createdAt: -1 }).limit(20).lean(),
      Student.countDocuments({ referredBy: student._id }),
    ]);

    const quizStats = {
      totalQuizzes: scores.length,
      avgScore: scores.length ? Math.round(scores.reduce((a, s) => a + (s.pct || 0), 0) / scores.length) : 0,
      bestScore: scores.length ? Math.max(...scores.map(s => s.pct || 0)) : 0,
    };

    const transferHistory = [...transfersOut, ...transfersIn]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 30);

    res.json({
      matric: student.matric,
      name: student.name,
      username: student.username,
      displayName: student.displayName || '',
      credits: student.credits || 0,
      quizStats,
      transferHistory,
      referral: {
        code: student.referralCode,
        referredCount: referralCount,
      },
      leaderboardOptIn: !!student.publicLeaderboardOptIn,
      tier: student.tier,
      currentGPA: student.currentGPA,
      targetGPA: student.targetGPA,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  NOTIFICATIONS (v1.2)
// ══════════════════════════════════════════════════════════════

// GET /api/notifications — most recent 50, newest first.
router.get('/notifications', requireStudent, async (req, res) => {
  try {
    const notifications = await Notification.find({ matric: req.student.sub })
      .sort({ createdAt: -1 }).limit(50).lean();
    const unreadCount = await Notification.countDocuments({ matric: req.student.sub, read: false });
    res.json({ notifications, unreadCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/notifications/:id/read
router.post('/notifications/:id/read', requireStudent, async (req, res) => {
  try {
    await Notification.updateOne(
      { _id: req.params.id, matric: req.student.sub },
      { read: true },
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/notifications/read-all
router.post('/notifications/read-all', requireStudent, async (req, res) => {
  try {
    await Notification.updateMany({ matric: req.student.sub, read: false }, { read: true });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  SERVER-SIDE BACKUP (v1.3.1)
// ══════════════════════════════════════════════════════════════
// Backs up data that used to live only in localStorage — bookmarks,
// notes, daily goal, exam-date/notification settings. See
// StudentBackup model for why this stays intentionally loose-shaped.

// GET /api/student-data — returns whatever's backed up, or empty
// defaults if this student has never synced before.
router.get('/student-data', requireStudent, async (req, res) => {
  try {
    const backup = await StudentBackup.findOne({ matric: req.student.sub }).lean();
    res.json({
      bookmarks: backup?.bookmarks ?? [],
      notes: backup?.notes ?? {},
      goal: backup?.goal ?? {},
      settings: backup?.settings ?? {},
      hasBackup: !!backup,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/student-data — upsert any subset of { bookmarks, notes, goal, settings }.
router.put('/student-data', requireStudent, async (req, res) => {
  try {
    const { bookmarks, notes, goal, settings } = req.body;
    const update = {};
    if (bookmarks !== undefined) update.bookmarks = bookmarks;
    if (notes !== undefined) update.notes = notes;
    if (goal !== undefined) update.goal = goal;
    if (settings !== undefined) update.settings = settings;

    await StudentBackup.findOneAndUpdate(
      { matric: req.student.sub },
      { $set: update },
      { upsert: true, new: true },
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
