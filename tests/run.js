// `npm test` — runs every tests/*.test.js in its own process and reports. No database or network needed.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + f + (r.stdout.trim() ? '  — ' + r.stdout.trim().split('\n').pop() : ''));
  if (!ok) console.log((r.stderr || r.stdout).split('\n').slice(0, 12).map(l => '    ' + l).join('\n'));
}
console.log(failed ? `\n${failed} of ${files.length} test file(s) failed` : `\nAll ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
