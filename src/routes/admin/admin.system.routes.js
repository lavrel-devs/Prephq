'use strict';
// v1.14 — System & controls (admin). Live monitoring, the platform controls (maintenance mode, banner, feature switches),
// the error log, database overview, maintenance tools and an audit trail of control changes. Permission area 'system'.
const express = require('express');
const mongoose = require('mongoose');
const Student = require('../../models/Student');
const Session = require('../../models/Session');
const Notification = require('../../models/Notification');
const ActivityLog = require('../../models/ActivityLog');
const SupportRequest = require('../../models/SupportRequest');
const Score = require('../../models/Score');
const monitor = require('../../services/monitor.service');
const cfgSvc = require('../../services/platformConfig.service');
const { logActivity } = require('../../services/activity.service');

const router = express.Router();
const who = req => (req.admin && req.admin.sub) || '';
const audit = (req, action, detail) => { try { logActivity({ source: 'admin', actorType: 'admin', actor: who(req), action, detail, ip: req.ip, status: 200 }); } catch (e) {} };
const ago = ms => new Date(Date.now() - ms);

const { buildAlerts } = require('../../utils/alerts');

router.get('/platform/monitor', async (req, res) => {
  try {
    const t0 = Date.now(); let dbPingMs = null;
    try { await mongoose.connection.db.admin().ping(); dbPingMs = Date.now() - t0; } catch (e) { dbPingMs = null; }
    const [cfg, online5, online30, secOnline5, sessions, pendingSupport, secPapers1h, byTier] = await Promise.all([
      cfgSvc.get(),
      Student.countDocuments({ lastActiveAt: { $gte: ago(5 * 60000) } }),
      Student.countDocuments({ lastActiveAt: { $gte: ago(30 * 60000) } }),
      Student.countDocuments({ track: 'secondary', lastActiveAt: { $gte: ago(5 * 60000) } }),
      Session.aggregate([{ $match: { revoked: false, expiresAt: { $gt: new Date() } } }, { $group: { _id: '$role', n: { $sum: 1 } } }]),
      SupportRequest.countDocuments({ status: 'open' }),
      Score.countDocuments({ sec: { $exists: true }, ts: { $gte: ago(3600000) } }),
      Student.aggregate([{ $group: { _id: '$track', n: { $sum: 1 } } }]),
    ]);
    const snap = monitor.snapshot();
    const sess = Object.fromEntries(sessions.map(s => [s._id, s.n]));
    res.json({
      snapshot: snap, dbPingMs, dbState: mongoose.connection.readyState,
      online: { five: online5, thirty: online30, secondaryFive: secOnline5, universityFive: Math.max(0, online5 - secOnline5) },
      sessions: { students: sess.student || 0, admins: sess.admin || 0 }, pendingSupport, secondaryPapersLastHour: secPapers1h,
      accounts: Object.fromEntries(byTier.map(r => [r._id || 'university', r.n])),
      server: { node: process.version, platform: process.platform, pid: process.pid, env: process.env.NODE_ENV || 'development', appVersion: require('../../../package.json').version },
      controls: { maintenance: cfg.maintenance.enabled, banner: cfg.banner.enabled, switchesOff: Object.entries(cfg.switches).filter(([, v]) => v === false).map(([k]) => k), secondaryEnabled: cfg.secondary.enabled },
      alerts: buildAlerts({ snap, dbPingMs, dbState: mongoose.connection.readyState, cfg, pendingSupport }),
    });
  } catch (e) { console.error('[admin monitor]', e); res.status(500).json({ error: e.message }); }
});

router.get('/platform/errors', (req, res) => res.json({ errors: monitor.getErrors(), slow: monitor.snapshot().slow }));
router.post('/platform/errors/clear', (req, res) => { const n = monitor.clearErrors(); audit(req, 'platform.errors.clear', String(n)); res.json({ cleared: n }); });

// ── Controls ──
router.get('/platform/controls', async (req, res) => {
  try { const cfg = await cfgSvc.get(true); res.json({ maintenance: cfg.maintenance, banner: cfg.banner, switches: cfg.switches, secondary: { enabled: cfg.secondary.enabled, signupsOpen: cfg.secondary.signupsOpen } }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/platform/controls', async (req, res) => {
  try {
    const b = req.body || {}; const patch = {};
    for (const k of ['maintenance', 'banner', 'switches']) if (b[k]) patch[k] = b[k];
    if (b.secondary) patch.secondary = { ...(('enabled' in b.secondary) ? { enabled: b.secondary.enabled } : {}), ...(('signupsOpen' in b.secondary) ? { signupsOpen: b.secondary.signupsOpen } : {}) };
    const cfg = await cfgSvc.update(patch, who(req));
    audit(req, 'platform.controls', JSON.stringify(patch).slice(0, 500));
    res.json({ maintenance: cfg.maintenance, banner: cfg.banner, switches: cfg.switches, secondary: { enabled: cfg.secondary.enabled, signupsOpen: cfg.secondary.signupsOpen } });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Database overview ──
router.get('/platform/db', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const cols = await db.listCollections({}, { nameOnly: true }).toArray();
    const rows = await Promise.all(cols.map(async c => {
      let count = 0, size = null, idx = null;
      try { count = await db.collection(c.name).estimatedDocumentCount(); } catch (e) {}
      try { const s = await db.command({ collStats: c.name }); size = s.size; idx = s.totalIndexSize; } catch (e) {}
      return { name: c.name, count, sizeKB: size === null ? null : Math.round(size / 1024), indexKB: idx === null ? null : Math.round(idx / 1024) };
    }));
    let total = null; try { const s = await db.stats(); total = { dataMB: Math.round((s.dataSize || 0) / 1048576 * 10) / 10, storageMB: Math.round((s.storageSize || 0) / 1048576 * 10) / 10, indexMB: Math.round((s.indexSize || 0) / 1048576 * 10) / 10 }; } catch (e) {}
    res.json({ total, collections: rows.sort((a, b) => b.count - a.count) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Maintenance tools (dry-run by default) ──
const PURGE = {
  sessions:      { label: 'Expired / signed-out sessions', min: 1,  filter: d => ({ $or: [{ expiresAt: { $lt: new Date() } }, { revoked: true, revokedAt: { $lt: ago(d * 86400000) } }] }), model: Session },
  notifications: { label: 'Read notifications',            min: 14, filter: d => ({ read: true, createdAt: { $lt: ago(d * 86400000) } }), model: Notification },
  activity:      { label: 'Activity log rows',             min: 30, filter: d => ({ ts: { $lt: ago(d * 86400000) } }), model: ActivityLog },
};
router.post('/platform/maintenance/purge', async (req, res) => {
  try {
    const { what, days, dryRun } = req.body || {}; const rule = PURGE[what];
    if (!rule) return res.status(400).json({ error: 'Choose what to clean up' });
    const d = Number.parseInt(days, 10) || rule.min; if (d < rule.min || d > 3650) return res.status(400).json({ error: `Keep at least ${rule.min} days` });
    const f = rule.filter(d);
    const matched = await rule.model.countDocuments(f);
    if (dryRun !== false) return res.json({ dryRun: true, what, days: d, matched });
    const r = await rule.model.deleteMany(f); audit(req, 'platform.purge', `${what} older than ${d}d: ${r.deletedCount}`);
    res.json({ success: true, what, days: d, deleted: r.deletedCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Emergency: sign every student (or one app's students) out. They land on the sign-in page within ~30 seconds.
router.post('/platform/sessions/signout-all', async (req, res) => {
  try {
    const { track, confirm } = req.body || {};
    if (confirm !== 'SIGN OUT') return res.status(400).json({ error: 'Type SIGN OUT to confirm' });
    let f = { role: 'student', revoked: false };
    if (track === 'secondary' || track === 'university') {
      const m = await Student.find(track === 'secondary' ? { track: 'secondary' } : { track: { $ne: 'secondary' } }).distinct('matric'); f.subjectId = { $in: m };
    } else if (track !== 'all') return res.status(400).json({ error: 'track must be all, university or secondary' });
    const r = await Session.updateMany(f, { $set: { revoked: true, revokedAt: new Date() } });
    audit(req, 'platform.signout-all', `${track}: ${r.modifiedCount}`); res.json({ success: true, signedOut: r.modifiedCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/platform/audit', async (req, res) => {
  try {
    const rows = await ActivityLog.find({ source: 'admin', action: { $regex: /^(platform|secondary)\./ } }).sort({ ts: -1 }).limit(100).select('ts actor action detail ip').lean();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
