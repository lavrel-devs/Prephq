const PlanCode = require('../models/PlanCode');
const Student = require('../models/Student');
const Payment = require('../models/Payment');
const SupportRequest = require('../models/SupportRequest');
const { generateCode } = require('../utils/codeGen');
const { isPremiumActive, resolvePlanDays, planText } = require('./entitlements.service');
const { notify } = require('./notification.service');

class CodeError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

// "x7k2 9qmp 4rbt", "X7K29QMP4RBT" and "X7K2-9QMP-4RBT" are all the same code.
function normalizeCode(raw) {
  const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 12 ? `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}` : c;
}

// Admin side: make `quantity` fresh codes for one plan.
async function createCodes({ plan, customDays, quantity = 1, forMatric = '', note = '', amount = 0, requestCode = '', createdBy = '' }) {
  const { days, error } = resolvePlanDays(plan, customDays);
  if (error) throw new CodeError(400, error);
  const qty = Math.min(Math.max(parseInt(quantity, 10) || 1, 1), 50);
  const bound = String(forMatric || '').trim().toUpperCase();
  if (bound && qty > 1) throw new CodeError(400, 'A code for one specific student can only be made one at a time');
  if (bound && !(await Student.exists({ matric: bound }))) throw new CodeError(404, 'No student has that matric number');
  const paid = Number(amount);
  const out = [];
  for (let i = 0; i < qty; i++) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        out.push(await PlanCode.create({
          code: generateCode(), plan, days, forMatric: bound, note: String(note || '').slice(0, 200),
          amount: Number.isFinite(paid) && paid > 0 ? paid : 0, requestCode: String(requestCode || ''), createdBy,
        }));
        break;
      } catch (e) { if (e.code !== 11000 || attempt === 4) throw e; }  // 11000 = collision, draw another
    }
  }
  return out;
}

// Student side: redeem a code on my own account. The code is claimed with one atomic update FIRST (so two
// taps / two devices can't both win), the plan is applied next, and the code is handed back if that fails.
async function redeemCode(matric, raw) {
  const code = normalizeCode(raw);
  if (code.length < 8) throw new CodeError(400, 'Enter your activation code');

  const doc = await PlanCode.findOne({ code });
  if (!doc) throw new CodeError(404, "That code isn't valid. Check it and try again.", 'CODE_INVALID');
  if (doc.status === 'used') throw new CodeError(409, 'This code has already been used.', 'CODE_USED');
  if (doc.status === 'revoked') throw new CodeError(410, 'This code is no longer active. Ask support for a new one.', 'CODE_REVOKED');
  if (doc.forMatric && doc.forMatric !== matric) throw new CodeError(403, 'This code was issued to a different account.', 'CODE_OTHER_ACCOUNT');

  const student = await Student.findOne({ matric });
  if (!student) throw new CodeError(404, 'Student not found');
  const active = isPremiumActive(student);
  if (active && student.premiumPlan === 'lifetime') throw new CodeError(409, 'You already have Premium Lifetime — nothing to add.', 'ALREADY_LIFETIME');
  if (active && !student.tierExpiresAt) throw new CodeError(409, 'Your Premium has no expiry date, so this code is not needed. Contact support if this looks wrong.', 'ALREADY_PERMANENT');

  const claimed = await PlanCode.findOneAndUpdate(
    { _id: doc._id, status: 'unused' },
    { status: 'used', usedBy: matric, usedAt: new Date() },
    { new: true },
  );
  if (!claimed) throw new CodeError(409, 'This code has already been used.', 'CODE_USED');

  let expiresAt = null;
  try {
    if (claimed.plan !== 'lifetime') {
      // Renewing while Premium is still running adds the days on top of what's left instead of resetting it.
      const now = Date.now();
      const base = active && new Date(student.tierExpiresAt).getTime() > now ? new Date(student.tierExpiresAt).getTime() : now;
      expiresAt = new Date(base + claimed.days * 86400000);
    }
    await Student.updateOne({ matric }, { tier: 'premium', premiumPlan: claimed.plan, tierExpiresAt: expiresAt });
  } catch (e) {
    await PlanCode.updateOne({ _id: claimed._id, usedBy: matric }, { status: 'unused', usedBy: '', usedAt: null }).catch(() => {});
    throw e;
  }

  // Bookkeeping that must never undo the upgrade.
  const label = planText(claimed.plan, claimed.days);
  try {
    if (claimed.amount > 0) await Payment.create({ matric, name: student.name, amount: claimed.amount, method: 'other', reference: claimed.code, note: `Premium ${label} (activation code)`, status: 'confirmed' });
    if (claimed.requestCode) await SupportRequest.updateOne({ code: claimed.requestCode, status: 'open' }, { status: 'resolved', resolvedBy: 'student (activation code)', resolvedAt: new Date(), resolutionNote: `Activation code redeemed — Premium ${label}` });
    await notify({ matric, type: 'announcement', title: '⭐ Premium activated', message: `Your Premium ${label} plan is now active.` });
  } catch (e) { console.error('[plan-code] post-redeem bookkeeping failed:', e.message); }

  return { plan: claimed.plan, label, days: claimed.days, lifetime: claimed.plan === 'lifetime', tierExpiresAt: expiresAt };
}

module.exports = { CodeError, normalizeCode, createCodes, redeemCode };
