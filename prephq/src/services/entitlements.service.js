const Settings = require('../models/Settings');
const Student = require('../models/Student');

// ══════════════════════════════════════════════════════════════
//  ENTITLEMENTS — the single place that answers "may this student
//  use this feature?".
//
//      student ─▶ plan (free | premium) ─▶ feature ─▶ allow / deny
//
//  • Premium (weekly / monthly / yearly / lifetime) → every feature.
//  • Free → each feature follows an admin ON/OFF switch stored in
//    Settings.tiers.free.features (Admin ▸ Credit Settings).
//  Routes use requireFeature('<key>'); the frontend reads the resolved
//  map from /api/me. To add a gated feature: add it to FEATURES and to
//  Settings.tiers.free.features, then put requireFeature on its route.
// ══════════════════════════════════════════════════════════════

const FEATURES = [
  { key: 'aiTutor',              label: 'AI Tutor (chat)',            freeDefault: true  },
  { key: 'practiceQuestions',    label: 'Practice questions',         freeDefault: true  },
  { key: 'aiQuestionGeneration', label: 'AI question generation',     freeDefault: true  },
  { key: 'flashcards',           label: 'Flashcards',                 freeDefault: false },
  { key: 'examMode',             label: 'Exam mode (CBT)',            freeDefault: true  },
  { key: 'examHistory',          label: 'Exam history & readiness',   freeDefault: true  },
  { key: 'studyPlan',            label: 'Study plan & revision queue', freeDefault: true  },
  { key: 'courseNotes',          label: 'Course notes',               freeDefault: true  },
  { key: 'studyGuide',           label: 'AI study guide',             freeDefault: false },
  { key: 'studyRooms',           label: 'Study rooms',                freeDefault: true  },
  { key: 'contests',             label: 'Contests',                   freeDefault: true  },
  { key: 'creditTransfers',      label: 'Credit transfers',           freeDefault: true  },
];
const FEATURE_KEYS = FEATURES.map(f => f.key);

// Premium billing periods. `lifetime` is a distinct entitlement, NOT a very long subscription.
const PREMIUM_PERIODS = ['weekly', 'monthly', 'yearly', 'lifetime'];
const PERIOD_DAYS = { weekly: 7, monthly: 30, yearly: 365, lifetime: null };
const PERIOD_PRICE_FIELD = { weekly: 'priceWeekly', monthly: 'priceMonthly', yearly: 'priceYearly', lifetime: 'priceLifetime' };

// 'basic' / 'pro' only exist on records written before the plan cleanup
// (they're migrated to 'premium' at boot); treat them as premium meanwhile.
const PREMIUM_TIER_VALUES = ['premium', 'basic', 'pro'];

function isPremiumActive(s, now = new Date()) {
  if (!s || !PREMIUM_TIER_VALUES.includes(s.tier)) return false;
  if (s.premiumPlan === 'lifetime') return true;                 // permanent: expiry is never consulted
  return !s.tierExpiresAt || now <= new Date(s.tierExpiresAt);   // null expiry = no expiry (manual grant)
}

function resolvePlan(s) { return isPremiumActive(s) ? 'premium' : 'free'; }

function freeFeatureOn(settings, key) {
  const f = settings.tiers && settings.tiers.free && settings.tiers.free.features;
  if (f && typeof f[key] === 'boolean') return f[key];
  const def = FEATURES.find(x => x.key === key);
  return def ? def.freeDefault : false;
}

function canUse(student, key, settings) {
  return resolvePlan(student) === 'premium' || freeFeatureOn(settings, key);
}

function featureMap(student, settings) {
  const out = {};
  for (const k of FEATURE_KEYS) out[k] = canUse(student, k, settings);
  return out;
}

async function entitlementSummary(student, settingsArg = null) {
  const settings = settingsArg || await Settings.getGlobal();
  const plan = resolvePlan(student);
  return {
    plan,
    premiumPlan: plan === 'premium' ? (student.premiumPlan || null) : null,
    lifetime: plan === 'premium' && student.premiumPlan === 'lifetime',
    expiresAt: plan === 'premium' && student.premiumPlan !== 'lifetime' ? (student.tierExpiresAt || null) : null,
    features: featureMap(student, settings),
  };
}

// Express middleware factory. Re-reads the student's plan on every call, so an expired
// plan or a freshly flipped admin switch takes effect immediately and can't be bypassed
// by calling the API directly.
function requireFeature(key) {
  if (!FEATURE_KEYS.includes(key)) throw new Error(`Unknown feature "${key}"`);
  return async function featureGate(req, res, next) {
    try {
      const student = await Student.findOne({ matric: req.student.sub }).select('tier premiumPlan tierExpiresAt').lean();
      if (!student) return res.status(404).json({ error: 'Student not found' });
      const settings = await Settings.getGlobal();
      if (canUse(student, key, settings)) return next();
      const label = FEATURES.find(f => f.key === key).label;
      return res.status(403).json({
        error: `${label} isn't available on the Free plan. Upgrade to Premium to unlock it.`,
        code: 'FEATURE_LOCKED',
        feature: key,
        plan: 'free',
      });
    } catch (e) {
      console.error('[entitlements]', e.message);
      res.status(500).json({ error: 'Could not check your plan' });
    }
  };
}

module.exports = {
  FEATURES, FEATURE_KEYS, PREMIUM_PERIODS, PERIOD_DAYS, PERIOD_PRICE_FIELD,
  isPremiumActive, resolvePlan, canUse, featureMap, entitlementSummary, requireFeature,
};
