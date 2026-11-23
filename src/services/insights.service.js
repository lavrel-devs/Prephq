'use strict';
// v1.17 — pure helpers for the Insights tab: fill gaps in daily series and turn the numbers into plain-English sentences.
// No database in here, so it is unit-tested.
const DAY = 86400000, TZ = 'Africa/Lagos';

const dayKey = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });   // YYYY-MM-DD in Nigerian time

// rows: [{ _id:'2026-11-20', n:3 }] → n days ending today, missing days = 0, oldest first
function fillDays(rows, n, now, field = 'n') {
  const m = new Map((rows || []).map(r => [r._id, r]));
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const k = dayKey(now - i * DAY); const r = m.get(k); out.push({ day: k, value: r ? (r[field] || 0) : 0, row: r || null }); }
  return out;
}
const sum = a => a.reduce((x, y) => x + y, 0);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
const change = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
const hour12 = h => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
const naira = n => '₦' + Math.round(n || 0).toLocaleString('en-NG');
const plural = (n, one, many) => `${n.toLocaleString('en-NG')} ${n === 1 ? one : (many || one + 's')}`;

// d: { signups7, signupsPrev7, total, dau, mau, cohort:{size,active}, funnel:{signedUp,picked,tried,regular,premium}, premium:{count,expiring7},
//      revenue:{cur,prev}, quiz:{count,passRate}, peakHour, hardest, easiest }
function buildSays(d) {
  const out = [], say = (tone, text) => out.push({ tone, text });

  const ch = change(d.signups7, d.signupsPrev7);
  if (!d.signups7 && !d.signupsPrev7) say('info', 'Nobody new joined in the last 2 weeks.');
  else if (ch === null) say('good', `${plural(d.signups7, 'new student')} joined this week (none the week before).`);
  else if (ch >= 10) say('good', `${plural(d.signups7, 'student')} joined this week, up ${ch}% on last week.`);
  else if (ch <= -10) say('warn', `${plural(d.signups7, 'student')} joined this week, down ${Math.abs(ch)}% on last week.`);
  else say('info', `${plural(d.signups7, 'student')} joined this week, about the same as last week.`);

  if (d.mau > 0) {
    const tenth = Math.round((d.dau / d.mau) * 10);
    say(tenth >= 2 ? 'good' : 'warn', `Out of every 10 students who used the app this month, ${tenth} used it today.`);
  }
  if (d.cohort && d.cohort.size >= 5) {
    const p = pct(d.cohort.active, d.cohort.size);
    say(p >= 40 ? 'good' : p >= 20 ? 'info' : 'bad', `Of ${d.cohort.size} students who joined 1 to 4 weeks ago, ${p}% were still active this week.`);
  }
  const f = d.funnel;
  if (f && f.signedUp >= 10) {
    const steps = [['pick their courses', f.picked], ['take even one quiz', f.tried], ['take 5 or more quizzes', f.regular]];
    let prev = f.signedUp, worst = null;
    for (const [label, n] of steps) { const lost = prev - n; if (prev > 0 && (!worst || lost / prev > worst.rate)) worst = { label, rate: lost / prev, lost, from: prev }; prev = n; }
    if (worst && worst.rate >= 0.2) say('warn', `Biggest drop-off: ${Math.round(worst.rate * 100)}% of students ${worst.from === f.signedUp ? 'who signed up' : 'at the step before'} never ${worst.label}.`);
    else say('good', 'Students move through signup to regular practice without a big drop-off.');
  }
  if (d.premium) {
    const p = pct(d.premium.count, d.total);
    if (p !== null) say(p >= 5 ? 'good' : 'info', `${plural(d.premium.count, 'student')} (${p}%) are on Premium.`);
    if (d.premium.expiring7 > 0) say('warn', `${plural(d.premium.expiring7, 'Premium plan')} ${d.premium.expiring7 === 1 ? 'ends' : 'end'} within 7 days. Message them from Segments → "Premium ending in 7 days".`);
  }
  if (d.revenue) {
    const rc = change(d.revenue.cur, d.revenue.prev);
    if (!d.revenue.cur && !d.revenue.prev) say('info', 'No confirmed payments in the last 60 days.');
    else if (rc === null) say('good', `${naira(d.revenue.cur)} confirmed in the last 30 days (nothing the 30 days before).`);
    else say(rc >= 0 ? 'good' : 'warn', `${naira(d.revenue.cur)} confirmed in the last 30 days, ${rc >= 0 ? 'up' : 'down'} ${Math.abs(rc)}% on the 30 days before.`);
  }
  if (d.quiz && d.quiz.count > 0 && d.quiz.passRate !== null) say(d.quiz.passRate >= 50 ? 'good' : 'warn', `${d.quiz.passRate}% of quizzes in the last 30 days scored 50 or more.`);
  if (d.peakHour !== null && d.peakHour !== undefined) say('info', `Most quizzes start around ${hour12(d.peakHour)} (Nigerian time). Send messages just before then.`);
  if (d.hardest) say('info', `Hardest course right now: ${d.hardest.course} (${d.hardest.accuracy}% correct).`);
  if (d.easiest && (!d.hardest || d.easiest.course !== d.hardest.course)) say('info', `Easiest course: ${d.easiest.course} (${d.easiest.accuracy}% correct).`);
  return out;
}

module.exports = { fillDays, buildSays, dayKey, change, pct, hour12, naira, DAY, TZ };
