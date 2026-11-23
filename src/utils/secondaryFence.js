// Wreddi Secondary — the ONE list of API calls a Secondary / JAMB account may make (pure, no DB, unit-tested).
//
// A Secondary account gets: the Secondary app, its own papers/scores, the basic account screens (profile, username, wallet,
// plan, notifications, upgrade / redeem a code, settings backup) and the Study Assistant. Everything else that the
// university app offers (courses, quizzes, flashcards, notes, study plan, contests, study rooms, leaderboard, written exams,
// GPA tools, sponsor link, achievements, cosmetics, wrapped, mistake notebook ...) is closed to it. Add a line here to open
// something to Secondary accounts; anything not listed is refused with 403 WRONG_TRACK.
//
// Paths are matched relative to /api (what Express gives a middleware mounted on '/api').
const RULES = [
  [/^\/secondary(\/|$)/,                 null],                       // the Secondary app itself (also guarded by requireTrack)
  [/^\/me$/,                             ['GET']],
  [/^\/profile$/,                        ['GET']],
  [/^\/profile\/display-name$/,          ['PUT']],
  [/^\/username(\/check\/[^/]+)?$/,      ['GET', 'POST']],
  [/^\/notifications(\/.*)?$/,           ['GET', 'POST']],
  [/^\/usage\/limits$/,                  ['GET']],
  [/^\/plans$/,                          ['GET']],
  [/^\/upgrade-request$/,                ['POST']],
  [/^\/redeem-code$/,                    ['POST']],
  [/^\/student-data$/,                   ['GET', 'PUT']],
  [/^\/transfer(\/history)?$/,           ['GET', 'POST']],
  [/^\/scores\/[^/]+$/,                  ['GET', 'POST']],            // own papers; POST must carry a `sec` block (scores.routes.js)
  [/^\/chat\/(history|quota|message)$/,  ['GET', 'POST', 'DELETE']],
  [/^\/brainiac(\/.*)?$/,                ['GET', 'POST', 'PUT', 'DELETE']],
  [/^\/version$/,                        ['GET']],
  [/^\/platform\/status$/,                ['GET']],   // v1.14 banner / maintenance notice
  [/^\/invite\//,                        ['GET']],
];

// Shell pages (SPA routes) a Secondary account may open. HOME for them is /secondary.
const SECONDARY_VIEWS = ['/secondary', '/profile', '/chat'];

function secondaryAllows(method, apiPath) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(apiPath || '').split('?')[0].replace(/\/+$/, '') || '/';
  for (const [re, methods] of RULES) if (re.test(p) && (!methods || methods.includes(m))) return true;
  return false;
}

module.exports = { secondaryAllows, SECONDARY_VIEWS, RULES };
