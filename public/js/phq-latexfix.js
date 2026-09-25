// Repairs maths the AI wrote WITHOUT dollar signs, e.g.  \text{moles Fe^{2+}} = 0.0250\ \text{L} \times 0.100\ \text{M}
// -> wraps the maths part in $…$ (and turns ions/formulas inside \text{…} into \ce{…}) so KaTeX can draw it.
// Runs in the browser (phq-sci.js, so old saved notes/questions get fixed too) and on the server (new AI output).
(function (root) {
  const CMD = /\\(?:d?frac|text|textbf|mathrm|mathbf|times|cdot|cdotp|centerdot|div|pm|ce|rightarrow|Rightarrow|leftrightarrow|rightleftharpoons|to|sqrt|Delta|alpha|beta|gamma|theta|lambda|mu|pi|sigma|omega|approx|leq|geq|neq|log|ln|sum|int|circ|vec|hat|left|right|cdots|ldots)(?![A-Za-z])/;
  const hasCmd = (s) => CMD.test(s);

  // \text{moles Fe^{2+}} would print a literal caret. Pull the formula/unit out of it.
  function fixText(math) {
    return math.replace(/\\text\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, (all, inner) => {
      if (inner.indexOf('^') < 0 && !/_/.test(inner)) return all;
      const m = /^(.*?)(\S+)$/.exec(inner);
      if (!m) return all;
      const pre = m[1], word = m[2];
      if (/^[A-Z][A-Za-z0-9]*(?:[\^_]\{?[0-9+\-−]*\}?)?$/.test(word) || /^[A-Z][A-Za-z0-9()]*\^/.test(word)) {
        return (pre ? `\\text{${pre}}` : '') + `\\ce{${word}}`;                 // ion / formula: Fe^{2+}, MnO4^-
      }
      const u = /^([^\^]+)\^(\{[^}]*\}|[^\s}]+)$/.exec(word);                   // unit: mol·L^{-1}
      return u ? `\\text{${pre}${u[1]}}^${u[2].startsWith('{') ? u[2] : '{' + u[2] + '}'}` : all;
    });
  }

  // A line is rarely ALL maths — "Given: m=0.5 mol·kg⁻¹, i=2 for NaCl, Kb=0.512 °C·kg·mol⁻¹ (water)."
  // has two separate maths clusters inside one ordinary sentence. Wrapping from the first command to the end
  // of the line (the old approach) swallowed "for NaCl" and "(water)" into math mode. Instead, split the line
  // into words and wrap only the runs of words that actually look like maths.
  const STOPWORDS = new Set(['for','the','and','are','was','not','but','use','of','in','on','at','to','is','as','we','it','or','given','water','solution','using','so','with','this','that','find','let']);
  function coreOf(word) {
    const m = /^([(\[]*)([\s\S]*?)([)\],.;:]*)$/.exec(word);
    return { lead: m[1], core: m[2], trail: m[3] };
  }
  function isMathWord(core) {
    if (!core) return false;
    if (core.indexOf('\\') >= 0) return true;                          // a LaTeX command
    if (/=/.test(core)) return true;                                    // an equation, e.g. m=0.5
    if (/^[0-9]+(?:\.[0-9]+)?$/.test(core)) return true;                 // a bare number
    if (/[\^_−]/.test(core)) return true;                                // 10^{-3}, kg−1, K_b, C_p
    if (/^[A-Za-z]{1,2}$/.test(core) && !STOPWORDS.has(core.toLowerCase())) return true; // short symbol: m, V, Kb
    return false;
  }
  function fixLine(line) {
    if (/\$|\\\(|\\\[/.test(line) || !hasCmd(line)) return line;
    const parts = line.split(/(\s+)/);                                  // alternating word, space, word, ...
    const isListMarker = /^[0-9]+\.$/.test(parts[0] || '');           // "4. …" — a step number, not maths, however long the line runs on
    const isMath = (i) => i % 2 === 0 && i < parts.length && !(i === 0 && isListMarker) && isMathWord(coreOf(parts[i]).core);
    let out = '', i = 0;
    while (i < parts.length) {
      if (isMath(i)) {
        let j = i;
        while (true) {
          if (j % 2 === 0) { if (isMath(j)) { j++; continue; } break; }   // a math word: consume, keep going
          if (isMath(j + 1)) { j++; continue; }                          // a space followed by another math word: consume
          break;                                                          // a space followed by non-math (or end): stop here
        }
        const clusterText = parts.slice(i, j).join('');
        const first = coreOf(parts[i]), last = coreOf(parts[j - 1]);
        const inner = clusterText.slice(first.lead.length, clusterText.length - last.trail.length);
        out += first.lead + '$' + fixText(inner) + '$' + last.trail;
        i = j;
      } else {
        out += parts[i]; i++;
      }
    }
    return out;
  }

  // \cdotp is a LaTeX control WORD: real LaTeX would swallow whatever letters follow it into the command name
  // (so "\cdotpkg" is actually broken LaTeX). The AI does this when it means "\cdot" right before a unit with
  // no space ("0.512 \cdotpkg/mol" for "0.512 ·kg/mol"). Split it apart so the dot and the unit both survive.
  function splitGlued(text) {
    return text.replace(/\\cdotp(?=[a-zA-Z])/g, '\\cdot ');
  }

  function fixBareLatex(text) {
    if (typeof text !== 'string' || !text) return text;
    text = splitGlued(text);
    if (!hasCmd(text)) return text;
    return text.split('\n').map(fixLine).join('\n');
  }

  root.PhqLatexFix = { fixBareLatex, hasCmd };
  if (typeof module !== 'undefined' && module.exports) module.exports = { fixBareLatex, hasCmd };
})(typeof window !== 'undefined' ? window : globalThis);
