const express = require('express');
const Contest = require('../models/Contest');
const Student = require('../models/Student');
const { requireStudent } = require('../middleware/auth');
const { contestJoinLimiter } = require('../middleware/rateLimit');
const {
  joinContest, updateParticipantScore, computeLeaderboard,
  createTeam, joinTeam, updateTeamScore, computeTeamLeaderboard, findStudentTeam, submitQuizScore,
} = require('../services/contest.service');
const { isObjectId } = require('../utils/validate');

const VISIBLE_STATUSES = ['upcoming', 'live', 'paused', 'ended', 'cancelled']; // never 'draft'

const router = express.Router();

// Strips the full participants/teams list down to count + "am I in"
// for list views, so we're not shipping every participant's or every
// team's full member data on every card.
function summarize(contest, matric) {
  const obj = contest.toObject ? contest.toObject() : contest;
  if (obj.teamBased) {
    const joined = (obj.teams || []).some(t => t.members.some(m => m.matric === matric));
    return { ...obj, participantCount: (obj.teams || []).reduce((n, t) => n + t.members.length, 0), teamCount: (obj.teams || []).length, joined, teams: undefined, participants: undefined };
  }
  const joined = obj.participants.some(p => p.matric === matric);
  return { ...obj, participantCount: obj.participants.length, joined, participants: undefined };
}

// GET /api/contests — list, filterable by status via ?status=upcoming|live|ended
router.get('/contests', requireStudent, async (req, res) => {
  try {
    // `?status[$ne]=x` parses into an object in Express; only accept a plain known status,
    // otherwise students could list unpublished drafts.
    const filter = {};
    if (typeof req.query.status === 'string' && VISIBLE_STATUSES.includes(req.query.status)) filter.status = req.query.status;
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

// GET /api/contests/:id — full detail. For team-based contests this
// returns `myTeam` (with teamCode to share) instead of `myEntry`.
router.get('/contests/:id', requireStudent, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Contest not found' });
    const contest = await Contest.findById(req.params.id).lean();
    if (!contest || contest.status === 'draft') return res.status(404).json({ error: 'Contest not found' });

    if (contest.teamBased) {
      const myTeam = (contest.teams || []).find(t => t.members.some(m => m.matric === req.student.sub)) || null;
      return res.json({ ...summarize(contest, req.student.sub), myTeam });
    }
    const myEntry = contest.participants.find(p => p.matric === req.student.sub) || null;
    res.json({ ...summarize(contest, req.student.sub), myEntry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/contests/:id/join — individual (non-team) contests only.
router.post('/contests/:id/join', requireStudent, contestJoinLimiter, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Contest not found' });
    const [contest, student] = await Promise.all([
      Contest.findById(req.params.id),
      Student.findOne({ matric: req.student.sub }),
    ]);
    if (!contest || contest.status === 'draft') return res.status(404).json({ error: 'Contest not found' });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    if (contest.teamBased) return res.status(400).json({ error: 'This is a team-based contest — use /team/create or /team/join' });

    await joinContest(contest, student);
    res.json({ success: true, contestId: contest._id, entryFeePaid: contest.entryFee });
  } catch (e) {
    const status = { NOT_JOINABLE: 400, ALREADY_JOINED: 409, FULL: 409, INSUFFICIENT_CREDITS: 400 }[e.code] || 500;
    res.status(status).json({ error: e.message, code: e.code || 'SERVER_ERROR' });
  }
});

// POST /api/contests/:id/team/create — { teamName }
router.post('/contests/:id/team/create', requireStudent, contestJoinLimiter, async (req, res) => {
  try {
    const { teamName } = req.body;
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Contest not found' });
    const [contest, student] = await Promise.all([
      Contest.findById(req.params.id),
      Student.findOne({ matric: req.student.sub }),
    ]);
    if (!contest || contest.status === 'draft') return res.status(404).json({ error: 'Contest not found' });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const team = await createTeam(contest, student, teamName);
    res.json({ success: true, teamCode: team.teamCode, teamName: team.teamName });
  } catch (e) {
    const status = { NOT_TEAM_CONTEST: 400, NOT_JOINABLE: 400, ALREADY_JOINED: 409, INVALID_TEAM_NAME: 400, INSUFFICIENT_CREDITS: 400 }[e.code] || 500;
    res.status(status).json({ error: e.message, code: e.code || 'SERVER_ERROR' });
  }
});

// POST /api/contests/:id/team/join — { teamCode }
router.post('/contests/:id/team/join', requireStudent, contestJoinLimiter, async (req, res) => {
  try {
    const { teamCode } = req.body;
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Contest not found' });
    const [contest, student] = await Promise.all([
      Contest.findById(req.params.id),
      Student.findOne({ matric: req.student.sub }),
    ]);
    if (!contest || contest.status === 'draft') return res.status(404).json({ error: 'Contest not found' });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const team = await joinTeam(contest, student, teamCode);
    res.json({ success: true, teamCode: team.teamCode, teamName: team.teamName, memberCount: team.members.length });
  } catch (e) {
    const status = { NOT_TEAM_CONTEST: 400, NOT_JOINABLE: 400, ALREADY_JOINED: 409, TEAM_NOT_FOUND: 404, TEAM_FULL: 409, INSUFFICIENT_CREDITS: 400 }[e.code] || 500;
    res.status(status).json({ error: e.message, code: e.code || 'SERVER_ERROR' });
  }
});

// GET /api/contests/:id/leaderboard — branches to team leaderboard for
// team-based contests, individual leaderboard otherwise.
router.get('/contests/:id/leaderboard', requireStudent, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Contest not found' });
    const contest = await Contest.findById(req.params.id).lean();
    if (!contest || contest.status === 'draft') return res.status(404).json({ error: 'Contest not found' });
    res.json(contest.teamBased ? computeTeamLeaderboard(contest) : computeLeaderboard(contest));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/contests/:id/quiz-questions — for quiz-type contests only.
// Must have joined (individually, or via a team) first. Strips the
// answer field so it can't be inspected client-side before submitting.
router.get('/contests/:id/quiz-questions', requireStudent, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Contest not found' });
    const contest = await Contest.findById(req.params.id).populate('questions').lean();
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    if (contest.type !== 'quiz') return res.status(400).json({ error: 'This is not a quiz-type contest' });
    if (contest.status !== 'live') return res.status(400).json({ error: 'This contest is not live' });

    if (contest.teamBased) {
      const team = (contest.teams || []).find(t => t.members.some(m => m.matric === req.student.sub));
      if (!team) return res.status(403).json({ error: 'Join or create a team first' });
      if (team.submittedAt || team.score > 0) return res.status(400).json({ error: 'Your team has already submitted this quiz' });
    } else {
      const already = contest.participants.find(p => p.matric === req.student.sub);
      if (!already) return res.status(403).json({ error: 'Join the contest first' });
      if (already.submittedAt || already.score > 0) return res.status(400).json({ error: 'You have already submitted your quiz for this contest' });
    }

    const questions = (contest.questions || []).filter(Boolean).map(q => ({ _id: q._id, course: q.course, q: q.q, opts: q.opts }));
    res.json({ questions, contestTitle: contest.title });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/contests/:id/submit-quiz — { answers: { [questionId]: selectedOptionIndex } }
// Score is computed server-side against the real answer key, never
// trusted from the client. For team contests, whichever teammate
// submits first sets the team's score for everyone.
router.post('/contests/:id/submit-quiz', requireStudent, async (req, res) => {
  try {
    const { answers } = req.body;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return res.status(400).json({ error: 'answers object is required' });
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Contest not found' });

    const contest = await Contest.findById(req.params.id).populate('questions');
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    if (contest.type !== 'quiz') return res.status(400).json({ error: 'This is not a quiz-type contest' });
    if (contest.status !== 'live') return res.status(400).json({ error: 'This contest is not live' });

    if (contest.teamBased) {
      const team = findStudentTeam(contest, req.student.sub);
      if (!team) return res.status(403).json({ error: 'Join or create a team first' });
      if (team.submittedAt || team.score > 0) return res.status(400).json({ error: 'Your team has already submitted this quiz' });
    } else {
      const participant = contest.participants.find(p => p.matric === req.student.sub);
      if (!participant) return res.status(403).json({ error: 'Join the contest first' });
      if (participant.submittedAt || participant.score > 0) return res.status(400).json({ error: 'You have already submitted your quiz for this contest' });
    }

    // Questions deleted from the bank after the contest was built come back as null.
    const questions = (contest.questions || []).filter(Boolean);
    let correct = 0;
    for (const q of questions) {
      const picked = answers[String(q._id)];
      if (Number.isInteger(picked) && picked === q.ans) correct++;
    }
    const score = questions.length ? Math.round((correct / questions.length) * 100) : 0;

    await submitQuizScore(contest._id, req.student.sub, score);

    res.json({ success: true, score, correct, total: questions.length });
  } catch (e) {
    const status = { NOT_PARTICIPANT: 403, ALREADY_SUBMITTED: 409 }[e.code] || 500;
    res.status(status).json({ error: e.message, code: e.code || 'SERVER_ERROR' });
  }
});

// POST /api/contests/:id/score — submit/update score for a
// leaderboard/timed contest (individual or team). Raffle contests
// ignore this; quiz contests must use /submit-quiz instead.
router.post('/contests/:id/score', requireStudent, async (req, res) => {
  try {
    const { score } = req.body;
    if (!Number.isFinite(score) || score < 0 || score > 100000) return res.status(400).json({ error: 'A score between 0 and 100000 is required' });
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Contest not found' });

    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    if (contest.type === 'quiz') return res.status(400).json({ error: 'Use /submit-quiz for quiz-type contests' });
    if (contest.status !== 'live') return res.status(400).json({ error: 'This contest is not live' });

    if (contest.type === 'raffle') return res.status(400).json({ error: 'Raffle contests are not scored' });

    // Client-reported scores can only go UP (a submitted result can't be quietly rewritten).
    // NOTE: this is still client-reported — see README "known limitations".
    const mine = contest.teamBased
      ? findStudentTeam(contest, req.student.sub)
      : contest.participants.find(p => p.matric === req.student.sub);
    if (mine && score <= (mine.score || 0)) return res.json({ success: true, unchanged: true });

    if (contest.teamBased) await updateTeamScore(contest, req.student.sub, score);
    else await updateParticipantScore(contest, req.student.sub, score);

    res.json({ success: true });
  } catch (e) {
    const status = { NOT_PARTICIPANT: 403 }[e.code] || 500;
    res.status(status).json({ error: e.message, code: e.code || 'SERVER_ERROR' });
  }
});

module.exports = router;
