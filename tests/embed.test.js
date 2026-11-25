// v1.19 Web pages: address cleaning, SSRF guard, frame-permission reading, real probing of local test servers, page rendering.
const assert = require('assert'), http = require('http');
const E = require('../src/services/embed.service');
const A = require('../src/utils/adminAccess');

// ── cleaning ──
assert.strictEqual(E.cleanEmbedUrl('example.com/a'), 'https://example.com/a');
['http://localhost/x', 'https://127.0.0.1', 'https://10.0.0.5', 'https://192.168.1.1/a', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/', 'https://printer.local', 'https://example.com:22', 'ftp://example.com', 'javascript:alert(1)', 'https://u:p@example.com']
  .forEach(x => assert.throws(() => E.cleanEmbedUrl(x), Error, x));
assert.throws(() => E.cleanEmbedUrl('https://wreddi.com/dashboard', ['wreddi.com']), /inside itself/);
assert.ok(E.cleanEmbedUrl('https://example.com:8443/x'));
assert.strictEqual(E.cleanSlug(' CBT-Practice '), 'cbt-practice');
assert.strictEqual(E.cleanSlug('Wreddi Holiday Tutorial'), 'wreddi-holiday-tutorial');
assert.strictEqual(E.cleanSlug('  CBT & Past   Questions!! '), 'cbt-and-past-questions'); assert.strictEqual(E.cleanSlug('a--b'), 'a-b'); assert.strictEqual(E.cleanSlug('-abc-'), 'abc'); assert.strictEqual(E.cleanSlug('Café_Menu'), 'cafe-menu');
assert.strictEqual(E.cleanSlug('x'.repeat(60)), 'x'.repeat(40));
['ab', '!!', '  ', 'admin', 'New', 'a b'.slice(0, 2)].forEach(x => assert.throws(() => E.cleanSlug(x), Error, JSON.stringify(x)));
assert.ok(/^[a-z0-9]{3,20}-[a-z2-9]{4}$/.test(E.autoSlug('https://www.Wikipedia.org/x'))); assert.ok(/^xysite-/.test(E.autoSlug('https://xy.com')));
assert.strictEqual(E.cleanMode('embed'), 'embed'); assert.throws(() => E.cleanMode('x'));

// ── private address detection ──
['0.0.0.0', '10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.1', '192.168.0.1', '100.64.0.1', '198.18.0.1', '224.0.0.1', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-ip']
  .forEach(ip => assert.ok(E.isPrivateIp(ip), ip + ' should be private'));
['8.8.8.8', '172.32.0.1', '100.63.0.1', '41.58.1.2', '2606:4700::1111', '2001:4860:4860::8888'].forEach(ip => assert.ok(!E.isPrivateIp(ip), ip + ' should be public'));

// ── frame permission ──
const V = (h, host = 'wreddi.com') => E.frameVerdict(h, host).embeddable;
assert.strictEqual(V({}), 'yes');
assert.strictEqual(V({ 'x-frame-options': 'DENY' }), 'no'); assert.strictEqual(V({ 'x-frame-options': 'SAMEORIGIN' }), 'no');
assert.strictEqual(V({ 'x-frame-options': 'ALLOW-FROM https://wreddi.com' }), 'yes'); assert.strictEqual(V({ 'x-frame-options': 'ALLOW-FROM https://other.com' }), 'no');
assert.strictEqual(V({ 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" }), 'no');
assert.strictEqual(V({ 'content-security-policy': "frame-ancestors 'self'" }), 'no');
assert.strictEqual(V({ 'content-security-policy': 'frame-ancestors *' }), 'yes');
assert.strictEqual(V({ 'content-security-policy': 'frame-ancestors https://wreddi.com https://x.com' }), 'yes');
assert.strictEqual(V({ 'content-security-policy': 'frame-ancestors https://*.wreddi.com' }, 'app.wreddi.com'), 'yes');
assert.strictEqual(V({ 'content-security-policy': 'frame-ancestors https://*.wreddi.com' }, 'wreddi.com'), 'no');
assert.strictEqual(V({ 'content-security-policy': 'frame-ancestors https:' }), 'yes');
assert.strictEqual(V({ 'content-security-policy': 'frame-ancestors https://wreddi.com:443' }), 'yes');
assert.strictEqual(V({ 'content-security-policy': "script-src 'self'" }), 'yes');                                            // no frame-ancestors = allowed
assert.strictEqual(V({ 'content-security-policy': "frame-ancestors *, frame-ancestors 'none'" }), 'no');                     // two policies: all must allow
assert.strictEqual(V({ 'content-security-policy': 'frame-ancestors https://wreddi.com' }, 'localhost:3000'), 'no');

// ── page rendering: nothing the admin or the target site supplies can break out of the HTML ──
const evil = { slug: 'x', url: 'https://example.com/?a="><script>alert(1)</script>', title: '<img src=x onerror=alert(1)>', description: '"><svg onload=1>' };
for (const html of [E.renderPage(evil), E.renderFallback(evil)]) { assert.ok(!/<script>alert|<img src=x|<svg onload/.test(html)); assert.ok(html.includes('noindex')); }
const page = E.renderPage({ slug: 'cbt', url: 'https://example.com/p', title: 'CBT' });
assert.ok(page.includes('<iframe') && page.includes('sandbox="') && page.includes('Open original') && page.includes('example.com'));
assert.ok(!E.renderFallback({ url: 'https://example.com', title: 'T' }).includes('<iframe'));

// ── permissions ──
assert.ok(A.AREA_KEYS.includes('sites'));
assert.ok(!A.checkAccess({ full: false, permissions: ['links'] }, 'GET', '/sites') && A.checkAccess({ full: false, permissions: ['sites'] }, 'POST', '/sites/check'));
assert.ok(A.checkAccess({ full: false, permissions: ['sites:view'] }, 'GET', '/sites') && !A.checkAccess({ full: false, permissions: ['sites:view'] }, 'DELETE', '/sites/abc'));

// ── real probing against local servers (the SSRF guard is bypassed only through the test-only flag) ──
const srv = http.createServer((req, res) => {
  const send = (code, headers, body) => { res.writeHead(code, headers); res.end(body); };
  if (req.url === '/open') return send(200, { 'content-type': 'text/html' }, '<html><head><title>Open &amp; Shut </title></head><body>hi</body></html>');
  if (req.url === '/xfo') return send(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' }, '<title>Nope</title>');
  if (req.url === '/csp') return send(200, { 'content-type': 'text/html', 'content-security-policy': "frame-ancestors 'self'" }, '<title>Csp</title>');
  if (req.url === '/r1') return send(302, { location: '/r2' }, '');
  if (req.url === '/r2') return send(301, { location: '/open' }, '');
  if (req.url === '/loop') return send(302, { location: '/loop' }, '');
  if (req.url === '/slow') return;                                                       // never answers
  if (req.url === '/bin') return send(200, { 'content-type': 'application/pdf' }, 'x'.repeat(200000));
  if (req.url === '/notfound') return send(404, { 'content-type': 'text/html' }, '<title>Not here</title>');
  send(500, {}, '');
});
srv.listen(0, '127.0.0.1', async () => {
  const B = 'http://127.0.0.1:' + srv.address().port, P = (p, o) => E.probe(B + p, Object.assign({ _allowPrivate: true }, o));
  try {
    let r = await P('/open'); assert.strictEqual(r.status, 200); assert.strictEqual(r.title, 'Open & Shut');
    r = await P('/r1'); assert.strictEqual(r.status, 200); assert.ok(r.finalUrl.endsWith('/open'), 'follows redirects');
    r = await P('/loop'); assert.ok(/too many/.test(r.error));
    r = await P('/slow', { totalMs: 700 }); assert.ok(/too long/.test(r.error));
    r = await P('/bin'); assert.strictEqual(r.title, '');                                  // non-HTML: headers only, body not read
    assert.strictEqual(E.frameVerdict((await P('/xfo')).headers, 'wreddi.com').embeddable, 'no');
    assert.strictEqual(E.frameVerdict((await P('/csp')).headers, 'wreddi.com').embeddable, 'no');
    // checkSite wraps probe + verdict
    const via = p => E.checkSite(B + p, 'wreddi.com', 'https', u => E.probe(u, { _allowPrivate: true }));
    assert.strictEqual((await via('/open')).embeddable, 'no', 'plain http target is refused inside an https page');   // B is http://
    assert.strictEqual((await E.checkSite(B + '/open', 'wreddi.com', 'http', u => E.probe(u, { _allowPrivate: true }))).embeddable, 'yes');
    assert.strictEqual((await E.checkSite(B + '/notfound', 'wreddi.com', 'http', u => E.probe(u, { _allowPrivate: true }))).embeddable, 'unknown');
    assert.strictEqual((await E.checkSite(B + '/xfo', 'wreddi.com', 'http', u => E.probe(u, { _allowPrivate: true }))).embeddable, 'no');
    // the real guard: local/internal targets are refused with the real probe
    for (const bad of [B + '/open', 'http://localhost:' + srv.address().port + '/open', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/']) {
      const x = await E.probe(bad); assert.ok(x.error && !x.headers, 'must refuse ' + bad + ' -> ' + JSON.stringify(x));
    }
    const rr = await E.checkSite('http://127.0.0.1:' + srv.address().port + '/open', 'wreddi.com', 'https'); assert.strictEqual(rr.embeddable, 'unknown');
    console.log('embed: ok');
  } catch (e) { console.error(e); process.exitCode = 1; }
  srv.close();
});
