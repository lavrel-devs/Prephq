// v1.12: a student account belongs to ONE app (university or Secondary / JAMB). Checks the route gate and the login/register rules.
const assert = require('assert'), fs = require('fs'), path = require('path');
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test';
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { requireTrack } = require(path.join(ROOT, 'src/middleware/auth.js'));
const Session = require(path.join(ROOT, 'src/models/Session.js')), Student = require(path.join(ROOT, 'src/models/Student.js'));
const { isSessionAllowed } = require(path.join(ROOT, 'src/middleware/auth.js'));

const q = v => { const p = Promise.resolve(v); p.select = () => p; p.lean = () => p; return p; };
(async () => {
  let track = 'university';
  Session.findById = () => q({ revoked: false });
  Student.findOne = () => q({ active: true, mustChangePassword: false, track });
  const run = async (need, t, sid) => {
    track = t; const payload = { role: 'student', sub: 'M' + t + sid, sid };
    await isSessionAllowed(payload);                       // fills the same cache requireStudent fills
    let out = null; const res = { status(c) { out = { c }; return this; }, json(b) { out = { ...out, ...b }; return this; } };
    requireTrack(need)({ student: payload }, res, () => { out = { c: 200 }; });
    return out;
  };
  assert.strictEqual((await run('secondary', 'university', 'a')).c, 403);
  assert.strictEqual((await run('secondary', 'university', 'b')).code, 'WRONG_TRACK');
  assert.strictEqual((await run('secondary', 'secondary', 'c')).c, 200);
  assert.strictEqual((await run('university', 'secondary', 'd')).c, 403);
  assert.strictEqual((await run('university', 'university', 'e')).c, 200);

  const auth = read('src/routes/auth.routes.js');
  assert.ok(/WRONG_TRACK/.test(auth) && /req\.body\.audience/.test(auth), 'login refuses the wrong app');
  assert.ok(auth.indexOf("if (!valid) return res.status(401)") < auth.indexOf('WRONG_TRACK'), 'password is checked before the app, so no account probing');
  assert.ok(/req\.body\.track === 'secondary'/.test(auth), 'signup chooses the app once');
  assert.ok(/WRONG_TRACK/.test(read('src/routes/scores.routes.js')), 'secondary papers only from secondary accounts');
  assert.ok(/requireTrack\('secondary'\)/.test(read('src/routes/secondary.routes.js')), 'whole secondary API is gated');
  assert.ok(!/st\.track = (track|'secondary')/.test(read('src/routes/secondary.routes.js')), 'students cannot flip their own track');
  console.log('track lock: university and secondary accounts are separate (route gate, login, signup, scores)');
})().catch(e => { console.error(e); process.exit(1); });
