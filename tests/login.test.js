// Sign in with matric OR username (v1.7.7). In-memory: Student/Session are stubbed, no database needed.
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdef'; process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef';
const assert = require('assert'), path = require('path'), http = require('http'), bcrypt = require('bcryptjs');
const abs = p => require.resolve(path.join(__dirname, '..', 'src', p));
const Student = require(abs('models/Student.js')), Session = require(abs('models/Session.js'));

const pw = bcrypt.hashSync('Secret#123', 4);
const mk = o => ({ active: true, devices: [], credits: 5, role: 'student', passwordHash: pw, profileCompleted: true, mustChangePassword: false, save: async () => {}, ...o });
const docs = [
  mk({ matric: 'PSC25CHM102', name: 'Ada Obi', username: 'ada_o' }),
  mk({ matric: 'PSC25BIO101', name: 'Bayo', username: 'psc25chm102' }),            // a username that LOOKS like Ada's matric
  mk({ matric: 'PSC25PHY101', name: 'Chi' }),                                      // never set a username
  mk({ matric: 'PSC25MTH101', name: 'Dayo', username: 'dayo', active: false }),
];
const q = v => ({ then: (a, b) => Promise.resolve(v).then(a, b) });
Student.findOne = f => q(docs.find(d => (f.matric !== undefined && d.matric === f.matric) || (f.username !== undefined && d.username === f.username)) || null);
Session.create = async d => ({ _id: { toString: () => 's1' }, ...d, save: async () => {} });   // issueSession: create() then save()
Session.updateMany = async () => ({}); Session.countDocuments = () => q(0); Session.find = () => q([]);

const express = require('express'); const app = express(); app.use(express.json());
app.use('/api/auth', require(abs('routes/auth.routes.js')));

(async () => {
  const server = http.createServer(app).listen(0); const base = `http://127.0.0.1:${server.address().port}/api/auth/login`;
  const login = async (body) => { const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const P = 'Secret#123';
  try {
    // matric still works, in any case and with stray spaces
    assert.strictEqual((await login({ matric: 'PSC25CHM102', password: P })).body.matric, 'PSC25CHM102');
    assert.strictEqual((await login({ matric: '  psc25chm102 ', password: P })).status, 200);
    // username works: any case, with or without @
    for (const u of ['ada_o', 'ADA_O', '@ada_o', ' Ada_O ']) { const r = await login({ matric: u, password: P }); assert.strictEqual(r.status, 200, u); assert.strictEqual(r.body.matric, 'PSC25CHM102'); }
    assert.strictEqual((await login({ identifier: 'ada_o', password: P })).status, 200, '`identifier` is accepted too');
    // matric wins over a lookalike username
    assert.strictEqual((await login({ matric: 'psc25chm102', password: P })).body.name, 'Ada Obi');
    assert.strictEqual((await login({ matric: '@psc25chm102', password: P })).body.name, 'Bayo', 'but explicitly @-prefixed it is the username');
    // failures are indistinguishable: unknown account vs wrong password
    const unknown = await login({ matric: 'nobody_here', password: P }), wrong = await login({ matric: 'ada_o', password: 'nope' });
    assert.strictEqual(unknown.status, 401); assert.strictEqual(wrong.status, 401); assert.strictEqual(unknown.body.error, wrong.body.error);
    assert.match(unknown.body.error, /matric number, username or password/);
    // a student with no username can still sign in by matric; junk and wrong types are rejected cleanly
    assert.strictEqual((await login({ matric: 'PSC25PHY101', password: P })).status, 200);
    assert.strictEqual((await login({ matric: 'x', password: P })).status, 401);
    assert.strictEqual((await login({ matric: { $ne: '' }, password: P })).status, 400);
    assert.strictEqual((await login({ matric: 'ada_o' })).status, 400);
    // suspended accounts are still refused when they use a username
    assert.strictEqual((await login({ matric: 'dayo', password: P })).status, 403);
    console.log('login by matric or username OK');
  } finally { server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
