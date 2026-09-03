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

// Explains why a specific answer was wrong (or why the correct answer
// is correct), for questions that don't already have a static `exp`
// field filled in by an admin. Kept deliberately short (2-3 sentences)
// — this is a quick "why" nudge during results review, not a lecture.
async function explainAnswer({ course, question, opts, correctIndex, chosenIndex }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'REPLACE_WITH_YOUR_GROQ_KEY') {
    const err = new Error('GROQ_API_KEY is not configured on the server');
    err.code = 'GROQ_NOT_CONFIGURED';
    throw err;
  }

  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const lettered = opts.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n');
  const chosenLine = Number.isInteger(chosenIndex) && chosenIndex !== correctIndex
    ? `The student chose "${String.fromCharCode(65 + chosenIndex)}. ${opts[chosenIndex]}", which is wrong.`
    : 'The student skipped this question.';

  const systemPrompt = `You are a patient tutor helping a Nigerian university student understand a quiz question they got wrong. Explain in 2-3 short sentences, plain language, no markdown headers or bullet lists — just prose. Explain why the correct answer is right, and briefly why the option they picked (if any) is a common misconception, without being condescending.`;
  const userPrompt = `Course: ${course}\nQuestion: ${question}\nOptions:\n${lettered}\nCorrect answer: ${String.fromCharCode(65 + correctIndex)}. ${opts[correctIndex]}\n${chosenLine}\n\nExplain.`;

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 220,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Groq API error (${res.status}): ${text.slice(0, 300)}`);
    err.code = 'GROQ_REQUEST_FAILED';
    throw err;
  }

  const data = await res.json();
  const explanation = data?.choices?.[0]?.message?.content?.trim();
  if (!explanation) {
    const err = new Error('Groq returned an empty response');
    err.code = 'GROQ_EMPTY_RESPONSE';
    throw err;
  }
  return explanation;
}

// Academic chatbot reply. `history` is the recent conversation
// (oldest first) so the model has context; kept short (last ~12
// messages) to control token spend per turn.
async function chatReply(history) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'REPLACE_WITH_YOUR_GROQ_KEY') {
    const err = new Error('GROQ_API_KEY is not configured on the server');
    err.code = 'GROQ_NOT_CONFIGURED';
    throw err;
  }

  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const systemPrompt = `You are PrepHQ's academic study assistant, helping Nigerian university students. Answer academic/study questions clearly and concisely. Use plain prose, not markdown headers. Keep answers focused — a few sentences to a short paragraph unless the student clearly wants a longer worked explanation (e.g. a multi-step calculation or proof). If asked something entirely unrelated to academics/studying, politely redirect to study topics.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(m => ({ role: m.role, content: m.content })),
  ];

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.5, max_tokens: 500 }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Groq API error (${res.status}): ${text.slice(0, 300)}`);
    err.code = 'GROQ_REQUEST_FAILED';
    throw err;
  }

  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    const err = new Error('Groq returned an empty response');
    err.code = 'GROQ_EMPTY_RESPONSE';
    throw err;
  }
  return reply;
}

module.exports = { generateQuiz, explainAnswer, chatReply };
