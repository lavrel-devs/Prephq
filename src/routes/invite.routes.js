const express = require('express');
const rateLimit = require('express-rate-limit');
const GeneratedQuestion = require('../models/GeneratedQuestion');
const Challenge = require('../models/Challenge');
const Student = require('../models/Student');
const Settings = require('../models/Settings');

// ── Invite preview (v1.7.5) ───────────────────────────────────
// PUBLIC (no login). When someone who isn't signed in opens a shared-quiz or challenge link, the app shows a
// small invite page instead of a bare login form: "@ada challenged you — scored 8/10 on CHM101", with a
// Sign-up button that carries the sender's referral code (so both of them get the referral credits).
// It reveals only what the link already implies — the sender's @username/first name, course, question COUNT and
// (for a challenge) their score. Never a matric number, the questions or the answers.
const router = express.Router();
const TOKEN_RE = /^[A-Za-z0-9_-]{8,32}$/;
const limiter = rateLimit({
  windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Slow down a little.' },
});

// GET /api/invite/q/:token  or  /api/invite/c/:token
router.get('/invite/:kind/:token', limiter, async (req, res) => {
  try {
    const { kind, token } = req.params;
    const notFound = () => res.status(404).json({ error: 'This link is not available any more.', code: 'LINK_NOT_FOUND' });
    if (!['q', 'c'].includes(kind) || !TOKEN_RE.test(token)) return notFound();

    let quiz = null, challenge = null;
    if (kind === 'q') {
      quiz = await GeneratedQuestion.findOne({ shareToken: token }).select('matric course questions').lean();
    } else {
      challenge = await Challenge.findOne({ token }).select('quizId owner correct total').lean();
      quiz = challenge && await GeneratedQuestion.findById(challenge.quizId).select('matric course questions').lean();
    }
    if (!quiz || !quiz.questions || !quiz.questions.length) return notFound();

    const owner = await Student.findOne({ matric: quiz.matric }).select('name username referralCode').lean();
    const settings = await Settings.getGlobal();
    const ref = settings.referral || {};
    res.json({
      kind,
      by: owner ? (owner.username ? `@${owner.username}` : String(owner.name || '').split(/\s+/)[0]) : '',
      course: quiz.course,
      questions: quiz.questions.length,
      score: challenge ? { correct: challenge.correct, total: challenge.total, pct: challenge.total ? Math.round((challenge.correct / challenge.total) * 100) : 0 } : null,
      ref: owner && owner.referralCode ? owner.referralCode : null,
      bonus: ref.enabled ? (ref.refereeBonus || 0) : 0,   // extra credits the new student gets for joining through a friend
    });
  } catch (e) { res.status(500).json({ error: 'Could not load this invite.' }); }
});

module.exports = router;
