/**
 * Wreddi chemistry text fixer — v1.8.7
 * The AI writes formulas as mhchem, e.g. $\ce{Cu^{2+}}$. Anywhere the page does not run the maths renderer
 * (the admin review queue, plain-text chat, old saved questions) that shows up as junk like "ceCu2+".
 * fix() turns those into ordinary readable text with Unicode sub/superscripts: Cu²⁺, H₂SO₄, 2H₂ + O₂ → 2H₂O.
 *
 * Works in Node (before AI text is saved) and in the browser (when text is shown, which also repairs old items).
 * Only a stand-alone \ce{...} (or $\ce{...}$) is converted. A \ce inside a bigger equation is left for the maths renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PhqChem = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ' };
  const SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', 'n': 'ₙ', 'x': 'ₓ' };
  const map = (s, table, fallbackMark) => {
    let out = '';
    for (const ch of s) { if (!table[ch]) return fallbackMark + s; out += table[ch]; }   // can't be shown small -> keep it readable
    return out;
  };
  const sup = (s) => map(String(s).replace(/[{}]/g, ''), SUP, '^');
  const sub = (s) => map(String(s).replace(/[{}]/g, ''), SUB, '_');

  // One whitespace-free piece of a formula: SO4^{2-}, Cu2+, (NH4)2SO4, 2H2O ...
  function token(t) {
    if (t === '->' || t === '-->' || t === '→') return '→';
    if (t === '<-') return '←';
    if (t === '<=>' || t === '<->>') return '⇌';
    if (t === '<->') return '↔';
    if (!/[A-Za-z)]/.test(t)) return t;                       // "+", "2", "(aq)"-less operators
    let s = t.replace(/\*/g, '·');
    let charge = '';
    if (!/\^/.test(s)) {                                       // bare charge written without ^ : Cu2+  SO42-  Na+  NO3-
      const m = s.match(/^(.*?[A-Za-z)\]])(\d*)([+-])$/);
      if (m) {
        let head = m[1], digs = m[2];
        if (digs.length >= 2) { charge = digs.slice(-1) + m[3]; head += digs.slice(0, -1); }
        else if (digs.length === 1 && /^[A-Z][a-z]?$/.test(head) && +digs >= 2 && +digs <= 4) charge = digs + m[3];   // Cu2+ Fe3+ O2-
        else { charge = m[3]; head += digs; }                  // NH4+  NO3-  Na+
        s = head;
      }
    }
    s = s.replace(/\^\{([^}]*)\}|\^([0-9]*[+\-−]*|[A-Za-z])/g, (_, a, b) => sup(a != null ? a : b));
    s = s.replace(/_\{([^}]*)\}|_([0-9A-Za-z]+)/g, (_, a, b) => sub(a != null ? a : b));
    s = s.replace(/([A-Za-z)\]])(\d+)/g, (_, l, d) => l + sub(d));   // H2O -> H₂O (digits after a letter/bracket only; coefficients stay)
    if (charge) s += sup(charge);
    return s;
  }
  function chem(src) {
    return String(src).replace(/\\(?:mathrm|text|ce)\s*/g, '').split(/(\s+)/).map(p => (/^\s+$/.test(p) ? p : token(p))).join('').trim();
  }

  const BODY = '((?:[^{}]|\\{[^{}]*\\})*)';
  const RX_MATH_CE = new RegExp('\\$\\s*\\\\?ce\\{' + BODY + '\\}\\s*\\$', 'g');   // $\ce{...}$
  const RX_BARE_CE = new RegExp('\\\\?\\bce\\{' + BODY + '\\}', 'g');               // \ce{...} or ce{...}
  const RX_MANGLED = /(^|[\s(\[,;:])ce(?=[A-Z][A-Za-z0-9()+\-^_{}]*)([A-Za-z0-9()+\-^_{}]+)/g; // "ceCu2+" left over from a stripped \ce{Cu^2+}

  function fix(text) {
    let s = String(text == null ? '' : text);
    if (s.indexOf('ce') < 0) return s;
    s = s.replace(RX_MATH_CE, (_, x) => chem(x));
    const held = [];                                            // whatever maths is left stays exactly as written
    s = s.replace(/\$\$[^\n]*?\$\$|\$[^$\n]+\$/g, m => { held.push(m); return '\u0003' + (held.length - 1) + '\u0004'; });
    s = s.replace(RX_BARE_CE, (_, x) => chem(x));
    s = s.replace(RX_MANGLED, (_, lead, body) => lead + token(body.replace(/^ce/, '')));
    return s.replace(/\u0003(\d+)\u0004/g, (_, i) => held[+i]);
  }
  return { fix, chem };
});
