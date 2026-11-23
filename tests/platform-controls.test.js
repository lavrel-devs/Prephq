// v1.14 admin controls: live config validation, the maintenance / kill-switch gate, monitoring maths, permissions and alerts.
const assert = require('assert'), fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const cfgSvc = require('../src/services/platformConfig.service');
const { decide } = require('../src/middleware/platformGate');
const monitor = require('../src/services/monitor.service');
const { buildAlerts } = require('../src/utils/alerts');
const A = require('../src/utils/adminAccess');
const { secondaryAllows } = require('../src/utils/secondaryFence');
const D = () => cfgSvc.withDefaults({});

// 1. sanitize: keeps valid input, rejects bad input, ignores unknown keys.
assert.deepStrictEqual(cfgSvc.sanitize({ switches: { aiChat: false, bogus: true }, evil: 1 }), { switches: { aiChat: false } });
assert.throws(() => cfgSvc.sanitize({ switches: { aiChat: 'no' } }), /on or off/);
assert.throws(() => cfgSvc.sanitize({ banner: { tone: 'purple' } }), /Banner style/);
assert.throws(() => cfgSvc.sanitize({ banner: { enabled: true, text: '  ' } }), /banner text/i);
assert.throws(() => cfgSvc.sanitize({ secondary: { maxPracticeCount: 500 } }), /whole number/);
assert.throws(() => cfgSvc.sanitize({ secondary: { papers: { jamb: { minutes: 2 } } } }), /JAMB minutes/);
assert.strictEqual(cfgSvc.sanitize({ secondary: { freeDailyMocks: '' } }).secondary.freeDailyMocks, null);
assert.strictEqual(cfgSvc.sanitize({ secondary: { freeDailyMocks: '3' } }).secondary.freeDailyMocks, 3);
assert.strictEqual(cfgSvc.sanitize({ maintenance: { message: 'x'.repeat(900) } }).maintenance.message.length, 400);
assert.deepStrictEqual(cfgSvc.flatten({ switches: { aiChat: false }, secondary: { exams: { jamb: true } } }), { 'switches.aiChat': false, 'secondary.exams.jamb': true });

// 2. paper shapes: defaults match the built-in numbers; overrides win; nulls fall back.
let c = D();
assert.deepStrictEqual(cfgSvc.paperShape(c, 'jamb', false), { minutes: 120, first: 60, other: 40 });
assert.deepStrictEqual(cfgSvc.paperShape(c, 'waec', false), { minutes: 60, questions: 50 });
assert.deepStrictEqual(cfgSvc.paperShape(c, 'school', true), { minutes: 10, questions: 10 });
c = cfgSvc.withDefaults({ secondary: { papers: { jamb: { minutes: 90, firstSubjectQs: 50 }, waec: { questions: 40, minutes: null } } } });
assert.deepStrictEqual(cfgSvc.paperShape(c, 'jamb', false), { minutes: 90, first: 50, other: 40 });
assert.deepStrictEqual(cfgSvc.paperShape(c, 'waec', false), { minutes: 60, questions: 40 });

// 3. public status: banner audience, maintenance text, Secondary notice.
c = cfgSvc.withDefaults({ banner: { enabled: true, text: 'Hi', tone: 'warn', audience: 'secondary' }, secondary: { motd: 'Study!' } });
assert.deepStrictEqual(cfgSvc.publicStatus(c, 'secondary').banner, { text: 'Hi', tone: 'warn' });
assert.strictEqual(cfgSvc.publicStatus(c, 'university').banner, null);
assert.strictEqual(cfgSvc.publicStatus(c, 'secondary').secondary.motd, 'Study!');
assert.strictEqual(cfgSvc.publicStatus(D(), '').maintenance, null);
assert.ok(cfgSvc.publicStatus(cfgSvc.withDefaults({ maintenance: { enabled: true } }), '').maintenance.message.length > 5);

// 4. gate: normal traffic passes; maintenance blocks students but never admins / status / refresh; switches block only their feature.
assert.strictEqual(decide(D(), 'GET', '/courses'), null);
const mt = cfgSvc.withDefaults({ maintenance: { enabled: true, message: 'Back soon', eta: '6pm' } });
assert.strictEqual(decide(mt, 'GET', '/courses').code, 'MAINTENANCE');
assert.strictEqual(decide(mt, 'POST', '/auth/login').status, 503);
['/admin/stats', '/auth/admin/login', '/auth/refresh', '/platform/status', '/version'].forEach(p => assert.strictEqual(decide(mt, 'GET', p), null, p + ' must stay reachable'));
const off = k => cfgSvc.withDefaults({ switches: { [k]: false } });
assert.strictEqual(decide(off('aiChat'), 'POST', '/chat/message').code, 'FEATURE_OFF');
assert.strictEqual(decide(off('aiChat'), 'GET', '/chat/history'), null, 'history still readable');
assert.strictEqual(decide(off('aiQuiz'), 'POST', '/quiz/generate').code, 'FEATURE_OFF');
assert.strictEqual(decide(off('contests'), 'POST', '/contests/1/join').code, 'FEATURE_OFF');
assert.strictEqual(decide(off('contests'), 'GET', '/contests'), null, 'contests still viewable');
assert.strictEqual(decide(off('studyRooms'), 'POST', '/study-rooms').code, 'FEATURE_OFF');
assert.strictEqual(decide(off('creditTransfers'), 'POST', '/transfer').code, 'FEATURE_OFF');
assert.strictEqual(decide(off('signups'), 'POST', '/auth/register').code, 'SIGNUPS_CLOSED');
assert.strictEqual(decide(off('logins'), 'POST', '/auth/login').code, 'LOGINS_OFF');
assert.strictEqual(decide(off('logins'), 'POST', '/auth/admin/login'), null, 'admins can always sign in');
const secOff = cfgSvc.withDefaults({ secondary: { enabled: false } });
assert.strictEqual(decide(secOff, 'GET', '/secondary/config').code, 'FEATURE_OFF');
assert.strictEqual(decide(secOff, 'POST', '/auth/register', { track: 'secondary' }).code, 'SIGNUPS_CLOSED');
assert.strictEqual(decide(secOff, 'POST', '/auth/register', { track: 'university' }), null, 'university sign-up unaffected');
assert.strictEqual(decide(cfgSvc.withDefaults({ secondary: { signupsOpen: false } }), 'POST', '/auth/register', { track: 'secondary' }).code, 'SIGNUPS_CLOSED');

// 5. monitor maths.
assert.strictEqual(monitor.percentile([1, 2, 3, 4, 100], 95), 100);
assert.strictEqual(monitor.percentile([], 95), 0);
assert.strictEqual(monitor.normalizePath('/api/questions/chm141?x=1'), '/api/questions/:key');
assert.strictEqual(monitor.normalizePath('/api/admin/students/65f1c2a4b8e3d9a1c0ffee12/credits'), '/api/admin/students/:id/credits');
assert.strictEqual(monitor.normalizePath('/api/contests/42/join'), '/api/contests/:n/join');
assert.strictEqual(monitor.normalizePath('/api/me'), '/api/me');
const now = Date.now();
for (let i = 0; i < 18; i++) monitor.record('GET', '/api/me', 200, 40, now);
monitor.record('GET', '/api/boom', 500, 90, now); monitor.record('POST', '/api/slow', 200, 2500, now);
const snap = monitor.snapshot(now);
assert.ok(snap.requests60 >= 20 && snap.errorRate5 > 0 && snap.slow.some(s => s.route === 'POST /api/slow'));
assert.ok(snap.topRoutes[0].route === 'GET /api/me' && snap.errorRoutes.some(r => r.route === 'GET /api/boom'));
assert.strictEqual(snap.series.length, 60);

// 6. alerts read like sentences and fire at sensible thresholds.
const quiet = { snap: { errorRate5: 0, p95Ms15: 100, now: { lag: 5, rss: 150 } }, dbPingMs: 20, dbState: 1, cfg: D(), pendingSupport: 0 };
assert.deepStrictEqual(buildAlerts(quiet), []);
assert.ok(buildAlerts({ ...quiet, dbState: 0 }).some(a => a.level === 'danger'));
assert.ok(buildAlerts({ ...quiet, snap: { ...quiet.snap, errorRate5: 7 } }).some(a => a.level === 'danger' && /7%/.test(a.text)));
assert.ok(buildAlerts({ ...quiet, cfg: mt }).some(a => /Maintenance mode is ON/.test(a.text)));
assert.ok(buildAlerts({ ...quiet, cfg: off('aiChat') }).some(a => /aiChat/.test(a.text)));

// 7. permissions: new areas exist and are enforced; old areas are untouched.
assert.ok(A.AREA_KEYS.includes('secondary') && A.AREA_KEYS.includes('system'));
const full = { full: true, permissions: [] }, secOnly = { full: false, permissions: ['secondary'] }, sysView = { full: false, permissions: ['system:view'] }, stu = { full: false, permissions: ['students'] };
const allowed = (acc, m, p) => A.checkAccess(acc, m, p);
assert.ok(allowed(secOnly, 'PUT', '/secondary/questions/1') && allowed(secOnly, 'GET', '/secondary/students'));
assert.ok(!allowed(secOnly, 'GET', '/platform/monitor') && !allowed(secOnly, 'PUT', '/platform/controls'));
assert.ok(allowed(sysView, 'GET', '/platform/monitor') && !allowed(sysView, 'PUT', '/platform/controls') && !allowed(sysView, 'POST', '/platform/maintenance/purge'));
assert.ok(!allowed(stu, 'GET', '/secondary/overview') && !allowed(stu, 'GET', '/platform/errors'));
assert.ok(allowed(full, 'POST', '/platform/sessions/signout-all'));
assert.ok(!allowed({ full: false, permissions: ['analytics'] }, 'POST', '/platform/sessions/signout-all'), 'emergency sign-out needs the System area');

// 8. wiring.
const server = read('server.js');
assert.ok(server.indexOf('monitor.middleware') < server.indexOf("platformGate').platformGate"), 'monitor sits in front of the gate');
assert.ok(server.indexOf("platformGate').platformGate") < server.indexOf("'/api/auth', require"), 'gate sits in front of sign-in');
assert.ok(/admin\.secondary\.routes/.test(server) && /admin\.system\.routes/.test(server) && /monitor\.recordError/.test(server));
assert.ok(secondaryAllows('GET', '/platform/status'), 'Secondary accounts can read the banner / maintenance status');
assert.ok(/EXAM_OFF/.test(read('src/routes/secondary.routes.js')) && /freeDailyMocks/.test(read('src/routes/secondary.routes.js')) && /disabled: \{ \$ne: true \}/.test(read('src/routes/secondary.routes.js')), 'Secondary runtime honours admin settings');
assert.ok(/AdminSecondary\.open\(\)/.test(read('public/admin.html')) && /AdminSystem\.open\(\)/.test(read('public/admin.html')), 'admin screens wired');
assert.ok(/platform-status\.js/.test(read('public/dashboard.html')) && /platform-status\.js/.test(read('public/login.html')));
console.log('platform controls: all checks passed');
