// Voice Quiz (v1.9.0): understanding spoken answers, and turning maths into words. Pure helpers only (no browser).
const assert = require('assert'), path = require('path');
const V = require(path.join(__dirname, '..', 'public', 'js', 'voice-quiz.js'));

const opts = ['Sodium chloride', 'Calcium carbonate', 'Potassium hydroxide', 'Magnesium sulphate'];
const p = (t, o = opts) => V.parseSpokenAnswer(t, o);
const ans = (t, i, via, o) => { const r = p(t, o); assert.deepStrictEqual([r.type, r.index], ['answer', i], `"${t}" -> ${JSON.stringify(r)}`); if (via) assert.strictEqual(r.via, via, `"${t}" via`); };
const cmd = (t, c) => assert.deepStrictEqual(p(t), { type: 'command', command: c }, `"${t}" -> ${JSON.stringify(p(t))}`);
const unk = (t, o) => assert.strictEqual(p(t, o).type, 'unknown', `"${t}" should not be understood: ${JSON.stringify(p(t, o))}`);

// ── letters, homophones, cues ────────────────────────────────
['B', 'b', 'Bee', 'be', 'option B', 'Option b.', 'the answer is B', 'I choose b', "it's B", 'B please', 'letter b'].forEach(t => ans(t, 1, 'letter'));
ans('A', 0); ans('ay', 0); ans('C', 2); ans('see', 2); ans('D', 3); ans('dee', 3); ans('option d', 3); ans('the answer is a', 0);
// ── numbers and ordinals ─────────────────────────────────────
ans('two', 1); ans('option two', 1); ans('option one', 0); ans('number three', 2); ans('the third one', 2); ans('second', 1); ans('I think the fourth one', 3);
// ── everyday words are NOT answers ───────────────────────────
['it is a metal', 'go to the lab', 'one', 'hmm', '', '   '].forEach(t => unk(t));
// two different letters = ambiguous, ask again rather than guess
assert.deepStrictEqual(p('option a or option b'), { type: 'unknown', reason: 'ambiguous' });

// ── saying the answer itself ─────────────────────────────────
ans('sodium chloride', 0, 'text'); ans('I think it is potassium hydroxide', 2, 'text'); ans('magnesium sulphate', 3, 'text');
unk('chloride is in salt', ['Sodium chloride', 'Potassium chloride', 'Calcium chloride']);          // fits several options: no clear winner
// an answer that happens to contain "first" must not be heard as "option A"
const laws = ['The first law of thermodynamics', 'The second law of thermodynamics', 'The third law of thermodynamics'];
ans('the first law of thermodynamics', 0, 'text', laws); ans('the second law of thermodynamics', 1, 'text', laws);
ans('the first one', 0, 'letter', laws);

// ── commands ─────────────────────────────────────────────────
cmd('repeat', 'repeat'); cmd('say that again', 'repeat'); cmd('please repeat the question', 'repeat'); cmd('what was that', 'repeat');
cmd('skip', 'skip'); cmd('next', 'skip'); cmd("I don't know", 'skip'); cmd('no idea', 'skip');
cmd('stop', 'stop'); cmd('end quiz', 'stop'); cmd("I'm done", 'stop'); cmd('quit', 'stop');
// ...but not inside a real answer
ans('pass through the membrane', 1, 'text', ['Diffusion across cell walls', 'Pass through the membrane', 'Active transport only']);

// ── several recogniser guesses: take the first one that makes sense ──
assert.strictEqual(V.parseBest(['hmm', 'bee'], opts).index, 1);
assert.strictEqual(V.parseBest(['', 'blah'], opts).type, 'unknown');
assert.deepStrictEqual(V.parseBest(['a or b', 'c'], opts).index, 2);

// ── making questions pleasant to hear ────────────────────────
const S = V.speakable;
assert.strictEqual(S('<b>Water</b> boils at $100^\\circ C$'), 'Water boils at 100 degrees C');
assert.strictEqual(S('Solve $x^2 + 3 = 7$'), 'Solve x squared plus 3 equals 7');
assert.strictEqual(S('$\\frac{1}{2}$ of the mass'), '1 over 2 of the mass');
assert.strictEqual(S('$\\sqrt{16}$'), 'square root of 16');
assert.strictEqual(S('$\\ce{H_2O}$'), 'water');
assert.strictEqual(S('$\\Delta H$ is negative'), 'delta H is negative');
assert.strictEqual(S('2H₂ + O₂ → 2H₂O'), '2, aitch 2 plus oh 2 gives 2 water');
assert.strictEqual(S('Speed = 30 m/s² at 25°C, 40%'), 'Speed equals 30 m/s squared at 25 degrees Celsius, 40 percent');
assert.strictEqual(S('A × B ≤ C'), 'A times B less than or equal to C');
assert.strictEqual(S(null), ''); assert.strictEqual(S(undefined), '');

const q = { q: 'Which compound is common salt?', opts, ans: 0, exp: 'Common salt is sodium chloride. It forms when sodium reacts with chlorine.', tag: 'Salts' };
const qs = V.buildQuestionSpeech(q, 3, 8);
assert.ok(qs.startsWith('Question 3 of 8. Which compound is common salt?'));
assert.ok(qs.includes('Option A. Sodium chloride.') && qs.includes('Option D. Magnesium sulphate.'));
assert.ok(!V.buildQuestionSpeech(q, 1, 1, { withOptions: false }).includes('Option A'));
assert.match(V.buildFeedback(q, 0, 0), /^Correct! Common salt is sodium chloride\./);
const wrong = V.buildFeedback(q, 2, 0);
assert.ok(wrong.startsWith('Not quite. The answer is option A, Sodium chloride.'), wrong);
assert.ok(wrong.includes('Common salt is sodium chloride.'));
assert.strictEqual(V.buildFeedback({ ...q, exp: '' }, 1, 0), 'Not quite. The answer is option A, Sodium chloride.');
assert.ok(!/It forms when/.test(V.buildFeedback({ ...q, exp: 'x'.repeat(10) + '. ' + 'y'.repeat(300) + '.' }, 0, 0)), 'explanations are kept short');

// ── summary ──────────────────────────────────────────────────
const res = [{ chosen: 0, correct: true, tag: 'Salts' }, { chosen: 1, correct: false, tag: 'Acids' }, { chosen: 2, correct: false, tag: 'Acids' }, { chosen: null, correct: false, tag: 'Bases' }];
const sum = V.summarize(res);
assert.deepStrictEqual([sum.total, sum.answered, sum.correct, sum.wrong, sum.skip, sum.pct], [4, 3, 1, 2, 1, 33]);
assert.deepStrictEqual(sum.weakTags, ['Acids'], 'skipped questions are not counted as wrong topics');
assert.match(V.buildSummary(sum), /^You got 1 out of 3\..*Revise Acids\./);
assert.match(V.buildSummary(V.summarize([])), /No answers this time/);

// ── long text is spoken in sentence-sized pieces ─────────────
const long = 'First sentence here. ' + 'Second sentence is a good deal longer, with a comma in it, and keeps going for a while. '.repeat(4) + 'Last one.';
const chunks = V.chunkSpeech(long, 120);
assert.ok(chunks.length >= 4 && chunks.every(c => c.length <= 140), chunks.map(c => c.length).join(','));
assert.strictEqual(V.chunkSpeech('Short.', 120).join('|'), 'Short.');
assert.deepStrictEqual(V.chunkSpeech('', 100), []);

console.log('voice quiz helpers OK');
