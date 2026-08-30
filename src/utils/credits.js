const Student = require('../models/Student');
const CreditTransaction = require('../models/CreditTransaction');

// Applies `delta` (positive or negative) to a student's credit balance
// and writes an audit-trail CreditTransaction. Throws if the student
// doesn't exist, or if the resulting balance would go negative and
// `allowNegative` isn't set.
//
// v1.2: accepts an already-loaded `studentDoc` (so callers doing a
// multi-step operation, like transfers, don't refetch mid-flow), plus
// `contestId` / `relatedTransferId` to link the ledger row to the
// contest or transfer that caused it.
async function applyCreditDelta({
  matric, delta, reason, note = '', actor = 'system', allowNegative = false,
  studentDoc = null, contestId = null, relatedTransferId = null,
}) {
  const student = studentDoc || await Student.findOne({ matric: matric.toUpperCase() });
  if (!student) throw new Error('Student not found');

  const newBalance = (student.credits || 0) + delta;
  if (newBalance < 0 && !allowNegative) {
    const err = new Error('Insufficient credits');
    err.code = 'INSUFFICIENT_CREDITS';
    throw err;
  }

  student.credits = newBalance;
  await student.save();

  const tx = await CreditTransaction.create({
    matric: student.matric,
    delta,
    balanceAfter: newBalance,
    reason,
    note,
    actor,
    contestId,
    relatedTransferId,
  });

  return { balance: newBalance, transaction: tx };
}

module.exports = { applyCreditDelta };
