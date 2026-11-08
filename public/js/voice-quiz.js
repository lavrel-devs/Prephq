/* ═══ Wreddi Voice Quiz — v1.9.0 ═══════════════════════════════════════════════════════════
   A hands-free quiz: Wreddi reads the question and the options aloud, listens for "B" (or "option two",
   "the second one", or the answer itself), says whether it was right and why, then moves on.
   Built for danfo rides, queues and fetching water — eyes off the screen, phone in a pocket.

   Two layers in this one file:
     1. Pure helpers (parseSpokenAnswer, speakable, buildQuestionSpeech …) — no browser needed, unit-tested
        in tests/voicequiz.test.js.
     2. The browser controller (window.PhqVoiceQuiz) — speech recognition + speech synthesis + a small
        full-screen UI. Works in tap-only mode when the browser has no speech recognition.

   It never talks to the server itself. The page hands it questions and gets a summary back (onFinish),
   so scoring/goal/streak stay in one place (dashboard.html).                                        */
(function (root) {
  'use strict';

  // ══ 1. Pure helpers ═══════════════════════════════════════════════════════════════════════
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const LETTER_WORDS = { a: 0, ay: 0, eh: 0, b: 1, be: 1, bee: 1, c: 2, see: 2, sea: 2, cee: 2, d: 3, dee: 3, e: 4, ee: 4, f: 5, ef: 5 };
  const ORDINALS = { first: 0, second: 1, third: 2, fourth: 3, forth: 3, fifth: 4, sixth: 5 };
  const NUMBERS = { one: 0, '1': 0, two: 1, to: 1, too: 1, '2': 1, three: 2, '3': 2, four: 3, for: 3, '4': 3, five: 4, '5': 4, six: 5, '6': 5 };
  const FILLERS = new Set(['please', 'um', 'uh', 'er', 'erm', 'the', 'my', 'answer', 'option', 'letter', 'number', 'is', 'its', 'it', 's',
    'choose', 'pick', 'select', 'i', 'think', 'go', 'with', 'going', 'would', 'say', 'final', 'then', 'okay', 'ok', 'yes', 'yeah', 'so', 'maybe', 'guess']);
  const CUES = new Set(['option', 'letter', 'answer', 'number', 'choose', 'pick', 'select', 'is', 'its', 'with', 'go', 'think']);
  const STRONG_CUES = new Set(['option', 'letter', 'number']);   // "option a" is unmistakable even mid-sentence; "it is a metal" is not
  const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'to', 'and', 'or', 'in', 'on', 'is', 'are', 'it', 'its', 'that', 'this', 'for', 'be', 'by', 'as', 'at',
    'answer', 'option', 'letter', 'i', 'think', 'its', 'please', 'um', 'uh', 'yes', 'so']);

  const tokenize = s => String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const contentTokens = s => tokenize(s).filter(t => !STOPWORDS.has(t));
  const letterOf = i => LETTERS[i] || String(i + 1);

  function mapWord(t) {
    if (Object.prototype.hasOwnProperty.call(LETTER_WORDS, t)) return LETTER_WORDS[t];
    if (Object.prototype.hasOwnProperty.call(ORDINALS, t)) return ORDINALS[t];
    if (Object.prototype.hasOwnProperty.call(NUMBERS, t)) return NUMBERS[t];
    return undefined;
  }

  // How well does what was said match one option's own words? → { index, s, margin }
  function bestTextMatch(transcript, opts) {
    const said = new Set(contentTokens(transcript));
    if (!said.size || !opts.length) return { index: -1, s: 0, margin: 0 };
    const scored = opts.map((o, i) => {
      const ot = [...new Set(contentTokens(o))];
      if (!ot.length) return { i, s: 0 };
      const hit = ot.filter(t => said.has(t)).length;
      return { i, s: (hit / ot.length + hit / said.size) / 2 };
    }).sort((a, b) => b.s - a.s);
    return { index: scored[0].i, s: scored[0].s, margin: scored[0].s - (scored[1] ? scored[1].s : 0) };
  }

  // What did the student say? → { type:'answer', index, via } | { type:'command', command } | { type:'unknown', reason? }
  function parseSpokenAnswer(transcript, opts) {
    opts = Array.isArray(opts) ? opts : [];
    const tokens = tokenize(transcript);
    if (!tokens.length) return { type: 'unknown', reason: 'empty' };
    const text = tokens.join(' ');
    const inRange = i => i != null && i >= 0 && (!opts.length || i < opts.length);

    // Commands only count in short replies, so an answer like "pass through the membrane" isn't mistaken for "skip".
    // Up to 3 words anything goes ("say that again"); up to 6 words only the clear ones ("please repeat the question"),
    // and only when the words don't also match one of the options.
    const tm = bestTextMatch(transcript, opts);
    const cmdOK = tokens.length <= 3 || (tokens.length <= 6 && tm.s < 0.5);
    if (cmdOK) {
      const strong = tokens.length <= 3;
      if (/\b(stop|end|quit|exit|finish|enough|im done|i am done)\b/.test(text)) return { type: 'command', command: 'stop' };
      if (/\b(repeat|again|pardon|say that|what was|sorry what|come again)\b/.test(text) && (strong || /\brepeat\b/.test(text))) return { type: 'command', command: 'repeat' };
      if (/\b(skip|pass|next|dont know|no idea|not sure)\b/.test(text) && (strong || /\bskip\b/.test(text))) return { type: 'command', command: 'skip' };
    }

    // Words that are also everyday words ("a", "to", "for", "one", "be") only count as an answer when they are the whole
    // reply, or the very last word after a cue ("the answer is a") — never mid-sentence ("it is a metal", "go to the lab").
    const AMBIG = new Set(['a', 'to', 'too', 'for', 'one', 'be', 'see', 'sea', 'eh']);

    // A bare letter / number: "B", "bee", "two".  ("one" alone is too ambiguous; "option one" is handled below.)
    const stripped = tokens.filter(t => !FILLERS.has(t));
    if (stripped.length === 1 && stripped[0] !== 'one' && mapWord(stripped[0]) !== undefined) {
      const idx = mapWord(stripped[0]);
      if (inRange(idx)) return { type: 'answer', index: idx, via: 'letter' };
    }
    // Cued letters: "the answer is C", "I choose b", "option two".  Ordinals: "the third one", "second".
    const found = new Set();
    tokens.forEach((t, i) => {
      if (ORDINALS[t] !== undefined) {
        // "the first law of thermodynamics" is an answer, not "option A": ordinals count in short replies or when followed by one/option/answer.
        const nxt = tokens[i + 1], prev = tokens[i - 1];
        if (tokens.length <= 4 || nxt === 'one' || nxt === 'option' || nxt === 'answer' || CUES.has(prev)) found.add(ORDINALS[t]);
      } else if (CUES.has(t) && tokens[i + 1] !== undefined) {
        let j = i + 1;
        if (FILLERS.has(tokens[j]) && mapWord(tokens[j]) === undefined && tokens[j + 1] !== undefined) j++;   // "answer is C"
        const m = mapWord(tokens[j]);
        if (m !== undefined && (STRONG_CUES.has(t) || !(AMBIG.has(tokens[j]) && j + 1 < tokens.length))) found.add(m);
      }
    });
    if (found.size > 1) return { type: 'unknown', reason: 'ambiguous' };
    if (found.size === 1) { const idx = [...found][0]; if (inRange(idx)) return { type: 'answer', index: idx, via: 'letter' }; }

    // Said the answer itself: "sodium chloride". Needs a clear winner so a vague phrase never picks for them.
    if (tm.s >= 0.6 && tm.margin >= 0.25) return { type: 'answer', index: tm.index, via: 'text', confidence: tm.s };
    return { type: 'unknown' };
  }

  // Several recogniser guesses ("alternatives") → the first that makes sense. Helps with "bee/be/b".
  function parseBest(alternatives, opts) {
    let amb = false;
    for (const alt of alternatives || []) {
      const r = parseSpokenAnswer(alt, opts);
      if (r.type !== 'unknown') return r;
      if (r.reason === 'ambiguous') amb = true;
    }
    return amb ? { type: 'unknown', reason: 'ambiguous' } : { type: 'unknown' };
  }

  // v1.9.2 chemistry pronunciation (formulas, ions, isotopes, units) lives in chem-speech.js
  const CS = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('./chem-speech') : root.PhqChemSpeech;
  const mathSay = x => latexToSpeech(CS && CS.isChemTeX(x) ? CS.fromTeX(x) : x);

  // Makes question text pleasant to hear: no HTML/markdown, maths and chemistry read as words.
  const GREEK = { alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta', Delta: 'delta', theta: 'theta', lambda: 'lambda', mu: 'mu', pi: 'pi', sigma: 'sigma', omega: 'omega', Omega: 'ohm', epsilon: 'epsilon', rho: 'rho', tau: 'tau', phi: 'phi', Sigma: 'sigma' };
  function latexToSpeech(x) {
    let s = String(x);
    for (let i = 0; i < 3; i++) s = s.replace(/\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, ' $1 over $2 ');
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, ' square root of $1 ');
    s = s.replace(/\^\s*\{?\\circ\}?/g, ' degrees ').replace(/\\circ/g, ' degrees ');
    s = s.replace(/\^\s*\{?\s*2\s*\}?/g, ' squared ').replace(/\^\s*\{?\s*3\s*\}?/g, ' cubed ');
    s = s.replace(/\^\s*\{\s*([^{}]*?)\s*\}/g, ' to the power $1 ').replace(/\^\s*([A-Za-z0-9+-])/g, ' to the power $1 ');
    s = s.replace(/_\s*\{([^{}]*)\}/g, ' $1 ').replace(/_\s*([A-Za-z0-9])/g, ' $1 ');
    s = s.replace(/\\(?:long)?(?:right|to)arrow|\\rightarrow|\\to\b/g, ' gives ')
      .replace(/\\(?:left)?rightleftharpoons|\\leftrightarrow|\\rightleftharpoons/g, ' in equilibrium with ')
      .replace(/\\times/g, ' times ').replace(/\\cdot/g, ' dot ').replace(/\\div/g, ' divided by ').replace(/\\pm/g, ' plus or minus ')
      .replace(/\\leq?\b/g, ' less than or equal to ').replace(/\\geq?\b/g, ' greater than or equal to ').replace(/\\neq/g, ' not equal to ').replace(/\\approx/g, ' approximately ')
      .replace(/\\(?:text|mathrm|mathbf|ce|textbf)\s*\{([^{}]*)\}/g, ' $1 ');
    s = s.replace(/\\([A-Za-z]+)/g, (m, n) => (GREEK[n] ? ` ${GREEK[n]} ` : ' '));
    return s.replace(/[{}\\]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function speakable(text) {
    let s = String(text == null ? '' : text);
    s = s.replace(/<[^>]*>/g, ' ');
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, (m, x) => ` ${mathSay(x)} `).replace(/\$([^$\n]+?)\$/g, (m, x) => ` ${mathSay(x)} `);
    s = s.replace(/\\\(([\s\S]+?)\\\)/g, (m, x) => ` ${mathSay(x)} `).replace(/\\\[([\s\S]+?)\\\]/g, (m, x) => ` ${mathSay(x)} `);
    if (CS) s = CS.chemSpeak(s);   // formulas and ions written in plain text
    s = s.replace(/→|⟶|⇒/g, ' gives ').replace(/⇌/g, ' in equilibrium with ').replace(/×/g, ' times ').replace(/÷/g, ' divided by ').replace(/±/g, ' plus or minus ')
      .replace(/≤/g, ' less than or equal to ').replace(/≥/g, ' greater than or equal to ').replace(/≠/g, ' not equal to ').replace(/≈/g, ' approximately ')
      .replace(/°C/g, ' degrees Celsius ').replace(/°/g, ' degrees ').replace(/²/g, ' squared ').replace(/³/g, ' cubed ')
      .replace(/Δ/g, ' delta ').replace(/μ/g, ' mu ').replace(/π/g, ' pi ').replace(/α/g, ' alpha ').replace(/β/g, ' beta ').replace(/γ/g, ' gamma ').replace(/λ/g, ' lambda ').replace(/Ω/g, ' ohms ')
      .replace(/(\d)\s*%/g, '$1 percent')
      .replace(/\s=\s/g, ' equals ').replace(/\s\+\s/g, ' plus ').replace(/\s[−–]\s/g, ' minus ');
    s = s.replace(/[₀-₉]/g, d => ' ' + (d.charCodeAt(0) - 0x2080) + ' ');   // chemistry subscripts: H₂O → "H 2 O"
    s = s.replace(/[*_`#>~]+/g, ' ');
    return s.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
  }

  const endStop = s => (/[.?!:]$/.test(s) ? s : s + '.');
  function buildQuestionSpeech(q, n, total, opts) {
    const withOptions = !opts || opts.withOptions !== false;
    const parts = [total ? `Question ${n} of ${total}.` : `Question ${n}.`, endStop(speakable(q.q))];
    if (withOptions) (q.opts || []).forEach((o, i) => parts.push(`Option ${letterOf(i)}. ${endStop(speakable(o))}`));
    return parts.join(' ');
  }
  function buildOptionsSpeech(q) { return (q.opts || []).map((o, i) => `Option ${letterOf(i)}. ${endStop(speakable(o))}`).join(' '); }

  const RIGHT = ['Correct!', 'Yes, that\'s right.', 'Spot on.', 'Right answer.', 'Good one.'];
  function firstSentences(text, maxChars) {
    const s = speakable(text);
    if (!s) return '';
    const parts = s.match(/[^.!?]+[.!?]*/g) || [s];
    let out = '';
    for (const p of parts) { if ((out + p).length > maxChars && out) break; out += p; }
    return out.trim().slice(0, maxChars + 40);
  }
  function buildFeedback(q, chosen, n) {
    const ok = chosen === q.ans;
    const exp = firstSentences(q.exp || '', 220);
    if (ok) return `${RIGHT[(n || 0) % RIGHT.length]}${exp ? ' ' + endStop(exp) : ''}`;
    return `Not quite. The answer is option ${letterOf(q.ans)}, ${endStop(speakable((q.opts || [])[q.ans] || ''))}${exp ? ' ' + endStop(exp) : ''}`;
  }

  function summarize(results) {
    const answered = results.filter(r => r.chosen != null);
    const correct = answered.filter(r => r.correct).length;
    const wrongTags = {};
    answered.filter(r => !r.correct && r.tag).forEach(r => { wrongTags[r.tag] = (wrongTags[r.tag] || 0) + 1; });
    const weakTags = Object.keys(wrongTags).sort((a, b) => wrongTags[b] - wrongTags[a]).slice(0, 2);
    return { total: results.length, answered: answered.length, correct, wrong: answered.length - correct, skip: results.length - answered.length, weakTags,
      pct: answered.length ? Math.round((correct / answered.length) * 100) : 0 };
  }
  function buildSummary(sum) {
    if (!sum.answered) return 'No answers this time. Come back anytime and we will go again.';
    const verdict = sum.pct >= 80 ? 'Excellent work.' : sum.pct >= 60 ? 'Good effort.' : sum.pct >= 40 ? 'Keep practising, you are getting there.' : 'This topic needs more work, and that is okay.';
    const weak = sum.weakTags.length ? ` Revise ${sum.weakTags.map(speakable).join(' and ')}.` : '';
    return `You got ${sum.correct} out of ${sum.answered}. ${verdict}${weak}`;
  }

  // The browser reads long text badly (some engines cut off after ~15 seconds), so speak it in sentence-sized pieces.
  function chunkSpeech(text, max) {
    max = max || 180;
    const sentences = String(text).match(/[^.!?]+[.!?]*\s*/g) || [String(text)];
    const out = []; let cur = '';
    for (const s of sentences) {
      if ((cur + s).length > max && cur) { out.push(cur.trim()); cur = ''; }
      if (s.length > max) { s.split(/,\s*/).forEach(piece => { if ((cur + piece).length > max && cur) { out.push(cur.trim()); cur = ''; } cur += piece + ', '; }); }
      else cur += s;
    }
    if (cur.trim()) out.push(cur.trim().replace(/,\s*$/, ''));
    return out.filter(Boolean);
  }

  const helpers = { parseSpokenAnswer, parseBest, speakable, latexToSpeech, buildQuestionSpeech, buildOptionsSpeech, buildFeedback, summarize, buildSummary, chunkSpeech, letterOf };
  if (typeof module !== 'undefined' && module.exports) { module.exports = helpers; }
  if (typeof window === 'undefined' || typeof document === 'undefined') return;   // Node (tests) stops here

  // ══ 2. Browser controller ═════════════════════════════════════════════════════════════════
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const TTS = ('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) ? window.speechSynthesis : null;
  const VKEY = 'phq_voice';   // same settings the AI-chat voice tutor uses (language)
  const savedLang = () => { try { return (JSON.parse(localStorage.getItem(VKEY) || '{}').lang) || 'en-NG'; } catch (e) { return 'en-NG'; } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CSS = `
  .vq-ov{position:fixed;inset:0;z-index:9500;display:none;flex-direction:column;background:var(--bg,#e0e5ec);color:var(--t1,#2a3142);font-family:var(--ff-b,'DM Sans',system-ui,sans-serif);padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0);}
  .vq-ov.on{display:flex;}
  .vq-top{display:flex;align-items:center;gap:10px;padding:14px 18px 8px;}
  .vq-title{font-weight:800;font-size:15px;flex:1;}
  .vq-count{font-size:12.5px;font-weight:800;color:var(--t3,#7a8296);}
  .vq-x{border:none;background:var(--bg,#e0e5ec);box-shadow:var(--sh,4px 4px 10px #b8c0cc,-4px -4px 10px #fff);width:36px;height:36px;border-radius:50%;cursor:pointer;color:var(--t2,#4a5568);font-size:15px;}
  .vq-bar{height:6px;margin:0 18px;border-radius:99px;background:var(--surf3,#d1d9e6);overflow:hidden;}
  .vq-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--brand,#3E5C8A),var(--purple,#5D7FB0));transition:width .3s;}
  .vq-body{flex:1;overflow:auto;padding:16px 18px;max-width:640px;width:100%;margin:0 auto;}
  .vq-q{font-size:19px;font-weight:700;line-height:1.45;margin:6px 0 16px;}
  .vq-opt{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;border:none;background:var(--bg,#e0e5ec);box-shadow:var(--sh,4px 4px 10px #b8c0cc,-4px -4px 10px #fff);border-radius:14px;padding:13px 14px;margin-bottom:10px;font:inherit;font-size:15px;color:inherit;cursor:pointer;}
  .vq-opt b{flex:0 0 26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12.5px;background:var(--brand-lt,rgba(62,92,138,.12));color:var(--brand,#3E5C8A);}
  .vq-opt.ok{box-shadow:0 0 0 2px var(--ok,#2d9c6e);} .vq-opt.no{box-shadow:0 0 0 2px var(--no,#d14545);}
  .vq-opt:disabled{cursor:default;}
  .vq-fb{min-height:22px;font-size:14px;line-height:1.5;color:var(--t2,#4a5568);margin-top:4px;}
  .vq-bottom{padding:10px 18px 18px;text-align:center;}
  .vq-orb{width:72px;height:72px;border-radius:50%;border:none;cursor:pointer;color:#fff;font-size:26px;background:linear-gradient(140deg,var(--brand,#3E5C8A),var(--purple,#5D7FB0));box-shadow:0 8px 22px var(--brand-glow,rgba(62,92,138,.3));}
  .vq-orb.live{animation:vq-pulse 1.1s ease-in-out infinite;} .vq-orb.say{opacity:.75;}
  @keyframes vq-pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.09);}}
  .vq-status{font-size:13.5px;font-weight:800;margin:10px 0 2px;min-height:19px;}
  .vq-hint{font-size:11.5px;color:var(--t3,#7a8296);line-height:1.5;}
  .vq-ctl{display:flex;gap:8px;justify-content:center;margin-top:10px;flex-wrap:wrap;}
  .vq-ctl button{border:none;cursor:pointer;font:inherit;font-size:12.5px;font-weight:800;padding:9px 16px;border-radius:99px;background:var(--bg,#e0e5ec);color:var(--t2,#4a5568);box-shadow:var(--sh,4px 4px 10px #b8c0cc,-4px -4px 10px #fff);}
  .vq-sum{text-align:center;padding:30px 10px;} .vq-sum .big{font-size:44px;font-weight:800;color:var(--brand,#3E5C8A);}
  `;

  const S = { ov: null, qs: [], i: 0, results: [], run: 0, open: false, lang: 'en-NG', rec: null, deliver: null, sttOk: !!SR, paused: false,
    idle: 0, onFinish: null, finished: false, wake: null, voice: null };

  function build() {
    if (S.ov) return;
    const st = document.createElement('style'); st.id = 'vq-style'; st.textContent = CSS; document.head.appendChild(st);
    const ov = document.createElement('div'); ov.className = 'vq-ov'; ov.id = 'vq-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Voice quiz');
    ov.innerHTML = `
      <div class="vq-top"><div class="vq-title">🎧 Voice quiz</div><div class="vq-count" id="vq-count"></div><button class="vq-x" id="vq-x" aria-label="End voice quiz">✕</button></div>
      <div class="vq-bar"><i id="vq-prog"></i></div>
      <div class="vq-body" id="vq-body"></div>
      <div class="vq-bottom">
        <button class="vq-orb" id="vq-orb" aria-label="Tap to answer by voice">🎤</button>
        <div class="vq-status" id="vq-status" aria-live="polite"></div>
        <div class="vq-hint" id="vq-hint"></div>
        <div class="vq-ctl"><button id="vq-repeat">Repeat</button><button id="vq-skip">Skip</button><button id="vq-end">End</button></div>
      </div>`;
    document.body.appendChild(ov); S.ov = ov;
    ov.querySelector('#vq-x').onclick = ov.querySelector('#vq-end').onclick = () => finish(true);
    ov.querySelector('#vq-repeat').onclick = () => deliver({ type: 'command', command: 'repeat' });
    ov.querySelector('#vq-skip').onclick = () => deliver({ type: 'command', command: 'skip' });
    ov.querySelector('#vq-orb').onclick = () => { if (S.paused) { S.paused = false; S.idle = 0; deliver({ type: 'command', command: 'resume' }); } else startRecognition(); };
    if (TTS) { const lv = () => { try { S.voices = TTS.getVoices() || []; } catch (e) { S.voices = []; } }; lv(); TTS.onvoiceschanged = lv; }
  }
  const $ = id => document.getElementById(id);
  const status = (t, cls) => { const el = $('vq-status'); if (el) { el.textContent = t || ''; el.style.color = cls === 'err' ? 'var(--no,#d14545)' : cls === 'live' ? 'var(--brand,#3E5C8A)' : ''; } };
  const alive = run => S.open && run === S.run;
  const deliver = r => { const d = S.deliver; if (d) { S.deliver = null; d(r); } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function pickVoice() {
    if (CS && CS.pickVoice) { let pref = ''; try { pref = localStorage.getItem('phq-voice') || ''; } catch (e) {} const best = CS.pickVoice(S.voices, S.lang, pref); if (best) return best; }
    const v = S.voices || [], norm = x => String(x || '').toLowerCase().replace('_', '-'), want = norm(S.lang);
    return v.find(x => norm(x.lang) === want) || v.find(x => norm(x.lang) === 'en-gb') || v.find(x => norm(x.lang).startsWith('en')) || null;
  }

  // Speak text; resolves when finished (or cancelled). Always stops listening first so the mic never hears the speaker.
  function say(text, run) {
    return new Promise(resolve => {
      stopRecognition();
      if (!TTS || !text) return resolve();
      try { TTS.cancel(); } catch (e) {}
      const parts = chunkSpeech(text); let k = 0;
      const orb = $('vq-orb'); if (orb) { orb.classList.add('say'); orb.classList.remove('live'); }
      const next = () => {
        if (!alive(run) || k >= parts.length) { if (orb) orb.classList.remove('say'); return resolve(); }
        const u = new SpeechSynthesisUtterance(parts[k++]); const v = pickVoice();
        if (v) { u.voice = v; u.lang = v.lang; } else u.lang = S.lang;
        u.rate = 0.97; let done = false;
        const go = () => { if (done) return; done = true; clearTimeout(guard); next(); };
        const guard = setTimeout(go, Math.max(4000, u.text.length * 110));   // some phones never fire onend
        u.onend = go; u.onerror = go;
        try { TTS.speak(u); } catch (e) { go(); }
      };
      next();
    });
  }

  function stopRecognition() { if (S.rec) { try { S.rec.onend = S.rec.onerror = S.rec.onresult = null; S.rec.abort(); } catch (e) {} S.rec = null; } const o = $('vq-orb'); if (o) o.classList.remove('live'); }
  function startRecognition() {
    if (!S.sttOk || !S.open || S.rec || !S.deliver) return;
    const q = S.qs[S.i]; if (!q) return;
    const rec = new SR(); S.rec = rec;
    rec.lang = S.lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 4;
    let finished = false, heard = false, failed = '';
    const orb = $('vq-orb'); if (orb) orb.classList.add('live');
    status('Listening…', 'live');
    const timer = setTimeout(() => { try { rec.stop(); } catch (e) {} }, 11000);
    rec.onresult = ev => {
      const res = ev.results[ev.results.length - 1]; heard = true;
      const alts = []; for (let a = 0; a < res.length; a++) alts.push(res[a].transcript);
      if (!res.isFinal) { status('“' + (alts[0] || '') + '”', 'live'); return; }
      finished = true; clearTimeout(timer); S.rec = null;
      const parsed = parseBest(alts, q.opts); parsed.heard = alts[0];
      deliver(parsed);
    };
    rec.onerror = ev => { failed = ev.error || 'error'; };
    rec.onend = () => {
      clearTimeout(timer); if (S.rec === rec) S.rec = null; if (orb) orb.classList.remove('live');
      if (finished) return;
      if (failed === 'language-not-supported' && S.lang !== 'en-US') { S.lang = 'en-US'; return startRecognition(); }
      if (failed === 'not-allowed' || failed === 'service-not-allowed') { S.sttOk = false; status('Microphone blocked — tap an answer instead', 'err'); $('vq-hint').textContent = 'Allow the microphone in your browser settings to answer by voice.'; return; }
      deliver({ type: 'silence', failed: failed || (heard ? 'unclear' : '') });
    };
    try { rec.start(); } catch (e) { S.rec = null; deliver({ type: 'silence' }); }
  }

  function renderQuestion(q, n) {
    $('vq-count').textContent = `${n} / ${S.qs.length}`;
    $('vq-prog').style.width = `${Math.round(((n - 1) / S.qs.length) * 100)}%`;
    const show = t => esc(String(t == null ? '' : t).replace(/<[^>]*>/g, ' '));   // visible text keeps its maths; only the spoken text is simplified
    $('vq-body').innerHTML = `<div class="vq-q">${show(q.q)}</div>` +
      (q.opts || []).map((o, i) => `<button class="vq-opt" data-i="${i}"><b>${letterOf(i)}</b><span>${show(o)}</span></button>`).join('') + '<div class="vq-fb" id="vq-fb"></div>';
    try { if (window.PhqSci && window.PhqSci.render) window.PhqSci.render($('vq-body')); } catch (e) {}   // the app's own maths/chemistry renderer
    $('vq-body').querySelectorAll('.vq-opt').forEach(b => { b.onclick = () => deliver({ type: 'answer', index: +b.dataset.i, via: 'tap' }); });
    $('vq-hint').textContent = S.sttOk ? 'Say “A”, “B”, “C” or “D” · “repeat” · “skip” · “stop”' : 'Tap an answer — this browser can’t hear you, but it can read to you.';
  }
  function revealAnswer(q, chosen) {
    $('vq-body').querySelectorAll('.vq-opt').forEach(b => {
      const i = +b.dataset.i; b.disabled = true;
      if (i === q.ans) b.classList.add('ok'); else if (i === chosen) b.classList.add('no');
    });
  }
  const wait = () => new Promise(res => { S.deliver = res; });

  async function runQuiz(run) {
    while (alive(run) && S.i < S.qs.length) {
      const q = S.qs[S.i], n = S.i + 1;
      renderQuestion(q, n);
      status('Reading the question…');
      await say(buildQuestionSpeech(q, n, S.qs.length), run);
      let misses = 0, outcome = null;
      while (alive(run) && !outcome) {
        status(S.sttOk ? 'Your turn — say your answer' : 'Tap your answer');
        const pending = wait();
        if (S.sttOk) startRecognition();
        const r = await pending;
        if (!alive(run)) return;
        stopRecognition();
        if (r.type === 'answer') { outcome = { chosen: r.index, via: r.via }; S.idle = 0; }
        else if (r.type === 'command' && r.command === 'stop') { finish(true); return; }
        else if (r.type === 'command' && r.command === 'repeat') { status('Repeating…'); await say(buildQuestionSpeech(q, n, S.qs.length), run); }
        else if (r.type === 'command' && r.command === 'skip') { outcome = { chosen: null }; }
        else if (r.type === 'command' && r.command === 'resume') { /* mic tapped after a pause — just listen again */ }
        else {
          misses++;
          if (!S.sttOk) continue;
          if (misses >= 3) { await say('Let’s skip this one.', run); outcome = { chosen: null, autoSkip: true }; S.idle++; }
          else await say(r.type === 'silence' && !r.failed ? 'I didn’t hear anything. Say A, B, C or D, or say repeat.' : r.reason === 'ambiguous' ? 'I heard more than one option. Which one is it?' : 'Sorry, I didn’t catch that. Say A, B, C or D, or say repeat.', run);
        }
      }
      if (!alive(run)) return;
      const correct = outcome.chosen != null && outcome.chosen === q.ans;
      S.results.push({ q, chosen: outcome.chosen, correct, tag: q.tag || '', course: q.course, id: q.id });
      if (outcome.chosen != null) { revealAnswer(q, outcome.chosen); const fb = buildFeedback(q, outcome.chosen, S.i); $('vq-fb').textContent = fb; status(correct ? 'Correct ✓' : 'Not quite', correct ? '' : 'err'); await say(fb, run); await sleep(350); }
      else if (!outcome.autoSkip) { status('Skipped'); await sleep(250); }
      S.i++;
      // Two questions in a row that nobody answered: they've probably stepped away. Pause instead of racing through.
      if (S.idle >= 2 && S.i < S.qs.length) {
        S.paused = true; status('Paused — tap the mic when you’re back');
        const resumed = wait();
        await say('Paused. Tap the microphone when you are ready.', run);
        await resumed; S.paused = false; S.idle = 0;
        if (!alive(run)) return;
      }
    }
    if (alive(run)) finish(false);
  }

  async function finish(userEnded) {
    if (S.finished) return; S.finished = true;
    S.run++;   // cancels the quiz loop and any speech that belongs to it
    deliver({ type: 'command', command: 'noop' }); stopRecognition(); try { TTS && TTS.cancel(); } catch (e) {}
    const sum = summarize(S.results);
    if (S.results.length === 0) { close(); return; }
    $('vq-body').innerHTML = `<div class="vq-sum"><div class="big">${sum.correct} / ${sum.answered}</div><div style="font-weight:800;margin:6px 0;">${sum.pct}% correct${sum.skip ? ` · ${sum.skip} skipped` : ''}</div>
      <div style="color:var(--t3,#7a8296);font-size:13.5px;line-height:1.5;">${sum.weakTags.length ? 'Revise: ' + sum.weakTags.map(esc).join(', ') : 'Nice and steady.'}</div>
      <div class="vq-ctl" style="margin-top:20px;"><button id="vq-done">Done</button></div></div>`;
    $('vq-done').onclick = close; $('vq-prog').style.width = '100%'; $('vq-orb').style.display = 'none';
    status('Quiz complete'); $('vq-hint').textContent = '';
    S.ov.querySelectorAll('#vq-repeat,#vq-skip,#vq-end').forEach(b => { b.style.display = 'none'; });
    // Hand the results to the page (it saves the score, goal and streak). Partial quizzes count for what was answered.
    if (S.onFinish && sum.answered > 0) { try { S.onFinish({ results: S.results.map(r => ({ course: r.course, tag: r.tag, id: r.id, correct: r.correct, chosen: r.chosen })), ...sum }); } catch (e) {} }
    if (!userEnded) await say(buildSummary(sum), S.run);
  }

  function close() {
    S.open = false; S.run++; stopRecognition(); try { TTS && TTS.cancel(); } catch (e) {}
    if (S.wake) { try { S.wake.release(); } catch (e) {} S.wake = null; }
    if (S.ov) S.ov.classList.remove('on');
    document.body.style.overflow = '';
  }

  async function start(cfg) {
    cfg = cfg || {};
    const qs = (cfg.questions || []).filter(q => q && q.q && Array.isArray(q.opts) && q.opts.length >= 2 && Number.isInteger(q.ans));
    if (!qs.length) return false;
    if (!TTS && !SR) { return false; }
    build();
    Object.assign(S, { qs, i: 0, results: [], open: true, run: S.run + 1, lang: savedLang(), rec: null, deliver: null, paused: false, idle: 0, finished: false, onFinish: cfg.onFinish || null, sttOk: !!SR });
    $('vq-orb').style.display = ''; S.ov.querySelectorAll('#vq-repeat,#vq-skip,#vq-end').forEach(b => { b.style.display = ''; });
    S.ov.querySelector('.vq-title').textContent = cfg.title ? '🎧 ' + cfg.title : '🎧 Voice quiz';
    S.ov.classList.add('on'); document.body.style.overflow = 'hidden';
    try { if (navigator.wakeLock) S.wake = await navigator.wakeLock.request('screen'); } catch (e) {}   // best effort: keeps the screen awake
    const run = S.run;
    if (!TTS) { status('This browser can’t read aloud — tap your answers'); }
    runQuiz(run);
    return true;
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.open && S.deliver && S.sttOk && !S.rec && !S.paused) startRecognition(); });
  window.PhqVoiceQuiz = { start, stop: () => finish(true), close, supported: () => !!(TTS || SR), canListen: () => !!SR, helpers };
})(typeof window !== 'undefined' ? window : globalThis);
