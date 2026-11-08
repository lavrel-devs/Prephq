// Sponsor link helpers (v1.9.2). Pure, so they are unit-tested.
const crypto = require('crypto');
const { dayKey } = require('./wrapped');
const DAY = 86400000;

const newToken = () => crypto.randomBytes(18).toString('base64url'); // 24 URL-safe characters

// attempts: [{ correct, ts }] from the last 14 days. "This week" is the last 7 Nigerian days ending today.
function weekSummary(attempts, now = Date.now()) {
  const keys = []; for (let i = 6; i >= 0; i--) keys.push(dayKey(now - i * DAY));
  const prevKeys = new Set(); for (let i = 13; i >= 7; i--) prevKeys.add(dayKey(now - i * DAY));
  const per = Object.fromEntries(keys.map(k => [k, { answered: 0, correct: 0 }]));
  let pa = 0, pc = 0;
  (attempts || []).forEach(a => {
    const k = dayKey(a.ts);
    if (per[k]) { per[k].answered++; if (a.correct) per[k].correct++; }
    else if (prevKeys.has(k)) { pa++; if (a.correct) pc++; }
  });
  const answered = keys.reduce((s, k) => s + per[k].answered, 0), correct = keys.reduce((s, k) => s + per[k].correct, 0);
  return {
    thisWeek: { answered, correct, accuracy: answered ? Math.round(100 * correct / answered) : 0, activeDays: keys.filter(k => per[k].answered).length, perDay: keys.map(k => per[k].answered) },
    lastWeek: { answered: pa, accuracy: pa ? Math.round(100 * pc / pa) : 0 },
  };
}

// "Free", "Premium" or "Premium (lifetime)", and when a paid plan ends
function planFor(st, now = Date.now()) {
  const paid = st && (st.premiumPlan || (st.tier && st.tier !== 'free'));
  if (!paid) return { label: 'Free', free: true, endsAt: null, daysLeft: null };
  if (st.premiumPlan === 'lifetime') return { label: 'Premium (lifetime)', free: false, endsAt: null, daysLeft: null };
  const ends = st.tierExpiresAt ? new Date(st.tierExpiresAt).getTime() : null;
  if (ends && ends < now) return { label: 'Free', free: true, endsAt: null, daysLeft: null, expired: true };
  return { label: 'Premium', free: false, endsAt: ends ? new Date(ends).toISOString() : null, daysLeft: ends ? Math.ceil((ends - now) / DAY) : null };
}
module.exports = { newToken, weekSummary, planFor };
