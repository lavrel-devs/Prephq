const Student = require('../models/Student');
const CreditTransaction = require('../models/CreditTransaction');

// Applies `delta` (positive or negative) to a student's credit balance
// and writes an audit-trail CreditTransaction. Throws if the student
// doesn't exist, or if the resulting balance would go negative and
// `allowNegative` isn't set.
//
// The balance change is a single atomic, conditional $inc — NOT a
// read-modify-write on a loaded document. The old version computed
// `credits + delta` in JS and saved it, so two overlapping requests
// (double-tap, two tabs, a transfer landing mid-quiz-spend) could both
// read the same balance and one write would silently erase the other —
// credits spent twice or lost. For debits the "enough credits" check
// is part of the same DB operation, so it can't be raced past either.
//
// v1.2: accepts an already-loaded `studentDoc` (so callers doing a
// multi-step operation, like transfers, don't refetch mid-flow), plus
// `contestId` / `relatedTransferId` to link the ledger row to the
// contest or transfer that caused it. When a studentDoc is passed its
// in-memory `credits` is synced to the new balance without marking the
// field dirty, so a later `studentDoc.save()` can't overwrite it.
async function applyCreditDelta({
  matric, delta, reason, note = '', actor = 'system', allowNegative = false,
  studentDoc = null, contestId = null, relatedTransferId = null,
}) {
  if (!Number.isFinite(delta)) throw new Error('Invalid credit amount');

  const identity = studentDoc
    ? { _id: studentDoc._id }
    : { matric: String(matric || '').toUpperCase() };

  const filter = { ...identity };
  if (delta < 0 && !allowNegative) filter.credits = { $gte: -delta };

  const updated = await Student.findOneAndUpdate(
    filter,
    { $inc: { credits: delta } },
    { new: true, projection: { credits: 1, matric: 1 } },
  );

  if (!updated) {
    const exists = await Student.exists(identity);
    if (!exists) throw new Error('Student not found');
    const err = new Error('Insufficient credits');
    err.code = 'INSUFFICIENT_CREDITS';
    throw err;
  }

  if (studentDoc) {
    studentDoc.set('credits', updated.credits);
    studentDoc.unmarkModified('credits');
  }

  let tx = null;
  try {
    tx = await CreditTransaction.create({
      matric: updated.matric,
      delta,
      balanceAfter: updated.credits,
      reason,
      note,
      actor,
      contestId,
      relatedTransferId,
    });
  } catch (e) {
    // The balance has already moved. Failing the whole request now
    // would leave the user charged with an error screen, so log loudly
    // for the admin instead of throwing.
    console.error(`[credits] Ledger write failed for ${updated.matric} (delta ${delta}, reason ${reason}):`, e.message);
  }

  return { balance: updated.credits, transaction: tx };
}

module.exports = { applyCreditDelta };
