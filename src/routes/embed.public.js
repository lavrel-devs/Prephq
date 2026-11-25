'use strict';
// v1.19 — Public page for a "web page" entry. Mounted in server.js:   app.use('/w', require('./src/routes/embed.public'));
// GET /w/<slug>: shows the other site in a frame under our domain, or redirects to it (mode "redirect"), or explains it can't be framed.
const express = require('express');
const EmbedSite = require('../models/EmbedSite');
const E = require('../services/embed.service');

const router = express.Router();
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
// Our own page only needs inline styles/script and the frame; it may frame any web address and nothing else can be loaded into it.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src http: https:; base-uri 'none'; form-action 'none'";

router.get('/:slug', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const slug = String(req.params.slug || '').toLowerCase();
    const msg = (code, t, m) => res.status(code).type('html').send(E.renderMessage(t, m));
    if (!SLUG.test(slug)) return msg(404, 'Page not found', 'This page does not exist. Check the address and try again.');
    const site = await EmbedSite.findOne({ slug }).lean();
    if (!site) return msg(404, 'Page not found', 'This page does not exist. Check the address and try again.');
    if (site.active === false) return msg(410, 'Page unavailable', 'This page has been switched off.');
    if (req.method === 'GET') EmbedSite.updateOne({ _id: site._id }, { $inc: { views: 1 }, $set: { lastViewAt: new Date() } }).catch(() => {});
    if (site.mode === 'redirect') return res.redirect(302, site.url);
    res.set('Content-Security-Policy', CSP);
    res.type('html').send(site.embeddable === 'no' ? E.renderFallback(site) : E.renderPage(site));
  } catch (e) { console.error('[web page]', e); if (!res.headersSent) res.status(500).type('html').send(E.renderMessage('Something went wrong', 'Please try again in a moment.')); }
});

module.exports = router;
