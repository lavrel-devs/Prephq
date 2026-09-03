const Contest = require('../models/Contest');
const ContestTemplate = require('../models/ContestTemplate');
const Question = require('../models/Question');
const Student = require('../models/Student');
const { applyCreditDelta } = require('../utils/credits');
const { notify } = require('./notification.service');
const { courseMatchFilter } = require('../utils/courseMatch');

// WAT (UTC+1, no DST) "now" broken into the pieces recurrence checks
// need. Matches the same offset approach as credit.service.js's
// watDateString, kept local here since this is the only other place
// that needs day-of-week / time-of-day, not just the date.
function watNow() {
  const shifted = new Date(Date.now() + 60 * 60 * 1000);
  return {
    dateStr: shifted.toISOString().slice(0, 10),
    hhmm: shifted.toISOString().slice(11, 16),
    dayOfWeek: shifted.getUTCDay(), // shifted is already WAT-offset, so getUTCDay() reads the WAT day
  };
}

// ── Recurring contest spawning ───────────────────────────────────
// Checked every minute alongside state transitions. A template spawns
// a fresh Contest the moment "now" (WAT) matches its scheduled
// slot — guarded by lastGeneratedAt so a template can't double-spawn
// across the several ticks that fall within its target minute window
// (in practice just the once, since we check the WAT date string, not
// just hh:mm).
async function spawnRecurringContests() {
  const now = watNow();
  const templates = await ContestTemplate.find({ active: true, timeOfDay: now.hhmm });

  for (const tpl of templates) {
    if (tpl.frequency === 'weekly' && tpl.dayOfWeek !== now.dayOfWeek) continue;

    const alreadySpawnedToday = tpl.lastGeneratedAt
      && new Date(tpl.lastGeneratedAt.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10) === now.dateStr;
    if (alreadySpawnedToday) continue;

    try { await spawnFromTemplate(tpl, now); }
    catch (e) { console.error(`[contest.service] Failed to spawn from template ${tpl._id}:`, e.message); }
  }
}

async function spawnFromTemplate(tpl) {
  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + tpl.durationMinutes * 60 * 1000);

  let questions = tpl.questions || [];
  if (tpl.type === 'quiz' && tpl.autoPickCourse) {
    // Fresh random draw each cycle — this is what makes a recurring
    // quiz contest feel new instead of a rerun of the same questions.
    const matchFilter = await courseMatchFilter(tpl.autoPickCourse);
    const pool = await Question.aggregate([
      { $match: matchFilter },
      { $sample: { size: tpl.autoPickCount || 10 } },
    ]);
    questions = pool.map(q => q._id);
  }

  const contest = await Contest.create({
    title: tpl.title,
    description: tpl.description,
    type: tpl.type,
    startTime, endTime,
    entryFee: tpl.entryFee,
    maxParticipants: tpl.maxParticipants,
    prizePool: tpl.prizePool,
    prizeDistribution: tpl.prizeDistribution,
    questions,
    status: 'live',
    createdBy: `template:${tpl._id}`,
  });

  tpl.lastGeneratedAt = startTime;
  tpl.lastSpawnedContestId = contest._id;
  await tpl.save();

  return contest;
}

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

// ── Teams: create, join, score ───────────────────────────────────
const crypto = require('crypto');
const TEAM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateTeamCode() {
  return Array.from({ length: 5 }, () => TEAM_CODE_CHARS[crypto.randomInt(TEAM_CODE_CHARS.length)]).join('');
}

function findStudentTeam(contest, matric) {
  return contest.teams.find(t => t.members.some(m => m.matric === matric));
}

// Creates a new team and adds the creator as its first member, paying
// their entry fee individually (there's no shared team wallet — each
// member pays their own way in).
async function createTeam(contest, student, teamName) {
  if (!contest.teamBased) { const err = new Error('This is not a team-based contest'); err.code = 'NOT_TEAM_CONTEST'; throw err; }
  if (!['upcoming', 'live'].includes(contest.status)) { const err = new Error('This contest is not open for entry right now'); err.code = 'NOT_JOINABLE'; throw err; }
  if (findStudentTeam(contest, student.matric)) { const err = new Error('You are already on a team in this contest'); err.code = 'ALREADY_JOINED'; throw err; }
  if (!teamName || !teamName.trim()) { const err = new Error('Team name is required'); err.code = 'INVALID_TEAM_NAME'; throw err; }

  if (contest.entryFee > 0) {
    if ((student.credits || 0) < contest.entryFee) { const err = new Error('Insufficient credits for the entry fee'); err.code = 'INSUFFICIENT_CREDITS'; throw err; }
    await applyCreditDelta({
      matric: student.matric, delta: -contest.entryFee, reason: 'contest_entry',
      note: `Entry fee for "${contest.title}" (team: ${teamName.trim()})`, actor: student.matric,
      contestId: contest._id, studentDoc: student,
    });
  }

  let teamCode;
  do { teamCode = generateTeamCode(); } while (contest.teams.some(t => t.teamCode === teamCode));

  contest.teams.push({
    teamCode, teamName: teamName.trim(),
    members: [{ studentId: student._id, matric: student.matric, username: student.username || '' }],
  });
  await contest.save();
  return contest.teams[contest.teams.length - 1];
}

// Joins an existing team by its shareable code, paying the entry fee
// individually. Throws TEAM_FULL if teamSize is set and already met.
async function joinTeam(contest, student, teamCode) {
  if (!contest.teamBased) { const err = new Error('This is not a team-based contest'); err.code = 'NOT_TEAM_CONTEST'; throw err; }
  if (!['upcoming', 'live'].includes(contest.status)) { const err = new Error('This contest is not open for entry right now'); err.code = 'NOT_JOINABLE'; throw err; }
  if (findStudentTeam(contest, student.matric)) { const err = new Error('You are already on a team in this contest'); err.code = 'ALREADY_JOINED'; throw err; }

  const team = contest.teams.find(t => t.teamCode === String(teamCode || '').toUpperCase());
  if (!team) { const err = new Error('No team found with that code'); err.code = 'TEAM_NOT_FOUND'; throw err; }
  if (contest.teamSize && team.members.length >= contest.teamSize) { const err = new Error('This team is full'); err.code = 'TEAM_FULL'; throw err; }

  if (contest.entryFee > 0) {
    if ((student.credits || 0) < contest.entryFee) { const err = new Error('Insufficient credits for the entry fee'); err.code = 'INSUFFICIENT_CREDITS'; throw err; }
    await applyCreditDelta({
      matric: student.matric, delta: -contest.entryFee, reason: 'contest_entry',
      note: `Entry fee for "${contest.title}" (team: ${team.teamName})`, actor: student.matric,
      contestId: contest._id, studentDoc: student,
    });
  }

  team.members.push({ studentId: student._id, matric: student.matric, username: student.username || '' });
  await contest.save();
  return team;
}

// Sets a team's score — locked after the first successful submission,
// mirroring the individual-contest rule (one shot, whichever teammate
// takes the quiz first sets it for the whole team).
async function updateTeamScore(contest, matric, score) {
  const team = findStudentTeam(contest, matric);
  if (!team) { const err = new Error('You are not on a team in this contest'); err.code = 'NOT_PARTICIPANT'; throw err; }
  team.score = score;
  await contest.save();
  return team;
}

function computeTeamLeaderboard(contest) {
  return [...contest.teams]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .map((t, i) => ({ rank: i + 1, teamName: t.teamName, teamCode: t.teamCode, score: t.score || 0, memberCount: t.members.length }));
}


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
// v1.3: team-based contests settle by team rank instead, and each
// tier's prize is split evenly across that team's members.
async function settleContest(contest) {
  if (contest.teamBased) return settleTeamContest(contest);

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

// ── Team settlement ───────────────────────────────────────────
// Same rank-then-pay logic as settleContest, but ranks teams and
// splits each tier's prize evenly across that team's members
// (integer division — any remainder from an uneven split is simply
// not distributed, rather than picking who gets the extra credit).
async function settleTeamContest(contest) {
  if (contest.teams.length === 0 || contest.prizeDistribution.length === 0) {
    contest.status = 'ended';
    await contest.save();
    return contest;
  }

  let ranked;
  if (contest.type === 'raffle') {
    ranked = [...contest.teams].sort(() => Math.random() - 0.5);
  } else {
    ranked = [...contest.teams].sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  for (let i = 0; i < ranked.length; i++) {
    const rank = i + 1;
    ranked[i].rank = rank;

    const tier = contest.prizeDistribution.find(t => t.rank === rank);
    if (tier && tier.amount > 0 && ranked[i].members.length > 0) {
      const perMember = Math.floor(tier.amount / ranked[i].members.length);
      ranked[i].prizeAwarded = tier.amount;
      if (perMember > 0) {
        for (const member of ranked[i].members) {
          await applyCreditDelta({
            matric: member.matric,
            delta: perMember,
            reason: 'contest_prize',
            note: `Team "${ranked[i].teamName}" placed #${rank} in "${contest.title}"`,
            actor: 'system',
            contestId: contest._id,
          });
          await notify({
            matric: member.matric,
            type: 'contest_result',
            title: `Team "${ranked[i].teamName}" placed #${rank}!`,
            message: `You won ${perMember} credits`,
            relatedId: contest._id,
            relatedType: 'Contest',
          });
        }
      }
    }
  }

  const byCode = Object.fromEntries(ranked.map(r => [r.teamCode, r]));
  contest.teams.forEach(t => {
    const r = byCode[t.teamCode];
    if (r) { t.rank = r.rank; t.prizeAwarded = r.prizeAwarded; }
  });

  contest.status = 'ended';
  await contest.save();
  return contest;
}


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
  spawnRecurringContests,
  createTeam,
  joinTeam,
  updateTeamScore,
  computeTeamLeaderboard,
  findStudentTeam,
};
