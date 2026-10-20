// Activation codes + daily/custom plans (v1.7.1). In-memory: models are stubbed, no database needed.
const assert = require('assert'), path = require('path');
const abs = p => require.resolve(path.join(__dirname, '..', 'src', p));
const ent = require(abs('services/entitlements.service.js'));
const PlanCode = require(abs('models/PlanCode.js')), Student = require(abs('models/Student.js'));
const Payment = require(abs('models/Payment.js')), SupportRequest = require(abs('models/SupportRequest.js'));
const Notification = require(abs('models/Notification.js'));

// ── plan helpers ──
assert.deepStrictEqual(ent.resolvePlanDays('daily'), { days: 1 });
assert.deepStrictEqual(ent.resolvePlanDays('weekly'), { days: 7 });
assert.deepStrictEqual(ent.resolvePlanDays('lifetime', 5), { days: null });
assert.deepStrictEqual(ent.resolvePlanDays('custom', 14), { days: 14 });
assert.deepStrictEqual(ent.resolvePlanDays('monthly', 14), { days: 14 }, 'admin can shorten a plan');
assert.ok(ent.resolvePlanDays('custom').error, 'custom needs days');
assert.ok(ent.resolvePlanDays('custom', 0).error && ent.resolvePlanDays('custom', 4000).error && ent.resolvePlanDays('custom', 1.5).error);
assert.ok(ent.resolvePlanDays('hourly').error);
assert.ok(!ent.STUDENT_PERIODS.includes('custom') && ent.STUDENT_PERIODS.includes('daily'), 'students can buy daily but never see custom');
assert.strictEqual(ent.planText('custom', 14), 'Custom · 14 days');
assert.strictEqual(ent.planText('weekly', 7), 'Weekly');

// ── in-memory stores ──
const codes = [], students = { ADA: { matric: 'ADA', name: 'Ada', tier: 'free', premiumPlan: null, tierExpiresAt: null }, BOB: { matric: 'BOB', name: 'Bob', tier: 'free' } };
const payments = [], notes = [], reqs = [{ code: 'PH-AAAAA', status: 'open' }];
let n = 0;
PlanCode.create = async d => { if (codes.some(c => c.code === d.code)) { const e = new Error('dup'); e.code = 11000; throw e; } const c = { _id: String(++n), status: 'unused', usedBy: '', ...d }; codes.push(c); return c; };
PlanCode.findOne = async f => codes.find(c => c.code === f.code) || null;
PlanCode.findOneAndUpdate = async (f, u) => { const c = codes.find(x => x._id === f._id && x.status === f.status); if (!c) return null; Object.assign(c, u); return c; };
PlanCode.updateOne = async (f, u) => { const c = codes.find(x => x._id === f._id); if (c) Object.assign(c, u); return {}; };
Student.exists = async f => !!students[f.matric];
Student.findOne = async f => students[f.matric] ? { ...students[f.matric] } : null;
Student.updateOne = async (f, u) => { Object.assign(students[f.matric], u); return {}; };
Payment.create = async d => { payments.push(d); return d; };
Notification.create = async d => { notes.push(d); return d; };
SupportRequest.updateOne = async (f, u) => { const r = reqs.find(x => x.code === f.code && x.status === f.status); if (r) Object.assign(r, u); return {}; };

const svc = require(abs('services/planCode.service.js'));
const fails = async (p, status) => { try { await p; assert.fail('expected failure'); } catch (e) { assert.strictEqual(e.status, status, e.message); } };

(async () => {
  assert.strictEqual(svc.normalizeCode('x7k2 9qmp-4rbt'), 'X7K2-9QMP-4RBT');

  await fails(svc.createCodes({ plan: 'custom' }), 400);                       // custom needs days
  await fails(svc.createCodes({ plan: 'weekly', quantity: 3, forMatric: 'ADA' }), 400);
  await fails(svc.createCodes({ plan: 'weekly', forMatric: 'NOBODY' }), 404);
  const bulk = await svc.createCodes({ plan: 'daily', quantity: 3 });
  assert.strictEqual(bulk.length, 3); assert.ok(bulk.every(c => c.days === 1 && /^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/.test(c.code)));

  // redeem a custom 10-day code (typed sloppily) bound to ADA, which answers request PH-AAAAA
  const [c1] = await svc.createCodes({ plan: 'custom', customDays: 10, forMatric: 'ADA', amount: 1500, requestCode: 'PH-AAAAA' });
  await fails(svc.redeemCode('BOB', c1.code), 403);                           // someone else's code
  await fails(svc.redeemCode('ADA', 'NOPE-NOPE-NOPE'), 404);
  const t0 = Date.now();
  const r1 = await svc.redeemCode('ADA', c1.code.toLowerCase().replace(/-/g, ' '));
  assert.strictEqual(r1.plan, 'custom'); assert.strictEqual(r1.label, 'Custom · 10 days');
  assert.strictEqual(students.ADA.tier, 'premium'); assert.strictEqual(students.ADA.premiumPlan, 'custom');
  assert.ok(Math.abs(new Date(students.ADA.tierExpiresAt).getTime() - (t0 + 10 * 86400000)) < 5000);
  assert.strictEqual(payments.length, 1); assert.strictEqual(payments[0].amount, 1500);
  assert.strictEqual(reqs[0].status, 'resolved', 'redeeming closes the upgrade request');
  assert.strictEqual(notes.length, 1);
  await fails(svc.redeemCode('ADA', c1.code), 409);                           // one-time

  // renewing while still Premium stacks days on top of what is left
  const before = new Date(students.ADA.tierExpiresAt).getTime();
  await svc.redeemCode('ADA', bulk[0].code);
  assert.strictEqual(new Date(students.ADA.tierExpiresAt).getTime(), before + 86400000);
  assert.strictEqual(students.ADA.premiumPlan, 'daily');

  // revoked codes are dead; lifetime accounts can't waste a code; lifetime codes never expire
  bulk[1].status = 'revoked'; await fails(svc.redeemCode('ADA', bulk[1].code), 410);
  const [life] = await svc.createCodes({ plan: 'lifetime' });
  const r2 = await svc.redeemCode('BOB', life.code);
  assert.strictEqual(r2.lifetime, true); assert.strictEqual(students.BOB.tierExpiresAt, null);
  await fails(svc.redeemCode('BOB', bulk[2].code), 409);
  assert.strictEqual(bulk[2].status, 'unused', 'a refused redeem must not burn the code');

  // a failed upgrade hands the code back
  const [c3] = await svc.createCodes({ plan: 'weekly' });
  const orig = Student.updateOne; Student.updateOne = async () => { throw new Error('db down'); };
  await assert.rejects(svc.redeemCode('ADA', c3.code));
  Student.updateOne = orig;
  assert.strictEqual(c3.status, 'unused'); assert.strictEqual(c3.usedBy, '');
  console.log('plan codes + daily/custom plans OK');
})().catch(e => { console.error(e); process.exit(1); });
