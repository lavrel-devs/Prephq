// ── Written Exam helpers (v1.8.0) ─────────────────────────────
// Pure functions: validate what the AI returns, and turn its marking into scores. Kept apart from the route and
// the AI call so they can be tested without a database or network.

const MAX_RUBRIC_POINTS = 8, MAX_POINT_MARKS = 5, MAX_ANSWER_CHARS = 4000;
const clean = (v, max) => String(v == null ? '' : v).replace(/\s+\n/g, '\n').trim().slice(0, max);

// AI output -> validated questions. Each needs a question, 2–8 rubric points with whole-number marks, and a model
// answer. A question's marks ALWAYS equal the sum of its rubric (the AI's own "marks" figure is ignored).
function normalizeQuestions(raw, wanted) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.questions) ? raw.questions : []);
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const q = clean(item.q, 700);
    const rubric = (Array.isArray(item.rubric) ? item.rubric : [])
      .map(r => ({ point: clean(r && r.point, 240), marks: Math.round(Number(r && r.marks)) }))
      .filter(r => r.point && Number.isFinite(r.marks) && r.marks >= 1)
      .slice(0, MAX_RUBRIC_POINTS)
      .map(r => ({ point: r.point, marks: Math.min(r.marks, MAX_POINT_MARKS) }));
    if (!q || rubric.length < 2) continue;
    out.push({ q, rubric, marks: rubric.reduce((a, r) => a + r.marks, 0), model: clean(item.model, 1800) });
    if (out.length >= wanted) break;
  }
  return out;
}

// Student answers -> exactly one trimmed string per question.
function normalizeAnswers(answers, count) {
  const a = Array.isArray(answers) ? answers : [];
  return Array.from({ length: count }, (_, i) => clean(typeof a[i] === 'string' ? a[i] : '', MAX_ANSWER_CHARS));
}

// AI marking -> per-question results. The score is NOT taken from the AI's own number: it is the sum of the marks
// of the rubric points the AI says the answer earned. A point can only be earned once, indexes outside the rubric
// are ignored, and a blank answer always scores 0 — so a confused or manipulated reply can't invent marks.
function applyMarking(questions, answers, aiResults) {
  const byIndex = new Map();
  for (const r of (Array.isArray(aiResults && aiResults.results) ? aiResults.results : Array.isArray(aiResults) ? aiResults : [])) {
    if (r && Number.isInteger(r.i)) byIndex.set(r.i, r);
  }
  return questions.map((q, i) => {
    const blank = !String(answers[i] || '').trim();
    const r = byIndex.get(i) || {};
    const met = blank ? [] : [...new Set((Array.isArray(r.met) ? r.met : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < q.rubric.length))].sort((a, b) => a - b);
    const score = met.reduce((a, idx) => a + q.rubric[idx].marks, 0);
    return {
      score: Math.min(score, q.marks), met,
      feedback: blank ? 'No answer was written for this question.' : clean(r.feedback, 700),
      tip: blank ? '' : clean(r.tip, 300),
    };
  });
}

const totals = (questions, results) => ({
  total: results.reduce((a, r) => a + r.score, 0),
  maxTotal: questions.reduce((a, q) => a + q.marks, 0),
});

// What an OPEN exam may reveal: the questions and their marks, never the scheme or the model answers.
const publicQuestions = (questions) => questions.map(q => ({ q: q.q, marks: q.marks }));

module.exports = { normalizeQuestions, normalizeAnswers, applyMarking, totals, publicQuestions, MAX_ANSWER_CHARS };
