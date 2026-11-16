// Wreddi Secondary — pure helpers (no DB, no network) so they can be unit-tested and shared by the routes.
//
// The secondary subapp serves students writing JAMB (UTME), WAEC (WASSCE), NECO (SSCE) and ordinary school
// exams (JSS1–SS3). It reuses the Course / Question / Score collections: a secondary subject is a Course with
// track = 'secondary', and a question can optionally carry exam / year / classLevel.

const EXAMS = {
  jamb:   { key: 'jamb',   label: 'JAMB UTME',      short: 'JAMB' },
  waec:   { key: 'waec',   label: 'WAEC WASSCE',    short: 'WAEC' },
  neco:   { key: 'neco',   label: 'NECO SSCE',      short: 'NECO' },
  school: { key: 'school', label: 'School exams',   short: 'School' },
};
const EXAM_KEYS = Object.keys(EXAMS);
const CLASS_LEVELS = ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'];

// Full-paper shapes. These are the defaults the paper builder uses; every number can be tuned here in one place.
//   JAMB UTME: 4 subjects, 180 questions, 2 hours. English 60, the other three 40 each. Each subject is scored out of 100,
//              so the total is out of 400.
//   WAEC / NECO objective paper: one subject at a time. The counts and minutes below are practice defaults.
const PAPERS = {
  jamb:   { minutes: 120, subjectCount: 4, firstSubjectQs: 60, otherSubjectQs: 40, mini: { first: 15, other: 10, minutes: 30 } },
  waec:   { minutes: 60,  questions: 50, mini: { questions: 15, minutes: 20 } },
  neco:   { minutes: 60,  questions: 60, mini: { questions: 15, minutes: 20 } },
  school: { minutes: 30,  questions: 30, mini: { questions: 10, minutes: 10 } },
};

// WAEC / NECO share the A1–F9 scale. A1–C6 is a "credit"; D7/E8 is a "pass"; F9 is a fail.
const GRADE_BANDS = [
  { grade: 'A1', min: 75, label: 'Excellent' },
  { grade: 'B2', min: 70, label: 'Very good' },
  { grade: 'B3', min: 65, label: 'Good' },
  { grade: 'C4', min: 60, label: 'Credit' },
  { grade: 'C5', min: 55, label: 'Credit' },
  { grade: 'C6', min: 50, label: 'Credit' },
  { grade: 'D7', min: 45, label: 'Pass' },
  { grade: 'E8', min: 40, label: 'Pass' },
  { grade: 'F9', min: 0,  label: 'Fail' },
];
const isCredit = g => ['A1', 'B2', 'B3', 'C4', 'C5', 'C6'].includes(g);

function gradeFor(pct) {
  const p = Number(pct);
  if (!Number.isFinite(p)) return 'F9';
  for (const b of GRADE_BANDS) if (p >= b.min) return b.grade;
  return 'F9';
}

// JAMB: each subject is marked out of 100, so the 4-subject total is out of 400.
// `correct` of `total` questions in that subject -> a mark out of 100 (rounded).
function jambSubjectScore(correct, total) {
  if (!total || total <= 0) return 0;
  return Math.round((Math.max(0, Math.min(correct, total)) / total) * 100);
}

// Splits a JAMB paper across a student's subjects. The FIRST subject must be English (60 questions); the others get 40.
// `mini` gives a shorter paper (so it fits a Free daily question cap and a quick sitting).
function jambShape(subjectCount = 4, mini = false) {
  const cfg = PAPERS.jamb;
  const a = mini ? cfg.mini.first : cfg.firstSubjectQs, b = mini ? cfg.mini.other : cfg.otherSubjectQs;
  const counts = [a]; for (let i = 1; i < subjectCount; i++) counts.push(b);
  return { counts, total: counts.reduce((x, y) => x + y, 0), minutes: mini ? cfg.mini.minutes : cfg.minutes };
}

// Seeded secondary subjects. `exams` lists which exam bodies normally examine it; `core` marks compulsory subjects.
const SUBJECTS = [
  { code: 'SEC-ENG',  title: 'English Language',        color: '#3E5C8A', icon: 'translate', exams: ['jamb', 'waec', 'neco', 'school'], core: true },
  { code: 'SEC-MTH',  title: 'Mathematics',             color: '#B5654A', icon: 'calc',      exams: ['jamb', 'waec', 'neco', 'school'], core: true },
  { code: 'SEC-PHY',  title: 'Physics',                 color: '#3A8FB0', icon: 'lightning', exams: ['jamb', 'waec', 'neco', 'school'] },
  { code: 'SEC-CHM',  title: 'Chemistry',               color: '#2E8B6A', icon: 'atom',      exams: ['jamb', 'waec', 'neco', 'school'] },
  { code: 'SEC-BIO',  title: 'Biology',                 color: '#3E5C8A', icon: 'dna',       exams: ['jamb', 'waec', 'neco', 'school'] },
  { code: 'SEC-ECO',  title: 'Economics',               color: '#B98A2E', icon: 'bar',       exams: ['jamb', 'waec', 'neco', 'school'] },
  { code: 'SEC-GOV',  title: 'Government',              color: '#6B7089', icon: 'globe',     exams: ['jamb', 'waec', 'neco', 'school'] },
  { code: 'SEC-LIT',  title: 'Literature in English',   color: '#B5654A', icon: 'edit',      exams: ['jamb', 'waec', 'neco', 'school'] },
  { code: 'SEC-CRS',  title: 'Christian Religious Studies', color: '#5D7FB0', icon: 'star',  exams: ['jamb', 'waec', 'neco', 'school'] },
  { code: 'SEC-IRS',  title: 'Islamic Studies',         color: '#2E8B6A', icon: 'star',      exams: ['jamb', 'waec', 'neco', 'school'] },
  { code: 'SEC-GEO',  title: 'Geography',               color: '#3A8FB0', icon: 'globe',     exams: ['jamb', 'waec', 'neco', 'school'] },
  { code: 'SEC-HIS',  title: 'History',                 color: '#B98A2E', icon: 'globe',     exams: ['jamb', 'waec', 'neco', 'school'] },
  { code: 'SEC-COM',  title: 'Commerce',                color: '#B98A2E', icon: 'bar',       exams: ['jamb', 'waec', 'neco', 'school'] },
  { code: 'SEC-ACC',  title: 'Financial Accounting',    color: '#6B7089', icon: 'calc',      exams: ['jamb', 'waec', 'neco', 'school'] },
  { code: 'SEC-AGR',  title: 'Agricultural Science',    color: '#2E8B6A', icon: 'dna',       exams: ['jamb', 'waec', 'neco', 'school'] },
  { code: 'SEC-FMT',  title: 'Further Mathematics',     color: '#B5654A', icon: 'math',      exams: ['waec', 'neco', 'school'] },
  { code: 'SEC-CMP',  title: 'Computer Studies',        color: '#3A8FB0', icon: 'laptop',    exams: ['waec', 'neco', 'school'] },
  { code: 'SEC-CIV',  title: 'Civic Education',         color: '#6B7089', icon: 'globe',     exams: ['waec', 'neco', 'school'], core: true },
  { code: 'SEC-BST',  title: 'Basic Science & Technology', color: '#3E5C8A', icon: 'flask',  exams: ['school'] },
];
const subjectKey = code => String(code).toLowerCase().replace(/[^a-z0-9]/g, '');   // same rule Course uses for `key`

// Typical JAMB combinations by course of study. Universities set their own requirements, so the UI labels these as a
// guide to check with the school, never as the official requirement.
const JAMB_COMBOS = [
  { course: 'Medicine & Surgery',      subjects: ['SEC-ENG', 'SEC-BIO', 'SEC-CHM', 'SEC-PHY'] },
  { course: 'Pharmacy',                subjects: ['SEC-ENG', 'SEC-BIO', 'SEC-CHM', 'SEC-PHY'] },
  { course: 'Nursing',                 subjects: ['SEC-ENG', 'SEC-BIO', 'SEC-CHM', 'SEC-PHY'] },
  { course: 'Engineering',             subjects: ['SEC-ENG', 'SEC-MTH', 'SEC-PHY', 'SEC-CHM'] },
  { course: 'Computer Science',        subjects: ['SEC-ENG', 'SEC-MTH', 'SEC-PHY', 'SEC-CHM'] },
  { course: 'Law',                     subjects: ['SEC-ENG', 'SEC-LIT', 'SEC-GOV', 'SEC-CRS'] },
  { course: 'Accounting',              subjects: ['SEC-ENG', 'SEC-MTH', 'SEC-ECO', 'SEC-COM'] },
  { course: 'Economics',               subjects: ['SEC-ENG', 'SEC-MTH', 'SEC-ECO', 'SEC-GOV'] },
  { course: 'Mass Communication',      subjects: ['SEC-ENG', 'SEC-LIT', 'SEC-GOV', 'SEC-ECO'] },
  { course: 'Microbiology / Biochemistry', subjects: ['SEC-ENG', 'SEC-BIO', 'SEC-CHM', 'SEC-PHY'] },
  { course: 'Chemistry',               subjects: ['SEC-ENG', 'SEC-CHM', 'SEC-MTH', 'SEC-PHY'] },
  { course: 'Agriculture',             subjects: ['SEC-ENG', 'SEC-CHM', 'SEC-BIO', 'SEC-AGR'] },
];

// ── Profile validation ────────────────────────────────────────
// Returns { value } or { error }. `known` is the Set of secondary course keys that exist.
function cleanProfile(body, known) {
  const b = body && typeof body === 'object' ? body : {};
  const out = {};
  if (b.exam !== undefined) {
    if (!EXAM_KEYS.includes(b.exam)) return { error: 'Choose JAMB, WAEC, NECO or School.' };
    out.exam = b.exam;
  }
  if (b.classLevel !== undefined) {
    if (b.classLevel !== '' && !CLASS_LEVELS.includes(b.classLevel)) return { error: 'Choose a class from JSS1 to SS3.' };
    out.classLevel = b.classLevel;
  }
  if (b.subjects !== undefined) {
    if (!Array.isArray(b.subjects)) return { error: 'Subjects must be a list.' };
    const subs = [...new Set(b.subjects.map(s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean))];
    const bad = subs.find(s => known && !known.has(s));
    if (bad) return { error: `Unknown subject "${bad}".` };
    out.subjects = subs.slice(0, 12);
  }
  if (b.examDate !== undefined) {
    if (b.examDate === null || b.examDate === '') out.examDate = null;
    else { const d = new Date(b.examDate); if (Number.isNaN(d.getTime())) return { error: 'That exam date is not valid.' }; out.examDate = d; }
  }
  if (b.targetScore !== undefined) {
    if (b.targetScore === null || b.targetScore === '') out.targetScore = null;
    else { const n = Number(b.targetScore); if (!Number.isFinite(n) || n < 0 || n > 400) return { error: 'Target score must be between 0 and 400.' }; out.targetScore = Math.round(n); }
  }
  for (const f of ['school', 'courseOfStudy']) if (b[f] !== undefined) out[f] = String(b[f]).trim().slice(0, 120);
  return { value: out };
}

// Checks a subject choice against the exam's rules (used when the student finishes setup).
//   JAMB: exactly 4, English included.   WAEC / NECO: up to 9, English and Mathematics included.
//   School: any (at least one).
// `keys` are course keys; `English` and `Mathematics` are identified by their seeded keys.
const KEY_ENG = subjectKey('SEC-ENG'), KEY_MTH = subjectKey('SEC-MTH');
function validateSubjects(exam, keys) {
  const n = keys.length;
  if (!n) return 'Pick at least one subject.';
  if (exam === 'jamb') {
    if (n !== 4) return 'JAMB UTME is four subjects. Pick exactly four.';
    if (!keys.includes(KEY_ENG)) return 'English Language is compulsory in JAMB.';
  }
  if (exam === 'waec' || exam === 'neco') {
    if (n > 9) return 'You can register for at most nine subjects.';
    if (!keys.includes(KEY_ENG) || !keys.includes(KEY_MTH)) return 'English Language and Mathematics are compulsory.';
  }
  return null;
}

// ── Results ───────────────────────────────────────────────────
// Turns a finished paper into the numbers the student sees.
//   sections [{ course, correct, total }]
function summarisePaper(exam, sections) {
  const rows = sections.map(s => {
    const total = Math.max(0, s.total | 0), correct = Math.max(0, Math.min(s.correct | 0, total));
    const pct = total ? Math.round((correct / total) * 100) : 0;
    return { course: s.course, correct, total, pct, scaled: jambSubjectScore(correct, total), grade: gradeFor(pct) };
  });
  const correct = rows.reduce((a, r) => a + r.correct, 0), total = rows.reduce((a, r) => a + r.total, 0);
  const out = { exam, rows, correct, total, pct: total ? Math.round((correct / total) * 100) : 0 };
  if (exam === 'jamb') out.utme = rows.reduce((a, r) => a + r.scaled, 0);
  return out;
}

// WAEC / NECO "5 credits including English and Maths" check, from the best grade per subject.
//   best: { courseKey: grade }
function creditCheck(best) {
  const entries = Object.entries(best || {});
  const credits = entries.filter(([, g]) => isCredit(g)).length;
  const eng = best[KEY_ENG], mth = best[KEY_MTH];
  const ok = credits >= 5 && isCredit(eng) && isCredit(mth);
  const missing = [];
  if (!isCredit(eng)) missing.push('a credit in English Language');
  if (!isCredit(mth)) missing.push('a credit in Mathematics');
  if (credits < 5) missing.push(`${5 - credits} more credit${5 - credits === 1 ? '' : 's'} overall`);
  return { credits, ok, missing };
}

// Days until an exam (whole days, can be negative once it has passed). null when no date is set.
function daysUntil(date, now = Date.now()) {
  if (!date) return null;
  const t = new Date(date).getTime(); if (Number.isNaN(t)) return null;
  const d0 = x => { const d = new Date(x); d.setHours(0, 0, 0, 0); return d.getTime(); };
  return Math.round((d0(t) - d0(now)) / 86400000);
}

// Picks `n` items at random without repeats. `rand` is injectable for tests.
function sample(arr, n, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, Math.max(0, n));
}

// Sanitises the optional `sec` block a client attaches to a score post. Anything odd is dropped, never trusted.
function cleanSec(sec, known) {
  if (!sec || typeof sec !== 'object' || !EXAM_KEYS.includes(sec.exam)) return null;
  const kind = ['mock', 'practice'].includes(sec.kind) ? sec.kind : 'practice';
  const rows = (Array.isArray(sec.rows) ? sec.rows : []).slice(0, 12).map(r => {
    const course = String((r && r.course) || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!course || (known && !known.has(course))) return null;
    const total = Math.max(0, Math.min(Math.round(Number(r.total) || 0), 200));
    const correct = Math.max(0, Math.min(Math.round(Number(r.correct) || 0), total));
    const pct = total ? Math.round((correct / total) * 100) : 0;
    return { course, correct, total, pct, scaled: jambSubjectScore(correct, total), grade: gradeFor(pct) };
  }).filter(Boolean);
  if (!rows.length) return null;
  const out = { exam: sec.exam, kind, rows };
  if (sec.exam === 'jamb' && kind === 'mock') out.utme = rows.reduce((a, r) => a + r.scaled, 0);
  const yr = Number(sec.year); if (Number.isInteger(yr) && yr >= 1978 && yr <= 2100) out.year = yr;
  return out;
}

module.exports = {
  EXAMS, EXAM_KEYS, CLASS_LEVELS, PAPERS, GRADE_BANDS, SUBJECTS, JAMB_COMBOS, KEY_ENG, KEY_MTH,
  isCredit, gradeFor, jambSubjectScore, jambShape, subjectKey, cleanProfile, validateSubjects,
  summarisePaper, creditCheck, daysUntil, sample, cleanSec,
};
