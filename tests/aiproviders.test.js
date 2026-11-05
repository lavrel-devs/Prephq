// v1.8.7 Gemini alongside Groq: request/response translation, retry timing, and which provider goes first.
const assert = require('assert'), path = require('path');
const P = require(path.join(__dirname, '..', 'src', 'services', 'aiProviders.logic.js'));

// config: key + sensible default models, placeholders ignored
assert.strictEqual(P.geminiConfig({}).key, ''); assert.strictEqual(P.geminiConfig({ GEMINI_API_KEY: 'REPLACE_ME' }).key, '');
const c = P.geminiConfig({ GEMINI_API_KEY: ' abc ', GEMINI_MODEL: 'm1' }); assert.strictEqual(c.key, 'abc'); assert.strictEqual(c.model, 'm1'); assert.ok(c.bulkModel);

// request translation
let r = P.buildGeminiRequest({ model: 'x', temperature: 0.3, max_tokens: 900, response_format: { type: 'json_object' }, reasoning_effort: 'low',
  messages: [{ role: 'system', content: 'You are X.' }, { role: 'system', content: 'Be brief.' }, { role: 'assistant', content: 'stray first' }, { role: 'user', content: 'Hi' }, { role: 'user', content: 'again' }, { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Q?' }] });
assert.strictEqual(r.systemInstruction.parts[0].text, 'You are X.\n\nBe brief.');
assert.deepStrictEqual(r.contents.map(x => x.role), ['user', 'model', 'user'], 'starts with user, alternates, merges same-role turns');
assert.strictEqual(r.contents[0].parts[0].text, 'Hi\n\nagain');
assert.strictEqual(r.generationConfig.temperature, 0.3); assert.strictEqual(r.generationConfig.responseMimeType, 'application/json');
assert.ok(r.generationConfig.maxOutputTokens >= 1800 && r.generationConfig.maxOutputTokens <= 8192, 'headroom for thinking, capped');
assert.strictEqual(P.buildGeminiRequest({ max_tokens: 99999, messages: [{ role: 'user', content: 'x' }] }).generationConfig.maxOutputTokens, 8192);
assert.ok(!('responseMimeType' in P.buildGeminiRequest({ messages: [{ role: 'user', content: 'x' }] }).generationConfig));
assert.strictEqual(r.safetySettings.length, 4);
assert.strictEqual(P.buildGeminiRequest({ messages: [{ role: 'system', content: 's' }] }).contents[0].role, 'user', 'never sends an empty conversation');

// response translation
const ok = P.parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'Hello ' }, { text: 'there', thought: false }, { text: 'hidden thoughts', thought: true }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 } });
assert.strictEqual(ok.choices[0].message.content, 'Hello there'); assert.strictEqual(ok.usage.total_tokens, 8); assert.strictEqual(ok.provider, 'gemini');
assert.throws(() => P.parseGeminiResponse({ promptFeedback: { blockReason: 'SAFETY' } }), e => e.code === 'AI_BLOCKED');
assert.throws(() => P.parseGeminiResponse({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }), e => e.code === 'GROQ_EMPTY_RESPONSE');
assert.throws(() => P.parseGeminiResponse({}), e => e.code === 'GROQ_EMPTY_RESPONSE');

// retry timing
assert.strictEqual(P.parseRetryMs('', '12'), 12000);
assert.strictEqual(P.parseRetryMs('{"retryDelay": "34s"}', null), 34500);
assert.strictEqual(P.parseRetryMs('Please retry in 2.5s.', null), 3000);
assert.strictEqual(P.parseRetryMs('nothing useful', null), 8000);
assert.strictEqual(P.parseRetryMs('', '9999'), 120000);

// who goes first
const plan = (o) => P.planProviders({ groq: true, gemini: true, ...o });
assert.deepStrictEqual(plan({}), ['groq', 'gemini'], 'students: Groq first, Gemini as backup');
assert.deepStrictEqual(plan({ priority: 'low' }), ['gemini', 'groq'], 'bulk jobs spare Groq');
assert.deepStrictEqual(plan({ pref: 'groq' }), ['groq']); assert.deepStrictEqual(plan({ pref: 'gemini' }), ['gemini', 'groq']);
assert.deepStrictEqual(plan({ gemini: false }), ['groq']); assert.deepStrictEqual(plan({ groq: false, priority: 'low' }), ['gemini']);
assert.deepStrictEqual(plan({ groq: false, gemini: false }), []);
const now = 1000;
assert.deepStrictEqual(plan({ cooling: { groq: 5000 }, now }), ['gemini', 'groq'], 'a rate-limited provider goes to the back');
assert.deepStrictEqual(plan({ cooling: { groq: 5000, gemini: 6000 }, now }), ['groq', 'gemini'].reverse().reverse(), 'both cooling: original order, still tries');
assert.deepStrictEqual(plan({ cooling: { groq: 500 }, now }), ['groq', 'gemini'], 'cooldown over');
console.log('AI providers logic OK');
