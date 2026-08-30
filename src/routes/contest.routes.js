const express = require('express');
const Contest = require('../models/Contest');
const Student = require('../models/Student');
const { requireStudent } = require('../middleware/auth');
const { contestJoinLimiter } = require('../middleware/rateLimit');
const { joinContest, updateParticipantScore, computeLeaderboard } = require('../services/contest.service');

const router = express.Router();

// Strips the full participants list down to count + "am I in" for list
// views, so we're not shipping every participant's data on every card.
function summarize(contest, matric) {
  const obj = contest.toObject ? contest.toObject() : contest;
  const joined = obj.participants.some(p => p.matric === matric);
  return {
    ...obj,
    participantCount: obj.participants.length,
    joined,
    participants: undefined,
  };
}

// GET /api/contests — list, filterable by status via ?status=upcoming|live|ended
router.get('/contests', requireStudent, async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    else filter.status = { $in: ['upcoming', 'live', 'paused'] }; // default: only active-ish contests

    const contests = await Contest.find(filter).sort({ startTime: 1 }).lean();
    res.json(contests.map(c => summarize(c, req.student.sub)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/contests/past — ended contests the student can browse results for
router.get('/contests/past', requireStudent, async (req, res) => {
  try {
    const contests = await Contest.find({ status: 'ended' }).sort({ endTime: -1 }).limit(30).lean();
    res.json(contests.map(c => summarize(c, req.student.sub)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/contests/:id — full detail, including this student's own
// participant entry (score/rank/prize) if they've joined.
router.get('/contests/:id', requireStudent, async (req, res) => {
  try {
    const contest = await Contest.findById(req.params.id).lean();
    if (!contest) return res.status(404).json({ error: 'Contest not found' });

    const myEntry = contest.participants.find(p => p.matric === req.student.sub) || null;
    res.json({ ...summarize(contest, req.student.sub), myEntry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/contests/:id/join
router.post('/contests/:id/join', requireStudent, contestJoinLimiter, async (req, res) => {
  try {
    const [contest, student] = await Promise.all([
      Contest.findById(req.params.id),
      Student.findOne({ matric: req.student.sub }),
    ]);
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    await joinContest(contest, student);
    res.json({ success: true, contestId: contest._id, entryFeePaid: contest.entryFee });
  } catch (e) {
    const status = { NOT_JOINABLE: 400, ALREADY_JOINED: 409, FULL: 409, INSUFFICIENT_CREDITS: 400 }[e.code] || 500;
    res.status(status).json({ error: e.message, code: e.code || 'SERVER_ERROR' });
  }
});

// GET /api/contests/:id/leaderboard — live-computed ranking, works for
// any contest with participants (most useful while status is 'live').
router.get('/contests/:id/leaderboard', requireStudent, async (req, res) => {
  try {
    const contest = await Contest.findById(req.params.id).lean();
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    res.json(computeLeaderboard(contest));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/contests/:id/quiz-questions — for quiz-type contests only.
// Must have joined first. Strips the answer field so it can't be
// inspected client-side before submitting.
router.get('/contests/:id/quiz-questions', requireStudent, async (req, res) => {
  try {
    const Question = require('../models/Question');
    const contest = await Contest.findById(req.params.id).populate('questions').lean();
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    if (contest.type !== 'quiz') return res.status(400).json({ error: 'This is not a quiz-type contest' });
    if (!contest.participants.some(p => p.matric === req.student.sub)) {
      return res.status(403).json({ error: 'Join the contest first' });
    }
    if (contest.status !== 'live') return res.status(400).json({ error: 'This contest is not live' });

    const already = contest.participants.find(p => p.matric === req.student.sub);
    if (already && already.score > 0) {
      return res.status(400).json({ error: 'You have already submitted your quiz for this contest' });
    }

    const questions = (contest.questions || []).map(q => ({ _id: q._id, course: q.course, q: q.q, opts: q.opts }));
    res.json({ questions, contestTitle: contest.title });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/contests/:id/submit-quiz — { answers: { [questionId]: selectedOptionIndex } }
// Score is computed server-side against the real answer key, never
// trusted from the client, then recorded via the same participant-score
// path the generic /score endpoint uses.
router.post('/contests/:id/submit-quiz', requireStudent, async (req, res) => {
  try {
    const Question = require('../models/Question');
    const { answers } = req.body;
    if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'answers object is required' });

    const contest = await Contest.findById(req.params.id).populate('questions');
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    if (contest.type !== 'quiz') return res.status(400).json({ error: 'This is not a quiz-type contest' });
    if (contest.status !== 'live') return res.status(400).json({ error: 'This contest is not live' });

    const participant = contest.participants.find(p => p.matric === req.student.sub);
    if (!participant) return res.status(403).json({ error: 'Join the contest first' });
    if (participant.score > 0) return res.status(400).json({ error: 'You have already submitted your quiz for this contest' });

    let correct = 0;
    for (const q of contest.questions) {
      const picked = answers[String(q._id)];
      if (Number.isInteger(picked) && picked === q.ans) correct++;
    }
    const score = contest.questions.length ? Math.round((correct / contest.questions.length) * 100) : 0;

    await updateParticipantScore(contest, req.student.sub, score);
    res.json({ success: true, score, correct, total: contest.questions.length });
  } catch (e) {
    const status = { NOT_PARTICIPANT: 403 }[e.code] || 500;
    res.status(status).json({ error: e.message, code: e.code || 'SERVER_ERROR' });
  }
});

// POST /api/contests/:id/score — submit/update this student's score for
// a quiz/leaderboard/timed contest. (Raffle contests ignore this.)
router.post('/contests/:id/score', requireStudent, async (req, res) => {
  try {
    const { score } = req.body;
    if (!Number.isFinite(score)) return res.status(400).json({ error: 'A numeric score is required' });

    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    if (contest.type === 'quiz') return res.status(400).json({ error: 'Use /submit-quiz for quiz-type contests' });
    if (contest.status !== 'live') return res.status(400).json({ error: 'This contest is not live' });

    await updateParticipantScore(contest, req.student.sub, score);
    res.json({ success: true });
  } catch (e) {
    const status = { NOT_PARTICIPANT: 403 }[e.code] || 500;
    res.status(status).json({ error: e.message, code: e.code || 'SERVER_ERROR' });
  }
});

module.exports = router;
