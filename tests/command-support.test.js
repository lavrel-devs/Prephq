// Command centre support modules: segment filters (run through mingo against sample students), tags, export cleaning, IP blocking.
const assert = require('assert');
const { buildFilter, cleanTags } = require('../src/services/segment.service');
const { cleanDoc, flat } = require('../src/utils/dataExport');
const gate = require('../src/middleware/blockGate');
let Query = null; try { ({ Query } = require('mingo')); } catch (e) { /* optional dev dependency */ }

const NOW = Date.UTC(2026, 10, 24), D = 86400000, ago = n => new Date(NOW - n * D), ahead = n => new Date(NOW + n * D);
const S = [
  { matric: 'A1', name: 'Ada Obi',    active: true,  track: 'university', tier: 'free',    credits: 0,   createdAt: ago(3),   lastActiveAt: ago(1),  selectedCourses: ['CHM101', 'MTH101'] },
  { matric: 'B2', name: 'Bayo Musa',  active: false, track: 'secondary',  tier: 'premium', premiumPlan: 'monthly', tierExpiresAt: ahead(5),  credits: 40,  createdAt: ago(90),  lastActiveAt: ago(45), selectedCourses: [] },
  { matric: 'C3', name: 'Chi Eze',    tier: 'premium', premiumPlan: 'lifetime', tierExpiresAt: null, credits: 10, createdAt: ago(400), lastActiveAt: null, selectedCourses: ['chm101'] },   // old account: no track, no active field
  { matric: 'D4', name: 'Dayo Bello', active: true,  track: 'university', tier: 'premium', premiumPlan: 'weekly', tierExpiresAt: ago(2),     credits: 5,   createdAt: ago(20),  lastActiveAt: ago(9),  selectedCourses: ['PHY101'] },
];
const run = (q, tags) => { const r = buildFilter(q, NOW, tags === undefined ? null : tags); assert.ok(!r.error, r.error); return Query ? S.filter(x => new Query(r.filter).test(x)).map(x => x.matric).sort().join(',') : null; };
const err = q => { const r = buildFilter(q, NOW); assert.ok(r.error, 'expected error for ' + JSON.stringify(q)); };

assert.deepStrictEqual(buildFilter({}, NOW), { filter: {} });
if (Query) {
  assert.strictEqual(run({ track: 'university' }), 'A1,C3,D4');         // accounts with no track count as university
  assert.strictEqual(run({ track: 'secondary' }), 'B2');
  assert.strictEqual(run({ tier: 'premium' }), 'B2,C3,D4');
  assert.strictEqual(run({ tier: 'free' }), 'A1');
  assert.strictEqual(run({ status: 'active' }), 'A1,C3,D4');            // missing "active" means active
  assert.strictEqual(run({ status: 'suspended' }), 'B2');
  assert.strictEqual(run({ course: 'chm101' }), 'A1,C3');               // case-insensitive, exact
  assert.strictEqual(run({ course: 'chm' }), '');
  assert.strictEqual(run({ inactiveDays: '30' }), 'B2,C3');             // never active also counts
  assert.strictEqual(run({ activeDays: '7' }), 'A1');
  assert.strictEqual(run({ joinedDays: '30' }), 'A1,D4');
  assert.strictEqual(run({ expiringDays: '7' }), 'B2');                 // lifetime never expires
  assert.strictEqual(run({ expiredDays: '7' }), 'D4');
  assert.strictEqual(run({ minCredits: '10', maxCredits: '40' }), 'B2,C3');
  assert.strictEqual(run({ q: 'bayo' }), 'B2');
  assert.strictEqual(run({ q: 'd4' }), 'D4');
  assert.strictEqual(run({ q: '.*' }), '');                              // regex characters are escaped
  assert.strictEqual(run({ tier: 'premium', status: 'active' }), 'C3,D4');
  assert.strictEqual(run({}, ['A1', 'B2']), 'A1,B2');                    // tag → matric list
  assert.strictEqual(run({ tier: 'premium' }, ['A1', 'B2']), 'B2');
} else console.log('(mingo not installed: filter checks skipped)');
['track', 'tier', 'status'].forEach(k => err({ [k]: 'nope' }));
['inactiveDays', 'joinedDays', 'expiringDays', 'minCredits'].forEach(k => err({ [k]: 'abc' }));
err({ inactiveDays: '0' }); err({ joinedDays: '99999' });

// tags
assert.deepStrictEqual(cleanTags(undefined), { tags: [] });
assert.deepStrictEqual(cleanTags(' Follow-Up, VIP ,vip,<b>x</b>'), { tags: ['follow-up', 'vip', 'bxb'] });
assert.deepStrictEqual(cleanTags(['A', 'a', 'b c']), { tags: ['a', 'b c'] });
assert.strictEqual(cleanTags('a'.repeat(40)).tags[0].length, 24);
assert.ok(cleanTags(Array.from({ length: 11 }, (_, i) => 't' + i)).error);

// export cleaning: secrets never leave, values become plain
const oid = { toHexString: () => 'abc123' };
const d = cleanDoc({ _id: oid, name: 'Ada', passwordHash: 'x', password: 'y', devices: [1], refreshHash: 'z', __v: 2, createdAt: new Date(0), nested: { a: oid }, telegramChatId: '5' }, ['telegramChatId']);
assert.deepStrictEqual(d, { _id: 'abc123', name: 'Ada', createdAt: '1970-01-01T00:00:00.000Z', nested: { a: 'abc123' } });
assert.strictEqual(flat(null), ''); assert.strictEqual(flat({ a: 1 }), '{"a":1}'); assert.strictEqual(flat(new Date(0)), '1970-01-01T00:00:00.000Z'); assert.strictEqual(flat(5), 5);

// IP helpers + gate
assert.strictEqual(gate.normIp('::FFFF:41.58.1.2'), '41.58.1.2'); assert.strictEqual(gate.normIp(' 2001:DB8::1 '), '2001:db8::1');
(async () => {
  const Block = require('../src/models/Block');
  Block.find = () => ({ select: () => ({ lean: async () => [{ value: '41.58.1.2' }] }) });
  gate.invalidate();
  const call = async (path, ip) => { let out = { next: false }; await gate({ path, ip }, { status(c) { out.status = c; return this; }, json(b) { out.body = b; }, type() { return this; }, send(b) { out.html = b; } }, () => { out.next = true; }); return out; };
  assert.strictEqual((await call('/api/student/quizzes', '41.58.1.2')).status, 403);
  assert.strictEqual((await call('/api/student/quizzes', '::ffff:41.58.1.2')).status, 403);
  assert.ok((await call('/dashboard', '41.58.1.2')).html.includes('Access blocked'));
  assert.ok((await call('/api/student/quizzes', '8.8.8.8')).next);
  assert.ok((await call('/api/admin/command/x', '41.58.1.2')).next, 'admin API never blocked');
  assert.ok((await call('/api/auth/admin/login', '41.58.1.2')).next, 'admin sign-in never blocked');
  assert.ok((await call('/admin.html', '41.58.1.2')).next, 'admin page never blocked');
  assert.ok((await call('/js/app.js', '41.58.1.2')).next, 'static assets pass');
  console.log('command-support: ok');
})().catch(e => { console.error(e); process.exit(1); });
