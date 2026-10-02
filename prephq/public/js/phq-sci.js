// ── PrepHQ science rendering (v1.6) ─────────────────────────────
// Turns plain text into proper maths and chemistry, anywhere in the app, with no per-screen wiring:
//   • LaTeX maths:   $x^2 + y^2$   \( ... \)   $$ ... $$   \[ ... \]      (KaTeX)
//   • Chemistry:     $\ce{H2SO4}$   $\ce{2H2 + O2 -> 2H2O}$                    (KaTeX + mhchem)
//   • Structures:    [[smiles: CC(=O)O]]  or  [[smiles: c1ccccc1 | Benzene]]  (SmilesDrawer — skeletal formulas)
// A MutationObserver watches the page, so quiz questions, results review, AI chat, flashcards and notes are all
// rendered automatically the moment they appear. KaTeX / SmilesDrawer are self-hosted (public/vendor) and only
// downloaded the first time a page actually contains maths or a structure — nothing extra for other screens.
// Add  data-nosci  to any element to opt it (and its children) out.
(function () {
  const MATH_HINT = /\$|\\\(|\\\[/;
  // Lazy match up to the closing ]]; SMILES itself can contain brackets ([C@H], [O-]) so the loop below re-balances them.
  const SMILES_RE = /\[\[\s*smiles\s*:\s*([^|\n]+?)\s*(?:\|\s*([^\]\n]*?)\s*)?\]\]/gi;
  const openCount = (t) => (t.match(/\[/g) || []).length - (t.match(/\]/g) || []).length;
  const loaded = {};

  function loadCss(href) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
  }
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    return (loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = src; s.onload = resolve;
      s.onerror = () => { delete loaded[src]; reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    }));
  }
  function ensureKatex() {
    if (window.renderMathInElement) return Promise.resolve();
    if (!loaded.katexCss) { loaded.katexCss = true; loadCss('/vendor/katex/katex.min.css'); }
    // mhchem adds \ce{…} so chemical formulas and reactions render properly: $\ce{2H2 + O2 -> 2H2O}$
    return loadScript('/vendor/katex/katex.min.js').then(() => loadScript('/vendor/katex/mhchem.min.js')).then(() => loadScript('/vendor/katex/auto-render.min.js'));
  }
  function ensureSmiles() {
    return window.SmilesDrawer ? Promise.resolve() : loadScript('/vendor/smiles/smiles-drawer.min.js');
  }

  const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

  function renderMath(el) {
    return ensureKatex().then(() => {
      window.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$', right: '$', display: false },
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option', 'input'],
        ignoredClasses: ['katex', 'no-sci'],
      });
    }).catch(() => {});
  }

  // Replaces every [[smiles: …]] token in the element's text with a drawn structure.
  function renderStructures(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => /\[\[\s*smiles/i.test(n.nodeValue) && !n.parentElement.closest('[data-nosci],textarea,script,style')
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    if (!nodes.length) return Promise.resolve();
    return ensureSmiles().then(() => {
      for (const node of nodes) {
        if (!node.parentNode) continue;
        const text = node.nodeValue; SMILES_RE.lastIndex = 0;
        const frag = document.createDocumentFragment(); let last = 0, m;
        while ((m = SMILES_RE.exec(text))) {
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          let smi = m[1].trim(), end = m.index + m[0].length;
          while (openCount(smi) > 0 && text[end] === ']') { smi += ']'; end++; }
          frag.appendChild(structureFigure(smi, (m[2] || '').trim()));
          SMILES_RE.lastIndex = last = end;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      }
    }).catch(() => {});
  }

  function structureFigure(smiles, caption) {
    const fig = document.createElement('span');
    fig.className = 'phq-mol'; fig.setAttribute('data-nosci', '');
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 240; canvas.style.maxWidth = '100%';
    fig.appendChild(canvas);
    if (caption) { const c = document.createElement('span'); c.className = 'phq-mol-cap'; c.textContent = caption; fig.appendChild(c); }
    try {
      const drawer = new window.SmilesDrawer.Drawer({ width: 320, height: 240, bondThickness: 1.2, compactDrawing: false });
      window.SmilesDrawer.parse(smiles, (tree) => { drawer.draw(tree, canvas, isDark() ? 'dark' : 'light', false); },
        () => fail(fig, smiles));
    } catch (e) { fail(fig, smiles); }
    return fig;
  }
  function fail(fig, smiles) {
    fig.textContent = ''; const s = document.createElement('code'); s.textContent = smiles; s.title = 'Could not draw this structure'; fig.appendChild(s);
  }

  // AI text that has LaTeX but forgot the $…$ (e.g. "\\frac{2}{5}" on its own) — wrap it so it renders.
  function fixBare(root) {
    const F = window.PhqLatexFix; if (!F || !F.hasCmd(root.textContent || '')) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => F.hasCmd(n.nodeValue) && !n.parentElement.closest('.katex,.phq-mol,[data-nosci],textarea,script,style,code,pre')
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) { const fixed = F.fixBareLatex(n.nodeValue); if (fixed !== n.nodeValue) n.nodeValue = fixed; }
  }

  function process(root) {
    if (!root || root.nodeType !== 1 || root.closest('[data-nosci]')) return;
    fixBare(root);
    const text = root.textContent || '';
    if (/\[\[\s*smiles/i.test(text)) renderStructures(root);
    if (MATH_HINT.test(text)) renderMath(root);
  }

  // Batch DOM changes so a screen that re-renders many nodes triggers one pass.
  let pending = new Set(), timer = null;
  function schedule(node) {
    pending.add(node);
    if (timer) return;
    timer = setTimeout(() => {
      const list = [...pending]; pending = new Set(); timer = null;
      for (const n of list) if (n.isConnected) process(n);
    }, 60);
  }
  const inSci = (el) => el && el.closest && el.closest('.katex,.phq-mol');
  function start() {
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) { if (!inSci(n)) schedule(n); }
          else if (n.nodeType === 3 && n.parentElement && !inSci(n.parentElement)) schedule(n.parentElement);
        }
        if (m.type === 'characterData' && m.target.parentElement && !inSci(m.target.parentElement)) schedule(m.target.parentElement);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    schedule(document.body);
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  const style = document.createElement('style');
  style.textContent = '.phq-mol{display:inline-flex;flex-direction:column;align-items:center;margin:6px 4px;vertical-align:middle;}'
    + '.phq-mol canvas{background:#fff;border-radius:12px;border:1px solid rgba(120,120,140,.25);}'
    + '[data-theme=dark] .phq-mol canvas{background:#1a1b26;}'
    // KaTeX's screen-reader MathML block is visually hidden but stays selectable by default, so copying
    // rendered maths pastes it twice (once from the visible html, once from this hidden copy). Excluding it
    // from selection stops that.
    + '.katex .katex-mathml{-webkit-user-select:none;user-select:none;}'
    + '.phq-mol-cap{font-size:12px;opacity:.7;margin-top:2px;}'
    + '.katex-display{overflow-x:auto;overflow-y:hidden;padding:2px 0;}';
  document.head.appendChild(style);

  window.PhqSci = { render: process };
})();
