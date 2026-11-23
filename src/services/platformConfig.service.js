'use strict';
// v1.14 — the live platform controls. Reads are cached for a few seconds (the gate runs on every API request); writes go
// through sanitize(), which is pure and unit-tested, so the admin screen can never store something the server cannot use.
const S = require('../utils/secondary');

const DEFAULTS = {
  maintenance: { enabled: false, message: '', eta: '' },
  banner: { enabled: false, text: '', tone: 'info', audience: 'all' },
  switches: { signups: true, logins: true, aiChat: true, aiQuiz: true, contests: true, studyRooms: true, creditTransfers: true },
  secondary: {
    enabled: true, signupsOpen: true,
    exams: { jamb: true, waec: true, neco: true, school: true },
    motd: '', maxPracticeCount: 50, freeDailyMocks: null,
    papers: {
      jamb:   { minutes: null, miniMinutes: null, firstSubjectQs: null, otherSubjectQs: null, miniFirstQs: null, miniOtherQs: null },
      waec:   { minutes: null, questions: null, miniMinutes: null, miniQuestions: null },
      neco:   { minutes: null, questions: null, miniMinutes: null, miniQuestions: null },
      school: { minutes: null, questions: null, miniMinutes: null, miniQuestions: null },
    },
  },
};

const clone = o => JSON.parse(JSON.stringify(o));
function merge(base, over) {
  if (!over || typeof over !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) merge(base[k], over[k]);
    else if (over[k] !== undefined) base[k] = over[k];
  }
  return base;
}
const withDefaults = doc => merge(clone(DEFAULTS), doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

// ── validation ───────────────────────────────────────────────
const bool = (v, name) => { if (typeof v !== 'boolean') throw new Error(`${name} must be on or off`); return v; };
const text = (v, name, max) => { if (typeof v !== 'string') throw new Error(`${name} must be text`); return v.trim().slice(0, max); };
const oneOf = (v, list, name) => { if (!list.includes(v)) throw new Error(`${name} must be one of: ${list.join(', ')}`); return v; };
const intOrNull = (v, name, min, max) => {
  if (v === null || v === '' || v === undefined) return null;
  const x = Number(v); if (!Number.isInteger(x) || x < min || x > max) throw new Error(`${name} must be a whole number from ${min} to ${max} (or blank)`);
  return x;
};
const int = (v, name, min, max) => { const x = intOrNull(v, name, min, max); if (x === null) throw new Error(`${name} is required`); return x; };

// Returns ONLY the recognised, validated parts of `input` (nested like DEFAULTS). Throws Error(message) on a bad value.
function sanitize(input) {
  const out = {}; const i = input && typeof input === 'object' ? input : {};
  if (i.maintenance) {
    const m = i.maintenance; out.maintenance = {};
    if ('enabled' in m) out.maintenance.enabled = bool(m.enabled, 'Maintenance mode');
    if ('message' in m) out.maintenance.message = text(m.message, 'Maintenance message', 400);
    if ('eta' in m) out.maintenance.eta = text(m.eta, 'Back-online time', 60);
  }
  if (i.banner) {
    const b = i.banner; out.banner = {};
    if ('enabled' in b) out.banner.enabled = bool(b.enabled, 'Banner');
    if ('text' in b) out.banner.text = text(b.text, 'Banner text', 300);
    if ('tone' in b) out.banner.tone = oneOf(b.tone, ['info', 'warn', 'danger'], 'Banner style');
    if ('audience' in b) out.banner.audience = oneOf(b.audience, ['all', 'university', 'secondary'], 'Banner audience');
    if (out.banner.enabled === true && 'text' in b && !out.banner.text) throw new Error('Write the banner text first');
  }
  if (i.switches) {
    out.switches = {};
    for (const k of Object.keys(DEFAULTS.switches)) if (k in i.switches) out.switches[k] = bool(i.switches[k], k);
  }
  if (i.secondary) {
    const s = i.secondary; const o = out.secondary = {};
    if ('enabled' in s) o.enabled = bool(s.enabled, 'Secondary app');
    if ('signupsOpen' in s) o.signupsOpen = bool(s.signupsOpen, 'Secondary sign-ups');
    if ('motd' in s) o.motd = text(s.motd, 'Secondary notice', 300);
    if ('maxPracticeCount' in s) o.maxPracticeCount = int(s.maxPracticeCount, 'Max practice questions', 5, 100);
    if ('freeDailyMocks' in s) o.freeDailyMocks = intOrNull(s.freeDailyMocks, 'Free daily mock papers', 0, 50);
    if (s.exams) { o.exams = {}; for (const k of S.EXAM_KEYS) if (k in s.exams) o.exams[k] = bool(s.exams[k], k + ' switch'); }
    if (s.papers) {
      o.papers = {};
      const lim = { minutes: [5, 300], miniMinutes: [3, 120], questions: [5, 200], miniQuestions: [3, 100], firstSubjectQs: [10, 100], otherSubjectQs: [5, 100], miniFirstQs: [3, 60], miniOtherQs: [3, 60] };
      for (const exam of S.EXAM_KEYS) {
        const p = s.papers[exam]; if (!p || typeof p !== 'object') continue;
        o.papers[exam] = {};
        for (const f of Object.keys(DEFAULTS.secondary.papers[exam])) if (f in p) o.papers[exam][f] = intOrNull(p[f], `${exam.toUpperCase()} ${f}`, lim[f][0], lim[f][1]);
      }
    }
  }
  return out;
}

// Dotted $set paths for a nested patch ({ switches: { aiChat: false } } -> { 'switches.aiChat': false }).
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out); else out[key] = v;
  }
  return out;
}

// The paper shape a Secondary exam uses once the admin's overrides are applied over utils/secondary.js PAPERS.
// jamb -> { minutes, counts:[first, other] } ; waec / neco / school -> { minutes, questions }
function paperShape(cfg, exam, mini) {
  const base = S.PAPERS[exam]; const o = ((cfg && cfg.secondary && cfg.secondary.papers) || {})[exam] || {};
  const pick = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);
  if (exam === 'jamb') {
    return {
      minutes: mini ? pick(o.miniMinutes, base.mini.minutes) : pick(o.minutes, base.minutes),
      first: mini ? pick(o.miniFirstQs, base.mini.first) : pick(o.firstSubjectQs, base.firstSubjectQs),
      other: mini ? pick(o.miniOtherQs, base.mini.other) : pick(o.otherSubjectQs, base.otherSubjectQs),
    };
  }
  return mini
    ? { minutes: pick(o.miniMinutes, base.mini.minutes), questions: pick(o.miniQuestions, base.mini.questions) }
    : { minutes: pick(o.minutes, base.minutes), questions: pick(o.questions, base.questions) };
}

// ── cached reads / writes ────────────────────────────────────
let cache = null, cacheAt = 0;
const TTL = 8000, READ_TIMEOUT = 1500;
// The gate calls this on every API request, so it must never hang: if the database does not answer within READ_TIMEOUT the
// last good config (or the defaults) is used and the next attempt is a few seconds later instead of on every request.
async function get(force = false) {
  if (!force && cache && Date.now() - cacheAt < TTL) return cache;
  const PlatformConfig = require('../models/PlatformConfig');
  let timer;
  try {
    const doc = await Promise.race([PlatformConfig.getGlobal(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('config read timed out')), READ_TIMEOUT); })]);
    cache = withDefaults(doc); cacheAt = Date.now();
  } catch (e) {
    if (!cache) cache = clone(DEFAULTS);
    cacheAt = Date.now() - TTL + 3000;   // fail open; look again in ~3 seconds
  } finally { clearTimeout(timer); }
  return cache;
}
// Test helper: pin the config so unit tests never touch the database.
function _prime(cfg) { cache = withDefaults(cfg || {}); cacheAt = Date.now() + 3600000; return cache; }
async function update(patch, by) {
  const clean = sanitize(patch);
  const set = flatten(clean);
  if (!Object.keys(set).length) return get(true);
  const PlatformConfig = require('../models/PlatformConfig');
  await PlatformConfig.findOneAndUpdate({ key: 'global' }, { $set: { ...set, updatedAt: new Date(), updatedBy: String(by || '') }, $setOnInsert: { key: 'global' } }, { upsert: true, setDefaultsOnInsert: true });
  cache = null; return get(true);
}

// What a logged-out or logged-in client may know: maintenance, the banner for its app, and the Secondary notice.
function publicStatus(cfg, track) {
  const t = track === 'secondary' ? 'secondary' : track === 'university' ? 'university' : '';
  const b = cfg.banner || {};
  const showBanner = b.enabled && b.text && (b.audience === 'all' || !t || b.audience === t);
  return {
    maintenance: cfg.maintenance.enabled ? { message: cfg.maintenance.message || 'Wreddi is being updated. Please check back shortly.', eta: cfg.maintenance.eta || '' } : null,
    banner: showBanner ? { text: b.text, tone: b.tone } : null,
    secondary: { enabled: cfg.secondary.enabled, signupsOpen: cfg.secondary.signupsOpen && cfg.secondary.enabled, motd: cfg.secondary.motd || '' },
    signupsOpen: cfg.switches.signups !== false,
  };
}

module.exports = { DEFAULTS, sanitize, flatten, merge, withDefaults, paperShape, get, update, publicStatus, _prime };
