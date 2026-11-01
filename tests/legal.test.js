// Legal pages (v1.8.2): every policy exists, links to the others, carries the same version as the server records, and the
// signup / login / invite pages tell people that signing up or logging in means they accept them.
const assert = require('assert'), fs = require('fs'), path = require('path');
const pub = path.join(__dirname, '..', 'public');
const { LEGAL_VERSION } = require(path.join(__dirname, '..', 'src', 'utils', 'legal.js'));
const read = f => fs.readFileSync(path.join(pub, f), 'utf8');

const docs = { terms: 'Terms', privacy: 'Privacy', cookies: 'Cookies', 'acceptable-use': 'Acceptable', 'payments-refunds': 'Payments', 'ai-disclaimer': 'AI' };
for (const k of Object.keys(docs)) {
  const h = read(`legal/${k}.html`);
  assert.ok(h.includes(`Version ${LEGAL_VERSION}`), `${k}: page version must match src/utils/legal.js`);
  assert.ok((h.match(/<h2>/g) || []).length >= 4, `${k}: has real sections`);
  assert.ok(/id="s1"/.test(h) && /class="lg-toc"/.test(h), `${k}: has a table of contents`);
  for (const other of Object.keys(docs)) assert.ok(h.includes(`href="/${other}"`), `${k} links to /${other}`);
}
assert.ok(read('legal/index.html').includes(`Version ${LEGAL_VERSION}`));
for (const k of Object.keys(docs)) assert.ok(read('legal/index.html').includes(`href="/${k}"`), `hub links to ${k}`);

// the automatic-consent statement is on the pages people actually pass through
const reg = read('register.html'), login = read('login.html'), invite = read('invite.html');
assert.match(reg, /By creating an account you agree to our/); assert.match(reg, /href="\/terms"/); assert.match(reg, /href="\/privacy"/); assert.match(reg, /you consent to the collection and use of your information/);
assert.match(login, /By signing in you agree to our/); assert.match(login, /href="\/terms"/); assert.match(login, /href="\/privacy"/); assert.match(login, /you consent to how we use your information/);
assert.match(invite, /id="fine">By creating an account or logging in you agree to our <a href="\/terms">Terms/);   // visible even if the link fails to load
const terms = read('legal/terms.html'), privacy = read('legal/privacy.html');
assert.match(terms, /creating an account, logging in, or using the Service in any way, you automatically agree/);
assert.match(privacy, /By creating an account or logging in, you agree to this policy and consent/);
assert.match(read('landing.html'), /href="\/terms"/);

// the pages are served at clean URLs
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
for (const [u, f] of [['/legal', 'index'], ['/terms', 'terms'], ['/privacy', 'privacy'], ['/cookies', 'cookies'], ['/acceptable-use', 'acceptable-use'], ['/payments-refunds', 'payments-refunds'], ['/ai-disclaimer', 'ai-disclaimer']])
  assert.ok(new RegExp(`'${u}':\\s*'legal/${f}\\.html'`).test(server), `${u} is routed`);

// the contact details can be filled in one place
assert.match(read('js/legal.js'), /contactEmail: ''/);
console.log(`legal pages OK (version ${LEGAL_VERSION}): 6 policies + hub, consent notices on signup/login/invite`);
