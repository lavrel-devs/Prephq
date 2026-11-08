'use strict';
// v1.8.3 Brainiac — the pure parts (no database, no network) so they can be tested on their own:
// which nudge to show, how to clean what the model says it learned, and how the system prompt is put together.

const { strip: stripMd } = require('../../public/js/phq-mdclean.js');

const DAY = 24 * 60 * 60 * 1000;
const MILESTONES = [3, 5, 7, 10, 14, 21, 30, 50, 75, 100, 150, 200, 365];
const MOODS = ['happy', 'proud', 'celebrate', 'thinking', 'worried', 'sleepy'];

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

function firstName(name) {
  const s = String(name || '').trim().split(/\s+/)[0];
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : 'friend';
}

// whole days between two 'YYYY-MM-DD' strings (a - b)
function dayDiff(a, b) {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY);
}

// ── Nudges: Brainiac speaking first. Rules over real study data — no AI call, so it costs nothing and is instant. ──
// snap: { name, today:'YYYY-MM-DD'(WAT), hour:0-23(WAT), streak:{count,last}, studiedToday, daysAway|null,
//         acc7, accPrev, attempts7, attemptsPrev, weak:[{course,tag,acc,n}], introduced }
// Returns nudges best-first, minus any whose id was already shown recently.
function buildPulse(snap, recentIds = []) {
  const out = [];
  const n = firstName(snap.name);
  const t = snap.today;
  const hour = snap.hour;
  const streak = snap.streak || { count: 0, last: null };
  const weak = (snap.weak || [])[0];
  const practise = weak
    ? { label: `Drill ${weak.tag}`, action: 'drill', course: weak.course, tag: weak.tag }
    : { label: "Let's practise", action: 'home' };
  const add = (id, priority, mood, text, cta) => out.push({ id, priority, mood, text, cta: cta || { label: 'Chat', action: 'open' } });

  if (!snap.introduced) {
    add('welcome', 100, 'happy', `Hey ${n}! I'm Brainiac. I'll learn how you study and help you do better. Tap me anytime.`, { label: 'Say hi', action: 'open' });
  }

  if (snap.studiedToday > 0 && streak.last === t && MILESTONES.includes(streak.count)) {
    add(`streak:${streak.count}`, 80, 'celebrate', `${streak.count}-day streak! That's a real habit now, ${n}. 🔥`, { label: 'Keep going', action: 'open' });
  }

  if (streak.count >= 2 && streak.last && dayDiff(t, streak.last) === 1 && !snap.studiedToday && hour >= 15) {
    add(`streak-risk:${t}`, 90, 'worried', `Your ${streak.count}-day streak ends tonight! Five questions keeps it alive. 🔥`,
      { ...practise, label: 'Save my streak' });
  }

  if (typeof snap.daysAway === 'number' && snap.daysAway >= 3 && !snap.studiedToday) {
    add(`back:${t}`, 70, 'happy',
      snap.daysAway >= 7
        ? `It's been a minute, ${n}! No guilt. Let's ease back in with a quick one.`
        : `Welcome back, ${n}! Let's get one good session in today.`, practise);
  }

  if (snap.attempts7 >= 15 && snap.attemptsPrev >= 10 && snap.acc7 != null && snap.accPrev != null && snap.acc7 - snap.accPrev >= 10) {
    add(`up:${t}`, 60, 'proud', `Your accuracy is up ${Math.round(snap.acc7 - snap.accPrev)} points this week. That's real progress, ${n}.`,
      { label: 'Keep it up', action: 'home' });
  }

  if (hour >= 23 || hour < 4) {
    add(`sleep:${t}`, 55, 'sleepy', `It's late, ${n}. Sleep is when your brain locks in what you studied. Pick it up tomorrow?`, { label: 'Chat', action: 'open' });
  }

  if (snap.guessN >= 3) {
    add(`guess:${t}`, 45, 'thinking', `You marked ${snap.guessN} questions as guesses. Let's turn them into real answers, ${n}.`, { label: 'Review guesses', action: 'guesses' });
  }

  if (weak && !snap.studiedToday) {
    add(`weak:${weak.course}:${weak.tag}:${t}`, 50, 'thinking',
      `${weak.tag} is giving you trouble (${Math.round(weak.acc * 100)}% lately). Ten minutes on it today could flip that.`, practise);
  }

  if (!snap.studiedToday && hour >= 5 && hour <= 21) {
    add(`daily:${t}`, 30, 'happy', `Ready for today, ${n}? Even ten questions keeps you moving.`, practise);
  }

  const seen = new Set(recentIds);
  return out.filter(x => !seen.has(x.id)).sort((a, b) => b.priority - a.priority);
}

// ── What Brainiac "learns": the model proposes, we filter. Nothing sensitive or identifying is ever kept. ──
const SENSITIVE = /(password|passcode|\bpin\b|\bbvn\b|\bnin\b|account number|card number|depress|suicid|self.?harm|anxiety|\bhiv\b|pregnan|disorder|diagnos|medication|relig|church|mosque|pastor|imam|politic|party member|\bsex|abuse|rape|tribe|ethnic)/i;

function sanitizeFacts(candidates, existing = []) {
  const have = new Set(existing.map(f => String(f).toLowerCase()));
  const out = [];
  for (const c of Array.isArray(candidates) ? candidates : []) {
    const s = clip(stripMd(c), 140);
    if (s.length < 8) continue;
    if (/\d{7,}/.test(s.replace(/[\s-]/g, ''))) continue;      // phone / ID / account-like numbers
    if (/@|https?:\/\//i.test(s)) continue;                    // emails, links
    if (SENSITIVE.test(s)) continue;
    const key = s.toLowerCase();
    if (have.has(key)) continue;
    have.add(key); out.push(s);
    if (out.length >= 3) break;
  }
  return out;
}

// Reply starts with [mood:xxx]; peel it off so the app can animate Brainiac, default to happy.
function parseMood(raw) {
  let text = String(raw || '').trim();
  let mood = 'happy';
  const m = text.match(/^\s*\[mood:\s*(\w+)\s*\]\s*/i);
  if (m) { if (MOODS.includes(m[1].toLowerCase())) mood = m[1].toLowerCase(); text = text.slice(m[0].length); }
  text = text.replace(/\[mood:\s*\w+\s*\]/gi, '').trim();
  return { mood, text };
}

// What the app tells us about the screen the student is on — size-capped, strings only.
function sanitizeContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  const out = {
    screen: clip(ctx.screen, 40),
    course: clip(ctx.course, 40),
    topic: clip(ctx.topic, 80),
    question: clip(ctx.question, 700),
    options: Array.isArray(ctx.options) ? ctx.options.slice(0, 6).map(o => clip(o, 160)) : [],
    chosen: clip(ctx.chosen, 160),
    correct: clip(ctx.correct, 160),
    wasCorrect: typeof ctx.wasCorrect === 'boolean' ? ctx.wasCorrect : null,
  };
  return out.screen || out.question ? out : null;
}

function contextText(ctx) {
  if (!ctx) return '';
  const l = [];
  if (ctx.screen) l.push(`They are on the "${ctx.screen}" screen.`);
  if (ctx.question) {
    l.push(`Question on screen${ctx.course ? ` (${ctx.course}${ctx.topic ? ', ' + ctx.topic : ''})` : ''}: ${ctx.question}`);
    if (ctx.options.length) l.push(`Options: ${ctx.options.map((o, i) => String.fromCharCode(65 + i) + ') ' + o).join(' | ')}`);
    if (ctx.wasCorrect === true) l.push(`They answered it correctly (${ctx.chosen}).`);
    if (ctx.wasCorrect === false) l.push(`They answered ${ctx.chosen || 'it'} — the right answer is ${ctx.correct || 'unknown'}.`);
  }
  return l.join('\n');
}

function buildSystemPrompt({ snap, facts = [], ctx = null, sciFormat = '' }) {
  const know = [];
  know.push(`Name: ${firstName(snap.name)}.`);
  if (snap.university || snap.department) know.push(`Studies ${snap.department || 'at'}${snap.university ? ' at ' + snap.university : ''}.`);
  if (snap.courses && snap.courses.length) know.push(`Courses this semester: ${snap.courses.slice(0, 10).join(', ')}.`);
  if (snap.gpa && (snap.gpa.current != null || snap.gpa.target != null)) know.push(`GPA now ${snap.gpa.current ?? 'unknown'}, aiming for ${snap.gpa.target ?? 'unknown'}.`);
  if (snap.streak && snap.streak.count) know.push(`Study streak: ${snap.streak.count} day(s).`);
  know.push(snap.studiedToday ? `Answered ${snap.studiedToday} questions today.` : 'Has not practised yet today.');
  if (snap.guessN) know.push(`They have admitted guessing on ${snap.guessN} bank question(s)${snap.guessTags && snap.guessTags.length ? ' (topics: ' + snap.guessTags.join(', ') + ')' : ''}. Those are the best things to learn for real.`);
  if (typeof snap.daysAway === 'number' && snap.daysAway >= 2) know.push(`Last practised ${snap.daysAway} days ago.`);
  if (snap.acc7 != null) know.push(`Accuracy over the last 7 days: ${Math.round(snap.acc7)}%${snap.accPrev != null ? ` (the week before: ${Math.round(snap.accPrev)}%)` : ''}.`);
  if (snap.weak && snap.weak.length) know.push(`Weak topics: ${snap.weak.map(w => `${w.tag} in ${w.course} (${Math.round(w.acc * 100)}%)`).join('; ')}.`);
  if (facts.length) know.push(`Things they have told you before: ${facts.join('; ')}.`);
  know.push(`Local time for them: ${snap.hour}:00 (Nigeria).`);

  return `You are Brainiac, the friendly study companion living inside Wreddi, an exam-prep app for Nigerian university students. You are an AI companion, and you are warm, upbeat and genuinely on the student's side.

PERSONALITY
- Talk like a smart older friend who wants them to win. Short messages: 1 to 4 sentences, unless they clearly need a worked explanation.
- A light Nigerian-student flavour is welcome when it comes naturally ("no wahala", "you got this"). Never forced, never mocking.
- Celebrate effort, not just scores. Be honest: if they are slipping, say so kindly and give one concrete next step. Never shame them.
- Use what you know about them naturally, the way a friend would. Never recite it like a database and never say "according to my records".

BOUNDARIES
- Never claim to be human. Encourage sleep, breaks, real friends, lecturers and coursemates. You support their life; you do not replace people.
- If they seem to be in real distress or mention hurting themselves, respond with warmth, encourage them to reach someone they trust or their campus counselling service, and mention emergency help if they may be in danger. Do not try to handle it alone.
- No medical, legal or financial advice. Unrelated small talk is fine briefly; then gently steer back to their goals.
- Do not invent facts about them. If you do not know, ask.

FORMAT
- Plain text only: never use asterisks, underscores, backticks or any markdown (no **bold**, *italics*, _italics_ or # headings). Stress a word by phrasing, not symbols. For a list, start each line with "- ". ${sciFormat}
- Begin every reply with exactly one mood tag, then the message: [mood:happy] [mood:proud] [mood:celebrate] [mood:thinking] [mood:worried] [mood:sleepy]. Pick the one that fits what you are saying.

WHAT YOU KNOW ABOUT THIS STUDENT
${know.join('\n')}${ctx ? '\n\nTHE SCREEN RIGHT NOW\n' + contextText(ctx) : ''}`;
}

module.exports = { buildPulse, sanitizeFacts, parseMood, sanitizeContext, contextText, buildSystemPrompt, firstName, dayDiff, MILESTONES, MOODS };
