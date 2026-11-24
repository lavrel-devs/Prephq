// v1.18 Short links: code/url cleaning, status rules and admin permissions. No database needed.
const assert = require('assert');
const S = require('../src/services/shortlink.service');
const A = require('../src/utils/adminAccess');

// codes
const c = S.generateCode(); assert.ok(/^[a-z2-9]{6}$/.test(c) && !/[01oli]/.test(c));
assert.strictEqual(new Set(Array.from({ length: 200 }, () => S.generateCode())).size, 200);
assert.strictEqual(S.cleanCode('  CHM-101 '), 'chm-101');
['ab', 'has space', '-lead', 'a'.repeat(33), 'bad/slash', ''].forEach(x => assert.throws(() => S.cleanCode(x), /Short code/));
assert.throws(() => S.cleanCode('Admin'), /reserved/);

// urls
assert.strictEqual(S.cleanUrl('example.com/a?b=1'), 'https://example.com/a?b=1');
assert.strictEqual(S.cleanUrl(' http://example.com '), 'http://example.com/');
['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com/x', 'file:///etc/passwd', 'https://user:pw@example.com', 'https://nodots', '', 'http://'].forEach(x => assert.throws(() => S.cleanUrl(x), Error, x));
assert.throws(() => S.cleanUrl('https://' + 'a'.repeat(2100) + '.com'), /too long/);
assert.throws(() => S.cleanUrl('https://wreddi.com/l/abc123', ['wreddi.com']), /short link/);
assert.ok(S.cleanUrl('https://wreddi.com/dashboard', ['wreddi.com']));   // other pages on our own site are fine

// expiry + status
const now = Date.UTC(2026, 10, 24);
assert.strictEqual(S.cleanExpiry('', now), null); assert.strictEqual(S.cleanExpiry(null, now), null);
assert.throws(() => S.cleanExpiry('2020-01-01', now), /future/); assert.throws(() => S.cleanExpiry('nope', now), /valid/);
assert.ok(S.cleanExpiry('2027-01-01', now) instanceof Date);
assert.strictEqual(S.statusOf({ active: true }, now), 'live');
assert.strictEqual(S.statusOf({ active: false }, now), 'off');
assert.strictEqual(S.statusOf({ active: true, expiresAt: new Date(now - 1) }, now), 'expired');
assert.strictEqual(S.isLive({ active: true, expiresAt: new Date(now + 1000) }, now), true);
assert.strictEqual(S.isLive(null), false);
assert.strictEqual(S.dayKey(Date.UTC(2026, 10, 24, 23, 30)), '2026-11-25');   // 00:30 in Nigeria
assert.strictEqual(S.dayKey(Date.UTC(2026, 10, 24, 22, 59)), '2026-11-24');

// permissions: new area exists, is locked to its own area, view-only works
assert.ok(A.AREA_KEYS.includes('links'));
const full = { full: true, permissions: [] }, none = { full: false, permissions: ['students'] }, view = { full: false, permissions: ['links:view'] }, chg = { full: false, permissions: ['links'] };
assert.ok(A.checkAccess(full, 'POST', '/links'));
assert.ok(!A.checkAccess(none, 'GET', '/links'));
assert.ok(A.checkAccess(view, 'GET', '/links') && A.checkAccess(view, 'GET', '/links/abc/stats'));
assert.ok(!A.checkAccess(view, 'POST', '/links') && !A.checkAccess(view, 'PUT', '/links/abc') && !A.checkAccess(view, 'DELETE', '/links/abc'));
assert.ok(A.checkAccess(chg, 'DELETE', '/links/abc'));
assert.deepStrictEqual(A.normalizePermissions(['links', 'links:view']), ['links']);
console.log('shortlink: ok');
