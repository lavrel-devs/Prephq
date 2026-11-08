// Mistake reasons and the one-line advice built from a student's pattern (v1.9.2). Pure, so it is unit-tested.
const REASONS = ['didnt_know', 'careless', 'time', 'misread'];
const LABELS = { didnt_know: "Didn't know it", careless: 'Careless slip', time: 'Ran out of time', misread: 'Misread it' };

function adviceFor(counts) {
  const c = {}; let total = 0;
  REASONS.forEach(r => { c[r] = Math.max(0, +(counts && counts[r]) || 0); total += c[r]; });
  if (total < 5) return { total, top: null, pct: 0, text: 'Tag a few more mistakes with a reason and Wreddi will spot your pattern.' };
  const top = REASONS.reduce((a, b) => (c[b] > c[a] ? b : a), REASONS[0]);
  const pct = Math.round((c[top] / total) * 100);
  if (pct < 40) return { total, top: null, pct, text: 'Your mistakes come from a mix of causes, so keep tagging them and the biggest one will show.' };
  const text = {
    careless: `${pct}% of your mistakes are careless slips. Slow down on the first read and check your working before you confirm.`,
    misread: `${pct}% of your mistakes are misread questions. Underline the key words (NOT, EXCEPT, the units) before you look at the options.`,
    time: `${pct}% of your mistakes happen when time runs out. Practise with the exam clock and skip the hard ones first.`,
    didnt_know: `${pct}% of your mistakes are real gaps in knowledge. Use Weak Topics and your notes, then retry those questions after a day.`,
  }[top];
  return { total, top, pct, text };
}
module.exports = { REASONS, LABELS, adviceFor };
