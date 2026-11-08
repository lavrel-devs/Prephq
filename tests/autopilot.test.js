// Weakness Autopilot (v1.9.0): the pure planning logic — time budget, ranking, exam urgency, done-detection.
const assert = require('assert'), path = require('path');
const L = require(path.join(__dirname, '..', 'src', 'services', 'autopilot.logic.js'));

// ── exam helpers ─────────────────────────────────────────────
assert.strictEqual(L.examFromSettings({}, '2026-11-06'), null);
assert.strictEqual(L.examFromSettings({ examDate: 'soon' }, '2026-11-06'), null);
const ex = L.examFromSettings({ examDate: '2026-11-12', examCourse: 'CHM 142', examName: 'Chem' }, '2026-11-06');
assert.deepStrictEqual([ex.daysLeft, ex.course, ex.courseCode], [6, 'chm142', 'CHM 142']);
assert.strictEqual(L.examFromSettings({ examDate: '2026-11-06' }, '2026-11-06').daysLeft, 0);
assert.strictEqual(L.examBoost(null, 'chm142'), 0);
assert.strictEqual(L.examBoost({ daysLeft: -2, course: 'chm142' }, 'chm142'), 0, 'past exams do nothing');
assert.strictEqual(L.examBoost({ daysLeft: 45, course: 'chm142' }, 'chm142'), 0, 'far-off exams do nothing');
assert.ok(L.examBoost({ daysLeft: 2, course: 'chm142' }, 'chm142') > L.examBoost({ daysLeft: 20, course: 'chm142' }, 'chm142'), 'closer = more urgent');
assert.ok(L.examBoost({ daysLeft: 5, course: 'chm142' }, 'chm142') > L.examBoost({ daysLeft: 5, course: 'chm142' }, 'phy101'), 'the exam course outranks others');

// ── plan building ────────────────────────────────────────────
const weak = (course, tag, accuracy) => ({ course, tag, accuracy, attempts: 8, courseCode: course.toUpperCase() });
const regs = [{ key: 'chm142', code: 'CHM142' }, { key: 'phy101', code: 'PHY101' }, { key: 'mth101', code: 'MTH101' }];

// Everything at once: must stay inside 15 minutes and always say why.
let p = L.buildAutopilotPlan({
  day: '2026-11-06', exam: ex, cardsEnabled: true, dueCards: 12, missed: { count: 9, qids: ['a', 'b', 'c'] },
  weakTopics: [weak('chm142', 'Organic reactions', 30), weak('phy101', 'Kinematics', 50), weak('mth101', 'Limits', 60)],
  registered: regs, practicedWeek: { chm142: 20, phy101: 2, mth101: 0 },
});
assert.ok(p.totalMin <= 15, `budget respected (${p.totalMin} min)`);
assert.ok(p.items.length >= 2 && p.items.every(i => i.id && i.title && i.detail && i.minutes >= 1 && i.target >= 1));
assert.strictEqual(p.items.reduce((a, i) => a + i.minutes, 0), p.totalMin);
assert.deepStrictEqual(p.items.map(i => i.id), p.items.map((_, i) => `ap-${i + 1}`));
// the exam course's weak topic is the top priority
assert.strictEqual(p.items.find(i => i.type === 'drill').tag, 'Organic reactions');
assert.match(p.headline, /CHM 142 exam in 6 days — focus on Organic reactions/);

// Same student with no exam: no exam wording, weakest topic still leads.
p = L.buildAutopilotPlan({ day: '2026-11-06', weakTopics: [weak('phy101', 'Kinematics', 20)], registered: regs, practicedWeek: { chm142: 20, phy101: 20, mth101: 20 } });
assert.strictEqual(p.items[0].tag, 'Kinematics');
assert.strictEqual(p.headline, 'Focus on Kinematics');

// A tight budget still returns the single best item, never an empty plan.
p = L.buildAutopilotPlan({ budgetMin: 1, weakTopics: [weak('chm142', 'Acids', 40)], registered: regs });
assert.strictEqual(p.items.length, 1);

// Flashcards only when the student's plan includes them.
p = L.buildAutopilotPlan({ cardsEnabled: false, dueCards: 20, weakTopics: [weak('chm142', 'Acids', 40)], registered: regs });
assert.ok(!p.items.some(i => i.type === 'flashcards'));
p = L.buildAutopilotPlan({ cardsEnabled: true, dueCards: 20, weakTopics: [], registered: regs });
const fc = p.items.find(i => i.type === 'flashcards');
assert.deepStrictEqual([fc.target, fc.dueAtGen], [15, 20], 'at most 15 cards, remembers how many were due');

// Brand-new student: a warm-up in their first course instead of an empty plan.
p = L.buildAutopilotPlan({ weakTopics: [], registered: [regs[0]] });
assert.deepStrictEqual([p.items.length, p.items[0].type, p.items[0].course], [1, 'practice', 'chm142']);
assert.match(p.items[0].title, /Warm-up: CHM142/);

// No courses picked: honest empty plan.
p = L.buildAutopilotPlan({});
assert.deepStrictEqual([p.items.length, p.totalMin], [0, 0]);
assert.strictEqual(p.headline, 'Pick your courses to get a daily plan');

// Lapsed student gets a welcoming headline.
p = L.buildAutopilotPlan({ daysSinceActive: 6, missed: { count: 3, qids: ['x'] }, registered: [regs[0]] });
assert.strictEqual(p.headline, 'Welcome back — an easy way to restart');

// Same topic is never listed twice (differently-spelled duplicates from the question bank).
p = L.buildAutopilotPlan({ weakTopics: [weak('chm142', 'Acids', 30), weak('CHM 142', ' acids ', 35)], registered: regs, practicedWeek: { chm142: 50, phy101: 50, mth101: 50 } });
assert.strictEqual(p.items.filter(i => i.type === 'drill').length, 1);

// ── done detection from real activity ────────────────────────
const plan = {
  items: [
    { id: 'ap-1', type: 'drill', course: 'chm142', tag: 'Organic reactions', target: 8, minutes: 5 },
    { id: 'ap-2', type: 'missed', target: 3, qids: ['a', 'b', 'c'], minutes: 2 },
    { id: 'ap-3', type: 'flashcards', target: 10, dueAtGen: 12, minutes: 2 },
    { id: 'ap-4', type: 'practice', course: 'phy101', target: 6, minutes: 4 },
  ],
};
let m = L.markDone(plan, {});
assert.deepStrictEqual(m.items.map(i => i.done), [false, false, false, false]);
assert.deepStrictEqual([m.doneCount, m.total, m.allDone, m.minutesLeft], [0, 4, false, 13]);

m = L.markDone(plan, { attemptsByKey: { 'chm142|organic reactions': 8 }, attemptsByCourse: { phy101: 5 }, retriedQids: 2, cardsDueNow: 5 });
assert.deepStrictEqual(m.items.map(i => i.done), [true, false, false, false], 'drill done; the rest still short');

m = L.markDone(plan, { attemptsByKey: { 'chm142|organic reactions': 9 }, attemptsByCourse: { phy101: 6 }, retriedQids: 3, cardsDueNow: 2 });
assert.deepStrictEqual(m.items.map(i => i.done), [true, true, true, true]);
assert.deepStrictEqual([m.allDone, m.minutesLeft], [true, 0]);
assert.strictEqual(L.markDone({ items: [] }, {}).allDone, false, 'an empty plan is never "all done"');

console.log('autopilot logic OK');
