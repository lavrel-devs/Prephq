'use strict';
// Command centre: turns the admin's "student group" conditions into a MongoDB filter for the Student collection. Pure, no database access.
const DAY = 86400000;
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const has = v => v !== undefined && v !== null && String(v).trim() !== '';
function num(v, label, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return { error: `${label} must be a number between ${min} and ${max}` };
  return { n };
}

// q: the conditions { track, tier, status, course, inactiveDays, activeDays, joinedDays, expiringDays, expiredDays, minCredits, maxCredits, q }
// matricIn: array of matrics when a tag was chosen (resolved by the caller from admin notes), else null
// Returns { filter } or { error }
function buildFilter(q, now = Date.now(), matricIn = null) {
  q = q || {};
  const and = [];

  if (has(q.track)) {
    const t = String(q.track);
    if (t === 'university') and.push({ $or: [{ track: 'university' }, { track: null }, { track: { $exists: false } }] });   // accounts from before v1.11 have no track
    else if (t === 'secondary') and.push({ track: 'secondary' });
    else return { error: 'Unknown app: choose university or secondary' };
  }
  if (has(q.tier)) {
    if (q.tier === 'premium') and.push({ tier: 'premium' });
    else if (q.tier === 'free') and.push({ tier: { $ne: 'premium' } });
    else return { error: 'Unknown plan: choose free or premium' };
  }
  if (has(q.status)) {
    if (q.status === 'active') and.push({ active: { $ne: false } });
    else if (q.status === 'suspended') and.push({ active: false });
    else return { error: 'Unknown status: choose active or suspended' };
  }
  if (has(q.course)) {
    const c = String(q.course).trim().slice(0, 40);
    and.push({ selectedCourses: { $regex: '^' + esc(c) + '$', $options: 'i' } });
  }
  if (has(q.inactiveDays)) {
    const r = num(q.inactiveDays, 'Inactive days', 1, 3650); if (r.error) return r;
    const cut = new Date(now - r.n * DAY);
    and.push({ $or: [{ lastActiveAt: { $lte: cut } }, { lastActiveAt: null }, { lastActiveAt: { $exists: false } }] });
  }
  if (has(q.activeDays)) {
    const r = num(q.activeDays, 'Active days', 1, 3650); if (r.error) return r;
    and.push({ lastActiveAt: { $gte: new Date(now - r.n * DAY) } });
  }
  if (has(q.joinedDays)) {
    const r = num(q.joinedDays, 'Joined days', 1, 3650); if (r.error) return r;
    and.push({ createdAt: { $gte: new Date(now - r.n * DAY) } });
  }
  if (has(q.expiringDays)) {      // Premium that ends within the next N days (lifetime never ends)
    const r = num(q.expiringDays, 'Expiring days', 1, 3650); if (r.error) return r;
    and.push({ tier: 'premium', premiumPlan: { $ne: 'lifetime' }, tierExpiresAt: { $gt: new Date(now), $lte: new Date(now + r.n * DAY) } });
  }
  if (has(q.expiredDays)) {       // Premium that ended in the last N days and has not been reset to free yet (the reset happens on the student's next visit)
    const r = num(q.expiredDays, 'Expired days', 1, 3650); if (r.error) return r;
    and.push({ tier: 'premium', premiumPlan: { $ne: 'lifetime' }, tierExpiresAt: { $gte: new Date(now - r.n * DAY), $lte: new Date(now) } });
  }
  if (has(q.minCredits)) { const r = num(q.minCredits, 'Minimum credits', -1e9, 1e9); if (r.error) return r; and.push({ credits: { $gte: r.n } }); }
  if (has(q.maxCredits)) { const r = num(q.maxCredits, 'Maximum credits', -1e9, 1e9); if (r.error) return r; and.push({ credits: { $lte: r.n } }); }
  if (has(q.q)) {
    const rx = new RegExp(esc(String(q.q).trim().slice(0, 60)), 'i');
    and.push({ $or: [{ name: rx }, { matric: rx }, { username: rx }] });
  }
  if (Array.isArray(matricIn)) and.push({ matric: { $in: matricIn } });

  return { filter: and.length ? { $and: and } : {} };
}

// Tags: lowercase words, up to 10 per note, 24 characters each. Accepts an array or "a, b, c".
function cleanTags(raw) {
  if (raw === undefined || raw === null || raw === '') return { tags: [] };
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const out = [];
  for (const t of list) {
    const c = String(t).toLowerCase().replace(/[^a-z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (c && !out.includes(c)) out.push(c);
  }
  if (out.length > 10) return { error: 'Use at most 10 tags per note' };
  return { tags: out };
}

module.exports = { buildFilter, cleanTags };
