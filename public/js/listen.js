/* listen.js (v1.9.2) - "Listen" mode: reads a note aloud, section by section, with the phone's own voice (no AI call, no data).
   Chemistry is said properly through chem-speech.js (formulas, ions, isotopes, units). Pure helpers at the top are unit-tested;
   the player (a small bar above the bottom nav) is below. */
(function (root) {
  'use strict';
  const CS = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('./chem-speech') : root.PhqChemSpeech;

  // ── pure helpers ───────────────────────────────────────────────────────
  // Turns a note's markdown into [{title, text}] sections ready to be spoken. `speak` is voice-quiz's speakable().
  function buildSections(raw, speak, title) {
    const say = speak || (t => { let s = String(t).replace(/[*_`#>~]+/g, ' '); return CS ? CS.chemSpeak(s) : s; });
    const lines = String(raw || '').replace(/\r/g, '').split('\n'), out = [];
    let cur = { title: title || 'Introduction', body: [] };
    const flush = () => { const text = say(cur.body.join('\n').replace(/^\s*[-*•]\s+/gm, '. ').replace(/\n{2,}/g, '. ').replace(/\n/g, ' ')).replace(/(\.\s*){2,}/g, '. ').trim(); if (text) out.push({ title: cur.title, text }); };
    lines.forEach(l => {
      const h = /^#{1,4}\s+(.*)$/.exec(l);
      if (h) { flush(); cur = { title: say(h[1]).replace(/[:.]+$/, '').trim() || 'Next', body: [] }; } else cur.body.push(l);
    });
    flush();
    return out.map((s, i) => ({ title: s.title, text: (s.title && i > 0 ? s.title + '. ' : '') + s.text }));
  }
  const RATES = [0.8, 0.9, 1, 1.15, 1.3];
  const api = { buildSections, RATES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window === 'undefined') return;

  // ── player ─────────────────────────────────────────────────────────────
  const TTS = ('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) ? window.speechSynthesis : null;
  const S = { sections: [], sec: 0, chunk: 0, chunks: [], playing: false, token: 0, title: '', rate: 1, voices: [] };
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  S.rate = +store.get('phq-listen-rate') || 1;
  const $ = id => document.getElementById(id);

  function loadVoices() { try { S.voices = TTS.getVoices() || []; } catch (e) {} }
  if (TTS) { loadVoices(); try { TTS.addEventListener('voiceschanged', loadVoices); } catch (e) {} }
  const chunker = () => (root.PhqVoiceQuiz && root.PhqVoiceQuiz.helpers && root.PhqVoiceQuiz.helpers.chunkSpeech) || (t => String(t).match(/[^.!?]+[.!?]*\s*/g) || [String(t)]);
  const speakFn = () => root.PhqVoiceQuiz && root.PhqVoiceQuiz.helpers && root.PhqVoiceQuiz.helpers.speakable;

  function prepSection() { S.chunks = chunker()(S.sections[S.sec].text, 180); S.chunk = 0; }
  function paint() {
    const bar = $('phq-listen'); if (!bar) return;
    $('lsn-title').textContent = S.title;
    $('lsn-sec').textContent = S.sections.length ? `${S.sec + 1}/${S.sections.length} · ${S.sections[S.sec].title.slice(0, 34)}` : '';
    $('lsn-play').textContent = S.playing ? '⏸' : '▶';
    $('lsn-rate').textContent = S.rate + '×';
  }
  function speakNext(token) {
    if (token !== S.token || !S.playing) return;
    if (S.chunk >= S.chunks.length) {
      if (S.sec + 1 >= S.sections.length) { S.playing = false; S.sec = 0; prepSection(); paint(); return; }
      S.sec++; prepSection(); paint();
    }
    const u = new SpeechSynthesisUtterance(S.chunks[S.chunk++]);
    const v = CS && CS.pickVoice ? CS.pickVoice(S.voices, 'en-GB', store.get('phq-voice') || '') : null;
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-GB';
    u.rate = S.rate; let done = false;
    const go = () => { if (done) return; done = true; clearTimeout(guard); speakNext(token); };
    const guard = setTimeout(go, Math.max(4000, u.text.length * 120 / S.rate));   // some phones never fire onend
    u.onend = go; u.onerror = go;
    try { TTS.speak(u); } catch (e) { go(); }
  }
  function play() { if (!TTS || !S.sections.length) return; S.playing = true; S.token++; try { TTS.cancel(); } catch (e) {} paint(); speakNext(S.token); }
  function pause() { S.playing = false; S.token++; try { TTS.cancel(); } catch (e) {} if (S.chunk > 0) S.chunk--; paint(); }   // re-reads the sentence it stopped in
  function jump(d) { const n = Math.max(0, Math.min(S.sections.length - 1, S.sec + d)); const was = S.playing; S.token++; try { TTS.cancel(); } catch (e) {} S.sec = n; prepSection(); S.playing = was; paint(); if (was) speakNext(S.token); }
  function setRate() { const i = RATES.indexOf(S.rate); S.rate = RATES[(i + 1) % RATES.length]; store.set('phq-listen-rate', S.rate); paint(); if (S.playing) { pause(); play(); } }
  function setVoice() {
    const en = S.voices.filter(v => /^en/i.test(v.lang)); if (!en.length) return window.toast && window.toast('No English voices on this phone');
    const cur = store.get('phq-voice') || (CS.pickVoice(S.voices, 'en-GB', '') || {}).name, i = en.findIndex(v => v.name === cur), nx = en[(i + 1) % en.length];
    store.set('phq-voice', nx.name); window.toast && window.toast('Voice: ' + nx.name); if (S.playing) { pause(); play(); }
  }
  function close() { S.playing = false; S.token++; try { TTS && TTS.cancel(); } catch (e) {} const b = $('phq-listen'); if (b) b.remove(); }
  function ensureBar() {
    if ($('phq-listen')) return;
    const bar = document.createElement('div'); bar.id = 'phq-listen';
    bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(var(--nav-space,96px) + 8px);z-index:950;max-width:520px;margin:0 auto;padding:10px 12px;border-radius:16px;background:var(--bg);box-shadow:var(--sh-lg);font-family:var(--ff-b);color:var(--t1);';
    const btn = (id, label, fn, big) => `<button id="${id}" style="border:none;cursor:pointer;min-width:${big ? 46 : 38}px;height:38px;border-radius:12px;background:var(--bg);box-shadow:var(--sh-sm);font-size:${big ? 17 : 13}px;font-weight:800;color:var(--brand);font-family:inherit;">${label}</button>`;
    bar.innerHTML = `<div style="display:flex;align-items:center;gap:8px;"><div style="flex:1;min-width:0;"><div id="lsn-title" style="font-weight:800;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div><div id="lsn-sec" style="font-size:11.5px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div></div>${btn('lsn-prev', '⏮')}${btn('lsn-play', '▶', 0, 1)}${btn('lsn-next', '⏭')}${btn('lsn-rate', '1×')}${btn('lsn-voice', '🗣')}${btn('lsn-x', '✕')}</div>`;
    document.body.appendChild(bar);
    $('lsn-play').onclick = () => (S.playing ? pause() : play()); $('lsn-prev').onclick = () => jump(-1); $('lsn-next').onclick = () => jump(1);
    $('lsn-rate').onclick = setRate; $('lsn-voice').onclick = setVoice; $('lsn-x').onclick = close;
  }
  function start(title, raw) {
    if (!TTS) { window.toast && window.toast('This phone cannot read aloud'); return false; }
    close(); loadVoices();
    S.sections = buildSections(raw, speakFn(), title); S.title = title || 'Notes'; S.sec = 0;
    if (!S.sections.length) { window.toast && window.toast('Nothing to read here'); return false; }
    prepSection(); ensureBar(); play(); return true;
  }
  root.PhqListen = { start, close, available: () => !!TTS };
})(typeof window !== 'undefined' ? window : globalThis);
