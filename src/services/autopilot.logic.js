// ── Weakness Autopilot — pure logic (v1.9.0) ───────────────────────────────────────────────
// Builds a short, time-boxed plan ("Today's 15 minutes") from what a student has actually done.
// Nothing here touches the database — autopilot.service.js gathers the inputs and this file decides.
// Keeping the decisions pure means they can be unit-tested (tests/autopilot.test.js) with no DB.
//
// How it chooses (every item says WHY it is there):
//   • Weak topics        — recent accuracy under the weak threshold, worst first.
//   • Missed questions   — questions the student last got wrong, to be retried.
//   • Flashcards due     — spaced-repetition cards that are due today.
//   • Least-practised    — a registered course that has had little attention this week.
//   • Exam urgency       — as the exam gets closer, everything tied to that course scores higher.
// Candidates are scored, then picked greedily until the time budget is used up.

const BUDGET_MIN = 15;          // the promise: a plan that takes about 15 minutes
const MIN_PER_QUESTION = 0.65;  // reading + answering one MCQ, on average
const WEAK_QUESTIONS = 8;       // questions per weak-topic drill
const MAX_WEAK_ITEMS = 3;       // never fill the plan with drills only
const EXAM_HORIZON_DAYS = 30;   // exams further away than this don't change the ranking

const normKey = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const tagNorm = v => String(v || '').trim().toLowerCase();
const qMinutes = n => Math.max(1, Math.round(n * MIN_PER_QUESTION));
const keyOf = (course, tag) => `${normKey(course)}|${tagNorm(tag)}`;

// Exam info from the student's saved settings (same shape study.routes.js builds). `day` is the WAT day 'YYYY-MM-DD'.
function examFromSettings(sets, day) {
  if (!sets || !/^\d{4}-\d{2}-\d{2}$/.test(sets.examDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return null;
  const daysLeft = Math.round((Date.parse(`${sets.examDate}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000);
  return {
    daysLeft, date: sets.examDate,
    course: normKey(sets.examCourse), courseCode: String(sets.examCourse || ''), name: String(sets.examName || ''),
  };
}

// 0 when there's no usable exam; otherwise grows from ~0 (30 days out) to ~24 (exam day), plus a bonus when it's THIS course.
function examBoost(exam, course) {
  if (!exam || exam.daysLeft == null || exam.daysLeft < 0 || exam.daysLeft > EXAM_HORIZON_DAYS) return 0;
  const urgency = (EXAM_HORIZON_DAYS + 1 - exam.daysLeft) * 0.8;       // 0.8 … 24.8
  if (!exam.course) return urgency * 0.5;                                // exam date set but no course chosen: mild nudge for everything
  return normKey(course) === exam.course ? urgency + 20 : urgency * 0.25;
}

function buildAutopilotPlan(input = {}) {
  const {
    day = '', budgetMin = BUDGET_MIN, exam = null,
    weakTopics = [], missed = { count: 0, qids: [] }, dueCards = 0, cardsEnabled = false,
    registered = [], practicedWeek = {}, daysSinceActive = null,
  } = input;

  const cand = [];

  // 1. Weak topics (worst first)
  weakTopics.slice(0, MAX_WEAK_ITEMS).forEach(w => {
    const target = WEAK_QUESTIONS;
    cand.push({
      score: 50 + Math.max(0, 65 - (Number(w.accuracy) || 0)) * 0.6 + examBoost(exam, w.course),
      item: {
        type: 'drill', title: `Drill: ${w.tag}`,
        detail: `${w.courseCode || String(w.course).toUpperCase()} · ${w.accuracy}% recently`,
        course: normKey(w.course), tag: w.tag, target, minutes: qMinutes(target),
      },
    });
  });

  // 2. Questions the student last got wrong
  const missedCount = (missed && missed.count) || 0;
  if (missedCount > 0) {
    const target = Math.min(missedCount, 6);
    cand.push({
      score: 62 + Math.min(missedCount, 10),
      item: {
        type: 'missed', title: `Retry ${target} question${target === 1 ? '' : 's'} you missed`,
        detail: `${missedCount}${missedCount >= 30 ? '+' : ''} waiting — turn them into wins`,
        target, minutes: qMinutes(target), qids: (missed.qids || []).slice(0, 30),
      },
    });
  }

  // 3. Flashcards due (only when the student's plan includes flashcards)
  if (cardsEnabled && dueCards > 0) {
    const target = Math.min(dueCards, 15);
    cand.push({
      score: 66 + Math.min(dueCards, 20) * 0.4,
      item: {
        type: 'flashcards', title: `Review ${target} flashcard${target === 1 ? '' : 's'}`,
        detail: 'Due today — reviewing on time is what makes them stick',
        target, dueAtGen: dueCards, minutes: Math.max(2, Math.ceil(target / 5)),
      },
    });
  }

  // 4. Least-practised registered course this week (only worth comparing when there's more than one)
  const regs = registered.map(r => ({ key: normKey(r.key), code: r.code || String(r.key).toUpperCase() }));
  const leastPracticed = regs.length > 1
    ? [...regs].sort((a, b) => (practicedWeek[a.key] || 0) - (practicedWeek[b.key] || 0))[0] : null;
  if (leastPracticed && (practicedWeek[leastPracticed.key] || 0) < 10) {
    const n = practicedWeek[leastPracticed.key] || 0, target = 6;
    cand.push({
      score: 40 + (10 - n) * 1.5 + examBoost(exam, leastPracticed.key),
      item: {
        type: 'practice', title: `Practise ${leastPracticed.code}`,
        detail: `Only ${n} question${n === 1 ? '' : 's'} this week`,
        course: leastPracticed.key, target, minutes: qMinutes(target),
      },
    });
  }

  // Nothing to go on yet (brand-new student, or a clean slate): a light warm-up in their first course.
  if (!cand.length && regs.length) {
    const first = leastPracticed || regs[0], target = WEAK_QUESTIONS;
    cand.push({
      score: 10,
      item: {
        type: 'practice', title: `Warm-up: ${first.code}`,
        detail: 'A quick start — Wreddi learns your weak spots from what you answer',
        course: first.key, target, minutes: qMinutes(target),
      },
    });
  }

  // Pick greedily by score, never repeating the same course+topic, until the budget is used.
  cand.sort((a, b) => b.score - a.score);
  const chosen = [], seen = new Set();
  let used = 0;
  for (const c of cand) {
    const k = c.item.type === 'drill' || c.item.type === 'practice' ? `${c.item.type}:${keyOf(c.item.course, c.item.tag)}` : c.item.type;
    if (seen.has(k)) continue;
    if (chosen.length && used + c.item.minutes > budgetMin) continue;   // always keep at least the best item
    seen.add(k); chosen.push(c.item); used += c.item.minutes;
  }
  chosen.forEach((it, i) => { it.id = `ap-${i + 1}`; });

  return { day, budgetMin, totalMin: used, headline: headlineFor({ exam, chosen, weakTopics, daysSinceActive, regs }), items: chosen };
}

function headlineFor({ exam, chosen, weakTopics, daysSinceActive, regs }) {
  if (!chosen.length) return regs.length ? 'Nothing due today — enjoy the break' : 'Pick your courses to get a daily plan';
  const examPart = exam && exam.daysLeft >= 0 && exam.daysLeft <= EXAM_HORIZON_DAYS
    ? `${exam.courseCode ? exam.courseCode + ' exam ' : 'Exam '}${exam.daysLeft === 0 ? 'today' : exam.daysLeft === 1 ? 'tomorrow' : `in ${exam.daysLeft} days`}` : '';
  const focus = weakTopics[0] ? `focus on ${weakTopics[0].tag}` : '';
  if (examPart && focus) return `${examPart} — ${focus}`;
  if (examPart) return examPart;
  if (daysSinceActive != null && daysSinceActive >= 3) return 'Welcome back — an easy way to restart';
  if (focus) return focus.charAt(0).toUpperCase() + focus.slice(1);
  return 'Keep your streak going';
}

// Marks which items are done from what the student has actually done today — never self-reported.
// activity = {
//   attemptsByKey:    { 'course|tag': n }  (questions answered today per course+tag, keys already normalised)
//   attemptsByCourse: { course: n }
//   retriedQids:      number of today's attempts on this plan's missed qids
//   cardsDueNow:      flashcards due right now
// }
function markDone(plan, activity = {}) {
  const byKey = activity.attemptsByKey || {}, byCourse = activity.attemptsByCourse || {};
  const items = (plan.items || []).map(it => {
    let done = false;
    if (it.type === 'drill') done = (byKey[keyOf(it.course, it.tag)] || 0) >= it.target;
    else if (it.type === 'practice') done = (byCourse[normKey(it.course)] || 0) >= it.target;
    else if (it.type === 'missed') done = (activity.retriedQids || 0) >= Math.min(it.target, (it.qids || []).length || it.target);
    else if (it.type === 'flashcards') done = activity.cardsDueNow != null && activity.cardsDueNow <= Math.max(0, (it.dueAtGen || 0) - it.target);
    return { ...it, done };
  });
  const doneCount = items.filter(i => i.done).length;
  const minutesLeft = items.filter(i => !i.done).reduce((a, i) => a + i.minutes, 0);
  return { ...plan, items, doneCount, total: items.length, allDone: items.length > 0 && doneCount === items.length, minutesLeft };
}

module.exports = {
  BUDGET_MIN, WEAK_QUESTIONS, MAX_WEAK_ITEMS, EXAM_HORIZON_DAYS,
  normKey, tagNorm, qMinutes, keyOf, examFromSettings, examBoost, buildAutopilotPlan, markDone,
};
