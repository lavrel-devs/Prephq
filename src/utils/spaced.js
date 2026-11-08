// Spaced review of missed questions (v1.9.1). Stateless: it reads a question's answer history, newest first.
// A question is "missed" while its latest answer is wrong. The gap before it comes back grows with every
// consecutive miss: 1 day after the first, 3 days after a second, 7 days after a third or more.
const STEPS_DAYS = [1, 3, 7];
const DAY = 86400000;

// recent: [{ correct: Boolean, ts: Date|number }], newest first. now: ms (injectable for tests).
function reviewState(recent, now = Date.now()) {
  if (!Array.isArray(recent) || !recent.length || recent[0].correct) return { missed: false, due: false, dueAt: null };
  let streak = 0;
  while (streak < recent.length && !recent[streak].correct) streak++;
  const gap = STEPS_DAYS[Math.min(streak, STEPS_DAYS.length) - 1] * DAY;
  const dueAt = new Date(new Date(recent[0].ts).getTime() + gap);
  return { missed: true, due: dueAt.getTime() <= now, dueAt, streak };
}

module.exports = { reviewState, STEPS_DAYS };
