// v1.8.7: \ce{...} chemistry shows as readable Unicode (Cu²⁺, H₂SO₄) instead of junk like "ceCu2+".
const assert = require('assert'), path = require('path');
const { fix } = require(path.join(__dirname, '..', 'public', 'js', 'phq-chemfix.js'));
const eq = (a, b) => assert.strictEqual(fix(a), b, JSON.stringify(a) + ' -> ' + JSON.stringify(fix(a)));

// the reported case, in every shape it can arrive
eq('$\\ce{Cu^{2+}}$', 'Cu²⁺'); eq('\\ce{Cu^2+}', 'Cu²⁺'); eq('ce{Cu^{2+}}', 'Cu²⁺'); eq('ceCu2+', 'Cu²⁺'); eq('$\\ce{Cu2+}$', 'Cu²⁺');
// ions, formulas, equations
eq('$\\ce{SO4^{2-}}$', 'SO₄²⁻'); eq('ceSO42-', 'SO₄²⁻'); eq('$\\ce{NO3-}$', 'NO₃⁻'); eq('$\\ce{NH4+}$', 'NH₄⁺'); eq('$\\ce{Fe^{3+}}$', 'Fe³⁺'); eq('$\\ce{MnO4^-}$', 'MnO₄⁻');
eq('$\\ce{Cr2O7^{2-}}$', 'Cr₂O₇²⁻'); eq('\\ce{Cr2O72-}', 'Cr₂O₇²⁻'); eq('$\\ce{H2SO4}$', 'H₂SO₄'); eq('$\\ce{(NH4)2SO4}$', '(NH₄)₂SO₄');
eq('$\\ce{2H2 + O2 -> 2H2O}$', '2H₂ + O₂ → 2H₂O'); eq('$\\ce{N2 + 3H2 <=> 2NH3}$', 'N₂ + 3H₂ ⇌ 2NH₃'); eq('$\\ce{CuSO4*5H2O}$', 'CuSO₄·5H₂O');
eq('$\\ce{H2O(l)}$', 'H₂O(l)'); eq('$\\ce{CH3COOH}$', 'CH₃COOH'); eq('$\\ce{Na+}$', 'Na⁺'); eq('$\\ce{Cl-}$', 'Cl⁻'); eq('$\\ce{O^{2-}}$', 'O²⁻');
// in a sentence and in a list of options
eq('The ion $\\ce{Fe^{2+}}$ is oxidised to \\ce{Fe^3+}.', 'The ion Fe²⁺ is oxidised to Fe³⁺.');
eq('A. ceCu2+ ✓', 'A. Cu²⁺ ✓');
// must not be touched
eq('Fe2+ and Cu2+ are cations', 'Fe2+ and Cu2+ are cations');            // plain text with no \ce stays as written
eq('The price is $5 and the cell is $x^2$', 'The price is $5 and the cell is $x^2$');
eq('Real words: cell, central, certain, cesium, century', 'Real words: cell, central, certain, cesium, century');
eq('$K = \\frac{[\\ce{Cu^{2+}}]}{2}$', '$K = \\frac{[\\ce{Cu^{2+}}]}{2}$');   // inside a bigger equation: left for the maths renderer
eq('', ''); assert.strictEqual(fix(null), '');
console.log('Chemistry fixer OK');
