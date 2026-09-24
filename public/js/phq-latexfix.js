// Repairs maths the AI wrote WITHOUT dollar signs, e.g.  \text{moles Fe^{2+}} = 0.0250\ \text{L} \times 0.100\ \text{M}
// -> wraps the maths part in $…$ (and turns ions/formulas inside \text{…} into \ce{…}) so KaTeX can draw it.
// Runs in the browser (phq-sci.js, so old saved notes/questions get fixed too) and on the server (new AI output).
(function (root) {
  const CMD = /\\(?:d?frac|text|textbf|mathrm|mathbf|times|cdot|div|pm|ce|rightarrow|Rightarrow|leftrightarrow|rightleftharpoons|to|sqrt|Delta|alpha|beta|gamma|theta|lambda|mu|pi|sigma|omega|approx|leq|geq|neq|log|ln|sum|int|circ|vec|hat|left|right|cdots|ldots)(?![A-Za-z])/;
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

  function fixLine(line) {
    if (/\$|\\\(|\\\[/.test(line) || !hasCmd(line)) return line;
    const m = CMD.exec(line); let start = m.index;
    const back = /((?:[A-Za-z][A-Za-z0-9]*(?:\([^)]*\))?\s*[=+\-*\/]\s*)+)$/.exec(line.slice(0, start));   // "V = \frac…"
    if (back) start -= back[1].length;
    let end = line.length;
    while (end > start && /[\s.,;:]/.test(line[end - 1])) end--;
    const math = line.slice(start, end);
    if (!math.trim()) return line;
    return line.slice(0, start) + '$' + fixText(math) + '$' + line.slice(end);
  }

  function fixBareLatex(text) {
    if (typeof text !== 'string' || !text || !hasCmd(text)) return text;
    return text.split('\n').map(fixLine).join('\n');
  }

  root.PhqLatexFix = { fixBareLatex, hasCmd };
  if (typeof module !== 'undefined' && module.exports) module.exports = { fixBareLatex, hasCmd };
})(typeof window !== 'undefined' ? window : globalThis);
