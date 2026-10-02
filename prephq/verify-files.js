// Run from the project root:  node verify-files.js
// Compares every file against MANIFEST.json (written when the zip was built) and lists any that are
// missing or whose contents differ — i.e. a broken/partial/overwritten copy.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'MANIFEST.json'), 'utf8'));
let bad = 0;
for (const [file, hash] of Object.entries(manifest)) {
  const p = path.join(__dirname, file);
  if (!fs.existsSync(p)) { console.log('MISSING  ', file); bad++; continue; }
  const h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  if (h !== hash) { console.log('DIFFERENT', file); bad++; }
}
console.log(bad ? `\n${bad} problem file(s). Delete this folder and re-extract prephq-fixed.zip.` : `All ${Object.keys(manifest).length} files match the release.`);
