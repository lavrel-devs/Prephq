// Guards the single-page shell: the tab screens in public/views/ are merged into the dashboard document, so they must stay
// isolated from it and from each other. These checks are static (no browser needed).
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public'), VIEWS = path.join(PUB, 'views');
const read = p => fs.readFileSync(p, 'utf8');
const names = fs.readdirSync(VIEWS).filter(f => f.endsWith('.html')).map(f => f.replace('.html', '')).sort();
assert.ok(names.length >= 5, 'expected the five tab views in public/views');

const mask = s => s.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length));
function rules(css, out = [], inKeyframes = false) {     // flat list of { sel } for every style rule, including inside @media
  const m = mask(css); let depth = 0, start = 0, bs = 0, head = '';
  for (let i = 0; i < m.length; i++) {
    if (m[i] === '{') { if (!depth) { head = m.slice(start, i).trim(); bs = i + 1; } depth++; }
    else if (m[i] === '}') { depth--; if (!depth) {
      if (/^@(media|supports)/i.test(head)) rules(css.slice(bs, i), out);
      else if (!/^@/.test(head)) out.push({ sel: head });
      start = i + 1; } }
  }
  return out;
}
const problems = [];
const dashHtml = read(path.join(PUB, 'dashboard.html'));
const dashCss = mask([...dashHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n'));
const dashClasses = new Set([...dashCss.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(m => m[1]));
const dashIds = new Set([...dashHtml.replace(/<script[\s\S]*?<\/script>/g, '').matchAll(/\bid="([^"$\{]+)"/g)].map(m => m[1]));
// classes the dashboard styles that a view may legitimately share: state classes toggled by scripts, plus the shell's own container
const SHARED_OK = new Set(['on', 'selected', 'correct', 'wrong', 'scr']);
const seenIds = {};

for (const name of names) {
  const html = read(path.join(VIEWS, name + '.html'));
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)], scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (styles.length !== 1 || scripts.length !== 1) { problems.push(`${name}: expected exactly one <style> and one <script>`); continue; }
  const css = styles[0][1], js = scripts[0][1];
  const markup = html.replace(styles[0][0], '').replace(scripts[0][0], '').replace(/<!--[\s\S]*?-->/g, '');

  // 1) CSS is scoped: every selector starts at (or inside) this view's container
  const scope = `#view-${name}`;
  for (const { sel } of rules(css)) for (const part of sel.split(',')) {
    const t = part.trim();
    if (t && !(t.startsWith(scope) || /^(\[data-theme[^\]]*\]|body[\w.#-]*)\s+#view-/.test(t) && t.includes(scope)) && !/^(from|to|\d+%)$/.test(t)) problems.push(`${name}: CSS selector is not scoped to ${scope}: "${t.slice(0, 70)}"`);
  }
  for (const k of css.matchAll(/@keyframes\s+([\w-]+)/g)) if (!k[1].startsWith('v' + name.replace(/-/g, ''))) problems.push(`${name}: @keyframes ${k[1]} should be prefixed v${name.replace(/-/g, '')}- so views can't clash`);

  // 2) no class the dashboard stylesheet also styles (it would leak into the view): use a v- prefix instead
  const used = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(m => m[1]));
  for (const m of (markup + js).matchAll(/class\s*=\s*\\?["']([^"'\\]*)/g)) m[1].split(/\s+/).forEach(t => /^[A-Za-z_][\w-]*$/.test(t) && used.add(t));
  for (const c of used) if (dashClasses.has(c) && !SHARED_OK.has(c)) problems.push(`${name}: class "${c}" is also styled by dashboard.html; rename it to "v-${c}" in this view`);

  // 3) the script runs with a scoped document and returns an onShow hook
  if (!/const document = PhqShell\.scope\(root\);/.test(js)) problems.push(`${name}: script must start with "const document = PhqShell.scope(root);"`);
  if (!/return \{ onShow\(\)\{/.test(js)) problems.push(`${name}: script must return { onShow(){...} }`);

  // 4) in-app navigation goes through the shell, not a page reload
  if (/location\.href\s*=\s*['"]\/(dashboard|contests|study-rooms|chat|profile|leaderboard)\b/.test(markup + js)) problems.push(`${name}: use PhqShell.go('/...') instead of location.href for tab routes`);

  // 5) every function an inline handler calls is exported to the global scope
  const exported = new Set([...js.matchAll(/^window\.([\w$]+)\s*=\s*\1;/gm)].map(m => m[1]));
  const declared = new Set([...js.matchAll(/^(?:async\s+)?function\s+([\w$]+)/gm)].map(m => m[1]));
  const handlerText = [...(markup + '\n' + js).matchAll(/\bon(?:click|change|input|keydown|keyup|submit|blur|focus)\s*=\s*\\?["']([^"']*)/g)].map(m => m[1]).join('\n');
  for (const c of new Set([...handlerText.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]))) if (declared.has(c) && !exported.has(c)) problems.push(`${name}: inline handler calls ${c}() but it isn't exported (add window.${c} = ${c};)`);

  // 6) element ids are unique across the dashboard and every view
  for (const id of new Set([...markup.matchAll(/\bid="([^"$\{]+)"/g)].map(m => m[1]))) {
    if (dashIds.has(id)) problems.push(`${name}: id "${id}" already exists in dashboard.html`);
    if (seenIds[id]) problems.push(`${name}: id "${id}" is also used by the ${seenIds[id]} view`); else seenIds[id] = name;
  }
}

// 7) the route table in shell.js, the server, and the files on disk agree
const shell = read(path.join(PUB, 'js', 'shell.js')), server = read(path.join(ROOT, 'server.js'));
const shellRoutes = [...shell.matchAll(/'\/([a-z-]+)':\s*\{\s*id:\s*'view-([a-z-]+)',\s*file:\s*'\/views\/([a-z-]+)\.html'/g)];
assert.deepStrictEqual(shellRoutes.map(m => m[1]).sort(), names, 'shell.js routes must match the files in public/views');
shellRoutes.forEach(m => { if (m[1] !== m[2] || m[1] !== m[3]) problems.push(`shell.js: route /${m[1]} must use id view-${m[1]} and file /views/${m[1]}.html`); });
const serverRoutes = (server.match(/const SHELL_ROUTES = \[([^\]]*)\]/) || [, ''])[1].match(/'\/([a-z-]+)'/g) || [];
assert.deepStrictEqual(serverRoutes.map(r => r.replace(/['\/]/g, '')).sort(), names, 'server.js SHELL_ROUTES must match the files in public/views');
for (const n of names) if (fs.existsSync(path.join(PUB, n + '.html'))) problems.push(`public/${n}.html still exists next to its view; the shell serves /${n} now`);

// mutation checks so this test can't pass by accident
assert.ok(dashClasses.has('topbar') && dashClasses.has('modal'), 'sanity: the dashboard styles .topbar and .modal, which is why views must not use them');
assert.deepStrictEqual(problems, [], '\n  ' + problems.join('\n  '));
console.log(`${names.length} views isolated: scoped CSS, no dashboard class clashes, unique ids, handlers exported, routes consistent`);
