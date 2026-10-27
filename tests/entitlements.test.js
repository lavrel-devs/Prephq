// Free AI quiz is controlled by the "AI quizzes/day" number (v1.7.5), not by a separate on/off switch.
const assert = require('assert'), path = require('path');
const ent = require(path.join(__dirname, '..', 'src', 'services', 'entitlements.service.js'));
const free = { tier: 'free' }, premium = { tier: 'premium', premiumPlan: 'monthly', tierExpiresAt: new Date(Date.now() + 864e5) };
const cfg = (aiQuizzes, flag) => ({ tiers: { free: { dailyAIQuizzes: aiQuizzes, features: { aiQuestionGeneration: flag, flashcards: false, aiTutor: true } } } });

// The live-data case: the number says 1/day but the old switch is OFF → free students CAN generate now.
assert.strictEqual(ent.canUse(free, 'aiQuestionGeneration', cfg(1, false)), true);
assert.strictEqual(ent.canUse(free, 'aiQuestionGeneration', cfg(3, true)), true);
assert.strictEqual(ent.canUse(free, 'aiQuestionGeneration', cfg(null, false)), true, 'blank = unlimited');
assert.strictEqual(ent.canUse(free, 'aiQuestionGeneration', cfg(0, true)), false, '0 locks it, whatever the old switch says');
assert.strictEqual(ent.canUse(premium, 'aiQuestionGeneration', cfg(0, false)), true, 'premium is never locked');
// Written Exam (v1.8.0) is controlled the same way, by "Written exams/day"
const wcfg = (n) => ({ tiers: { free: { dailyWrittenExams: n, features: {} } } });
assert.strictEqual(ent.canUse(free, 'writtenExam', wcfg(1)), true);
assert.strictEqual(ent.canUse(free, 'writtenExam', wcfg(0)), false, '0 locks written exams for free students');
assert.strictEqual(ent.canUse(free, 'writtenExam', wcfg(null)), true, 'blank = unlimited');
assert.strictEqual(ent.canUse(premium, 'writtenExam', wcfg(0)), true);
// everything else still follows its switch
assert.strictEqual(ent.canUse(free, 'flashcards', cfg(1, true)), false);
assert.strictEqual(ent.canUse(free, 'aiTutor', cfg(1, true)), true);
// the admin switch grid no longer lists AI generation (it would be a second, conflicting control)
assert.ok(ent.FEATURES.find(f => f.key === 'aiQuestionGeneration').controlledBy === 'dailyAIQuizzes');
console.log('free AI-quiz entitlement follows the daily limit OK');
