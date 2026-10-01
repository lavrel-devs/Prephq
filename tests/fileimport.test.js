// JSON / CSV / TSV question-file parser (answer keys are never guessed).
const fs = require('fs'), path = require('path'), assert = require('assert');
// Uses the parser that ships inside public/admin.html (between these two markers), not a copy.
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
const a = html.indexOf('// ── BULK UPLOAD · from a file'), b = html.indexOf('// ── MODAL UTILS');
assert.ok(a > 0 && b > a, 'could not find the file-import code in admin.html');
const src = html.slice(a, b);
global.document = {}; global.bpFlatten = s => s; global.bpParsed = []; global.bpResolve = c => ({ key: String(c).toLowerCase().replace(/[^a-z0-9]/g, ''), known: true });
eval(src + '\nglobal.T = { bpCsvRows, bpReadFile, bpItemFromRecord };');
const RF = (...a) => T.bpReadFile(...a);

// CSV: quotes, commas and newlines inside cells, doubled quotes, BOM, CRLF
const csv = '\uFEFFcourse,question,optionA,optionB,optionC,optionD,answer,tag,explanation\r\n' +
  'CHM 141,"Which is ""principal"", i.e. n?",Magnetic,Principal,Spin,Azimuthal,B,Atoms,"line1\nline2"\r\n' +
  'MTH101,Plain q,1,2,3,4,d,,\r\n' +
  'MTH101,Answer by text,red,green,blue,yellow,Green,,\r\n' +
  'MTH101,Bare digit,1,2,3,4,2,,\r\n' +
  'MTH101,Three options,1,2,3,,A,,\r\n' +
  'MTH101,No answer,1,2,3,4,,,\r\n' +
  'MTH101,Dup text,same,same,x,y,same,,\r\n' +
  'MTH101,Bad letter,1,2,3,4,E,,\r\n' +
  'MTH101,Digit clash,4,3,2,1,2,,\r\n';
const r = RF(csv, 'q.csv').records;
assert.strictEqual(r.length, 9);
assert.deepStrictEqual([r[0].ans, r[0].q, r[0].exp, r[0].tag, r[0].course], [1, 'Which is "principal", i.e. n?', 'line1\nline2', 'Atoms', 'CHM 141']);
assert.strictEqual(r[1].ans, 3);                          // lower-case letter
assert.strictEqual(r[2].ans, 1);                          // exact option text, case-insensitive
assert.strictEqual(r[3].ans, 1);                          // bare "2": text and position agree (option B) -> safe
assert.ok(/exactly 4/.test(r[4].why));
assert.ok(/No answer/.test(r[5].why));
assert.ok(/match one option/.test(r[6].why));             // text matches two options -> refused, never guessed
assert.ok(/A–D/.test(r[7].why));
assert.ok(/option number 2 or the option with that text/.test(r[8].why) && r[8].ans === -1);   // '2' could mean B or C -> refused

// TSV and semicolon auto-detect, alternative header names
const tsv = 'Course\tQuestion\tA\tB\tC\tD\tCorrect\nGST101\tTab q\ta\tb\tc\td\tC';
assert.deepStrictEqual(RF(tsv, 'q.tsv').records.map(x => [x.course, x.ans]), [['GST101', 2]]);
const semi = 'course;q;opt1;opt2;opt3;opt4;answer\nGST101;Semi q;a;b;c;d;A';
assert.strictEqual(RF(semi, 'q.csv').records[0].ans, 0);

// JSON: array, {questions}, {course:[...]}, numbers only under the app's own fields
const A = { question: 'J1', options: ['a', 'b', 'c', 'd'], answer: 'C', course: 'CHM141', tag: 'T', explanation: 'e' };
assert.strictEqual(RF(JSON.stringify([A]), 'a.json').records[0].ans, 2);
assert.strictEqual(RF(JSON.stringify({ questions: [A] }), 'a.json').records[0].course, 'CHM141');
const byCourse = RF(JSON.stringify({ chm141: [{ q: 'K1', opts: ['a', 'b', 'c', 'd'], ans: 3 }], mth101: [{ q: 'K2', opts: ['a', 'b', 'c', 'd'], answerNumber: 1 }] }), 'a.json').records;
assert.deepStrictEqual(byCourse.map(x => [x.course, x.ans]), [['chm141', 3], ['mth101', 0]]);   // ans is 0-based, answerNumber is 1-based
assert.ok(/ambiguous/.test(RF(JSON.stringify([{ ...A, answer: 2 }]), 'a.json').records[0].why));   // numeric "answer" refused
assert.ok(/outside/.test(RF(JSON.stringify([{ question: 'x', options: ['a', 'b', 'c', 'd'], ans: 9 }]), 'a.json').records[0].why));

// errors are readable, not crashes
assert.ok(/Could not read/.test(RF('{ nope', 'a.json').error));
assert.ok(/No questions/.test(RF('[]', 'a.json').error));
assert.ok(/header row/.test(RF('only one line', 'a.csv').error));
assert.ok(/question/.test(RF('foo,bar\n1,2', 'a.csv').error));
console.log('file-import tests passed');
