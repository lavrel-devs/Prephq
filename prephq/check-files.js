// Run from the project root:  node check-files.js
// Lists every local require() that points at a file that doesn't exist.
const fs = require('fs'), path = require('path');
let missing = 0;
function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    if (f === 'node_modules' || f.startsWith('.')) continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js') && !p.includes('bulk-upload-tool') && !p.includes('public')) check(p);
  }
}
function check(file) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    const base = path.resolve(path.dirname(file), m[1]);
    if (!['', '.js', '.json', '/index.js'].some(ext => fs.existsSync(base + ext) && fs.statSync(base + ext).isFile())) {
      console.log(`MISSING  ${path.relative('.', base)}   (needed by ${path.relative('.', file)})`);
      missing++;
    }
  }
}
walk('.');
console.log(missing ? `\n${missing} missing file(s) — re-extract the zip.` : 'All required files are present.');
