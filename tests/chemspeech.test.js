const assert = require('assert');
const { chemSpeak, fromTeX, isChemTeX, texToPlain } = require('../public/js/chem-speech');
const say = t => chemSpeak(t).replace(/\s+/g, ' ').trim();
const eq = (input, want) => assert.strictEqual(say(input), want, `"${input}" -> "${say(input)}" (wanted "${want}")`);
const has = (input, frag) => assert.ok(say(input).includes(frag), `"${input}" -> "${say(input)}" should contain "${frag}"`);

// compounds are said by name
eq('NaCl', 'sodium chloride'); eq('H2O', 'water'); eq('H2SO4', 'sulphuric acid'); eq('CO2', 'carbon dioxide');
eq('C6H12O6', 'glucose'); eq('Ca(OH)2', 'calcium hydroxide'); eq('CuSO4.5H2O', 'copper two sulphate pentahydrate'); eq('NaCl(aq)', 'sodium chloride aqueous');
eq('It forms NaCl.', 'It forms sodium chloride.');
// ions are said as ions, whichever way they are written
eq('Ca2+', 'calcium 2 plus ion'); eq('Fe3+', 'iron 3 plus ion'); eq('Na+', 'sodium ion'); eq('H+', 'hydrogen ion'); eq('Cl-', 'chloride ion');
eq('SO42-', 'sulphate ion'); eq('SO4^2-', 'sulphate ion'); eq('SO₄²⁻', 'sulphate ion'); eq('Ca²⁺', 'calcium 2 plus ion'); eq('H₂O', 'water');
eq('NH4+', 'ammonium ion'); eq('OH-', 'hydroxide ion'); eq('NO3-', 'nitrate ion'); eq('CO32-', 'carbonate ion'); eq('Cr2O72-', 'dichromate ion'); eq('O2-', 'oxide ion');
// unlisted formulas are spelled so a voice cannot glue them into a word
has('C2H5Cl', 'see 2, aitch 5, chlorine'); has('O2', 'oh 2'); has('2H2', '2, aitch 2'); has('Mg(NO2)2', 'bracket');
// equations
const eqn = say('2H2 + O2 -> 2H2O'); assert.ok(eqn.includes('gives') && eqn.includes('water') && eqn.includes('oh 2'), eqn);
has('N2 + 3H2 <=> 2NH3', 'in equilibrium with'); has('2NH3', 'ammonia');
// isotopes, electrons, scales and units
eq('14C', 'carbon 14'); eq('235U', 'uranium 2 3 5'); eq('^{14}C'.replace(/[{}]/g, ''), 'carbon 14'); eq('e-', 'electron');
eq('pH of 7', 'P H of 7'); eq('pKa', 'P K A'); eq('Ksp', 'K S P');
eq('0.1 mol/dm3', '0.1 moles per decimetre cubed'); eq('-286 kJ/mol', '-286 kilojoules per mole'); eq('298 K', '298 kelvin'); eq('2 M HCl', '2 molar hydrochloric acid');
eq('Na atom', 'sodium atom');
// ordinary text is left alone: course codes, abbreviations, capital-letter words, lone letters
['PHY101', 'CHM101', 'JAMB', 'UTME', 'GPA', 'NYSC', 'AI', 'DNA', 'I', 'A', 'He said so', 'In 2026 As we know', 'Section 3', 'ATP'].forEach(t => eq(t, t));
// TeX as it appears in the question bank
assert.ok(isChemTeX('\\ce{Ca^{2+}}') && isChemTeX('SO_4^{2-}') && !isChemTeX('x^{2}+1'));
assert.strictEqual(fromTeX('Ca^{2+}').trim(), 'calcium 2 plus ion');
assert.strictEqual(fromTeX('SO_4^{2-}').trim(), 'sulphate ion');
const t1 = fromTeX('\\ce{2H2 + O2 -> 2H2O}').replace(/\s+/g, ' ').trim(); assert.ok(t1.includes('gives') && t1.includes('water'), t1);
// lite mode: readable text with no KaTeX
assert.strictEqual(texToPlain('\\ce{H2SO4}'), 'H₂SO₄'); assert.strictEqual(texToPlain('Ca^{2+}'), 'Ca²⁺'); assert.strictEqual(texToPlain('\\frac{a}{b}'), '(a)/(b)');
console.log('chem speech: compounds by name, ions, spelled formulas, equations, isotopes, units; plain words untouched; lite plain text');
