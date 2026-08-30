const express = require('express');
const Contest = require('../../models/Contest');
const Student = require('../../models/Student');
const { requireAdmin } = require('../../middleware/auth');
const { applyCreditDelta } = require('../../utils/credits');
const { settleContest } = require('../../services/contest.service');
const { notify } = require('../../services/notification.service');

const router = express.Router();
router.use(requireAdmin);

// ══════════════════════════════════════════════════════════════
//  CONTESTS — CRUD
// ══════════════════════════════════════════════════════════════

// GET /api/admin/contests/questions?course=... — question picker source
// for building quiz-type contests. Returns id/text/course/options only
// (no answer needed here — admin picks by content, not correctness).
router.get('/contests-question-bank', async (req, res) => {
  try {
    const Question = require('../../models/Question');
    const filter = {};
    if (req.query.course) filter.course = req.query.course;
    const questions = await Question.find(filter).sort({ createdAt: -1 }).limit(300).lean();
    res.json(questions.map(q => ({ _id: q._id, course: q.course, q: q.q, opts: q.opts, tag: q.tag })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/contests — list all, any status
router.get('/contests', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const contests = await Contest.find(filter).sort({ createdAt: -1 }).lean();
    res.json(contests.map(c => ({ ...c, participantCount: c.participants.length })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/contests/:id — full detail including all participants/scores
router.get('/contests/:id', async (req, res) => {
  try {
    const contest = await Contest.findById(req.params.id).lean();
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    res.json(contest);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/contests — create. Auto-status: 'draft' if explicitly
// requested, otherwise 'upcoming' (or 'live' if startTime is already in
// the past) so a contest is playable the moment it's created without an
// extra "publish" step.
router.post('/contests', async (req, res) => {
  try {
    const {
      title, description, bannerImage, startTime, endTime,
      entryFee, maxParticipants, prizePool, prizeDistribution,
      type, questions, status,
    } = req.body;

    if (!title || !startTime || !endTime || !type) {
      return res.status(400).json({ error: 'title, startTime, endTime, and type are required' });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (end <= start) return res.status(400).json({ error: 'endTime must be after startTime' });

    let resolvedStatus = status;
    if (!resolvedStatus) resolvedStatus = start <= new Date() ? 'live' : 'upcoming';

    const contest = await Contest.create({
      title, description: description || '', bannerImage: bannerImage || '',
      startTime: start, endTime: end,
      entryFee: entryFee || 0,
      maxParticipants: maxParticipants || null,
      prizePool: prizePool || 0,
      prizeDistribution: prizeDistribution || [],
      type, questions: questions || [],
      status: resolvedStatus,
      createdBy: req.admin.sub,
    });

    res.status(201).json(contest);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/contests/:id — edit fields. Cannot edit an ended/cancelled contest.
router.put('/contests/:id', async (req, res) => {
  try {
    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    if (['ended', 'cancelled'].includes(contest.status)) {
      return res.status(400).json({ error: 'Cannot edit a contest that has ended or been cancelled' });
    }

    const editable = [
      'title', 'description', 'bannerImage', 'startTime', 'endTime',
      'entryFee', 'maxParticipants', 'prizePool', 'prizeDistribution', 'questions',
    ];
    for (const field of editable) {
      if (req.body[field] !== undefined) contest[field] = req.body[field];
    }
    await contest.save();
    res.json(contest);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/admin/contests/:id — only allowed pre-live (draft/upcoming),
// so a contest that's already collected entries/participants can't just
// vanish. Use cancel for live/ended contests.
router.delete('/contests/:id', async (req, res) => {
  try {
    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    if (!['draft', 'upcoming'].includes(contest.status)) {
      return res.status(400).json({ error: 'Only draft or upcoming contests can be deleted — cancel this one instead' });
    }
    await Contest.deleteOne({ _id: contest._id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/contests/:id/duplicate — clone as a fresh draft
router.post('/contests/:id/duplicate', async (req, res) => {
  try {
    const original = await Contest.findById(req.params.id).lean();
    if (!original) return res.status(404).json({ error: 'Contest not found' });

    const { _id, participants, createdAt, updatedAt, status, ...rest } = original;
    const copy = await Contest.create({
      ...rest,
      title: `${original.title} (copy)`,
      status: 'draft',
      participants: [],
      createdBy: req.admin.sub,
    });
    res.status(201).json(copy);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  LIFECYCLE CONTROLS
// ══════════════════════════════════════════════════════════════

// POST /api/admin/contests/:id/start — force to 'live' now (e.g. a draft
// or an upcoming contest the admin wants to open early).
router.post('/contests/:id/start', async (req, res) => {
  try {
    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    if (['ended', 'cancelled'].includes(contest.status)) {
      return res.status(400).json({ error: 'Cannot start an ended or cancelled contest' });
    }
    contest.status = 'live';
    if (contest.startTime > new Date()) contest.startTime = new Date();
    await contest.save();
    res.json(contest);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/contests/:id/pause
router.post('/contests/:id/pause', async (req, res) => {
  try {
    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    if (contest.status !== 'live') return res.status(400).json({ error: 'Only a live contest can be paused' });
    contest.status = 'paused';
    await contest.save();
    res.json(contest);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/contests/:id/resume
router.post('/contests/:id/resume', async (req, res) => {
  try {
    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    if (contest.status !== 'paused') return res.status(400).json({ error: 'This contest is not paused' });
    contest.status = 'live';
    await contest.save();
    res.json(contest);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/contests/:id/extend — push endTime out by N minutes
router.post('/contests/:id/extend', async (req, res) => {
  try {
    const minutes = parseInt(req.body.minutes, 10);
    if (!minutes || minutes <= 0) return res.status(400).json({ error: 'minutes must be a positive number' });

    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    if (!['live', 'paused', 'upcoming'].includes(contest.status)) {
      return res.status(400).json({ error: 'Cannot extend an ended or cancelled contest' });
    }
    contest.endTime = new Date(contest.endTime.getTime() + minutes * 60 * 1000);
    await contest.save();
    res.json(contest);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/contests/:id/end — end + settle prizes right now, ahead of schedule
router.post('/contests/:id/end', async (req, res) => {
  try {
    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    if (!['live', 'paused'].includes(contest.status)) {
      return res.status(400).json({ error: 'Only a live or paused contest can be ended' });
    }
    const settled = await settleContest(contest);
    res.json(settled);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/contests/:id/cancel — cancel WITHOUT settling prizes;
// refunds entry fees already paid.
router.post('/contests/:id/cancel', async (req, res) => {
  try {
    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    if (['ended', 'cancelled'].includes(contest.status)) {
      return res.status(400).json({ error: 'This contest is already ended or cancelled' });
    }

    for (const p of contest.participants) {
      if (p.entryFeePaid > 0) {
        await applyCreditDelta({
          matric: p.matric,
          delta: p.entryFeePaid,
          reason: 'refund',
          note: `Refund — "${contest.title}" was cancelled`,
          actor: req.admin.sub,
          contestId: contest._id,
        });
        await notify({
          matric: p.matric,
          type: 'contest_result',
          title: `"${contest.title}" was cancelled`,
          message: `Your ${p.entryFeePaid}-credit entry fee has been refunded`,
          relatedId: contest._id,
          relatedType: 'Contest',
        });
      }
    }

    contest.status = 'cancelled';
    await contest.save();
    res.json(contest);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  PARTICIPANT MANAGEMENT
// ══════════════════════════════════════════════════════════════

// POST /api/admin/contests/:id/participants — manually add a participant
router.post('/contests/:id/participants', async (req, res) => {
  try {
    const { matric } = req.body;
    if (!matric) return res.status(400).json({ error: 'matric is required' });

    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ error: 'Contest not found' });

    const student = await Student.findOne({ matric: matric.toUpperCase() });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    if (contest.participants.some(p => p.matric === student.matric)) {
      return res.status(409).json({ error: 'Already a participant' });
    }

    contest.participants.push({
      studentId: student._id,
      matric: student.matric,
      username: student.username || '',
      joinedAt: new Date(),
      entryFeePaid: 0, // admin-added, no fee charged
    });
    await contest.save();
    res.json({ success: true, participantCount: contest.participants.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/admin/contests/:id/participants/:matric — manually remove
router.delete('/contests/:id/participants/:matric', async (req, res) => {
  try {
    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ error: 'Contest not found' });

    const matric = req.params.matric.toUpperCase();
    const before = contest.participants.length;
    contest.participants = contest.participants.filter(p => p.matric !== matric);
    if (contest.participants.length === before) return res.status(404).json({ error: 'Participant not found' });

    await contest.save();
    res.json({ success: true, participantCount: contest.participants.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/contests/:id/participants/:matric — manually adjust a
// participant's score or prize (e.g. correcting a dispute)
router.put('/contests/:id/participants/:matric', async (req, res) => {
  try {
    const contest = await Contest.findById(req.params.id);
    if (!contest) return res.status(404).json({ error: 'Contest not found' });

    const matric = req.params.matric.toUpperCase();
    const participant = contest.participants.find(p => p.matric === matric);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    const { score, prizeAwarded, rank } = req.body;
    if (Number.isFinite(score)) participant.score = score;
    if (Number.isFinite(rank)) participant.rank = rank;

    // Manual prize adjustment credits/debits the difference and logs it,
    // rather than silently overwriting the stored number.
    if (Number.isFinite(prizeAwarded) && prizeAwarded !== participant.prizeAwarded) {
      const diff = prizeAwarded - (participant.prizeAwarded || 0);
      if (diff !== 0) {
        await applyCreditDelta({
          matric,
          delta: diff,
          reason: diff > 0 ? 'admin_grant' : 'admin_deduct',
          note: `Manual prize adjustment for "${contest.title}"`,
          actor: req.admin.sub,
          contestId: contest._id,
          allowNegative: diff < 0, // trust admin override here
        });
      }
      participant.prizeAwarded = prizeAwarded;
    }

    await contest.save();
    res.json({ success: true, participant });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  EXPORT
// ══════════════════════════════════════════════════════════════

// GET /api/admin/contests/:id/export — participant list + scores as CSV
router.get('/contests/:id/export', async (req, res) => {
  try {
    const contest = await Contest.findById(req.params.id).lean();
    if (!contest) return res.status(404).json({ error: 'Contest not found' });

    const rows = ['matric,username,score,rank,entryFeePaid,prizeAwarded,joinedAt'];
    contest.participants.forEach(p => {
      rows.push([
        p.matric, p.username || '', p.score || 0, p.rank ?? '',
        p.entryFeePaid || 0, p.prizeAwarded || 0, new Date(p.joinedAt).toISOString(),
      ].join(','));
    });

    const filename = `contest-${contest.title.replace(/[^a-z0-9]/gi, '_')}-results.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(rows.join('\n'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
