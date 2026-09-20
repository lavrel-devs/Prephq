const cron = require('node-cron');
const { runBulkDailyRefresh } = require('./credit.service');
const { transitionContestStates, spawnRecurringContests } = require('./contest.service');

// ── Scheduler ─────────────────────────────────────────────────
// New in v1.2. Two jobs:
//   1. Daily credit refresh — midnight WAT (UTC+1), i.e. 23:00 UTC.
//      node-cron expressions are evaluated in server time, so we run
//      it in the 'Africa/Lagos' timezone (WAT, no DST) rather than
//      doing manual UTC math — clearer and correct even if the host
//      machine's local TZ differs.
//   2. Contest state transitions — every minute, moves contests
//      between upcoming -> live -> ended based on startTime/endTime
//      and settles prizes when a contest ends. v1.3: the same tick
//      also checks recurring contest templates and spawns a fresh
//      Contest the moment one's scheduled slot arrives.
let contestTickRunning = false; // a slow tick must not overlap the next one (double settlement risk)
let refreshRunning = false;

function startScheduler() {
  cron.schedule('0 0 * * *', async () => {
    if (refreshRunning) return;
    refreshRunning = true;
    try {
      const { applied } = await runBulkDailyRefresh();
      console.log(`[scheduler] Daily credit refresh applied to ${applied} students`);
    } catch (e) {
      console.error('[scheduler] Daily refresh failed:', e.message);
    } finally { refreshRunning = false; }
  }, { timezone: 'Africa/Lagos' });

  cron.schedule('* * * * *', async () => {
    if (contestTickRunning) return;
    contestTickRunning = true;
    try {
      await transitionContestStates();
      await spawnRecurringContests();
    } catch (e) {
      console.error('[scheduler] Contest tick failed:', e.message);
    } finally { contestTickRunning = false; }
  });

  console.log('[scheduler] Started: daily credit refresh (00:00 WAT), contest transitions + recurring spawns (every minute)');
}

module.exports = { startScheduler };
