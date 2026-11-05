'use strict';
// v1.8.7 Multi-provider AI — the pure parts (no network), so they can be tested on their own.
// The app speaks "Groq/OpenAI style" everywhere ({model, messages, temperature, max_tokens, response_format}). This file
// translates that to Gemini's generateContent format and back, and decides which provider a call should try first.

const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']
  .map(category => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));   // science questions (reactions, medicine) shouldn't trip "medium" filters

function geminiConfig(env = process.env) {
  const key = String(env.GEMINI_API_KEY || '').trim();
  const ok = !!key && !/^REPLACE/i.test(key);
  return {
    key: ok ? key : '',
    model: String(env.GEMINI_MODEL || 'gemini-3.8-flash').trim(),            // interactive default
    bulkModel: String(env.GEMINI_MODEL_BULK || 'gemini-3.5-flash-lite').trim(), // background / bulk jobs
  };
}

// OpenAI-style request -> Gemini request. System messages become systemInstruction; assistant -> "model";
// consecutive same-role turns are merged (Gemini wants strict alternation) and the conversation must start with a user turn.
function buildGeminiRequest(body) {
  const sys = [], turns = [];
  for (const m of body.messages || []) {
    const text = typeof m.content === 'string' ? m.content : '';
    if (!text) continue;
    if (m.role === 'system') { sys.push(text); continue; }
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.parts[0].text += '\n\n' + text;
    else turns.push({ role, parts: [{ text }] });
  }
  while (turns.length && turns[0].role === 'model') turns.shift();
  if (!turns.length) turns.push({ role: 'user', parts: [{ text: sys.length ? 'Please respond as instructed.' : '.' }] });
  const req = {
    contents: turns,
    generationConfig: {
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
      // thinking models spend part of this budget thinking, so give it headroom over what the Groq call asked for
      maxOutputTokens: Math.min(8192, Math.max(2048, Math.round((body.max_tokens || 1000) * 2))),
    },
    safetySettings: SAFETY,
  };
  if (sys.length) req.systemInstruction = { parts: [{ text: sys.join('\n\n') }] };
  if (body.response_format && body.response_format.type === 'json_object') req.generationConfig.responseMimeType = 'application/json';
  return req;
}

// Gemini response -> OpenAI-style response, so every existing caller keeps working unchanged.
function parseGeminiResponse(json) {
  const fail = (code, msg) => { const e = new Error(msg); e.code = code; return e; };
  if (json && json.promptFeedback && json.promptFeedback.blockReason) throw fail('AI_BLOCKED', `Gemini blocked this request (${json.promptFeedback.blockReason}).`);
  const cand = json && Array.isArray(json.candidates) ? json.candidates[0] : null;
  const parts = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
  const text = parts.filter(p => p && typeof p.text === 'string' && !p.thought).map(p => p.text).join('').trim();
  if (!text) throw fail('GROQ_EMPTY_RESPONSE', `Gemini returned no text${cand && cand.finishReason ? ` (${cand.finishReason})` : ''}.`);
  const u = json.usageMetadata || {};
  return {
    provider: 'gemini',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: String((cand && cand.finishReason) || 'stop').toLowerCase() }],
    usage: { prompt_tokens: u.promptTokenCount || 0, completion_tokens: u.candidatesTokenCount || 0, total_tokens: u.totalTokenCount || 0 },
  };
}

// How long Gemini says to wait: header Retry-After, "retryDelay": "34s" in the error body, or "retry in 34.5s" in its message.
function parseRetryMs(text, headerValue) {
  const h = Number(headerValue); if (Number.isFinite(h) && h > 0) return Math.min(120000, Math.round(h * 1000));
  const m = String(text || '').match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) || String(text || '').match(/retry (?:in|after) (\d+(?:\.\d+)?)\s*s/i);
  return m ? Math.min(120000, Math.round(Number(m[1]) * 1000) + 500) : 8000;
}

// Which providers to try, in order. Only configured ones. A provider that just hit a rate limit ("cooling") goes to the back,
// so the next calls skip straight to the healthy one instead of waiting.
//   AI_PROVIDER=auto (default): student-facing calls -> Groq first, Gemini as backup; bulk/background calls (priority 'low')
//                               -> Gemini first, which keeps Groq's limit free for students.
//   AI_PROVIDER=groq: Groq only.   AI_PROVIDER=gemini: Gemini first for everything, Groq as backup.
function planProviders({ groq, gemini, pref = 'auto', priority = 'high', cooling = {}, now = Date.now() }) {
  let order = [];
  if (pref === 'groq') order = ['groq'];
  else if (pref === 'gemini') order = ['gemini', 'groq'];
  else order = priority === 'low' ? ['gemini', 'groq'] : ['groq', 'gemini'];
  order = order.filter(p => (p === 'groq' ? groq : gemini));
  const hot = order.filter(p => !(cooling[p] > now)), cold = order.filter(p => cooling[p] > now);
  return [...hot, ...cold];
}

module.exports = { geminiConfig, buildGeminiRequest, parseGeminiResponse, parseRetryMs, planProviders, SAFETY };
