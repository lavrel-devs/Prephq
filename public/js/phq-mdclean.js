/**
 * PrepHQ plain-text cleaner — v1.8.5
 * The AI sometimes answers in markdown (**bold**, *italic*, _italic_, `code`, # headings). PrepHQ shows AI text as
 * plain text, so those marks appear as stray asterisks and underscores. strip() removes them and keeps the words.
 *
 * Works in Node (server, before text is saved/sent) and in the browser (safety net, also fixes old saved messages).
 * Never touches: maths ($..$ / $$..$$), chemistry structures ([[smiles: ..]]), links, snake_case words, blanks (____),
 * multiplication (2 * 3), or underscores/asterisks inside words.
 *
 * Options: keepBold (leave **term** for the study-notes reader, which turns it into bold), keepHeadings (leave "## ").
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PhqMd = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function strip(text, opts) {
    opts = opts || {};
    let s = String(text == null ? '' : text);
    if (!/[*_`#•+]/.test(s)) return s.trim();

    // Hide what must never be edited behind placeholders.
    const keep = [];
    const hold = (m) => { keep.push(m); return '\u0003' + (keep.length - 1) + '\u0004'; };
    s = s.replace(/\$\$[^\n]*?\$\$|\$[^$\n]+\$|\[\[smiles:[^\]\n]*\]\]|https?:\/\/[^\s)<]+|\\[*_`]/gi, hold);

    // code fences + inline code
    s = s.replace(/```[a-z]*\n?|```/gi, '').replace(/`([^`\n]+)`/g, '$1').replace(/`/g, '');
    // horizontal rules (--- *** ___ on their own line)
    s = s.replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '');
    // headings
    if (!opts.keepHeadings) s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '');
    // bullets written with * + or •  ->  "- "
    s = s.replace(/^([ \t]*)[*+•][ \t]+/gm, '$1- ');

    // bold / bold-italic
    s = s.replace(/\*{3}(?=[^\s*])([^\n]*?[^\s*])\*{3}/g, opts.keepBold ? '**$1**' : '$1');
    if (opts.keepBold) s = s.replace(/(^|[^\w_])__(?=[^\s_])([^\n]*?[^\s_])__(?![\w_])/g, '$1**$2**');
    else s = s.replace(/\*\*(?=[^\s*])([^\n]*?[^\s*])\*\*/g, '$1').replace(/(^|[^\w_])__(?=[^\s_])([^\n]*?[^\s_])__(?![\w_])/g, '$1$2');
    // italics
    s = s.replace(/(^|[^\w*])\*(?![\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1$2');
    s = s.replace(/(^|[^\w_])_(?![\s_])([^_\n]*?[^\s_])_(?![\w_])/g, '$1$2');

    // leftovers: unbalanced markers
    if (opts.keepBold) s = s.split('\n').map(l => ((l.match(/\*\*/g) || []).length % 2 ? l.replace(/\*\*/g, '') : l)).join('\n');
    else s = s.replace(/\*{2,}/g, '');
    s = s.replace(/\*{3,}/g, '').replace(/(?<![_\w])__(?![_\w])/g, '');
    s = s.replace(/(^|\s)\*(?=[A-Za-z])/gm, '$1').replace(/(?<=[A-Za-z.,!?:;)])\*(?=\s|$)/gm, '');

    s = s.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
    s = s.replace(/\u0003(\d+)\u0004/g, (_, i) => keep[+i].replace(/^\\([*_`])$/, '$1'));
    return s.trim();
  }

  return { strip };
});
