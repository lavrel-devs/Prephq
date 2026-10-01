// Design-token guard: the student-facing pages must take their colours, shadows, radii and fonts from
// public/css/tokens.css. Fails if a page stops linking it, links it AFTER its own <style>, or quietly
// re-declares a shared token with a different value (which would fork the design).
const fs = require('fs'), path = require('path'), assert = require('assert');
const PUB = path.join(__dirname, '..', 'public');
const PAGES = ['dashboard', 'profile', 'leaderboard', 'contests', 'study-rooms', 'chat', 'change-password', 'login', 'register', 'forgot-password', 'landing'];

const mask = s => s.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length));
const norm = v => v.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').toLowerCase();
function rules(css) {                       // top-level rules -> [{ sel, body }]
  const m = mask(css), out = []; let depth = 0, start = 0, bs = 0, sel = '';
  for (let i = 0; i < m.length; i++) {
    if (m[i] === '{') { if (!depth) { sel = m.slice(start, i).trim(); bs = i + 1; } depth++; }
    else if (m[i] === '}') { depth--; if (!depth) { out.push({ sel, body: css.slice(bs, i) }); start = i + 1; } }
  }
  return out;
}
function tokens(css) {                      // { light: {--x: v}, dark: {--x: v} }
  const t = { light: {}, dark: {} };
  for (const { sel, body } of rules(css)) {
    const mode = sel === ':root' ? 'light' : sel === '[data-theme=dark]' ? 'dark' : null;
    if (!mode) continue;
    for (const d of mask(body).matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) t[mode][d[1]] = body.slice(d.index + d[0].indexOf(':') + 1, d.index + d[0].length).trim();
  }
  return t;
}

const shared = tokens(fs.readFileSync(path.join(PUB, 'css', 'tokens.css'), 'utf8'));
assert.ok(Object.keys(shared.light).length > 40, 'tokens.css should define the shared tokens');
assert.ok(shared.light['--brand'] && shared.light['--bg'] && shared.dark['--bg'], 'tokens.css is missing core colours');

const problems = [];
for (const p of PAGES) {
  const html = fs.readFileSync(path.join(PUB, p + '.html'), 'utf8');
  const link = html.indexOf('/css/tokens.css'), style = html.indexOf('<style');
  if (link < 0) { problems.push(`${p}: does not link /css/tokens.css`); continue; }
  if (style >= 0 && link > style) problems.push(`${p}: tokens.css must come BEFORE the page's own <style>`);
  const own = { light: {}, dark: {} };
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) { const t = tokens(m[1]); Object.assign(own.light, t.light); Object.assign(own.dark, t.dark); }
  for (const mode of ['light', 'dark'])
    for (const [name, val] of Object.entries(own[mode]))
      if (name in shared[mode] && norm(val) !== norm(shared[mode][name])) problems.push(`${p}: redefines ${name} (${mode}) as "${val}" — shared value is "${shared[mode][name]}"`);
}
assert.deepStrictEqual(problems, [], '\n  ' + problems.join('\n  '));

// a mutation check so this test can't pass by accident: a forked value must be caught
const fork = tokens(':root{ --brand: #ff0000; }');
assert.notStrictEqual(norm(fork.light['--brand']), norm(shared.light['--brand']));
console.log(`design tokens consistent: ${Object.keys(shared.light).length} shared tokens across ${PAGES.length} pages`);
