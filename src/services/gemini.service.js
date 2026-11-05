const L = require('./aiProviders.logic');

// v1.8.7 Gemini as a second AI provider (eases Groq's rate limits). Speaks the same shape as callGroqOnce: pass the
// Groq-style body, get a Groq-style response, errors carry the same codes the queue and routes already understand.
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const cfg = () => L.geminiConfig();
const isConfigured = () => !!cfg().key;

async function call(body, timeoutMs = 30000, opts = {}) {
  const c = cfg();
  if (!c.key) { const e = new Error('GEMINI_API_KEY is not configured'); e.code = 'GROQ_NOT_CONFIGURED'; throw e; }
  const model = opts.priority === 'low' ? c.bulkModel : c.model;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.key },
      body: JSON.stringify(L.buildGeminiRequest(body)), signal: controller.signal,
    });
  } catch (e) {
    const err = new Error(e.name === 'AbortError' ? 'The AI took too long to respond. Please try again.' : `Could not reach the AI service: ${e.message}`);
    err.code = e.name === 'AbortError' ? 'GROQ_TIMEOUT' : 'GROQ_UNREACHABLE';
    throw err;
  } finally { clearTimeout(timer); }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 429 || res.status === 503) {
      const err = new Error('The AI is busy for a moment.'); err.code = 'GROQ_RATE_LIMITED'; err.retryAfterMs = L.parseRetryMs(text, res.headers.get('retry-after')); throw err;
    }
    const err = new Error(res.status === 404
      ? `Gemini model "${model}" is not available. Set GEMINI_MODEL / GEMINI_MODEL_BULK to a model listed in your Google AI Studio.`
      : `Gemini API error (${res.status}): ${text.slice(0, 300)}`);
    err.code = 'GROQ_REQUEST_FAILED';
    throw err;
  }
  return L.parseGeminiResponse(await res.json());
}

module.exports = { call, isConfigured, config: cfg };
