const assert = require('assert');
const { newToken, weekSummary, planFor } = require('../src/utils/sponsor');
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0), D = 86400000;
const at = (daysAgo, correct) => ({ ts: new Date(NOW - daysAgo * D), correct });

const t = newToken(); assert.ok(/^[A-Za-z0-9_-]{24}$/.test(t), t); assert.notStrictEqual(t, newToken(), 'tokens are random');
const w = weekSummary([at(0, true), at(0, false), at(1, true), at(2, true), at(6, true), at(8, true), at(9, false), at(20, true)], NOW);
assert.deepStrictEqual([w.thisWeek.answered, w.thisWeek.correct, w.thisWeek.accuracy, w.thisWeek.activeDays], [5, 4, 80, 4]);
assert.strictEqual(w.thisWeek.perDay.length, 7); assert.strictEqual(w.thisWeek.perDay[6], 2, 'today is the last bar'); assert.strictEqual(w.thisWeek.perDay[0], 1, 'six days ago is the first bar');
assert.deepStrictEqual([w.lastWeek.answered, w.lastWeek.accuracy], [2, 50], 'the 8 and 9 day old answers are last week; 20 days is neither');
assert.strictEqual(weekSummary([], NOW).thisWeek.accuracy, 0);

assert.strictEqual(planFor({ tier: 'free' }).label, 'Free');
assert.strictEqual(planFor({ premiumPlan: 'lifetime', tier: 'premium' }).label, 'Premium (lifetime)');
const p = planFor({ tier: 'premium', premiumPlan: 'monthly', tierExpiresAt: new Date(NOW + 3 * D) }, NOW); assert.deepStrictEqual([p.label, p.daysLeft, p.free], ['Premium', 3, false]);
assert.deepStrictEqual([planFor({ tier: 'premium', premiumPlan: 'weekly', tierExpiresAt: new Date(NOW - D) }, NOW).label, planFor({ tier: 'premium', premiumPlan: 'weekly', tierExpiresAt: new Date(NOW - D) }, NOW).expired], ['Free', true]);
console.log('sponsor: random tokens, this-week vs last-week summary, plan label and days left');
