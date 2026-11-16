// Secondary must stay separate from the university app, and must never create data on its own.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { bootstrapSecondaryCourses } = require('../src/utils/secondarySeed');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

(async () => {
  // 1. Seeding is off unless explicitly enabled.
  let inserted = 0;
  const Course = { exists: async () => null, insertMany: async d => { inserted += d.length; } };
  assert.strictEqual(await bootstrapSecondaryCourses(Course, {}), 0);
  assert.strictEqual(await bootstrapSecondaryCourses(Course, { SEED_SECONDARY_SUBJECTS: 'false' }), 0);
  assert.strictEqual(inserted, 0, 'nothing may be inserted by default');
  assert.ok(await bootstrapSecondaryCourses(Course, { SEED_SECONDARY_SUBJECTS: 'true' }) > 0, 'opt-in still works');

  // 2. Places that list "every course" must exclude secondary.
  assert.ok(/Course\.countDocuments\(\{ track: \{ \$ne: 'secondary' \} \}\)/.test(read('server.js')), 'university default seed ignores secondary');
  assert.ok(/Course\.find\(\{ track: \{ \$ne: 'secondary' \} \}\)/.test(read('src/services/telegramBot.service.js')), 'telegram /courses');
  assert.ok(/Course\.find\(\{ track: \{ \$ne: 'secondary' \} \}\)/.test(read('src/services/noteJob.service.js')), 'bulk note job');
  assert.ok(/t === 'secondary' \? \{ track: 'secondary' \}/.test(read('src/routes/student.routes.js')), '/api/courses hides secondary by default');
  console.log('secondary isolation: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
