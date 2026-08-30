const Contest = require('../models/Contest');
const Student = require('../models/Student');
const { applyCreditDelta } = require('../utils/credits');
const { notify } = require('./notification.service');

// ── State transitions ────────────────────────────────────────
// Called every minute by the scheduler. Moves contests through
// upcoming -> live -> ended based on startTime/endTime, and settles
// prizes the moment a contest ends. 'draft', 'paused', and 'cancelled'
// contests never auto-transition — draft requires an admin to publish
// it (set status to 'upcoming'/'live'), paused requires an explicit
// resume, and cancelled is terminal.
async function transitionContestStates() {
  const now = new Date();

  await sendUpcomingReminders();

  const toGoLive = await Contest.find({ status: 'upcoming', startTime: { $lte: now } });
  for (const contest of toGoLive) {
    contest.status = 'live';
    await contest.save();
  }

  const toEnd = await Contest.find({ status: 'live', endTime: { $lte: now } });
  for (const contest of toEnd) {
    await settleContest(contest);
  }
}

// ── Join ──────────────────────────────────────────────────────
// Deducts the entry fee (if any) and adds the student to
// `participants`. Throws with `.code` for the route to branch on:
// NOT_JOINABLE | ALREADY_JOINED | FULL | INSUFFICIENT_CREDITS
async function joinContest(contest, student) {
  if (!['upcoming', 'live'].includes(contest.status)) {
    const err = new Error('This contest is not open for entry right now');
    err.code = 'NOT_JOINABLE';
    throw err;
  }

  const already = contest.participants.some(p => p.matric === student.matric);
  if (already) {
    const err = new Error('You have already joined this contest');
    err.code = 'ALREADY_JOINED';
    throw err;
  }

  if (contest.maxParticipants && contest.participants.length >= contest.maxParticipants) {
    const err = new Error('This contest is full');
    err.code = 'FULL';
    throw err;
  }

  if (contest.entryFee > 0) {
    if ((student.credits || 0) < contest.entryFee) {
      const err = new Error('Insufficient credits for the entry fee');
      err.code = 'INSUFFICIENT_CREDITS';
      throw err;
    }
    await applyCreditDelta({
      matric: student.matric,
      delta: -contest.entryFee,
      reason: 'contest_entry',
      note: `Entry fee for "${contest.title}"`,
      actor: student.matric,
      contestId: contest._id,
      studentDoc: student,
    });
  }

  contest.participants.push({
    studentId: student._id,
    matric: student.matric,
    username: student.username || '',
    joinedAt: new Date(),
    entryFeePaid: contest.entryFee,
  });
  await contest.save();

  return contest;
}

// ── Score update (quiz/leaderboard/timed contests) ──────────────
// Sets/overwrites a participant's score. Raffle-type contests ignore
// score entirely (winners are drawn randomly at settlement).
async function updateParticipantScore(contest, matric, score) {
  const participant = contest.participants.find(p => p.matric === matric);
  if (!participant) {
    const err = new Error('Not a participant in this contest');
    err.code = 'NOT_PARTICIPANT';
    throw err;
  }
  participant.score = score;
  await contest.save();
  return contest;
}

// ── Live leaderboard (computed, not persisted) ──────────────────
function computeLeaderboard(contest) {
  return [...contest.participants]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .map((p, i) => ({
      rank: i + 1,
      matric: p.matric,
      username: p.username,
      score: p.score || 0,
    }));
}

// ── Settlement ────────────────────────────────────────────────
// Runs once, when a contest transitions to 'ended' (either via the
// scheduler or an admin manually ending/cancelling-with-settlement).
// Quiz/leaderboard/timed contests rank by score; raffle contests draw
// random winners from the participant pool. Prizes are paid per
// `prizeDistribution` ({rank, amount}) and each winner is notified.
async function settleContest(contest) {
  if (contest.participants.length === 0 || contest.prizeDistribution.length === 0) {
    contest.status = 'ended';
    await contest.save();
    return contest;
  }

  let ranked;
  if (contest.type === 'raffle') {
    // Random draw: shuffle a copy of participants, assign rank by draw order.
    ranked = [...contest.participants].sort(() => Math.random() - 0.5);
  } else {
    ranked = [...contest.participants].sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  for (let i = 0; i < ranked.length; i++) {
    const rank = i + 1;
    ranked[i].rank = rank;

    const tier = contest.prizeDistribution.find(t => t.rank === rank);
    if (tier && tier.amount > 0) {
      ranked[i].prizeAwarded = tier.amount;
      await applyCreditDelta({
        matric: ranked[i].matric,
        delta: tier.amount,
        reason: 'contest_prize',
        note: `Prize for rank #${rank} in "${contest.title}"`,
        actor: 'system',
        contestId: contest._id,
      });
      await notify({
        matric: ranked[i].matric,
        type: 'contest_result',
        title: `You placed #${rank} in ${contest.title}!`,
        message: `You won ${tier.amount} credits`,
        relatedId: contest._id,
        relatedType: 'Contest',
      });
    }
  }

  // Write ranks/prizes back onto the actual participants subdocs
  // (ranked is a shuffled/sorted copy — match by matric to update in place).
  const byMatric = Object.fromEntries(ranked.map(r => [r.matric, r]));
  contest.participants.forEach(p => {
    const r = byMatric[p.matric];
    if (r) { p.rank = r.rank; p.prizeAwarded = r.prizeAwarded; }
  });

  contest.status = 'ended';
  await contest.save();
  return contest;
}

// ── Reminders ─────────────────────────────────────────────────
// Notifies already-joined participants of upcoming contests starting
// within the next 15 minutes, once per contest (remindersSent flag).
// Runs from the same per-minute scheduler tick as state transitions.
async function sendUpcomingReminders() {
  const now = new Date();
  const soon = new Date(now.getTime() + 15 * 60 * 1000);

  const due = await Contest.find({
    status: 'upcoming',
    remindersSent: false,
    startTime: { $gte: now, $lte: soon },
  });

  for (const contest of due) {
    for (const p of contest.participants) {
      await notify({
        matric: p.matric,
        type: 'contest_reminder',
        title: `"${contest.title}" starts soon`,
        message: `Starting at ${contest.startTime.toISOString()}`,
        relatedId: contest._id,
        relatedType: 'Contest',
      });
    }
    contest.remindersSent = true;
    await contest.save();
  }
}

module.exports = {
  transitionContestStates,
  joinContest,
  updateParticipantScore,
  computeLeaderboard,
  settleContest,
  sendUpcomingReminders,
};
