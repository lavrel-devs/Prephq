/**
 * Wreddi Brainiac — v1.8.3
 * The floating study companion. One script, no assets: the mascot is inline SVG, sounds are tiny WebAudio blips.
 * Talks to /api/brainiac/*. The page (dashboard.html) feeds it events and tells it what screen/question is showing
 * through window.PhqBrainiacHost; this file never reaches into the quiz code itself.
 *
 *   PhqBrainiacHost = { context(), hide(), weak(), drill(w), home(), assistant() }   (all optional)
 *   events:  phq:answer {correct}   phq:results {pct,correct,total,guessedRight}   phq:goal {done,before,target}   phq:screen {id}
 */
(function (global) {
  'use strict';
  if (global.PhqBrainiac) return;

  const POS_KEY = 'phq_bn_pos', SIZE = 64, EDGE = 10;
  const host = () => global.PhqBrainiacHost || {};
  let state = null, root, fab, sayEl, sheet, msgsEl, inputEl, chipsEl, panelEl, setEl;
  let open = false, busy = false, mood = 'happy', side = 'right', yRatio = null, sayTimer = null, moodTimer = null;
  let correctRun = 0, wrongRun = 0, booted = false, lastScreen = '', lastNudge = null, pulseAt = 0, audioCtx = null;

  // ── Mascot ─────────────────────────────────────────────────────────────────────
  // Each mood shows a set of parts (eyes, mouth, extras); CSS does the showing and the animating.
  const MOODS = {
    happy:     ['e-open', 'm-smile'],
    proud:     ['e-happy', 'm-smile', 'x-spark'],
    celebrate: ['e-happy', 'm-big', 'x-spark'],
    thinking:  ['e-open', 'm-flat', 'x-q', 'look'],
    worried:   ['e-open', 'm-worry', 'x-sweat'],
    sleepy:    ['e-closed', 'm-o', 'x-zzz'],
  };
  let gid = 0;
  function mascot(initial) {
    const g = 'bnG' + (++gid);
    return `<svg class="bn-m" data-mood="${initial || 'happy'}" viewBox="0 0 100 100" aria-hidden="true">
<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5D7FB0"/><stop offset="1" stop-color="#3E5C8A"/></linearGradient></defs>
<ellipse class="bn-shadow" cx="50" cy="94" rx="26" ry="4" fill="#1d2140" opacity=".14"/>
<g class="bn-wrap">
 <path d="M50 11C34 5 14 15 14 35C6 39 6 58 16 63C16 78 32 88 46 84L46 88L54 88L54 84C68 88 84 78 84 63C94 58 94 39 86 35C86 15 66 5 50 11Z" fill="url(#${g})"/>
 <ellipse cx="35" cy="25" rx="14" ry="6.5" fill="#fff" opacity=".22" transform="rotate(-18 35 25)"/>
 <g fill="none" stroke="#fff" stroke-opacity=".38" stroke-width="2.4" stroke-linecap="round"><path d="M50 14V30"/><path d="M28 32q8-6 15 2"/><path d="M72 32q-8-6-15 2"/><path d="M22 50q6-5 11 1"/><path d="M78 50q-6-5-11 1"/></g>
 <circle cx="26" cy="67" r="5" fill="#FF8FB1" opacity=".55"/><circle cx="74" cy="67" r="5" fill="#FF8FB1" opacity=".55"/>
 <g class="p e-open bn-blink"><circle cx="37" cy="56" r="9" fill="#fff"/><circle cx="63" cy="56" r="9" fill="#fff"/>
  <g class="bn-pupils"><circle cx="38" cy="57" r="4.6" fill="#1E1B4B"/><circle cx="64" cy="57" r="4.6" fill="#1E1B4B"/><circle cx="39.6" cy="55.2" r="1.5" fill="#fff"/><circle cx="65.6" cy="55.2" r="1.5" fill="#fff"/></g></g>
 <g class="p e-happy" fill="none" stroke="#1E1B4B" stroke-width="3.6" stroke-linecap="round"><path d="M29 58q8-10 16 0"/><path d="M55 58q8-10 16 0"/></g>
 <g class="p e-closed" fill="none" stroke="#1E1B4B" stroke-width="3.4" stroke-linecap="round"><path d="M29 57q8 7 16 0"/><path d="M55 57q8 7 16 0"/></g>
 <g class="p m-smile" fill="none" stroke="#1E1B4B" stroke-width="3.4" stroke-linecap="round"><path d="M40 71q10 9 20 0"/></g>
 <g class="p m-big"><path d="M38 68q12 19 24 0Z" fill="#7A1A4A" stroke="#1E1B4B" stroke-width="2.4" stroke-linejoin="round"/><ellipse cx="50" cy="76" rx="5.5" ry="3" fill="#FF6B8A"/></g>
 <g class="p m-flat" fill="none" stroke="#1E1B4B" stroke-width="3.4" stroke-linecap="round"><path d="M43 74h14"/></g>
 <g class="p m-worry" fill="none" stroke="#1E1B4B" stroke-width="3.4" stroke-linecap="round"><path d="M40 77q10-9 20 0"/></g>
 <g class="p m-o"><ellipse cx="50" cy="74" rx="4" ry="5" fill="#1E1B4B"/></g>
 <g class="p x-q"><path d="M62 42q9-3 12 2" fill="none" stroke="#1E1B4B" stroke-width="3" stroke-linecap="round"/><text x="80" y="26" font-size="20" font-weight="800" fill="#fff" font-family="Nunito,system-ui,sans-serif">?</text></g>
 <g class="p x-sweat"><path d="M80 36q-6 9 0 12q6-3 0-12Z" fill="#7DD3FC" stroke="#fff" stroke-width="1.2"/></g>
 <g class="p x-zzz" font-weight="800" fill="#fff" font-family="Nunito,system-ui,sans-serif"><text class="bn-z1" x="76" y="30" font-size="16">z</text><text class="bn-z2" x="86" y="18" font-size="11">z</text></g>
</g>
<g class="p x-spark" fill="#FDE68A"><path class="bn-s1" d="M14 14l2.4 5.6L22 22l-5.6 2.4L14 30l-2.4-5.6L6 22l5.6-2.4Z"/><path class="bn-s2" d="M88 8l1.8 4.2L94 14l-4.2 1.8L88 20l-1.8-4.2L82 14l4.2-1.8Z"/><path class="bn-s3" d="M92 44l1.6 3.6L97 49l-3.4 1.4L92 54l-1.6-3.6L87 49l3.4-1.4Z"/></g>
</svg>`;
  }

  const CSS = (() => {
    const show = Object.entries(MOODS).map(([m, parts]) => parts.map(p => `.bn-m[data-mood="${m}"] .${p}`).join(',') + '{display:inline}').join('\n');
    return `
.bn-root{position:fixed;z-index:9000;width:${SIZE}px;height:${SIZE}px;touch-action:none;transition:left .28s cubic-bezier(.3,1.4,.5,1),top .28s ease;font-family:var(--ff-b,'Nunito',system-ui,sans-serif)}
.bn-root.drag{transition:none}
.bn-root[hidden]{display:none}
.bn-fab{all:unset;box-sizing:border-box;width:${SIZE}px;height:${SIZE}px;border-radius:50%;cursor:grab;position:relative;display:block;-webkit-tap-highlight-color:transparent;background:var(--bg,#f1f3fa);box-shadow:var(--sh,6px 6px 14px rgba(120,130,170,.35),-6px -6px 14px rgba(255,255,255,.85));transition:transform .15s}
.bn-fab:active{cursor:grabbing;transform:scale(.94)}
.bn-fab:focus-visible{outline:3px solid #5D7FB0;outline-offset:3px}
.bn-fab .bn-m{width:100%;height:100%;display:block;overflow:visible}
.bn-dot{position:absolute;top:2px;right:2px;width:15px;height:15px;border-radius:50%;background:#FF5D73;border:2.5px solid var(--bg,#f1f3fa);transform:scale(0);transition:transform .25s cubic-bezier(.3,1.6,.5,1)}
.bn-root.has-note .bn-dot{transform:scale(1)}
.bn-m .p{display:none}
${show}
.bn-wrap{transform-origin:50% 88%;transform-box:view-box;animation:bnBob 3.4s ease-in-out infinite}
.bn-m[data-mood="celebrate"] .bn-wrap{animation:bnJump .62s ease-in-out infinite}
.bn-m[data-mood="worried"] .bn-wrap{animation:bnSway 1.6s ease-in-out infinite}
.bn-m[data-mood="sleepy"] .bn-wrap{animation:bnBreath 3.4s ease-in-out infinite}
.bn-m[data-mood="thinking"] .bn-pupils{transform:translate(2px,-3px)}
.bn-m[data-mood="worried"] .bn-pupils{transform:translate(0,1.5px) scale(.9);transform-origin:50px 57px}
.bn-blink{animation:bnBlink 4.6s infinite;transform-origin:50px 56px;transform-box:view-box}
.bn-s1{animation:bnTw 1.1s ease-in-out infinite}.bn-s2{animation:bnTw 1.1s .35s ease-in-out infinite}.bn-s3{animation:bnTw 1.1s .7s ease-in-out infinite}
.bn-z1{animation:bnZ 2.4s ease-in-out infinite}.bn-z2{animation:bnZ 2.4s .8s ease-in-out infinite}
.bn-s1,.bn-s2,.bn-s3{transform-box:fill-box;transform-origin:center}
@keyframes bnBob{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-2.5px) scale(1.015)}}
@keyframes bnJump{0%,100%{transform:translateY(0) scale(1.04,.96)}45%{transform:translateY(-9px) scale(.97,1.04)}}
@keyframes bnSway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
@keyframes bnBreath{0%,100%{transform:scale(1)}50%{transform:scale(1.04,1.03)}}
@keyframes bnBlink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.08)}}
@keyframes bnTw{0%,100%{transform:scale(.4);opacity:.4}50%{transform:scale(1.1);opacity:1}}
@keyframes bnZ{0%{transform:translateY(4px);opacity:0}30%{opacity:1}100%{transform:translateY(-6px);opacity:0}}
.bn-say{position:absolute;bottom:6px;max-width:min(250px,68vw);min-width:150px;background:var(--bg,#f1f3fa);color:var(--t1,#1d2140);border-radius:18px;padding:11px 13px 11px 14px;box-shadow:var(--sh,6px 6px 14px rgba(120,130,170,.35),-6px -6px 14px rgba(255,255,255,.85));font-size:13.5px;line-height:1.35;font-weight:700;animation:bnPop .32s cubic-bezier(.3,1.5,.5,1);cursor:pointer}
.bn-say[hidden]{display:none}
.bn-root[data-side="right"] .bn-say{right:${SIZE + 10}px;transform-origin:100% 100%}
.bn-root[data-side="left"] .bn-say{left:${SIZE + 10}px;transform-origin:0 100%}
.bn-say-x{all:unset;position:absolute;top:-8px;right:-4px;width:22px;height:22px;border-radius:50%;text-align:center;line-height:22px;font-size:14px;color:var(--t3,#7b82a6);background:var(--bg,#f1f3fa);box-shadow:var(--sh-sm,3px 3px 7px rgba(120,130,170,.3),-3px -3px 7px rgba(255,255,255,.8));cursor:pointer}
.bn-say-cta{all:unset;display:inline-block;margin-top:8px;padding:6px 13px;border-radius:999px;font-size:12.5px;font-weight:800;color:#fff;cursor:pointer;background:linear-gradient(135deg,#5D7FB0,#3E5C8A);box-shadow:0 3px 0 rgba(40,60,95,.35)}
.bn-say-cta:active{transform:translateY(2px);box-shadow:none}
@keyframes bnPop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
.bn-conf{position:fixed;z-index:9100;width:9px;height:13px;border-radius:2px;pointer-events:none;animation:bnConf 1.15s cubic-bezier(.2,.7,.4,1) forwards}
@keyframes bnConf{0%{transform:translate(0,0) rotate(0);opacity:1}100%{transform:translate(var(--dx),var(--dy)) rotate(var(--r));opacity:0}}
.bn-sheet{position:fixed;inset:0;z-index:9200;display:flex;align-items:flex-end;justify-content:center}
.bn-sheet[hidden]{display:none}
.bn-back{position:absolute;inset:0;background:rgba(24,20,60,.32);animation:bnFade .2s}
.bn-panel{position:relative;width:100%;max-width:520px;height:min(80vh,640px);display:flex;flex-direction:column;background:var(--bg,#f1f3fa);color:var(--t1,#1d2140);border-radius:26px 26px 0 0;box-shadow:0 -10px 40px rgba(24,20,60,.25);animation:bnUp .3s cubic-bezier(.2,.9,.3,1);padding-bottom:env(safe-area-inset-bottom,0)}
@keyframes bnUp{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}@keyframes bnFade{from{opacity:0}to{opacity:1}}
.bn-grab{width:42px;height:5px;border-radius:9px;background:var(--t3,#9aa1c2);opacity:.45;margin:9px auto 0}
.bn-head{display:flex;align-items:center;gap:10px;padding:8px 14px 10px}
.bn-head .bn-m{width:46px;height:46px;flex-shrink:0}
.bn-title{font-family:var(--ff-h,inherit);font-weight:800;font-size:17px;letter-spacing:-.3px;line-height:1.1}
.bn-sub{font-size:12px;color:var(--t3,#7b82a6);font-weight:600}
.bn-hbtn{all:unset;margin-left:auto;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;cursor:pointer;color:var(--t2,#4a5078);background:var(--bg,#f1f3fa);box-shadow:var(--sh-sm,3px 3px 7px rgba(120,130,170,.3),-3px -3px 7px rgba(255,255,255,.8));font-size:15px}
.bn-hbtn+.bn-hbtn{margin-left:2px}
.bn-msgs{flex:1;overflow-y:auto;padding:6px 14px 10px;display:flex;flex-direction:column;gap:9px;-webkit-overflow-scrolling:touch}
.bn-msg{max-width:86%;padding:10px 13px;border-radius:18px;font-size:14.5px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;animation:bnPop .25s}
.bn-msg.b{align-self:flex-start;border-bottom-left-radius:6px;background:var(--bg,#f1f3fa);box-shadow:var(--sh-sm,3px 3px 7px rgba(120,130,170,.3),-3px -3px 7px rgba(255,255,255,.8))}
.bn-msg.u{align-self:flex-end;border-bottom-right-radius:6px;color:#fff;background:linear-gradient(135deg,#5D7FB0,#3E5C8A)}
.bn-msg.err{color:#b4233a}
.bn-typing span{display:inline-block;width:7px;height:7px;margin:0 2px;border-radius:50%;background:var(--t3,#9aa1c2);animation:bnDot 1s infinite}.bn-typing span:nth-child(2){animation-delay:.15s}.bn-typing span:nth-child(3){animation-delay:.3s}
@keyframes bnDot{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-5px);opacity:1}}
.bn-chips{display:flex;gap:8px;overflow-x:auto;padding:2px 14px 8px;scrollbar-width:none}.bn-chips::-webkit-scrollbar{display:none}
.bn-chip{all:unset;flex-shrink:0;padding:8px 14px;border-radius:999px;font-size:13px;font-weight:800;color:var(--brand,#5b3df5);cursor:pointer;background:var(--bg,#f1f3fa);box-shadow:var(--sh-sm,3px 3px 7px rgba(120,130,170,.3),-3px -3px 7px rgba(255,255,255,.8));white-space:nowrap}
.bn-chip:active{box-shadow:var(--sh-in-sm,inset 2px 2px 5px rgba(120,130,170,.35),inset -2px -2px 5px rgba(255,255,255,.8))}
.bn-chip.go{color:#fff;background:linear-gradient(135deg,#5D7FB0,#3E5C8A);box-shadow:0 3px 0 rgba(40,60,95,.35)}
.bn-in{display:flex;gap:9px;padding:4px 14px 12px}
.bn-in input{flex:1;min-width:0;border:none;outline:none;border-radius:999px;padding:12px 16px;font:inherit;font-size:14.5px;color:var(--t1,#1d2140);background:var(--bg,#f1f3fa);box-shadow:var(--sh-in-sm,inset 2px 2px 5px rgba(120,130,170,.35),inset -2px -2px 5px rgba(255,255,255,.8))}
.bn-send{all:unset;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;cursor:pointer;color:#fff;background:linear-gradient(135deg,#5D7FB0,#3E5C8A);box-shadow:0 3px 0 rgba(40,60,95,.35);flex-shrink:0}
.bn-send:disabled{opacity:.5;cursor:default}
.bn-set{position:absolute;inset:0;background:var(--bg,#f1f3fa);border-radius:26px 26px 0 0;display:flex;flex-direction:column;padding:14px;gap:10px;overflow-y:auto;animation:bnFade .18s}
.bn-set[hidden]{display:none}
.bn-row{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:16px;background:var(--bg,#f1f3fa);box-shadow:var(--sh-sm,3px 3px 7px rgba(120,130,170,.3),-3px -3px 7px rgba(255,255,255,.8))}
.bn-row b{display:block;font-size:14px}.bn-row small{display:block;font-size:12px;color:var(--t3,#7b82a6);margin-top:1px}
.bn-sw{all:unset;margin-left:auto;flex-shrink:0;width:46px;height:27px;border-radius:99px;cursor:pointer;position:relative;background:var(--bg,#f1f3fa);box-shadow:var(--sh-in-sm,inset 2px 2px 5px rgba(120,130,170,.35),inset -2px -2px 5px rgba(255,255,255,.8))}
.bn-sw::after{content:'';position:absolute;top:3px;left:3px;width:21px;height:21px;border-radius:50%;background:#aab0cc;transition:all .2s}
.bn-sw[aria-checked="true"]::after{left:22px;background:linear-gradient(135deg,#5D7FB0,#3E5C8A)}
.bn-h2{font-weight:800;font-size:13px;color:var(--t3,#7b82a6);text-transform:uppercase;letter-spacing:.05em;margin:6px 2px 0}
.bn-fact{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;font-size:13.5px;background:var(--bg,#f1f3fa);box-shadow:var(--sh-in-sm,inset 2px 2px 5px rgba(120,130,170,.35),inset -2px -2px 5px rgba(255,255,255,.8))}
.bn-fact button{all:unset;margin-left:auto;cursor:pointer;color:var(--t3,#7b82a6);padding:2px 6px;font-size:16px}
.bn-link{all:unset;cursor:pointer;font-size:13px;font-weight:800;color:#b4233a;text-align:center;padding:8px}
.bn-empty{font-size:13px;color:var(--t3,#7b82a6);padding:2px 4px}
body.quiz-active .bn-root{z-index:30}
@media (min-width:900px){
.bn-sheet{align-items:flex-end;justify-content:flex-end;padding:0 24px 24px}
.bn-back{background:transparent}
.bn-panel{max-width:420px;height:min(72vh,640px);border-radius:26px;box-shadow:0 18px 60px rgba(24,20,60,.28),0 2px 10px rgba(24,20,60,.12)}
.bn-set{border-radius:26px}
}
@media (max-height:520px) and (orientation:landscape){.bn-panel{height:92vh}.bn-head .bn-m{width:34px;height:34px}}
@media (prefers-reduced-motion:reduce){.bn-wrap,.bn-blink,.bn-s1,.bn-s2,.bn-s3,.bn-z1,.bn-z2,.bn-say,.bn-panel,.bn-msg{animation:none!important}.bn-root{transition:none}}
`;
  })();

  // ── Little helpers ────────────────────────────────────────────────────────────────
  const $ = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; };
  const lsGet = () => { try { return JSON.parse(localStorage.getItem(POS_KEY)) || {}; } catch (e) { return {}; } };
  const lsSet = (o) => { try { localStorage.setItem(POS_KEY, JSON.stringify(o)); } catch (e) {} };
  async function api(url, method, body) {
    const r = await global.PhqAuth.authFetch(url, { method: method || 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }, 'student');
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || 'Something went wrong'); e.code = d.code; e.status = r.status; throw e; }
    return d;
  }
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  function setMood(m, forMs) {
    mood = MOODS[m] ? m : 'happy';
    document.querySelectorAll('.bn-m').forEach(el => el.setAttribute('data-mood', mood));
    clearTimeout(moodTimer);
    if (forMs) moodTimer = setTimeout(() => setMood('happy'), forMs);
  }

  // Sound: three tiny synthesized blips, quiet, only when the student's sound switch is on. Haptics ride along.
  function blip(kind) {
    if (navigator.vibrate) try { navigator.vibrate(kind === 'win' ? [12, 40, 18] : 8); } catch (e) {}
    if (!state || !state.sound) return;
    try {
      audioCtx = audioCtx || new (global.AudioContext || global.webkitAudioContext)();
      const notes = { ok: [660, 880], win: [523, 659, 784, 1046], pop: [740], oops: [330, 262] }[kind] || [660];
      notes.forEach((f, i) => {
        const t = audioCtx.currentTime + i * 0.09, o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = kind === 'oops' ? 'triangle' : 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + 0.2);
      });
    } catch (e) {}
  }

  function confetti(n) {
    if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = fab.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const cols = ['#5D7FB0', '#3E5C8A', '#FDE68A', '#A9BEDD', '#34D399', '#7F9BC2'];
    for (let i = 0; i < (n || 26); i++) {
      const el = document.createElement('i'); el.className = 'bn-conf';
      const a = Math.random() * Math.PI * 2, d = 70 + Math.random() * 130;
      el.style.cssText = `left:${cx}px;top:${cy}px;background:${pick(cols)};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 40}px;--r:${Math.random() * 720 - 360}deg`;
      document.body.appendChild(el); setTimeout(() => el.remove(), 1300);
    }
  }

  // ── Position: drag anywhere, snaps to the nearest side edge, remembered ───────────
  function place(animate) {
    const vw = global.innerWidth, vh = global.innerHeight;
    if (yRatio == null) yRatio = (vh - SIZE - 104) / vh;
    const y = Math.max(64, Math.min(vh - SIZE - 84, Math.round(yRatio * vh)));
    root.classList.toggle('drag', !animate);
    root.style.left = (side === 'right' ? vw - SIZE - EDGE : EDGE) + 'px';
    root.style.top = y + 'px';
    root.setAttribute('data-side', side);
  }
  function wireDrag() {
    let sx = 0, sy = 0, ox = 0, oy = 0, moved = false, on = false;
    fab.addEventListener('pointerdown', e => {
      on = true; moved = false; sx = e.clientX; sy = e.clientY;
      const r = root.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top;
      try { fab.setPointerCapture(e.pointerId); } catch (x) {}
    });
    fab.addEventListener('pointermove', e => {
      if (!on) return;
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) > 7) { moved = true; root.classList.add('drag'); hideSay(); }
      if (moved) { root.style.left = (e.clientX - ox) + 'px'; root.style.top = (e.clientY - oy) + 'px'; }
    });
    const end = () => {
      if (!on) return; on = false;
      if (!moved) { open ? closeSheet() : openSheet(); return; }
      const r = root.getBoundingClientRect();
      side = r.left + r.width / 2 < global.innerWidth / 2 ? 'left' : 'right';
      yRatio = r.top / global.innerHeight; lsSet({ side, yRatio });
      place(true);
    };
    fab.addEventListener('pointerup', end); fab.addEventListener('pointercancel', end);
    fab.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open ? closeSheet() : openSheet(); } });
  }

  // ── Speech bubble (Brainiac speaking first) ───────────────────────────────────────
  function say(text, o) {
    o = o || {};
    if (!state || !state.enabled || open) return;
    if (host().hide && host().hide()) return;
    sayEl.querySelector('.bn-say-t').textContent = text;
    const cta = sayEl.querySelector('.bn-say-cta');
    cta.hidden = !o.cta; cta.textContent = o.cta ? o.cta.label : '';
    sayEl._cta = o.cta || null;
    sayEl.hidden = false; root.classList.add('has-note');
    if (o.mood) setMood(o.mood, o.moodFor || 0);
    if (o.sound) blip(o.sound);
    clearTimeout(sayTimer); sayTimer = setTimeout(hideSay, o.ms || 8000);
  }
  function hideSay() { sayEl.hidden = true; clearTimeout(sayTimer); }

  // What happens when a nudge's button is tapped. Instant, free: none of these call the AI.
  function runAction(c) {
    if (!c) return openSheet();
    const h = host();
    if (c.action === 'drill' && h.drill) { closeSheet(); return h.drill({ course: c.course, tag: c.tag }); }
    if (c.action === 'home' && h.home) { closeSheet(); return h.home(); }
    if (c.action === 'guesses' && h.guessReview) { closeSheet(); return h.guessReview(); }
    if (c.action === 'assistant' && h.assistant) { closeSheet(); return h.assistant(); }
    openSheet();
  }

  // ── The sheet ─────────────────────────────────────────────────────────────────────
  function addMsg(role, text, cls) {
    const el = document.createElement('div');
    el.className = `bn-msg ${role === 'user' ? 'u' : 'b'}${cls ? ' ' + cls : ''}`;
    el.textContent = (role !== 'user' && global.PhqMd) ? global.PhqMd.strip(text) : text;
    msgsEl.appendChild(el); msgsEl.scrollTop = msgsEl.scrollHeight;
    if (role !== 'user' && global.PhqSci && typeof global.PhqSci.render === 'function') { try { global.PhqSci.render(el); } catch (e) {} }
    return el;
  }
  function greeting() {
    const name = (state && state.name) || 'friend', h = new Date(Date.now() + 36e5).getUTCHours();
    const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    return lastNudge ? lastNudge.text : `${part}, ${name}! What are we working on today?`;
  }
  function renderChips() {
    chipsEl.innerHTML = '';
    const h = host(), ctx = h.context ? h.context() : null, weak = h.weak ? h.weak() : null, chips = [];
    if (ctx && ctx.question) {
      chips.push({ t: 'Explain this', send: 'Explain this question to me step by step.' });
      chips.push({ t: 'Memory trick', send: 'Give me a memory trick for this.' });
    }
    if (weak && h.drill) chips.push({ t: `Drill ${weak.tag}`, go: true, run: () => { closeSheet(); h.drill(weak); } });
    if (h.assistant) chips.push({ t: 'Study Assistant', run: () => { closeSheet(); h.assistant(); } });
    chips.push({ t: "I'm stressed", send: "I'm stressed about my exams." }, { t: 'Plan my week', send: 'Help me plan my study week.' }, { t: 'Motivate me', send: 'I need some motivation to study.' });
    chips.forEach(c => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'bn-chip' + (c.go ? ' go' : ''); b.textContent = c.t;
      b.onclick = () => (c.run ? c.run() : send(c.send)); chipsEl.appendChild(b);
    });
  }
  function openSheet() {
    if (!state || !state.enabled) return;
    open = true; hideSay(); root.classList.remove('has-note'); sheet.hidden = false; setEl.hidden = true;
    if (!msgsEl.children.length) {
      (state.recent || []).forEach(m => addMsg(m.role === 'user' ? 'user' : 'bot', m.content));
      addMsg('bot', greeting());
    } else if (lastNudge) { addMsg('bot', lastNudge.text); }
    lastNudge = null; renderChips(); setMood('happy'); blip('pop');
    setTimeout(() => { try { inputEl.focus({ preventScroll: true }); } catch (e) {} }, 320);
  }
  function closeSheet() { open = false; sheet.hidden = true; }
  async function send(text) {
    text = String(text || inputEl.value || '').trim();
    if (!text || busy) return;
    busy = true; inputEl.value = ''; addMsg('user', text);
    const typing = addMsg('bot', '', 'bn-typing'); typing.innerHTML = '<span></span><span></span><span></span>';
    setMood('thinking');
    const h = host();
    try {
      const d = await api('/api/brainiac/chat', 'POST', { message: text, context: h.context ? h.context() : undefined });
      typing.remove(); typing.className = ''; const el = addMsg('bot', d.reply);
      setMood(d.mood || 'happy', 6000);
      if (d.dailyRemaining === 0) addMsg('bot', "That's my last chat for today. I'm still here for nudges and quick drills!");
      if (d.mood === 'celebrate') { confetti(18); blip('win'); } else blip('ok');
    } catch (e) {
      typing.remove();
      addMsg('bot', e.code === 'LIMIT_REACHED' ? "You've used today's chat allowance. I'm still here for quick drills and nudges, and I'll be fully back tomorrow!" : (e.message || "I couldn't answer that. Try again?"), 'err');
      setMood('worried', 3500);
    }
    busy = false;
  }

  // ── Settings + "what Brainiac knows" ──────────────────────────────────────────────
  const SW = [['enabled', 'Show Brainiac', 'The floating buddy on every screen'], ['nudges', 'Let Brainiac speak first', 'Streak reminders, comebacks, weak-topic tips'], ['sound', 'Sound & vibration', 'Soft pops and cheers'], ['learn', 'Remember things about me', 'So it can know you better over time']];
  function renderSettings() {
    setEl.innerHTML = '';
    const top = $(`<div class="bn-head" style="padding:0 0 4px"><div><div class="bn-title">Brainiac settings</div><div class="bn-sub">You're in control of all of this</div></div><button class="bn-hbtn" data-back aria-label="Back">✕</button></div>`);
    top.querySelector('[data-back]').onclick = () => { setEl.hidden = true; if (!state.enabled) closeSheet(); };
    setEl.appendChild(top);
    SW.forEach(([k, t, s]) => {
      const row = $(`<div class="bn-row"><div><b>${t}</b><small>${s}</small></div><button class="bn-sw" role="switch" aria-checked="${!!state[k]}" aria-label="${t}"></button></div>`);
      row.querySelector('.bn-sw').onclick = async (ev) => {
        const next = !state[k]; ev.currentTarget.setAttribute('aria-checked', String(next));
        try { state = Object.assign(state, await api('/api/brainiac/settings', 'PUT', { [k]: next })); applyEnabled(); } catch (e) { ev.currentTarget.setAttribute('aria-checked', String(!next)); }
      };
      setEl.appendChild(row);
    });
    setEl.appendChild($('<div class="bn-h2">What I remember about you</div>'));
    if (!state.facts.length) setEl.appendChild($('<div class="bn-empty">Nothing yet. As we chat, I\'ll note useful things (like how you like to study). You can remove any of it.</div>'));
    state.facts.forEach(f => {
      const row = $(`<div class="bn-fact"><span></span><button aria-label="Forget this">✕</button></div>`);
      row.querySelector('span').textContent = f.text;
      row.querySelector('button').onclick = async () => { try { await api('/api/brainiac/memory/' + f.id, 'DELETE'); state.facts = state.facts.filter(x => x.id !== f.id); renderSettings(); } catch (e) {} };
      setEl.appendChild(row);
    });
    const wipe = $('<button class="bn-link">Forget everything (notes + our chat)</button>');
    wipe.onclick = async () => { if (!global.confirm('Brainiac will forget what it noted about you and clear your chat. Continue?')) return; try { await api('/api/brainiac/memory', 'DELETE'); state.facts = []; state.recent = []; msgsEl.innerHTML = ''; renderSettings(); } catch (e) {} };
    setEl.appendChild(wipe);
  }
  function applyEnabled() { root.hidden = !state.enabled; if (!state.enabled) { hideSay(); } }
  function openSettings() { if (!state) return; sheet.hidden = false; open = true; setEl.hidden = false; renderSettings(); }

  // ── Reactions to what the student is doing (all client-side: free, instant) ───────
  const CHEER = ['Nice one!', "That's it!", 'Correct!', "You're on it!", 'Sharp!'];
  function onAnswer(correct) {
    if (!state || !state.enabled) return;
    if (correct) {
      correctRun++; wrongRun = 0; setMood('happy', 900); blip('ok');
      if ([3, 5, 7, 10, 15].includes(correctRun)) { say(`${correctRun} in a row! 🔥`, { mood: 'celebrate', moodFor: 1800, sound: 'win', ms: 2600 }); confetti(correctRun >= 7 ? 30 : 16); }
      else if (correctRun === 1 && Math.random() < .35) say(pick(CHEER), { ms: 1600 });
    } else {
      wrongRun++; const had = correctRun; correctRun = 0; setMood('worried', 1400); blip('oops');
      if (had >= 3) say(`Streak over at ${had}, but that's okay. Check the explanation and go again.`, { ms: 3600 });
      else if (wrongRun === 2) say("Tricky ones. Read the explanation — it'll stick.", { ms: 3400 });
    }
  }
  function onResults(d) {
    if (!state || !state.enabled) return;
    correctRun = 0; wrongRun = 0;
    const pct = d && d.pct != null ? d.pct : 0;
    if (d && d.guessedRight >= 2) { say(`${d.guessedRight} of your correct answers were guesses. Honest marking, well done! Want to turn them into real knowledge?`, { mood: 'thinking', moodFor: 4000, sound: 'ok', ms: 8000, cta: { label: 'Review guesses', action: 'guesses' } }); setTimeout(() => pulse(true), 4000); return; }
    if (pct >= 80) { say(`${pct}%! You crushed that. 🎉`, { mood: 'celebrate', moodFor: 4000, sound: 'win', ms: 6000 }); confetti(34); }
    else if (pct >= 50) say(`${pct}%. Solid work. Review what you missed and the next one will be better.`, { mood: 'proud', moodFor: 3500, sound: 'ok', ms: 6000 });
    else say(`${pct}% this time. That's how you find what to fix. Want to go over the misses?`, { mood: 'happy', ms: 7000, cta: { label: 'Let\'s review', action: 'open' } });
    setTimeout(() => pulse(true), 4000);   // a streak milestone may have just landed
  }

  // Daily goal (the ring on the home screen). Celebrates the moment it's crossed — once a day — and says
  // "nearly there" when only a few questions remain. Overrides the quiz-score bubble because it's more useful.
  function onGoal(d) {
    if (!state || !state.enabled || !d) return;
    const day = new Date(Date.now() + 36e5).toISOString().slice(0, 10), left = d.target - d.done;
    let seen = ''; try { seen = localStorage.getItem('phq_bn_goal_day') || ''; } catch (e) {}
    if (d.before < d.target && d.done >= d.target && seen !== day) {
      try { localStorage.setItem('phq_bn_goal_day', day); } catch (e) {}
      say(`Daily goal smashed! ${d.done} questions today. 🎯`, { mood: 'celebrate', moodFor: 5000, sound: 'win', ms: 7000 }); confetti(40);
    } else if (left > 0 && left <= 5 && d.done > 0) {
      say(`${left} more question${left === 1 ? '' : 's'} and you hit today's goal!`, { mood: 'happy', ms: 7000, cta: { label: 'Finish it', action: 'home' } });
    }
  }

  // ── Pulse: Brainiac speaks first (rule-based on the server, never uses AI) ────────
  async function pulse(afterQuiz) {
    if (!state || !state.enabled || !state.nudges || Date.now() - pulseAt < (afterQuiz ? 5000 : 20 * 60 * 1000)) return;
    pulseAt = Date.now();
    try {
      const { nudges } = await api('/api/brainiac/pulse');
      if (!nudges || !nudges.length) return;
      const n = nudges[0]; lastNudge = n;
      say(n.text, { mood: n.mood, moodFor: n.mood === 'celebrate' ? 5000 : 0, cta: n.cta, sound: n.mood === 'celebrate' ? 'win' : 'pop', ms: 9000 });
      if (n.mood === 'celebrate') confetti(26);
    } catch (e) { /* a nudge failing should never bother anyone */ }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────────────
  function build() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    root = $(`<div class="bn-root" data-side="right" hidden>
      <div class="bn-say" hidden role="status"><button class="bn-say-x" aria-label="Dismiss">×</button><div class="bn-say-t"></div><button class="bn-say-cta"></button></div>
      <button class="bn-fab" aria-label="Open Brainiac, your study buddy">${mascot('happy')}<span class="bn-dot"></span></button></div>`);
    fab = root.querySelector('.bn-fab'); sayEl = root.querySelector('.bn-say');
    sayEl.querySelector('.bn-say-x').onclick = (e) => { e.stopPropagation(); hideSay(); root.classList.remove('has-note'); };
    sayEl.onclick = (e) => { if (e.target.closest('.bn-say-x')) return; const c = sayEl._cta; hideSay(); runAction(c); };
    sheet = $(`<div class="bn-sheet" hidden><div class="bn-back"></div><div class="bn-panel" role="dialog" aria-label="Brainiac">
      <div class="bn-grab"></div>
      <div class="bn-head">${mascot('happy')}<div><div class="bn-title">Brainiac</div><div class="bn-sub">Your study buddy</div></div>
        <button class="bn-hbtn" data-gear aria-label="Brainiac settings">⚙</button><button class="bn-hbtn" data-close aria-label="Close">✕</button></div>
      <div class="bn-msgs" aria-live="polite"></div><div class="bn-chips"></div>
      <form class="bn-in" autocomplete="off"><input type="text" maxlength="1500" placeholder="Ask me anything..." aria-label="Message Brainiac"><button class="bn-send" aria-label="Send">➤</button></form>
      <div class="bn-set" hidden></div></div></div>`);
    panelEl = sheet.querySelector('.bn-panel'); msgsEl = sheet.querySelector('.bn-msgs'); chipsEl = sheet.querySelector('.bn-chips'); inputEl = sheet.querySelector('input'); setEl = sheet.querySelector('.bn-set');
    sheet.querySelector('.bn-back').onclick = closeSheet; sheet.querySelector('[data-close]').onclick = closeSheet;
    sheet.querySelector('[data-gear]').onclick = () => { setEl.hidden = false; renderSettings(); };
    sheet.querySelector('form').onsubmit = (e) => { e.preventDefault(); send(); };
    document.body.appendChild(root); document.body.appendChild(sheet);
    wireDrag();
    global.addEventListener('resize', () => place(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) closeSheet(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pulse(); });
    global.addEventListener('phq:answer', e => onAnswer(!!(e.detail && e.detail.correct)));
    global.addEventListener('phq:results', e => onResults(e.detail));
    global.addEventListener('phq:goal', e => onGoal(e.detail));
    global.addEventListener('phq:screen', e => {
      const id = e.detail && e.detail.id; if (id === lastScreen) return; lastScreen = id;
      const hidden = host().hide && host().hide(); root.style.visibility = hidden ? 'hidden' : '';
      if (hidden) hideSay();
    });
  }

  async function start() {
    if (booted) return; booted = true;
    if (!global.PhqAuth || !global.PhqAuth.getSession || !global.PhqAuth.getSession()) { booted = false; return; }
    try { state = await api('/api/brainiac/state'); } catch (e) { booted = false; return; }
    build();
    const p = lsGet(); side = p.side === 'left' ? 'left' : 'right'; yRatio = typeof p.yRatio === 'number' ? p.yRatio : null;
    place(false); applyEnabled();
    setTimeout(() => pulse(), 2600);
  }

  global.PhqBrainiac = { start, open: openSheet, openSettings, say, setMood };
})(window);
