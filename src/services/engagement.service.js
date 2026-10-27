const Student = require('../models/Student');
const QuestionAttempt = require('../models/QuestionAttempt');
const Settings = require('../models/Settings');
const { isPremiumActive } = require('./entitlements.service');

// ── Real engagement (v1.7.8) ──────────────────────────────────
// "Active" used to mean "lastActiveAt moved", but that also moves on background polling and the daily credit
// refresh, so almost every account looked active. Here a student counts only when they ANSWERED QUESTIONS, and
// accounts you list (your own testing logins) are left out. Days are Nigerian (WAT) calendar days.
const DAY = 24 * 60 * 60 * 1000;

// Monday of the week containing a 'YYYY-MM-DD' day string.
function weekStart(day) {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * DAY).toISOString().slice(0, 10);
}
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);

// rows: [{ matric, day:'YYYY-MM-DD', n }]  students: [{ matric, tier, premiumPlan, tierExpiresAt, profileCompleted, selectedCourses }]
// Pure function — the route feeds it database results, the test feeds it fixtures.
function buildReport({ rows, students, freeCap = null, weeks = 8, now = new Date() }) {
  const today = new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);   // WAT = UTC+1
  const thisWeek = weekStart(today);
  const byStudent = new Map();   // matric -> { days:Set, attempts }
  for (const r of rows) {
    const s = byStudent.get(r.matric) || { days: new Set(), attempts: 0, weeks: new Set(), first: r.day };
    s.days.add(r.day); s.attempts += r.n; s.weeks.add(weekStart(r.day)); if (r.day < s.first) s.first = r.day;
    byStudent.set(r.matric, s);
  }
  const registered = students.length;
  const known = new Set(students.map(s => s.matric));
  const studied = [...byStudent.keys()].filter(m => known.has(m));
  const dayCount = m => byStudent.get(m).days.size;

  const funnel = {
    registered,
    profileDone: students.filter(s => s.profileCompleted).length,
    hasCourses: students.filter(s => (s.selectedCourses || []).length > 0).length,
    studied: studied.length,
    studied3Days: studied.filter(m => dayCount(m) >= 3).length,
    studied7Days: studied.filter(m => dayCount(m) >= 7).length,
    studiedOneDayOnly: studied.filter(m => dayCount(m) === 1).length,
  };

  // Weekly active studiers for the last `weeks` weeks (oldest first).
  const weekly = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const w = new Date(new Date(`${thisWeek}T00:00:00Z`).getTime() - i * 7 * DAY).toISOString().slice(0, 10);
    const active = studied.filter(m => byStudent.get(m).weeks.has(w)).length;
    weekly.push({ week: w, active, pct: pct(active, registered), partial: w === thisWeek });
  }

  // Of the students who FIRST studied in a given week, how many studied again in a later week?
  const cohorts = [];
  for (const w of weekly.map(x => x.week).slice(0, -1)) {   // current week is still running
    const cohort = studied.filter(m => weekStart(byStudent.get(m).first) === w);
    if (!cohort.length) continue;
    const back = cohort.filter(m => [...byStudent.get(m).weeks].some(x => x > w)).length;
    cohorts.push({ week: w, newStudiers: cohort.length, cameBack: back, pct: pct(back, cohort.length) });
  }

  // How often do free students run into the daily question cap? (last 30 days, students who are free right now)
  let freeCapStats = null;
  if (freeCap != null) {
    const since = new Date(now.getTime() - 30 * DAY).toISOString().slice(0, 10);
    const free = new Set(students.filter(s => !isPremiumActive(s)).map(s => s.matric));
    const days = rows.filter(r => free.has(r.matric) && r.day >= since);
    const hit = days.filter(r => r.n >= freeCap).length;
    freeCapStats = { cap: freeCap, studentDays: days.length, hit, pct: pct(hit, days.length) };
  }

  const totals = studied.map(m => byStudent.get(m).attempts).sort((a, b) => b - a);
  const sum = totals.reduce((a, b) => a + b, 0);
  const top = n => pct(totals.slice(0, n).reduce((a, b) => a + b, 0), sum);
  return { funnel, weekly, cohorts, freeCap: freeCapStats, concentration: { top1Pct: top(1), top5Pct: top(5), attempts: sum } };
}

async function engagementReport({ weeks = 8 } = {}) {
  const settings = await Settings.getGlobal();
  const exclude = (settings.analyticsExclude || []).map(m => String(m).toUpperCase());
  const matchStudents = exclude.length ? { matric: { $nin: exclude } } : {};
  const [students, rows] = await Promise.all([
    Student.find(matchStudents).select('matric tier premiumPlan tierExpiresAt profileCompleted selectedCourses').lean(),
    QuestionAttempt.aggregate([
      { $match: exclude.length ? { matric: { $nin: exclude } } : {} },
      { $group: { _id: { matric: '$matric', day: { $dateToString: { format: '%Y-%m-%d', date: '$ts', timezone: 'Africa/Lagos' } } }, n: { $sum: 1 } } },
      { $project: { _id: 0, matric: '$_id.matric', day: '$_id.day', n: 1 } },
    ]),
  ]);
  const freeCap = settings.tiers && settings.tiers.free ? settings.tiers.free.dailyQuestions : null;
  return { exclude, ...buildReport({ rows, students, freeCap: typeof freeCap === 'number' ? freeCap : null, weeks }) };
}

module.exports = { buildReport, engagementReport, weekStart };
