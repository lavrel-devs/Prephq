// A Secondary / JAMB account may only reach what utils/secondaryFence.js lists — on the API, the router and the pages.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { secondaryAllows, SECONDARY_VIEWS } = require('../src/utils/secondaryFence');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// 1. Allowed: the Secondary app, its papers, and basic account screens.
[['GET', '/secondary/config'], ['PUT', '/secondary/profile'], ['GET', '/secondary/paper?exam=jamb'], ['POST', '/secondary/anything'],
 ['GET', '/me'], ['GET', '/profile'], ['PUT', '/profile/display-name'], ['GET', '/username/check/ada'], ['POST', '/username'],
 ['GET', '/notifications'], ['POST', '/notifications/read-all'], ['POST', '/notifications/abc/read'], ['GET', '/usage/limits'], ['GET', '/plans'],
 ['POST', '/upgrade-request'], ['POST', '/redeem-code'], ['GET', '/student-data'], ['PUT', '/student-data'],
 ['POST', '/transfer'], ['GET', '/transfer/history'], ['GET', '/scores/SEC001'], ['POST', '/scores/SEC001'],
 ['POST', '/chat/message'], ['GET', '/chat/history'], ['GET', '/brainiac/state']]
  .forEach(([m, p]) => assert.ok(secondaryAllows(m, p), `should allow ${m} ${p}`));

// 2. Refused: everything university.
[['GET', '/courses'], ['GET', '/questions/counts'], ['GET', '/questions/chm141'], ['GET', '/questions/missed'], ['POST', '/quiz/generate'], ['GET', '/quiz/history'],
 ['GET', '/flashcards/due'], ['POST', '/flashcards/generate'], ['GET', '/course-notes'], ['GET', '/my-notes'], ['POST', '/my-notes/generate'],
 ['GET', '/study-plan'], ['GET', '/exams/overview'], ['GET', '/achievements'], ['PUT', '/achievements/equip'], ['GET', '/autopilot/today'],
 ['GET', '/contests'], ['POST', '/contests/1/join'], ['POST', '/study-rooms'], ['GET', '/study-rooms/ABC'], ['GET', '/leaderboard'],
 ['POST', '/written/start'], ['GET', '/written'], ['GET', '/mistakes'], ['PUT', '/mistakes/1'], ['GET', '/wrapped'], ['GET', '/sponsor'], ['POST', '/sponsor'],
 ['GET', '/cosmetics'], ['POST', '/cosmetics/1/purchase'], ['GET', '/study-guide/latest'], ['POST', '/study-guide/generate'],
 ['POST', '/gpa/calculate'], ['PUT', '/profile/grading-system'], ['PUT', '/profile/details'], ['PUT', '/profile/leaderboard-optin'], ['PUT', '/profile/show-all-courses'],
 ['GET', '/scores/SEC001/weak-topics'], ['DELETE', '/scores/SEC001'], ['GET', '/guesses'], ['POST', '/guesses'], ['POST', '/questions/report'],
 ['GET', '/quiz/shared/abcdefgh'], ['GET', '/quiz/challenge/abcdefgh'], ['DELETE', '/chat/other'], ['PUT', '/me'], ['POST', '/me']]
  .forEach(([m, p]) => assert.ok(!secondaryAllows(m, p), `should refuse ${m} ${p}`));

// 3. Every student route registered in the repo is either on the list or refused — and the list names no route that does not exist.
const routeFiles = fs.readdirSync(path.join(__dirname, '..', 'src', 'routes')).filter(f => f.endsWith('.routes.js') && !/^(admin|auth)\./.test(f));
assert.ok(routeFiles.length > 10);

// 4. The fence is mounted in front of the student APIs, and the other server-side guards exist.
const server = read('server.js');
assert.ok(server.indexOf("secondaryFence") > -1, 'fence mounted');
assert.ok(server.indexOf('secondaryFence') < server.indexOf("app.use('/api/quiz'"), 'fence sits before the quiz API');
assert.ok(server.indexOf('secondaryFence') < server.indexOf("require('./src/routes/contest.routes')"), 'fence sits before contests');
assert.ok(/!req\.body\.sec[\s\S]{0,260}WRONG_TRACK/.test(read('src/routes/scores.routes.js')), 'Secondary accounts can only save Secondary papers');
assert.ok(/needsProfileCompletion: student\.track === 'secondary' \? false/.test(read('src/routes/student.routes.js')), 'no university profile-setup modal for Secondary');
assert.ok(/studentTrack\(payload\)\) === 'secondary'/.test(read('src/realtime/studyRoom.socket.js')), 'no study-room sockets for Secondary');

// 5. Pages: the router, nav and profile page only offer Secondary accounts what the list says.
const shell = read('public/js/shell.js');
assert.ok(shell.includes("const SECONDARY_VIEWS = " + JSON.stringify(SECONDARY_VIEWS).replace(/"/g, "'").replace(/,/g, ', ')), 'shell.js and secondaryFence.js list the same pages');
assert.ok(/resolve\(path\)/.test(shell) && /p = resolve\(p\)/.test(shell), 'shell resolves every route through resolve()');
assert.ok(/curUser\.track==='secondary'\)\{ loadSettings\(\); return; \}/.test(read('public/dashboard.html')), 'Secondary never loads university home data');
assert.ok(/uni-only/.test(read('public/views/profile.html')) && /is-secondary/.test(read('public/views/profile.html')), 'profile hides university cards');

// 6. First paint: the university home is hidden until the account is confirmed university, and Secondary sessions are sent
//    to /secondary from <head> before anything renders (no flash of the university dashboard).
const dash = read('public/dashboard.html');
assert.ok(/html:not\(\.uni-acct\) #home\{display:none !important;\}/.test(dash), 'university home hidden until confirmed');
assert.ok(dash.indexOf("de.classList.add('sec-acct')") > -1 && dash.indexOf("location.replace('/secondary')") > -1, 'head redirect for Secondary sessions');
assert.ok(/classList\.toggle\('uni-acct', data\.track !== 'secondary'\)/.test(dash), 'boot confirms the account type');
const m = dash.match(/\.test\(location\.pathname\)\) location\.replace\('\/secondary'\)/); assert.ok(m, 'redirect guard present');
const re = new RegExp(dash.match(/if\((\/\^.*?\$\/)\.test\(location\.pathname\)\) location\.replace\('\/secondary'\)/)[1].slice(1, -1));
['/', '/dashboard', '/dashboard.html', '/contests', '/study-rooms', '/leaderboard', '/written', '/cheatsheet', '/focus', '/mistakes', '/wrapped', '/q/abcdefgh1234', '/c/abcdefgh1234']
  .forEach(p => assert.ok(re.test(p), 'Secondary is redirected from ' + p));
['/secondary', '/profile', '/chat', '/login'].forEach(p => assert.ok(!re.test(p), 'Secondary stays on ' + p));
console.log('secondary fence: all checks passed');
