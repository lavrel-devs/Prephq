'use strict';
// v1.18 — Short links (admin). Mounted from admin.command.routes.js, so it lives under /api/admin/links.
// Permission area: "links" (see utils/adminAccess.js). Every change is written to the audit trail as links.*
const express = require('express');
const mongoose = require('mongoose');

const ShortLink = require('../../models/ShortLink');
const ShortClick = require('../../models/ShortClick');
const S = require('../../services/shortlink.service');
const { logActivity } = require('../../services/activity.service');

const router = express.Router();
const who = req => (req.admin && req.admin.sub) || '';
const audit = (req, action, detail) => { try { logActivity({ source: 'admin', actorType: 'admin', actor: who(req), action, detail, ip: req.ip, status: 200 }); } catch (e) {} };
const fail = (res, e) => { console.error('[admin links]', e); res.status(500).json({ error: e.message }); };
const bad = (res, e) => res.status(400).json({ error: e.message });
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MAX_LINKS = 20000;

const ownHosts = req => [req.hostname].concat((process.env.SHORT_BASE_URL || '').trim() ? [new URL(process.env.SHORT_BASE_URL).hostname] : []);
const row = (l, req) => ({
  _id: l._id, code: l.code, shortUrl: S.baseUrl(req) + '/l/' + l.code, url: l.url, title: l.title || '',
  clicks: l.clicks || 0, lastClickAt: l.lastClickAt, expiresAt: l.expiresAt, active: l.active !== false,
  status: S.statusOf(l), createdBy: l.createdBy, createdAt: l.createdAt,
});

// ── list (search + status filter + paging) with totals ─────────
router.get('/links', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100), status = String(req.query.status || '');
    const page = Math.max(1, parseInt(req.query.page, 10) || 1), limit = 25, now = new Date();
    const f = {};
    if (q) { const r = new RegExp(esc(q), 'i'); f.$or = [{ code: r }, { url: r }, { title: r }]; }
    if (status === 'off') f.active = false;
    else if (status === 'expired') { f.active = { $ne: false }; f.expiresAt = { $lte: now }; }
    else if (status === 'live') { f.active = { $ne: false }; f.$and = [{ $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }]; }
    const [items, total, all] = await Promise.all([
      ShortLink.find(f).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ShortLink.countDocuments(f),
      ShortLink.aggregate([{ $group: { _id: null, links: { $sum: 1 }, clicks: { $sum: '$clicks' }, live: { $sum: { $cond: [{ $and: [{ $ne: ['$active', false] }, { $or: [{ $eq: ['$expiresAt', null] }, { $gt: ['$expiresAt', now] }] }] }, 1, 0] } } } }]),
    ]);
    const t = all[0] || { links: 0, clicks: 0, live: 0 };
    res.json({ items: items.map(l => row(l, req)), total, page, pages: Math.max(1, Math.ceil(total / limit)), totals: { links: t.links, clicks: t.clicks, live: t.live } });
  } catch (e) { fail(res, e); }
});

// ── create ─────────────────────────────────────────────────────
router.post('/links', async (req, res) => {
  try {
    const b = req.body || {};
    let url, title, expiresAt, code;
    try { url = S.cleanUrl(b.url, ownHosts(req)); title = S.cleanTitle(b.title); expiresAt = S.cleanExpiry(b.expiresAt); if (String(b.code || '').trim()) code = S.cleanCode(b.code); } catch (e) { return bad(res, e); }
    if (await ShortLink.estimatedDocumentCount() >= MAX_LINKS) return res.status(400).json({ error: 'Link limit reached (' + MAX_LINKS + '). Delete old links first.' });
    if (code) {
      if (await ShortLink.exists({ code })) return res.status(409).json({ error: 'The code "' + code + '" is already used.' });
    } else {
      for (let i = 0; i < 8 && !code; i++) { const c = S.generateCode(i < 5 ? 6 : 7); if (!(await ShortLink.exists({ code: c }))) code = c; }
      if (!code) return res.status(500).json({ error: 'Could not make a free code. Try again.' });
    }
    let doc;
    try { doc = await ShortLink.create({ code, url, title, expiresAt, createdBy: who(req) }); }
    catch (e) { if (e && e.code === 11000) return res.status(409).json({ error: 'The code "' + code + '" is already used.' }); throw e; }
    audit(req, 'links.create', code + ' → ' + url);
    res.json(row(doc.toObject(), req));
  } catch (e) { fail(res, e); }
});

// ── edit: destination, title, expiry, on/off (the code itself never changes, so printed links keep working) ──
router.put('/links/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid link' });
    const b = req.body || {}, set = {};
    try {
      if (b.url !== undefined) set.url = S.cleanUrl(b.url, ownHosts(req));
      if (b.title !== undefined) set.title = S.cleanTitle(b.title);
      if (b.expiresAt !== undefined) set.expiresAt = S.cleanExpiry(b.expiresAt);
    } catch (e) { return bad(res, e); }
    if (b.active !== undefined) set.active = !!b.active;
    if (!Object.keys(set).length) return res.status(400).json({ error: 'Nothing to change' });
    const doc = await ShortLink.findByIdAndUpdate(req.params.id, { $set: set }, { new: true }).lean();
    if (!doc) return res.status(404).json({ error: 'Link not found' });
    audit(req, 'links.update', doc.code + ' ' + Object.keys(set).join(','));
    res.json(row(doc, req));
  } catch (e) { fail(res, e); }
});

// ── delete ─────────────────────────────────────────────────────
router.delete('/links/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid link' });
    const doc = await ShortLink.findByIdAndDelete(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Link not found' });
    await ShortClick.deleteMany({ link: doc._id });
    audit(req, 'links.delete', doc.code + ' → ' + doc.url);
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

// ── clicks per day, last 30 days (Nigerian dates) ──────────────
router.get('/links/:id/stats', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid link' });
    const link = await ShortLink.findById(req.params.id).lean();
    if (!link) return res.status(404).json({ error: 'Link not found' });
    const now = Date.now(), days = [];
    for (let i = 29; i >= 0; i--) days.push(S.dayKey(now - i * 86400000));
    const rows = await ShortClick.find({ link: link._id, day: { $in: days } }).lean();
    const by = Object.fromEntries(rows.map(r => [r.day, r.n]));
    const series = days.map(d => ({ day: d, value: by[d] || 0 }));
    res.json({ link: row(link, req), series, last30: series.reduce((a, x) => a + x.value, 0) });
  } catch (e) { fail(res, e); }
});

module.exports = router;
