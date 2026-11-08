/* chem-speech.js (v1.9.2) - turns chemistry into words a text-to-speech voice can say properly.
   Before this, a voice read "NaCl" as one nonsense word, "Ca2+" as "C A two plus", and "SO4^2-" as "S O four to the power two minus".
   Now: formulas of known compounds are said by name ("sodium chloride"), ions as ions ("sulphate ion", "calcium 2 plus ion"),
   other formulas are spelled so a voice cannot mangle them ("aitch 2, oh"), and isotopes, state symbols, pH, K constants and
   chemistry units are all spoken. Pure functions, no browser needed: unit-tested in tests/chemspeech.test.js.
   Also exports texToPlain() for lite mode (readable text instead of loading KaTeX). */
(function (root) {
  'use strict';
  // ── data ──────────────────────────────────────────────────────────────
  const EL = {};
  'H hydrogen,He helium,Li lithium,Be beryllium,B boron,C carbon,N nitrogen,O oxygen,F fluorine,Ne neon,Na sodium,Mg magnesium,Al aluminium,Si silicon,P phosphorus,S sulphur,Cl chlorine,Ar argon,K potassium,Ca calcium,Sc scandium,Ti titanium,V vanadium,Cr chromium,Mn manganese,Fe iron,Co cobalt,Ni nickel,Cu copper,Zn zinc,Ga gallium,Ge germanium,As arsenic,Se selenium,Br bromine,Kr krypton,Rb rubidium,Sr strontium,Y yttrium,Zr zirconium,Nb niobium,Mo molybdenum,Tc technetium,Ru ruthenium,Rh rhodium,Pd palladium,Ag silver,Cd cadmium,In indium,Sn tin,Sb antimony,Te tellurium,I iodine,Xe xenon,Cs caesium,Ba barium,La lanthanum,Ce cerium,Pr praseodymium,Nd neodymium,Pm promethium,Sm samarium,Eu europium,Gd gadolinium,Tb terbium,Dy dysprosium,Ho holmium,Er erbium,Tm thulium,Yb ytterbium,Lu lutetium,Hf hafnium,Ta tantalum,W tungsten,Re rhenium,Os osmium,Ir iridium,Pt platinum,Au gold,Hg mercury,Tl thallium,Pb lead,Bi bismuth,Po polonium,At astatine,Rn radon,Fr francium,Ra radium,Ac actinium,Th thorium,Pa protactinium,U uranium,Np neptunium,Pu plutonium,Am americium,Cm curium,Bk berkelium,Cf californium,Es einsteinium,Fm fermium,Md mendelevium,No nobelium,Lr lawrencium'
    .split(',').forEach(p => { const i = p.indexOf(' '); EL[p.slice(0, i)] = p.slice(i + 1); });
  const LETTER = { A: 'ay', B: 'bee', C: 'see', D: 'dee', E: 'ee', F: 'eff', G: 'gee', H: 'aitch', I: 'eye', J: 'jay', K: 'kay', L: 'el', M: 'em', N: 'en', O: 'oh', P: 'pee', Q: 'queue', R: 'ar', S: 'ess', T: 'tee', U: 'you', V: 'vee', W: 'double you', X: 'ex', Y: 'why', Z: 'zed' };

  const COMPOUND = {};
  ('H2O water;H2O2 hydrogen peroxide;CO2 carbon dioxide;CO carbon monoxide;NaCl sodium chloride;HCl hydrochloric acid;H2SO4 sulphuric acid;HNO3 nitric acid;H3PO4 phosphoric acid;H2CO3 carbonic acid;CH3COOH ethanoic acid;HCOOH methanoic acid;NaOH sodium hydroxide;KOH potassium hydroxide;LiOH lithium hydroxide;Ca(OH)2 calcium hydroxide;Mg(OH)2 magnesium hydroxide;Ba(OH)2 barium hydroxide;NH3 ammonia;NH4Cl ammonium chloride;NH4OH ammonium hydroxide;(NH4)2SO4 ammonium sulphate;NH4NO3 ammonium nitrate;CH4 methane;C2H6 ethane;C3H8 propane;C4H10 butane;C2H4 ethene;C2H2 ethyne;C6H6 benzene;C2H5OH ethanol;CH3OH methanol;C6H12O6 glucose;C12H22O11 sucrose;CaCO3 calcium carbonate;Na2CO3 sodium carbonate;NaHCO3 sodium hydrogen carbonate;K2CO3 potassium carbonate;CaO calcium oxide;MgO magnesium oxide;ZnO zinc oxide;CuO copper two oxide;PbO lead two oxide;Fe2O3 iron three oxide;Fe3O4 triiron tetroxide;Al2O3 aluminium oxide;SiO2 silicon dioxide;SO2 sulphur dioxide;SO3 sulphur trioxide;NO nitrogen monoxide;NO2 nitrogen dioxide;N2O dinitrogen monoxide;KMnO4 potassium permanganate;K2Cr2O7 potassium dichromate;CuSO4 copper two sulphate;FeSO4 iron two sulphate;ZnSO4 zinc sulphate;Na2SO4 sodium sulphate;BaSO4 barium sulphate;MgSO4 magnesium sulphate;CaSO4 calcium sulphate;AgNO3 silver nitrate;KNO3 potassium nitrate;NaNO3 sodium nitrate;Pb(NO3)2 lead nitrate;BaCl2 barium chloride;CaCl2 calcium chloride;MgCl2 magnesium chloride;FeCl3 iron three chloride;AlCl3 aluminium chloride;KCl potassium chloride;KBr potassium bromide;KI potassium iodide;NaBr sodium bromide;NaI sodium iodide;NaF sodium fluoride;AgCl silver chloride;HF hydrofluoric acid;HBr hydrobromic acid;HI hydroiodic acid;H2S hydrogen sulphide;O3 ozone;NaClO sodium hypochlorite;CuSO4.5H2O copper two sulphate pentahydrate;CuSO4·5H2O copper two sulphate pentahydrate;Na2CO3.10H2O sodium carbonate decahydrate;MgSO4.7H2O magnesium sulphate heptahydrate')
    .split(';').forEach(p => { const i = p.indexOf(' '); COMPOUND[p.slice(0, i)] = p.slice(i + 1); });
  // charge written as formula + (^n if n>1) + sign
  const POLY = { 'OH-': 'hydroxide', 'NO3-': 'nitrate', 'NO2-': 'nitrite', 'SO4^2-': 'sulphate', 'SO3^2-': 'sulphite', 'CO3^2-': 'carbonate', 'HCO3-': 'hydrogen carbonate', 'PO4^3-': 'phosphate',
    'NH4+': 'ammonium', 'H3O+': 'hydronium', 'MnO4-': 'permanganate', 'Cr2O7^2-': 'dichromate', 'CrO4^2-': 'chromate', 'ClO3-': 'chlorate', 'ClO-': 'hypochlorite', 'ClO4-': 'perchlorate',
    'CN-': 'cyanide', 'HSO4-': 'hydrogen sulphate', 'HSO3-': 'hydrogen sulphite', 'CH3COO-': 'ethanoate', 'O2^2-': 'peroxide', 'S2O3^2-': 'thiosulphate', 'HPO4^2-': 'hydrogen phosphate', 'H2PO4-': 'dihydrogen phosphate', 'SCN-': 'thiocyanate' };
  const ANION = { H: 'hydride', F: 'fluoride', Cl: 'chloride', Br: 'bromide', I: 'iodide', O: 'oxide', S: 'sulphide', N: 'nitride', P: 'phosphide' };
  // Single symbols that are not ordinary English words, so "Na atom" can safely become "sodium atom"
  const SAFE_LONE = new Set('Na Cl Fe Cu Zn Ag Au Pb Hg Mg Ca Al Si Sn Br Kr Xe Ne Ar Li Mn Cr Ni Ti Ba Sr Rb Cs Ra Rn Pt Pd Cd Ga Ge Se Te Sb Bi Po Th Pu Np'.split(' '));
  // Formulas with no digit or charge that are still formulas (an unlisted all-capitals word like NYSC or JAMB must not be touched)
  const NO_DIGIT_OK = new Set('NaCl HCl NaOH KOH KCl KBr KI NaBr NaI NaF HF HBr HI MgO CaO ZnO CuO PbO CO NO LiOH AgCl CaCl BaCl'.split(' '));

  const SUB = '₀₁₂₃₄₅₆₇₈₉', SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const num = n => String(n);

  // ── TeX-ish input ─────────────────────────────────────────────────────
  function unwrap(s, cmd) { // \ce{...} / \text{...} with nested braces -> contents
    for (let guard = 0; guard < 40; guard++) {
      const i = s.indexOf(cmd + '{'); if (i < 0) break;
      let d = 0, j = i + cmd.length;
      for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}') { d--; if (d === 0) break; } }
      s = s.slice(0, i) + ' ' + s.slice(i + cmd.length + 1, j) + ' ' + s.slice(j + 1);
    }
    return s;
  }
  function normalizeTeX(x) {
    let s = String(x);
    ['\\ce', '\\text', '\\mathrm', '\\textrm', '\\mathbf'].forEach(c => { s = unwrap(s, c); });
    s = s.replace(/\\(?:long)?rightleftharpoons|\\leftrightarrow|\\rightleftarrows/g, ' <=> ').replace(/\\(?:long)?rightarrow|\\to\b/g, ' -> ')
      .replace(/\\cdot/g, '·').replace(/\\uparrow/g, ' gas ').replace(/\\downarrow/g, ' precipitate ');
    s = s.replace(/_\s*\{([^{}]*)\}/g, '$1').replace(/_\s*(\w)/g, '$1');
    s = s.replace(/\^\s*\{([^{}]*)\}/g, '^$1');
    return s.replace(/[{}]/g, '');
  }
  function isChemTeX(x) {
    return /\\ce\s*\{|\\rightleftharpoons|[A-Z][a-z]?\d*\^\{?\d*[+-]\}?|[A-Z][a-z]?_\{?\d|\\mathrm\{\s*[A-Z][a-z]?\d?/.test(String(x));
  }
  function fromTeX(x) { return chemSpeak(normalizeTeX(x)); }

  // ── formula parsing and speaking ──────────────────────────────────────
  function parts(body) { // [{sym,count}|{open}|{close,count}] or null if any symbol is not an element
    const out = []; const re = /([A-Z][a-z]?)(\d*)|\(|\)(\d*)|[·.]\d*/g; let m, pos = 0;
    while ((m = re.exec(body))) {
      if (m.index !== pos) return null; pos = re.lastIndex;
      if (m[1]) { if (!EL[m[1]]) return null; if (m[2] && +m[2] >= 100) return null; out.push({ sym: m[1], n: m[2] }); }
      else if (m[0] === '(') out.push({ open: true });
      else if (m[0] === ')') out.push({ close: true, n: m[3] || '' });
      else out.push({ dot: true, n: m[0].slice(1) });
    }
    return pos === body.length && out.length ? out : null;
  }
  function spell(p) { // letters say their name, two-letter symbols say the element, so a voice never glues "NaCl" into a word
    const o = []; let i = 0;
    p.forEach(t => {
      if (t.open) o.push('bracket'); else if (t.close) o.push('bracket' + (t.n ? ' ' + t.n : '')); else if (t.dot) o.push('dot' + (t.n ? ' ' + t.n : ''));
      else o.push((t.sym.length === 1 ? LETTER[t.sym.toUpperCase()] : EL[t.sym]) + (t.n ? ' ' + t.n : ''));
    });
    return o.join(', ').replace(/bracket,\s/g, 'bracket ').replace(/,\s*bracket/g, ', bracket');
  }
  function speakIon(body, mag, sign) {
    const key = body + (mag > 1 ? '^' + mag : '') + sign;
    if (POLY[key]) return POLY[key] + ' ion';
    const p = parts(body);
    if (p && p.length === 1 && p[0].sym && !p[0].n) {
      const s = p[0].sym;
      if (sign === '+') return mag > 1 ? EL[s] + ' ' + mag + ' plus ion' : EL[s] + ' ion';
      return ANION[s] ? ANION[s] + ' ion' : EL[s] + ' ' + (mag > 1 ? mag + ' ' : '') + 'minus ion';
    }
    return (p ? spell(p) : body) + ', ' + (mag > 1 ? mag + ' ' : '') + (sign === '+' ? 'plus' : 'minus') + ' ion';
  }
  const STATE = { aq: 'aqueous', s: 'solid', l: 'liquid', g: 'gas' };

  // one candidate token -> spoken words, or null to leave the text alone
  function speakToken(coef, body, charge, state) {
    let sign = '', mag = 0;
    if (charge) {
      sign = charge.slice(-1); const dg = charge.replace(/[\^+-]/g, '');
      if (charge[0] === '^') mag = dg ? +dg : 1;
      else {
        // "Ca2+" / "SO42-" / "NH4+": decide whether a trailing digit is part of the formula or the charge
        const whole = body + sign;
        const last = /\d$/.test(body) ? +body.slice(-1) : 0;
        if (!charge.length || charge === sign) {
          const asIs = POLY[whole] || (parts(body) && POLY[whole]);
          if (asIs || !last) mag = 1;
          else { const rest = body.slice(0, -1), p2 = parts(rest); if (POLY[rest + '^' + last + sign] || (p2 && p2.length === 1 && p2[0].sym && !p2[0].n)) { body = rest; mag = last; } else mag = 1; }
        } else mag = +charge.replace(/[+-]/g, '') || 1;
      }
    }
    const p = parts(body); if (!p) return null;
    const letters = body.replace(/[^A-Za-z]/g, ''), hasDigitOrParen = /[\d()]/.test(body);
    let said;
    if (sign) said = speakIon(body, mag, sign);
    else if (COMPOUND[body]) said = COMPOUND[body];
    else if (hasDigitOrParen || NO_DIGIT_OK.has(body)) {
      const dot = body.search(/[·.]/);
      if (dot > 0) { // hydrate of an unlisted salt: "X.nH2O"
        const m = /^(.*?)[·.](\d*)H2O$/.exec(body); const main = m && parts(m[1]);
        if (!m || !main) return null;
        said = (COMPOUND[m[1]] || spell(main)) + ' with ' + (m[2] || 'some') + ' water';
      } else said = spell(p);
    } else if (SAFE_LONE.has(body)) said = EL[body];
    else return null;
    if (state && STATE[state]) said += ' ' + STATE[state];
    return (coef ? coef + (COMPOUND[body] || sign ? ' ' : ', ') : '') + said;
  }

  // Characters that show up inside questions and notes in place of ASCII
  function normalizeUnicode(s) {
    // Only superscripts that are clearly chemistry: charges (Ca²⁺) and isotope numbers (¹⁴C). Plain ones like m/s² or x² are left
    // for the voice quiz's own maths handling.
    const run = r => '^' + r.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, c => SUP.indexOf(c)).replace(/⁺/g, '+').replace(/⁻/g, '-');
    s = s.replace(new RegExp('[' + SUP + ']*[⁺⁻]', 'g'), run);
    s = s.replace(new RegExp('(^|[^A-Za-z0-9])([' + SUP + ']{1,3})(?=[A-Z])', 'g'), (m, pre, r) => pre + run(r));
    s = s.replace(/[₀-₉]/g, c => SUB.indexOf(c)).replace(/[₊]/g, '+').replace(/[₋]/g, '-');
    return s.replace(/−/g, '-');
  }

  function chemSpeak(text) {
    let s = normalizeUnicode(String(text == null ? '' : text));
    // isotopes: ^14C, ^{235}_{92}U, 14C, 235U
    s = s.replace(/\^\s*(\d{1,3})\s*([A-Z][a-z]?)(?![a-z])/g, (m, a, e) => EL[e] ? ' ' + isoSay(e, a) + ' ' : m);
    s = s.replace(/(^|[^A-Za-z0-9_^.])(\d{2,3})([A-Z][a-z]?)(?![A-Za-z0-9])/g, (m, pre, a, e) => EL[e] && isIsotopeMass(a) ? pre + isoSay(e, a) : m);
    // acid-base and equilibrium shorthand
    s = s.replace(/\bp(H|OH)\b/g, (m, x) => 'P ' + (x === 'H' ? 'H' : 'O H')).replace(/\bp(Ka|Kb)\b/g, (m, x) => 'P K ' + x[1].toUpperCase())
      .replace(/\bK(sp|a|b|c|p|w)\b/g, (m, x) => 'K ' + x.toUpperCase().split('').join(' '));
    // units
    s = s.replace(/mol\s*\/\s*dm\^?3|mol\s*dm\^?-3/g, ' moles per decimetre cubed ').replace(/mol\s*\/\s*L\b|mol\s*L\^?-1/g, ' moles per litre ')
      .replace(/g\s*\/\s*cm\^?3|g\s*cm\^?-3/g, ' grams per centimetre cubed ').replace(/g\s*\/\s*dm\^?3/g, ' grams per decimetre cubed ')
      .replace(/kJ\s*\/\s*mol|kJ\s*mol\^?-1/g, ' kilojoules per mole ').replace(/J\s*\/\s*mol|J\s*mol\^?-1/g, ' joules per mole ')
      .replace(/g\s*\/\s*mol|g\s*mol\^?-1/g, ' grams per mole ').replace(/J\s*\/\s*K\b|J\s*K\^?-1/g, ' joules per kelvin ')
      .replace(/\bdm\^?3\b/g, ' decimetres cubed ').replace(/\bcm\^?3\b/g, ' centimetres cubed ').replace(/\bm\^?3\b/g, ' metres cubed ')
      .replace(/(\d)\s*mL\b/g, '$1 millilitres').replace(/(\d)\s*kPa\b/g, '$1 kilopascals').replace(/\bmmHg\b/g, ' millimetres of mercury ')
      .replace(/(\d)\s*K\b/g, '$1 kelvin').replace(/(\d)\s*M\b/g, '$1 molar').replace(/(\d)\s*nm\b/g, '$1 nanometres').replace(/(\d)\s*pm\b/g, '$1 picometres');
    // electrons and arrows
    s = s.replace(/(^|[^A-Za-z0-9])e\^?-(?![A-Za-z0-9])/g, '$1 electron ');
    s = s.replace(/<=>|<->/g, ' in equilibrium with ').replace(/-{1,2}>/g, ' gives ');
    // formulas, ions, state symbols
    const TOKEN = /(^|[^A-Za-z0-9_^])(\d+(?=[A-Z(]))?((?:[A-Z][a-z]?\d*|\((?:[A-Z][a-z]?\d*)+\)\d*)+(?:(?:·\d*|\.\d+)(?:[A-Z][a-z]?\d*|\((?:[A-Z][a-z]?\d*)+\)\d*)+)?)(\^\d*[+-]|\d?[+-](?![A-Za-z0-9]))?(?:\((aq|s|l|g)\))?(?![A-Za-z0-9])/g;
    s = s.replace(TOKEN, (m, pre, coef, body, charge, state) => {
      let r = null; try { r = speakToken(coef || '', body, charge || '', state || ''); } catch (e) { r = null; }
      return r == null ? m : pre + ' ' + r + ' ';
    });
    return s.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.;:!?])/g, '$1');
  }
  function isIsotopeMass(a) { return a.length === 3 || (a.length === 2 && +a >= 10); }
  function isoSay(e, a) { return EL[e] + ' ' + (a.length >= 3 ? a.split('').join(' ') : a); }

  // ── lite mode: readable text instead of loading KaTeX ─────────────────
  const SUPMAP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻' };
  const SUBMAP = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
  function texToPlain(x) {
    let s = String(x);
    ['\\ce', '\\text', '\\mathrm', '\\textbf'].forEach(c => { s = unwrap(s, c); });
    for (let i = 0; i < 3; i++) s = s.replace(/\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)').replace(/\\(?:long)?rightarrow|\\to\b/g, '→').replace(/\\rightleftharpoons/g, '⇌').replace(/\\times/g, '×').replace(/\\cdot/g, '·')
      .replace(/\\Delta/g, 'Δ').replace(/\\circ/g, '°').replace(/\\pm/g, '±').replace(/\\leq?\b/g, '≤').replace(/\\geq?\b/g, '≥').replace(/->/g, '→').replace(/<=>/g, '⇌');
    s = s.replace(/\^\s*\{([^{}]*)\}/g, (m, a) => a.replace(/[0-9+-]/g, c => SUPMAP[c] || c)).replace(/\^\s*([0-9+-])/g, (m, a) => SUPMAP[a] || a);
    s = s.replace(/_\s*\{([^{}]*)\}/g, (m, a) => a.replace(/[0-9]/g, c => SUBMAP[c])).replace(/_\s*([0-9])/g, (m, a) => SUBMAP[a]);
    s = s.replace(/([A-Za-z)])(\d+)/g, (m, l, d) => l + d.replace(/[0-9]/g, c => SUBMAP[c])); // chemistry subscripts: H2O -> H₂O
    return s.replace(/\\[A-Za-z]+/g, ' ').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  }

  // ── choosing the best voice on this phone ─────────────────────────────
  // Prefers a Nigerian or British English voice, then "natural/neural/enhanced" ones, then voices stored on the phone
  // (they cost no data). prefName is a voice the student picked themselves: it always wins.
  function pickVoice(voices, lang, prefName) {
    const norm = x => String(x || '').toLowerCase().replace('_', '-'), want = norm(lang || 'en-GB');
    let best = null, top = -1;
    (voices || []).forEach(v => {
      const l = norm(v.lang); if (!l.startsWith('en')) return;
      let sc = 1;
      if (prefName && v.name === prefName) sc += 1000;
      if (l === want) sc += 4; if (l === 'en-ng') sc += 5; else if (l === 'en-gb') sc += 3;
      if (/natural|neural|premium|enhanced|wavenet|online/i.test(v.name)) sc += 3;
      if (v.localService) sc += 1;
      if (sc > top) { top = sc; best = v; }
    });
    return best;
  }

  const api = { chemSpeak, fromTeX, isChemTeX, normalizeTeX, texToPlain, pickVoice, EL, COMPOUND, POLY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PhqChemSpeech = api;
})(typeof window !== 'undefined' ? window : globalThis);
