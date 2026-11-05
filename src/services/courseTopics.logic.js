'use strict';
// v1.8.5 Course topic outline — the pure parts (no database, no network), so they can be tested on their own.
const { strip: stripMd } = require('../../public/js/phq-mdclean.js');

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const MAX_TOPICS = 40, MAX_LEN = 80;

// Tidy what the AI (or an old tag) gave us: plain text, Title Case-ish spacing, no numbering, no duplicates.
function cleanTopics(list, max = MAX_TOPICS) {
  const out = [], seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    let t = stripMd(String(raw == null ? '' : raw)).replace(/^\s*(?:\d+[.)]|[-•])\s*/, '').replace(/\s+/g, ' ').replace(/[,;]+/g, ' ').trim();
    t = t.replace(/\s{2,}/g, ' ').slice(0, MAX_LEN).trim();
    if (t.length < 2) continue;
    const k = norm(t);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

// Add new topics after the ones the admin already has. Never removes or reorders anything they wrote.
// A new topic is skipped if it is the same as an existing one once punctuation/case is ignored.
function mergeTopics(existing, incoming) {
  const base = cleanTopics(existing, 200), have = new Set(base.map(norm));
  const added = [];
  for (const t of cleanTopics(incoming, 200)) { const k = norm(t); if (!have.has(k)) { have.add(k); added.push(t); } }
  return { topics: [...base, ...added].slice(0, 80), added };
}

// From a course's question rows ({tag, q}), build what generateCourseOutline wants:
//   tags = [{ tag, count, samples[] }]  (same tag spelled differently is counted together, most common spelling wins)
//   untagged = [{ i, q }]               (questions with no tag, capped, to let the AI infer topics from the text)
function tagStats(rows, { maxTags = 80, maxUntagged = 60 } = {}) {
  const byKey = new Map(), untagged = [];
  let total = 0;
  for (const r of rows || []) {
    total++;
    const tag = String((r && r.tag) || '').replace(/\s+/g, ' ').trim();
    const q = String((r && (r.q || r.question)) || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (tag) {
      const k = norm(tag); if (!k) continue;
      const e = byKey.get(k) || { variants: new Map(), count: 0, samples: [] };
      e.count++; e.variants.set(tag, (e.variants.get(tag) || 0) + 1);
      if (q && e.samples.length < 3) e.samples.push(q.slice(0, 110));
      byKey.set(k, e);
    } else if (q && untagged.length < maxUntagged) untagged.push({ i: untagged.length, q: q.slice(0, 180) });
  }
  const tags = [...byKey.values()].map(e => ({ tag: [...e.variants.entries()].sort((a, b) => b[1] - a[1])[0][0], count: e.count, samples: e.samples }))
    .sort((a, b) => b.count - a.count).slice(0, maxTags);
  return { total, tags, untagged };
}

module.exports = { cleanTopics, mergeTopics, tagStats, norm, MAX_TOPICS };
