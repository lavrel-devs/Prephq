// Pure helpers for bulk question upload (no DB access here, so they can be unit-tested).

// "What is  the Value of π?" and "what is the value of π" are the same question.
const stemKey = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const dupeKey = (course, q) => `${course}|${stemKey(q)}`;

const validOpts = o => Array.isArray(o) && o.length >= 2 && o.length <= 10 && o.every(x => typeof x === 'string' && x.trim());

// Splits an uploaded list into what can be inserted and what can't, with a reason for each rejected row.
//   items         [{ course, q, opts, ans, tag?, exp? }]
//   courseKeys    Set of canonical course keys that exist
//   existingKeys  Set of dupeKey()s already in the bank
// Returns { accepted: [...normalised docs], rejected: [{ index, reason }] }
function planBulk(items, courseKeys, existingKeys) {
  const seen = new Set(existingKeys);
  const accepted = [], rejected = [];
  items.forEach((it, index) => {
    const bad = reason => rejected.push({ index, reason });
    if (!it || typeof it !== 'object') return bad('Not a question');
    const course = String(it.course || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!course || !courseKeys.has(course)) return bad(`Unknown course "${it.course || ''}"`);
    if (typeof it.q !== 'string' || !it.q.trim()) return bad('Empty question');
    if (!validOpts(it.opts)) return bad('Needs 2–10 non-empty options');
    const ans = Number.parseInt(it.ans, 10);
    if (!Number.isInteger(ans) || ans < 0 || ans >= it.opts.length) return bad('Answer must point to one of the options');
    const key = dupeKey(course, it.q);
    if (seen.has(key)) return bad('Duplicate — already in the bank');
    seen.add(key);
    accepted.push({
      course, q: it.q.trim(), opts: it.opts.map(o => o.trim()), ans,
      tag: typeof it.tag === 'string' ? it.tag.trim().slice(0, 80) : '',
      exp: typeof it.exp === 'string' ? it.exp : '',
    });
  });
  return { accepted, rejected };
}

// Lowest-accuracy-first ranking that doesn't crown a question after only 2 attempts.
// `minAttempts` guards against noise; `reports` is a Map(questionId -> open report count).
function rankQuality(rows, reports, minAttempts = 8) {
  return rows
    .map(r => ({ ...r, accuracy: r.attempts ? Math.round((r.correct / r.attempts) * 100) : null, reports: reports.get(String(r._id)) || 0 }))
    .filter(r => r.reports > 0 || r.attempts >= minAttempts)
    .sort((a, b) => (b.reports - a.reports) || ((a.accuracy ?? 101) - (b.accuracy ?? 101)));
}

// ── Per-course question counts ───────────────────────────────
// The dashboard only needs a NUMBER per course for its badges. Downloading every course's whole bank to get it
// (what it used to do) grows with every question uploaded, so we count on the server in a single pass instead.
//
// A question belongs to a course if its stored `course` equals (ignoring case) the course's key OR its courseCode —
// the same matching GET /questions/:course uses — so the badge and the practice pool always agree.
//   rows     [{ _id: '<lower-cased stored course>', n }]   (the $group output)
//   courses  [{ key, courseCode }]
function countsForCourses(rows, courses) {
  const byName = new Map(rows.map(r => [String(r._id || '').toLowerCase(), r.n]));
  const out = {};
  for (const c of courses) {
    const names = new Set([c.key, c.courseCode].filter(Boolean).map(x => String(x).toLowerCase()));
    let n = 0;
    for (const name of names) n += byName.get(name) || 0;
    out[c.key] = n;
  }
  return out;
}

// 60s cache + single-flight: a burst of students opening the app costs one scan, not one each. Admin question
// changes call invalidateCounts() so uploads show up immediately on this instance; the TTL bounds it elsewhere.
const cache = { at: 0, data: null, inflight: null };
function invalidateCounts() { cache.at = 0; cache.data = null; }
async function getCourseCounts(Question, Course, ttlMs = 60000) {
  if (cache.data && Date.now() - cache.at < ttlMs) return cache.data;
  if (cache.inflight) return cache.inflight;
  cache.inflight = (async () => {
    try {
      const [rows, courses] = await Promise.all([
        Question.aggregate([{ $group: { _id: { $toLower: '$course' }, n: { $sum: 1 } } }]),
        Course.find().select('key courseCode').lean(),
      ]);
      cache.data = countsForCourses(rows, courses);
      cache.at = Date.now();
      return cache.data;
    } finally { cache.inflight = null; }
  })();
  return cache.inflight;
}

module.exports = { stemKey, dupeKey, planBulk, rankQuality, countsForCourses, getCourseCounts, invalidateCounts };
