// Wreddi Wrapped (v1.9.2): a student's semester in numbers, built only from their own answer history. Pure, so it is unit-tested.
// attempts: [{ course, tag, correct, ts }] in any order. Days are Nigerian days (WAT, UTC+1) so a late-night session counts for that evening.
const DAY = 86400000, WAT = 3600000;
const dayKey = ts => new Date(new Date(ts).getTime() + WAT).toISOString().slice(0, 10);
const dayNum = k => Math.floor(Date.parse(k + 'T00:00:00Z') / DAY);

function buildWrapped(attempts) {
  const list = (attempts || []).filter(a => a && a.ts).slice().sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const answered = list.length, correct = list.filter(a => a.correct).length;
  const byDay = new Map();
  list.forEach(a => { const k = dayKey(a.ts), d = byDay.get(k) || { date: k, answered: 0, correct: 0 }; d.answered++; if (a.correct) d.correct++; byDay.set(k, d); });
  const days = [...byDay.keys()].sort();
  let longest = 0, run = 0, prev = null;
  days.forEach(k => { const n = dayNum(k); run = prev !== null && n === prev + 1 ? run + 1 : 1; prev = n; if (run > longest) longest = run; });
  let bestDay = null; byDay.forEach(d => { if (!bestDay || d.answered > bestDay.answered) bestDay = d; });
  // topics that went from weak to strong: first half of the attempts vs second half, 6+ attempts, from 50% or less to 70% or more
  const topics = new Map();
  list.forEach(a => { if (!a.tag) return; const k = a.course + '|' + a.tag; (topics.get(k) || topics.set(k, []).get(k)).push(a.correct ? 1 : 0); });
  const improved = [];
  topics.forEach((r, k) => {
    if (r.length < 6) return;
    const h = Math.floor(r.length / 2), pct = x => Math.round(100 * x.reduce((s, v) => s + v, 0) / x.length);
    const from = pct(r.slice(0, h)), to = pct(r.slice(h));
    if (from <= 50 && to >= 70) { const [course, tag] = k.split('|'); improved.push({ course, tag, from, to, lift: to - from }); }
  });
  improved.sort((a, b) => b.lift - a.lift);
  const perCourse = new Map(); list.forEach(a => perCourse.set(a.course, (perCourse.get(a.course) || 0) + 1));
  let topCourse = null; perCourse.forEach((n, c) => { if (!topCourse || n > topCourse.answered) topCourse = { course: c, answered: n }; });
  return {
    answered, correct, accuracy: answered ? Math.round(100 * correct / answered) : 0,
    activeDays: days.length, longestStreak: longest, bestDay, topCourse,
    improved: improved.slice(0, 3).map(({ course, tag, from, to }) => ({ course, tag, from, to })),
  };
}
module.exports = { buildWrapped, dayKey };
