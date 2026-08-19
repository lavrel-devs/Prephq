const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Asks Groq to generate a set of multiple-choice questions for a course
// at a given difficulty, and returns them as a parsed array of:
//   { q, opts: [4 strings], ans: <index 0-3>, exp: <short explanation> }
async function generateQuiz({ course, difficulty = 'medium', count = 10, studyMaterial = '' }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'REPLACE_WITH_YOUR_GROQ_KEY') {
    const err = new Error('GROQ_API_KEY is not configured on the server');
    err.code = 'GROQ_NOT_CONFIGURED';
    throw err;
  }

  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

  const systemPrompt = `You are a quiz question generator for Nigerian university students preparing for exams. You output ONLY valid JSON — no markdown fences, no commentary, no preamble. The JSON must be an array of exactly ${count} objects, each with this exact shape:
{"q": "question text", "opts": ["option A", "option B", "option C", "option D"], "ans": 0, "exp": "one-sentence explanation of the correct answer"}
"ans" is the zero-based index into "opts" of the correct option. Questions must be at "${difficulty}" difficulty, specific to the course code "${course}" as taught in a Nigerian university curriculum, and must not repeat the same question twice.`;

  // Optional student-supplied context (pasted notes, or text extracted
  // client-side from an uploaded PDF/txt) — makes the quiz hyper-
  // personalized to what they're actually studying. Never persisted;
  // it only lives for the duration of this one request.
  const materialBlock = studyMaterial
    ? `\n\nThe student has supplied their own study material below. Prioritize generating questions that test the specific content, terms, and topics found in it, rather than generic course questions:\n"""\n${studyMaterial}\n"""`
    : '';

  const userPrompt = `Generate ${count} multiple-choice questions for the course "${course}" at "${difficulty}" difficulty. Return only the JSON array.${materialBlock}`;

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.6,
      response_format: { type: 'json_object' }, // some Groq models require an object wrapper; we handle both shapes below
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Groq API error (${res.status}): ${text.slice(0, 300)}`);
    err.code = 'GROQ_REQUEST_FAILED';
    throw err;
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) {
    const err = new Error('Groq returned an empty response');
    err.code = 'GROQ_EMPTY_RESPONSE';
    throw err;
  }

  const questions = parseQuestionsFromModelOutput(raw);
  return { questions, model };
}

// The model may return a bare array, or an object wrapping the array
// under a key (common when response_format=json_object is enforced).
// This normalizes either shape into a plain array.
function parseQuestionsFromModelOutput(raw) {
  let cleaned = raw.trim().replace(/^```json\s*|^```\s*|```$/g, '');
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    const err = new Error('Could not parse quiz JSON from AI response');
    err.code = 'GROQ_PARSE_FAILED';
    throw err;
  }

  let list = Array.isArray(parsed) ? parsed : null;
  if (!list && parsed && typeof parsed === 'object') {
    const arrKey = Object.keys(parsed).find(k => Array.isArray(parsed[k]));
    if (arrKey) list = parsed[arrKey];
  }
  if (!list) {
    const err = new Error('AI response did not contain a question array');
    err.code = 'GROQ_PARSE_FAILED';
    throw err;
  }

  return list
    .filter(item => item && item.q && Array.isArray(item.opts) && item.opts.length >= 2 && typeof item.ans === 'number')
    .map(item => ({
      q: String(item.q).trim(),
      opts: item.opts.map(String),
      ans: item.ans,
      exp: item.exp ? String(item.exp).trim() : '',
    }));
}

module.exports = { generateQuiz };
