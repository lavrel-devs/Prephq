const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const aiQueue = require('./aiQueue.service');
const { fixBareLatex } = require('../../public/js/phq-latexfix.js');

// Shared fetch wrapper for every Groq call in this file. Centralizes
// the 30s hard timeout — without it, a slow/unreachable Groq endpoint
// (or a flaky outbound connection from a free-tier host) can hang a
// request indefinitely, leaving the student staring at a spinner with
// no error to act on.
async function callGroqOnce(body, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
    // A model name in .env that Groq no longer serves (e.g. a retired llama model) shouldn't break every
    // AI feature: retry once with the default model, and say what to fix in the log.
    if (res.status === 404 && /model_not_found/.test(text) && body.model !== DEFAULT_MODEL) {
      console.error(`[groq] Model "${body.model}" is not available — falling back to ${DEFAULT_MODEL}. Set GROQ_MODEL=${DEFAULT_MODEL} in your .env.`);
      return callGroqOnce({ ...body, model: DEFAULT_MODEL }, timeoutMs);
    }
    if (res.status === 429 || res.status === 503) {
      // Rate limited / overloaded: the queue (aiQueue.service) pauses and retries this automatically.
      const err = new Error('The AI is busy for a moment.');
      err.code = 'GROQ_RATE_LIMITED';
      err.retryAfterMs = res.status === 503 ? 4000 : aiQueue.parseRetryAfter(res.headers, text);
      throw err;
    }
    const err = new Error(`Groq API error (${res.status}): ${text.slice(0, 300)}`);
    err.code = 'GROQ_REQUEST_FAILED';
    throw err;
  }
  return res.json();
}

// Every Groq call goes through the queue: spaced-out starts, automatic wait-and-retry on rate limits.
// `opts.priority` = 'low' for bulk jobs (they yield to students), default 'high'.
function callGroq(body, timeoutMs = 30000, opts = {}) {
  return aiQueue.run(() => callGroqOnce(body, timeoutMs), opts);
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

// Science formatting the app can draw: LaTeX (KaTeX + mhchem) and skeletal structures from SMILES.
const SCI_FORMAT = `MATHS/SCIENCE FORMATTING (the app renders these): write maths in LaTeX between single dollar signs, e.g. $E = mc^2$, $\\frac{a}{b}$, $x^2 + 3x - 4 = 0$; put an important equation on its own line as $$ ... $$ (keep each $$...$$ on ONE line). Write chemical formulas and reactions with mhchem: $\\ce{H2SO4}$, $\\ce{2H2 + O2 -> 2H2O}$, $\\ce{Fe^{3+}}$. To show an organic or molecular structure, put its SMILES on its own line as [[smiles: CC(=O)O]] and the app draws the skeletal structure. Only give a SMILES you are certain is valid; never invent one. Every LaTeX command MUST sit inside $…$ — never write a bare \\frac, \\text or \\times on its own. Put each calculation step on its own line, fully wrapped in $…$. Write ions and formulas with \\ce{} (e.g. $\\ce{Fe^{2+}}$, $\\ce{MnO4^-}$), never inside \\text{}; use \\text{} only for plain words and units, and write units like $\\text{mol L}^{-1}$. Never use a bare $ for money (write naira or ₦).`;

// The model sometimes writes a single backslash inside a JSON string ("\\frac"), which JSON.parse silently turns
// into a control character (form feed + "rac"). Put the backslash back so LaTeX survives.
function fixLatexEscapes(v) {
  return fixBareLatex(String(v)
    .replace(/\f(?=rac|orall|lat|box)/g, '\\f').replace(/\x0c/g, '\\f')
    .replace(/\x08(?=eta|ar|oldsymbol|ig|ullet|inom)/g, '\\b')
    .replace(/\t(?=heta|imes|au|ext|o\b|an|ilde|riangle|herefore)/g, '\\t')
    .replace(/\r(?=ightarrow|ho|ight|m\{|angle)/g, '\\r')
    .replace(/\n(?=eq|abla|u\b|ot|eg|less|geq|parallel|i\b)/g, '\\n'));
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
"ans" is the zero-based index into "opts" of the correct option. Questions must be at "${difficulty}" difficulty, specific to the course code "${course}" as taught in a Nigerian university curriculum, and must not repeat the same question twice.
${SCI_FORMAT} Inside JSON strings every backslash must be doubled (write "$\\\\frac{1}{2}$" for \\frac{1}{2}). Keep <sub>/<sup> out — use LaTeX instead.`;

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
      q: fixLatexEscapes(cleanAiText(item.q)),
      opts: item.opts.map(o => fixLatexEscapes(cleanAiText(o))),
      ans: item.ans,
      exp: item.exp ? fixLatexEscapes(cleanAiText(item.exp)) : '',
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

  const systemPrompt = `You are a patient tutor helping a Nigerian university student understand a quiz question they got wrong. Explain in 2-3 short sentences, plain language, no markdown headers or bullet lists — just prose. Explain why the correct answer is right, and briefly why the option they picked (if any) is a common misconception, without being condescending. ${SCI_FORMAT}`;
  const userPrompt = `Course: ${course}\nQuestion: ${question}\nOptions:\n${lettered}\nCorrect answer: ${String.fromCharCode(65 + correctIndex)}. ${opts[correctIndex]}\n${chosenLine}\n\nExplain.`;

  const data = await callGroq({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: tokenBudget(model, 420),
    ...extraParams(model),
  });

  const explanation = data?.choices?.[0]?.message?.content?.trim();
  if (!explanation) {
    const err = new Error('Groq returned an empty response');
    err.code = 'GROQ_EMPTY_RESPONSE';
    throw err;
  }
  return fixBareLatex(explanation);
}

// Academic chatbot reply. `history` is the recent conversation
// (oldest first) so the model has context; kept short (last ~12
// messages) to control token spend per turn.
async function chatReply(history) {
  requireGroqKey();
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const systemPrompt = `You are PrepHQ's academic study assistant, helping Nigerian university students. Answer academic/study questions clearly and concisely. Use plain prose, not markdown headers. ${SCI_FORMAT} Keep answers focused — a few sentences to a short paragraph unless the student clearly wants a longer worked explanation (e.g. a multi-step calculation or proof). If asked something entirely unrelated to academics/studying, politely redirect to study topics.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(m => ({ role: m.role, content: m.content })),
  ];

  const data = await callGroq({ model, messages, temperature: 0.5, max_tokens: tokenBudget(model, 900), ...extraParams(model) });

  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    const err = new Error('Groq returned an empty response');
    err.code = 'GROQ_EMPTY_RESPONSE';
    throw err;
  }
  return fixBareLatex(reply);
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

// ── Course notes (admin AI note builder) ──────────────────────
// 1) Arrange the topics found in a course's past questions into a sensible teaching order.
//    `tags` = [{ tag, count, samples[] }], `untagged` = [{ i, q }] (questions with no topic tag).
async function generateCourseOutline({ courseCode, courseTitle, tags, untagged, priority }) {
  requireGroqKey();
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const tagLines = tags.map(t => `- "${t.tag}" (${t.count} questions) e.g. ${t.samples.map(x => `"${x}"`).join(' | ')}`).join('\n') || '(none)';
  const untaggedLines = untagged.map(u => `[${u.i}] ${u.q}`).join('\n') || '(none)';

  const system = `You organise a university course into a topic outline for study notes. You output ONLY valid JSON, no commentary.
Return {"topics":[{"name":"Topic name","tags":["existing tag exactly as given"],"untaggedIdx":[3,7],"summary":"one plain sentence on what this topic covers"}]}
Rules:
- Order topics in the sequence a lecturer would teach them (fundamentals first).
- Merge duplicate or differently-spelled tags into ONE topic. In "tags" copy the tag strings EXACTLY as given.
- Every given tag must appear in exactly one topic.
- Questions with no tag are listed with an index. Group them into a suitable topic (existing or new) using "untaggedIdx"; leave out any that are too vague.
- Topic names: short, clear, Title Case, max 80 characters. At most 40 topics.`;
  const user = `Course: ${courseCode} — ${courseTitle}\n\nTOPIC TAGS FROM PAST QUESTIONS:\n${tagLines}\n\nQUESTIONS WITHOUT A TAG:\n${untaggedLines}\n\nReturn only the JSON object.`;

  const data = await callGroq({
    model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.3, max_tokens: tokenBudget(model, 2500), ...extraParams(model), response_format: { type: 'json_object' },
  }, 60000, { priority });
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) { const err = new Error('Groq returned an empty response'); err.code = 'GROQ_EMPTY_RESPONSE'; throw err; }
  let parsed;
  try { parsed = JSON.parse(raw.trim().replace(/^```json\s*|^```\s*|```$/g, '')); }
  catch (e) { const err = new Error('Could not read the AI outline. Try again.'); err.code = 'GROQ_PARSE_FAILED'; throw err; }
  if (!parsed || !Array.isArray(parsed.topics)) { const err = new Error('The AI did not return an outline. Try again.'); err.code = 'GROQ_PARSE_FAILED'; throw err; }
  return { topics: parsed.topics, model };
}

// 2) Write comprehensive-but-simple notes for ONE topic. `questions` = [{ q, correct, exp }] — the past
//    questions on this topic, used to see what examiners actually test.
async function generateCourseNote({ courseCode, courseTitle, topic, questions, priority }) {
  requireGroqKey();
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const evidence = questions.map((x, i) => `${i + 1}. ${x.q}\n   Answer: ${x.correct}${x.exp ? `\n   Explanation: ${x.exp}` : ''}`).join('\n');

  const system = `You write study notes for Nigerian university students preparing for exams. Write in clear, simple English that a first-year student can follow: short sentences, everyday words, and a brief plain-language explanation whenever you use a technical term.
Be COMPREHENSIVE — teach the whole topic properly, not just the sample questions — but never pad. Only state facts you are confident are correct; if unsure, leave it out.
FORMAT (strict, plain text only — no HTML, no tables, no code fences):
- Section headings on their own line starting with "## ".
- Bullet points starting with "- ".
- Put **double asterisks** around key terms the first time they appear.
- Write every formula in LaTeX, e.g. $PV = nRT$, and say what each symbol means. For sciences and maths, use the structures/equations that help (see below).
${SCI_FORMAT}
Use these sections in this order: "## Overview", "## Key ideas", "## Worked examples" (1–2 short examples with steps, only if the topic is calculation-based or benefits from one), "## Common exam traps", "## Quick recap" (5–8 bullets).
Total length about 450–800 words.`;
  const user = `Course: ${courseCode} — ${courseTitle}\nTopic: ${topic}\n\nPast exam questions on this topic (use them to see what is examined, and cover those ideas, but teach the whole topic):\n${evidence}\n\nWrite the notes now.`;

  const data = await callGroq({
    model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.4, max_tokens: tokenBudget(model, 2400), ...extraParams(model),
  }, 90000, { priority });
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw || !raw.trim()) { const err = new Error('Groq returned an empty response'); err.code = 'GROQ_EMPTY_RESPONSE'; throw err; }
  return { body: cleanNoteText(raw), model };
}

// 3) A student-requested note on a topic they typed. `depth` = quick | standard | detailed.
const DEPTH_SPEC = {
  quick:    { words: '200–350 words', sections: '"## Overview", "## Key points" and "## Quick recap"', budget: 1200 },
  standard: { words: '450–800 words', sections: '"## Overview", "## Key ideas", "## Worked examples" (only if useful), "## Common exam traps", "## Quick recap"', budget: 2400 },
  detailed: { words: '900–1500 words', sections: '"## Overview", "## Key ideas", "## Worked examples" (2–4 step-by-step examples), "## Common exam traps", "## Self-test" (4–6 short questions with answers), "## Quick recap"', budget: 3600 },
};
async function generateStudentNote({ courseCode, courseTitle, topic, depth = 'standard', questions = [] }) {
  requireGroqKey();
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const spec = DEPTH_SPEC[depth] || DEPTH_SPEC.standard;
  const evidence = questions.length
    ? `\n\nPast exam questions on this topic (use them to see what is examined, but teach the whole topic):\n${questions.map((x, i) => `${i + 1}. ${x.q}\n   Answer: ${x.correct}`).join('\n')}`
    : '';
  const system = `You write study notes for Nigerian university students preparing for exams. Write in clear, simple English a first-year student can follow: short sentences, everyday words, and a brief plain-language explanation whenever you use a technical term. Be accurate: only state facts you are confident are correct; if unsure, leave it out. If the topic is not a real academic topic, reply with the single line "## Overview" followed by one sentence asking the student to name a real topic.
FORMAT (strict, plain text only — no HTML, no tables, no code fences): section headings on their own line starting with "## "; bullets starting with "- "; **double asterisks** around key terms the first time they appear.
Use these sections in order: ${spec.sections}. Total length about ${spec.words}.
Write every formula in LaTeX (e.g. $PV = nRT$) and say what each symbol means; use worked calculations with units where the topic needs them.
${SCI_FORMAT}`;
  const user = `Course: ${courseCode} — ${courseTitle}\nTopic: ${topic}${evidence}\n\nWrite the notes now.`;
  const data = await callGroq({
    model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.4, max_tokens: tokenBudget(model, spec.budget), ...extraParams(model),
  }, 90000);
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw || !raw.trim()) { const err = new Error('Groq returned an empty response'); err.code = 'GROQ_EMPTY_RESPONSE'; throw err; }
  return { body: cleanNoteText(raw), model };
}

// Keeps the note inside the simple markup the student reader supports (## headings, "- " bullets, **bold**)
// and strips anything else — HTML, markdown extras, code fences.
function cleanNoteText(raw) {
  let t = String(raw)
    .replace(/```[a-z]*\n?|```/gi, '')
    .replace(/<\/?(?:b|i|u|em|strong|p|br|div|span|ul|ol|li|h[1-6]|table|thead|tbody|tr|td|th|a|img|sub|sup|code|pre|script|style|iframe)(?=[\s/>])[^>]*>/gi, '')
    .replace(/^\s*#{1,4}\s+/gm, '## ')
    .replace(/^\s*[*•]\s+/gm, '- ')
    .replace(/^\s*-{3,}\s*$/gm, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (t.length > 11500) { t = t.slice(0, 11500); t = t.slice(0, Math.max(t.lastIndexOf('\n'), 6000)).trim(); }
  return fixBareLatex(t);
}

module.exports = { generateQuiz, explainAnswer, chatReply, generateStudyGuide, generateCourseOutline, generateCourseNote, generateStudentNote, cleanNoteText, fixLatexEscapes, SCI_FORMAT };
