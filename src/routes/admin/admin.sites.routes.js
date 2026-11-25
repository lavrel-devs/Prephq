'use strict';
// v1.19 — Web pages (admin). Mounted in server.js under /api/admin/sites. Permission area: "sites" (see utils/adminAccess.js).
// Every change is written to the audit trail as sites.*
const express = require('express');
const mongoose = require('mongoose');

const EmbedSite = require('../../models/EmbedSite');
const E = require('../../services/embed.service');          // always called as E.fn(...) so tests can replace E.probe
const S = require('../../services/shortlink.service');
const { logActivity } = require('../../services/activity.service');

const router = express.Router();
const who = req => (req.admin && req.admin.sub) || '';
const audit = (req, action, detail) => { try { logActivity({ source: 'admin', actorType: 'admin', actor: who(req), action, detail, ip: req.ip, status: 200 }); } catch (e) {} };
const fail = (res, e) => { console.error('[admin sites]', e); res.status(500).json({ error: e.message }); };
const bad = (res, e) => res.status(400).json({ error: e.message });
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MAX_SITES = 500;

const ownHosts = req => [req.hostname].concat((process.env.SHORT_BASE_URL || '').trim() ? [new URL(process.env.SHORT_BASE_URL).hostname] : []);
const check = (req, url) => E.checkSite(url, req.get('host'), req.protocol, (u) => E.probe(u));
const row = (s, req) => ({
  _id: s._id, slug: s.slug, pageUrl: S.baseUrl(req) + '/w/' + s.slug, url: s.url, host: E.hostOf(s.url), title: s.title || '', description: s.description || '',
  mode: s.mode, active: s.active !== false, views: s.views || 0, lastViewAt: s.lastViewAt,
  embeddable: s.embeddable, embeddableReason: s.embeddableReason || '', checkedAt: s.checkedAt, createdBy: s.createdBy, createdAt: s.createdAt,
});

// list + totals
router.get('/sites', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100), page = Math.max(1, parseInt(req.query.page, 10) || 1), limit = 20;
    const f = {}; if (q) { const r = new RegExp(esc(q), 'i'); f.$or = [{ slug: r }, { url: r }, { title: r }]; }
    const [items, total, agg] = await Promise.all([
      EmbedSite.find(f).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      EmbedSite.countDocuments(f),
      EmbedSite.aggregate([{ $group: { _id: null, sites: { $sum: 1 }, views: { $sum: '$views' }, live: { $sum: { $cond: [{ $ne: ['$active', false] }, 1, 0] } } } }]),
    ]);
    const t = agg[0] || { sites: 0, views: 0, live: 0 };
    res.json({ items: items.map(s => row(s, req)), total, page, pages: Math.max(1, Math.ceil(total / limit)), totals: { sites: t.sites, live: t.live, views: t.views } });
  } catch (e) { fail(res, e); }
});

// check an address without saving anything (the "Check site" button)
router.post('/sites/check', async (req, res) => {
  try {
    let url; try { url = E.cleanEmbedUrl((req.body || {}).url, ownHosts(req)); } catch (e) { return bad(res, e); }
    const c = await check(req, url);
    res.json({ url, embeddable: c.embeddable, reason: c.reason, title: c.title, finalUrl: c.finalUrl, status: c.status });
  } catch (e) { fail(res, e); }
});

// create
router.post('/sites', async (req, res) => {
  try {
    const b = req.body || {};
    let url, title, description, slug, mode;
    try {
      url = E.cleanEmbedUrl(b.url, ownHosts(req)); title = E.cleanTitle(b.title); description = E.cleanDescription(b.description);
      if (String(b.slug || '').trim()) slug = E.cleanSlug(b.slug);
      if (b.mode) mode = E.cleanMode(b.mode);
    } catch (e) { return bad(res, e); }
    if (await EmbedSite.estimatedDocumentCount() >= MAX_SITES) return res.status(400).json({ error: 'Page limit reached (' + MAX_SITES + '). Delete old pages first.' });
    if (slug) { if (await EmbedSite.exists({ slug })) return res.status(409).json({ error: 'The page address "' + slug + '" is already used.' }); }
    else { for (let i = 0; i < 8 && !slug; i++) { const c = E.autoSlug(url); if (!(await EmbedSite.exists({ slug: c }))) slug = c; } if (!slug) return res.status(500).json({ error: 'Could not make a free page address. Try again.' }); }

    const c = await check(req, url);
    if (!title) title = E.cleanTitle(c.title);
    if (!mode) mode = c.embeddable === 'no' ? 'redirect' : 'embed';           // a site that refuses framing can only be redirected to
    let doc;
    try { doc = await EmbedSite.create({ slug, url, title, description, mode, embeddable: c.embeddable, embeddableReason: c.reason, checkedAt: new Date(), createdBy: who(req) }); }
    catch (e) { if (e && e.code === 11000) return res.status(409).json({ error: 'The page address "' + slug + '" is already used.' }); throw e; }
    audit(req, 'sites.create', slug + ' → ' + url + ' (' + mode + ', ' + c.embeddable + ')');
    res.json(row(doc.toObject(), req));
  } catch (e) { fail(res, e); }
});

// edit (address, title, description, mode, on/off). The page address (slug) never changes. A new site address is checked again.
router.put('/sites/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid page' });
    const b = req.body || {}, set = {};
    try {
      if (b.url !== undefined) set.url = E.cleanEmbedUrl(b.url, ownHosts(req));
      if (b.title !== undefined) set.title = E.cleanTitle(b.title);
      if (b.description !== undefined) set.description = E.cleanDescription(b.description);
      if (b.mode !== undefined) set.mode = E.cleanMode(b.mode);
    } catch (e) { return bad(res, e); }
    if (b.active !== undefined) set.active = !!b.active;
    if (!Object.keys(set).length) return res.status(400).json({ error: 'Nothing to change' });
    if (set.url) { const c = await check(req, set.url); Object.assign(set, { embeddable: c.embeddable, embeddableReason: c.reason, checkedAt: new Date() }); }
    const doc = await EmbedSite.findByIdAndUpdate(req.params.id, { $set: set }, { new: true }).lean();
    if (!doc) return res.status(404).json({ error: 'Page not found' });
    audit(req, 'sites.update', doc.slug + ' ' + Object.keys(set).filter(k => !/^embeddable|checkedAt/.test(k)).join(','));
    res.json(row(doc, req));
  } catch (e) { fail(res, e); }
});

// check the target again (sites change their headers)
router.post('/sites/:id/recheck', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid page' });
    const cur = await EmbedSite.findById(req.params.id).lean(); if (!cur) return res.status(404).json({ error: 'Page not found' });
    const c = await check(req, cur.url);
    const doc = await EmbedSite.findByIdAndUpdate(req.params.id, { $set: { embeddable: c.embeddable, embeddableReason: c.reason, checkedAt: new Date() } }, { new: true }).lean();
    audit(req, 'sites.recheck', cur.slug + ' ' + c.embeddable);
    res.json(row(doc, req));
  } catch (e) { fail(res, e); }
});

router.delete('/sites/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid page' });
    const doc = await EmbedSite.findByIdAndDelete(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Page not found' });
    audit(req, 'sites.delete', doc.slug + ' → ' + doc.url);
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

module.exports = router;
