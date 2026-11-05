// v1.8.5 AI course topic outline: tidying names, merging without touching what the admin wrote, reading tags from questions.
const assert = require('assert'), path = require('path');
const T = require(path.join(__dirname, '..', 'src', 'services', 'courseTopics.logic.js'));

// cleanTopics: plain text, no numbering/markdown, no duplicates, sane length
assert.deepStrictEqual(T.cleanTopics(['1. Atomic Structure', '**Chemical Bonding**', '- Stoichiometry', 'atomic  structure', 'a', '', null, 'Acids, Bases & Salts']),
  ['Atomic Structure', 'Chemical Bonding', 'Stoichiometry', 'Acids Bases & Salts']);
assert.strictEqual(T.cleanTopics(['x'.repeat(200)])[0].length, 80);
assert.strictEqual(T.cleanTopics(Array.from({ length: 100 }, (_, i) => 'Topic ' + i)).length, T.MAX_TOPICS);
assert.deepStrictEqual(T.cleanTopics('nope'), []);

// mergeTopics: existing first and untouched, only genuinely new ones appended
const m = T.mergeTopics(['Bonding', 'Atomic structure'], ['Atomic Structure', 'Stoichiometry', 'bonding', 'Thermochemistry']);
assert.deepStrictEqual(m.topics, ['Bonding', 'Atomic structure', 'Stoichiometry', 'Thermochemistry']);
assert.deepStrictEqual(m.added, ['Stoichiometry', 'Thermochemistry']);
assert.deepStrictEqual(T.mergeTopics([], ['A topic']).topics, ['A topic']);
assert.deepStrictEqual(T.mergeTopics(['Only mine'], []).added, []);

// tagStats: groups differently-spelled tags, most common spelling wins, untagged capped, tags with no questions ignored
const rows = [
  { tag: 'Thermodynamics', q: '<b>What</b> is entropy?' }, { tag: 'thermodynamics', q: 'Define enthalpy' }, { tag: 'Thermodynamics ', q: 'State the first law' },
  { tag: 'Kinetics', q: 'Order of reaction?' }, { tag: '', q: 'Which gas law relates P and V?' }, { q: 'Another untagged one' }, { tag: 'Kinetics' },
];
const st = T.tagStats(rows);
assert.strictEqual(st.total, 7);
assert.deepStrictEqual(st.tags.map(t => [t.tag, t.count]), [['Thermodynamics', 3], ['Kinetics', 2]]);
assert.ok(!st.tags[0].samples.join().includes('<b>'), 'html stripped from samples');
assert.strictEqual(st.untagged.length, 2); assert.strictEqual(st.untagged[1].i, 1);
assert.strictEqual(T.tagStats(Array.from({ length: 200 }, (_, i) => ({ q: 'q' + i })), { maxUntagged: 60 }).untagged.length, 60);
assert.deepStrictEqual(T.tagStats([]), { total: 0, tags: [], untagged: [] });
console.log('Course topics logic OK');
