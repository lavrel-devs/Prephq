const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Shared fetch wrapper for every Groq call in this file. Centralizes
// the 30s hard timeout — without it, a slow/unreachable Groq endpoint
// (or a flaky outbound connection from a free-tier host) can hang a
// request indefinitely, leaving the student staring at a spinner with
// no error to act on.
async function callGroq(body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let res;
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('The AI took too long to respond. Please try again.');
      err.code = 'GROQ_TIMEOUT';
      throw err;
    }
    const err = new Error(`Could not reach the AI service: ${e.message}`);
    err.code = 'GROQ_UNREACHABLE';
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Groq API error (${res.status}): ${text.slice(0, 300)}`);
    err.code = 'GROQ_REQUEST_FAILED';
    throw err;
  }
  return res.json();
}

// Reasoning models (gpt-oss, qwen3, deepseek-r1…) spend part of `max_tokens`
// on hidden reasoning. The old tight caps (220 / 500) could be used up before
// any answer text appeared, producing "Groq returned an empty response".
function tokenBudget(model, base) {
  return /gpt-oss|qwen3|deepseek-r1|reason/i.test(model) ? base * 4 : base;
}
function extraParams(model) {
  return /gpt-oss/i.test(model) ? { reasoning_effort: 'low' } : {};
}

// AI text is rendered as HTML by the dashboard (question banks legitimately use
// <sub>/<sup>), so keep only harmless inline formatting tags and drop attributes.
// `<` followed by a space/digit (e.g. "x < 5") is not a tag and is left alone.
function cleanAiText(v) {
  return String(v)
    .replace(/<(\/?)(sub|sup|b|i|em|strong|br)\b[^>]*>/gi, '\u0001$1$2\u0002')
    .replace(/<(?=[a-zA-Z\/!?])[^>]*>?/g, '')
    .replace(/\u0001(\/?)(sub|sup|b|i|em|strong|br)\u0002/gi, '<$1$2>')
    .trim();
}

function requireGroqKey() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'REPLACE_WITH_YOUR_GROQ_KEY') {
    const err = new Error('GROQ_API_KEY is not configured on the server');
    err.code = 'GROQ_NOT_CONFIGURED';
    throw err;
  }
}

// Asks Groq to generate a set of multiple-choice questions for a course
// at a given difficulty, and returns them as a parsed array of:
//   { q, opts: [4 strings], ans: <index 0-3>, exp: <short explanation> }
async function generateQuiz({ course, difficulty = 'medium', count = 10, studyMaterial = '' }) {
  requireGroqKey();
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

  const data = await callGroq({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.6,
    ...extraParams(model),
    response_format: { type: 'json_object' }, // some Groq models require an object wrapper; we handle both shapes below
  });

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
    .map(item => item && ({ ...item, ans: typeof item.ans === 'string' && /^\d+$/.test(item.ans) ? parseInt(item.ans, 10) : item.ans }))
    // `ans` must point at a real option — the model sometimes returns 1-based or out-of-range indexes.
    .filter(item => item && item.q && Array.isArray(item.opts) && item.opts.length >= 2 && item.opts.length <= 8
      && Number.isInteger(item.ans) && item.ans >= 0 && item.ans < item.opts.length)
    .map(item => ({
      q: cleanAiText(item.q),
      opts: item.opts.map(cleanAiText),
      ans: item.ans,
      exp: item.exp ? cleanAiText(item.exp) : '',
    }));
}

// Explains why a specific answer was wrong (or why the correct answer
// is correct), for questions that don't already have a static `exp`
// field filled in by an admin. Kept deliberately short (2-3 sentences)
// — this is a quick "why" nudge during results review, not a lecture.
async function explainAnswer({ course, question, opts, correctIndex, chosenIndex }) {
  requireGroqKey();
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const lettered = opts.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n');
  const chosenLine = !Number.isInteger(chosenIndex)
    ? 'The student skipped this question.'
    : chosenIndex === correctIndex
      ? 'The student answered correctly and wants to understand why.'
      : `The student chose "${String.fromCharCode(65 + chosenIndex)}. ${opts[chosenIndex]}", which is wrong.`;

  const systemPrompt = `You are a patient tutor helping a Nigerian university student understand a quiz question they got wrong. Explain in 2-3 short sentences, plain language, no markdown headers or bullet lists — just prose. Explain why the correct answer is right, and briefly why the option they picked (if any) is a common misconception, without being condescending.`;
  const userPrompt = `Course: ${course}\nQuestion: ${question}\nOptions:\n${lettered}\nCorrect answer: ${String.fromCharCode(65 + correctIndex)}. ${opts[correctIndex]}\n${chosenLine}\n\nExplain.`;

  const data = await callGroq({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: tokenBudget(model, 220),
    ...extraParams(model),
  });

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
  requireGroqKey();
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const systemPrompt = `You are PrepHQ's academic study assistant, helping Nigerian university students. Answer academic/study questions clearly and concisely. Use plain prose, not markdown headers. Keep answers focused — a few sentences to a short paragraph unless the student clearly wants a longer worked explanation (e.g. a multi-step calculation or proof). If asked something entirely unrelated to academics/studying, politely redirect to study topics.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(m => ({ role: m.role, content: m.content })),
  ];

  const data = await callGroq({ model, messages, temperature: 0.5, max_tokens: tokenBudget(model, 500), ...extraParams(model) });

  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    const err = new Error('Groq returned an empty response');
    err.code = 'GROQ_EMPTY_RESPONSE';
    throw err;
  }
  return reply;
}

// v1.4. Generates a structured, actionable study plan for a student
// working toward a target GPA, given their current GPA and the
// courses they're offering this semester (plus, optionally, which of
// those they're weakest on if we have weak-topic data for them).
// Returns { weeks: [{ title, focus, tasks: [string] }], summary }.
async function generateStudyGuide({ currentGPA, targetGPA, gpaScale = 5.0, department, courses, weakCourses = [] }) {
  requireGroqKey();
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const gpaGap = (Number(targetGPA) - Number(currentGPA)).toFixed(2);
  courses = (courses || []).map(c => String(c).slice(0, 30));
  const weakLine = weakCourses.length ? `\nThe student has been scoring weakest recently in: ${weakCourses.join(', ')}. Weight the plan toward these.` : '';

  const systemPrompt = `You are an academic coach for a Nigerian university student. You output ONLY valid JSON — no markdown fences, no commentary. The JSON must have this exact shape:
{"summary": "2-3 sentence encouraging overview of the plan and what it will take to close the GPA gap", "weeks": [{"title": "Week 1", "focus": "short phrase naming the focus", "tasks": ["specific, actionable task", "..."]}]}
Produce exactly 4 weeks. Each week must have 3-5 concrete, specific tasks (not vague advice like "study more") — e.g. "Redo all past-question MCQs for [course] topic X and review every wrong answer", "Summarize chapters 3-4 of [course] into one page of notes". Ground tasks in the student's actual courses and department.`;

  const userPrompt = `Department: ${department || 'not specified'}
Courses this semester: ${courses.join(', ') || 'not specified'}
GPA scale used by this student's school: 0–${gpaScale}
Current GPA: ${currentGPA} · Target GPA: ${targetGPA} (gap: ${gpaGap} on a ${gpaScale}-point scale)${weakLine}

Generate a 4-week study plan to help close this GPA gap. Return only the JSON object.`;

  const data = await callGroq({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.6,
    ...extraParams(model),
    response_format: { type: 'json_object' },
  });

  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) {
    const err = new Error('Groq returned an empty response');
    err.code = 'GROQ_EMPTY_RESPONSE';
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.trim().replace(/^```json\s*|^```\s*|```$/g, ''));
  } catch (e) {
    const err = new Error('Could not parse study guide JSON from AI response');
    err.code = 'GROQ_PARSE_FAILED';
    throw err;
  }

  if (!parsed.weeks || !Array.isArray(parsed.weeks) || !parsed.weeks.length) {
    const err = new Error('AI response did not contain a study plan');
    err.code = 'GROQ_PARSE_FAILED';
    throw err;
  }

  return {
    summary: cleanAiText(parsed.summary || ''),
    weeks: parsed.weeks.map(w => ({
      title: cleanAiText(w.title || ''),
      focus: cleanAiText(w.focus || ''),
      tasks: Array.isArray(w.tasks) ? w.tasks.map(cleanAiText).slice(0, 8) : [],
    })),
    model,
  };
}

module.exports = { generateQuiz, explainAnswer, chatReply, generateStudyGuide };
