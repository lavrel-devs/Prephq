// v1.8.5: the AI's stray *, _, ` and # marks are removed; maths, chemistry, links, blanks and multiplication are not touched.
const { strip } = require(require('path').join(__dirname, '..', 'public', 'js', 'phq-mdclean.js')); const assert = require('assert');
const eq = (a, b, o) => assert.strictEqual(strip(a, o), b, JSON.stringify(a) + ' -> ' + JSON.stringify(strip(a, o)));
eq('**Entropy** is a measure of *disorder* in a system.', 'Entropy is a measure of disorder in a system.');
eq('This is __very__ important and _really_ so.', 'This is very important and really so.');
eq('***Key point*** here', 'Key point here');
eq('## Overview\n* first\n* second\n+ third', 'Overview\n- first\n- second\n- third');
eq('Use `x = 5` then **solve**.', 'Use x = 5 then solve.');
eq('Intro\n---\nBody\n***\nEnd', 'Intro\n\nBody\n\nEnd');
// must NOT be touched
eq('Area is $A = \\pi r_1^2 * 2$ and $$E_k = \\frac{1}{2}mv^2$$', 'Area is $A = \\pi r_1^2 * 2$ and $$E_k = \\frac{1}{2}mv^2$$');
eq('Rename my_var_name and snake_case_word', 'Rename my_var_name and snake_case_word');
eq('Compute 2 * 3 * 4 = 24, and a*b*c', 'Compute 2 * 3 * 4 = 24, and a*b*c');
eq('Fill in the blank: The ______ is the powerhouse.', 'Fill in the blank: The ______ is the powerhouse.');
eq('See https://example.com/a_b_c/*x* now', 'See https://example.com/a_b_c/*x* now');
eq('Structure [[smiles: CC(=O)O_x*]] shown', 'Structure [[smiles: CC(=O)O_x*]] shown');
eq('Escaped \\*star\\* stays', 'Escaped *star* stays');
// unbalanced / stray
eq('Here is **an unfinished bold', 'Here is an unfinished bold');
eq('Note: *Important', 'Note: Important');
eq('Done**', 'Done');
// notes mode keeps **term**, drops the rest
eq('## Overview\n**Entropy** is *disorder* and __heat__.', '## Overview\n**Entropy** is disorder and **heat**.', { keepBold: true, keepHeadings: true });
eq('A **broken bold and _x_', 'A broken bold and x', { keepBold: true, keepHeadings: true });
eq('', ''); eq(null, '');
console.log('Markdown cleaner OK');
