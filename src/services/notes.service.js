// Pure helpers for the AI course-notes builder (kept separate so they can be unit-tested).
const GENERIC = new Set(['', 'ai generated', 'ai', 'general', 'misc', 'other', 'untagged']);

const strip = (v) => String(v == null ? '' : v).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

// Groups a course's questions into topic tags (with counts and a couple of sample stems each) plus a
// small sample of questions that have no usable tag.
function collectTopics(questions, { maxUntagged = 40 } = {}) {
  const byTag = new Map();
  const untagged = [];
  for (const q of questions) {
    const tag = strip(q.tag);
    if (!tag || GENERIC.has(tag.toLowerCase())) {
      if (untagged.length < maxUntagged) untagged.push({ i: untagged.length + 1, q: strip(q.q).slice(0, 160), id: String(q._id) });
      continue;
    }
    const k = tag.toLowerCase();
    const cur = byTag.get(k) || { tag, count: 0, samples: [] };
    cur.count++;
    if (cur.samples.length < 2) cur.samples.push(strip(q.q).slice(0, 140));
    byTag.set(k, cur);
  }
  return { tags: [...byTag.values()].sort((a, b) => b.count - a.count), untagged };
}

// Makes the AI's outline trustworthy: only real tags/indexes survive, every real tag ends up in exactly one
// topic (leftovers become their own topics), duplicates merge, names are clean, and question counts are ours.
function normalizeOutline(aiTopics, tags, untagged) {
  const tagByKey = new Map(tags.map(t => [t.tag.toLowerCase(), t]));
  const seenTags = new Set();
  const usedIdx = new Set();
  const byName = new Map();
  const out = [];

  const add = (name, tagList, idxList, summary) => {
    const clean = strip(name).slice(0, 80);
    if (!clean) return;
    const k = clean.toLowerCase();
    let topic = byName.get(k);
    if (!topic) { topic = { name: clean, tags: [], questionIds: [], summary: strip(summary).slice(0, 200), questionCount: 0 }; byName.set(k, topic); out.push(topic); }
    for (const t of tagList) topic.tags.push(t.tag), topic.questionCount += t.count;
    for (const i of idxList) { const u = untagged.find(x => x.i === i); if (u) { topic.questionIds.push(u.id); topic.questionCount++; } }
  };

  for (const t of (Array.isArray(aiTopics) ? aiTopics : []).slice(0, 60)) {
    if (!t || typeof t !== 'object') continue;
    const tagList = [];
    for (const raw of Array.isArray(t.tags) ? t.tags : []) {
      const found = tagByKey.get(strip(raw).toLowerCase());
      if (found && !seenTags.has(found.tag.toLowerCase())) { seenTags.add(found.tag.toLowerCase()); tagList.push(found); }
    }
    const idxList = [];
    for (const n of Array.isArray(t.untaggedIdx) ? t.untaggedIdx : []) {
      const i = Number(n);
      if (Number.isInteger(i) && !usedIdx.has(i) && untagged.some(x => x.i === i)) { usedIdx.add(i); idxList.push(i); }
    }
    if (tagList.length || idxList.length) add(t.name, tagList, idxList, t.summary);
  }
  // Anything the AI dropped still gets a topic so no past-question topic is lost.
  for (const t of tags) if (!seenTags.has(t.tag.toLowerCase())) add(t.tag, [t], [], '');
  return out.slice(0, 40);
}

module.exports = { collectTopics, normalizeOutline, strip, GENERIC };
