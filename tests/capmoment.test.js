// Free-cap moment (v1.7.9): the reset countdown shown on the cap screen and results strip.
// The helpers live inline in dashboard.html, so they are sliced out of it and run here.
const assert = require('assert'), fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
const a = html.indexOf('function msUntilWatMidnight'), b = html.indexOf('async function paintCapPanel');
assert.ok(a > 0 && b > a, 'cap helpers not found in dashboard.html');
const { msUntilWatMidnight, fmtDuration } = new Function(html.slice(a, b) + '\nreturn { msUntilWatMidnight, fmtDuration };')();
assert.strictEqual(msUntilWatMidnight(Date.UTC(2026, 9, 14, 10, 0)), 13 * 3600000);        // 11:00 WAT -> 13h
assert.strictEqual(msUntilWatMidnight(Date.UTC(2026, 9, 14, 22, 30)), 30 * 60000);        // 23:30 WAT -> 30m
assert.strictEqual(msUntilWatMidnight(Date.UTC(2026, 9, 14, 23, 30)), 23.5 * 3600000);    // 00:30 WAT next day
assert.strictEqual(msUntilWatMidnight(Date.UTC(2026, 9, 31, 22, 59)), 60000);             // month end
assert.strictEqual(fmtDuration(13 * 3600000), '13h 00m'); assert.strictEqual(fmtDuration(5.2 * 3600000), '5h 12m');
assert.strictEqual(fmtDuration(30 * 60000), '30m'); assert.strictEqual(fmtDuration(1000), '1m');
// the cap panel only exists once, inside the paywall modal
assert.strictEqual((html.match(/id="pw-cap"/g) || []).length, 1); assert.strictEqual((html.match(/id="cap-strip"/g) || []).length, 1);
console.log('cap-moment time helpers + markup OK');
