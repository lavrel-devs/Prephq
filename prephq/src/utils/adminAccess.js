// ── Admin permissions ─────────────────────────────────────────
// Every /api/admin/* request is mapped to one permission "area". An admin
// is either FULL ACCESS (everything, including managing other admins) or
// limited to a list of areas. Each area can be granted as
//   "<area>"        → view + change
//   "<area>:view"   → read-only (GET requests only)
// Anything not listed in RULES below needs full access, so a new endpoint
// is locked down by default until it is added here.

const AREAS = [
  { key: 'analytics',     label: 'Dashboard & analytics',  desc: 'Overview stats, analytics charts' },
  { key: 'students',      label: 'Students',                desc: 'View/edit accounts, suspend, reset usernames & passwords, reports' },
  { key: 'credits',       label: 'Credits & transfers',     desc: 'Grant/deduct credits, bulk grants, transaction & transfer logs' },
  { key: 'payments',      label: 'Payments & plans',        desc: 'Payment records, upgrade students to Premium (weekly/monthly/yearly/lifetime)' },
  { key: 'courses',       label: 'Courses',                 desc: 'Add/edit/remove courses' },
  { key: 'questions',     label: 'Question bank',           desc: 'Add/edit/delete questions, bulk upload' },
  { key: 'contests',      label: 'Contests',                desc: 'Create/run contests and recurring templates (can adjust contest prizes)' },
  { key: 'support',       label: 'Support requests',        desc: 'Password recovery, upgrade and question-report requests from students' },
  { key: 'announcements', label: 'Announcements',           desc: 'Broadcast notifications to students' },
  { key: 'settings',      label: 'Credit & plan settings',  desc: 'Daily refresh, referral, tier limits & pricing' },
  { key: 'cosmetics',     label: 'Shop items',              desc: 'Badges and frames in the cosmetics shop' },
];
const AREA_KEYS = AREAS.map(a => a.key);

// [pattern on the path after /api/admin, areas that unlock it]
// 'ANY' = every admin; 'FULL' = full-access admins only; 'OWNER' = the main admin only. First match wins.
const RULES = [
  [/^\/admins\/me(\/password)?\/?$/, 'ANY'],
  [/^\/support(\/|$)/, ['support']],
  [/^\/followups(\/|$)/, ['students']],
  [/^\/course-notes(\/|$)/, ['courses']],
  [/^\/admins(\/|$)/, 'FULL'],
  [/^\/activity(\/|$)/, 'OWNER'],

  [/^\/credits(\/|$)/, ['credits']],
  [/^\/transfers(\/|$)/, ['credits']],
  [/^\/export\/(transactions|transfers)\/?$/, ['credits']],
  [/^\/students\/[^/]+\/credits(\/|$)/, ['credits']],
  [/^\/users\/bulk-grant\/?$/, ['credits']],

  [/^\/payments(\/|$)/, ['payments']],
  [/^\/users\/tier-distribution\/?$/, ['payments', 'analytics']],
  [/^\/users\/[^/]+\/tier\/?$/, ['payments']],

  [/^\/(stats|dashboard|analytics)(\/|$)/, ['analytics']],

  [/^\/export\/users\/?$/, ['students']],
  [/^\/students(\/|$)/, ['students']],
  [/^\/users(\/|$)/, ['students']],

  [/^\/courses(\/|$)/, ['courses']],
  [/^\/questions(\/|$)/, ['questions']],
  [/^\/contests-question-bank\/?$/, ['questions', 'contests']],
  [/^\/contest-templates(\/|$)/, ['contests']],
  [/^\/contests(\/|$)/, ['contests']],
  [/^\/announcements(\/|$)/, ['announcements']],
  [/^\/credit-settings(\/|$)/, ['settings']],
  [/^\/cosmetics(\/|$)/, ['cosmetics']],
];

function isReadMethod(method) {
  return method === 'GET' || method === 'HEAD';
}

// Is `perm` list valid? Accepts "area" or "area:view".
function normalizePermissions(list) {
  if (!Array.isArray(list)) return null;
  const out = new Set();
  for (const p of list) {
    if (typeof p !== 'string') return null;
    const [area, level] = p.split(':');
    if (!AREA_KEYS.includes(area) || (level !== undefined && level !== 'view')) return null;
    out.add(level === 'view' ? `${area}:view` : area);
  }
  // "area" (change) already includes view, so drop a redundant "area:view".
  for (const p of [...out]) if (p.endsWith(':view') && out.has(p.slice(0, -5))) out.delete(p);
  return [...out];
}

// access = { full: boolean, permissions: string[] }
function areaAllowed(access, method, areas) {
  if (access.full) return true;
  const perms = access.permissions || [];
  return areas.some(a => perms.includes(a) || (isReadMethod(method) && perms.includes(`${a}:view`)));
}

// Decision for a request. `path` is relative to /api/admin.
function checkAccess(access, method, path) {
  const rule = RULES.find(([re]) => re.test(path));
  if (!rule) return access.full;               // unknown endpoint → full access only
  const need = rule[1];
  if (need === 'ANY') return true;
  if (need === 'FULL') return access.full;
  if (need === 'OWNER') return !!access.owner;
  return areaAllowed(access, method, need);
}

// For handlers that do part of their work only when the admin holds an
// extra permission (e.g. creating a student WITH starting credits).
function canChange(access, area) {
  return !!access && (access.full || (access.permissions || []).includes(area));
}

module.exports = { AREAS, AREA_KEYS, normalizePermissions, checkAccess, canChange };
