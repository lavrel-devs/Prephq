'use strict';
// v1.18 — Public redirect for short links. Mount in server.js:   app.use('/l', require('./src/routes/shortlink.public'));
// GET /l/<code>  (/s/ is already the sponsor page) → 302 to the saved address. 302 (not 301) so editing a link's destination takes effect straight away.
const express = require('express');
const ShortLink = require('../models/ShortLink');
const ShortClick = require('../models/ShortClick');
const S = require('../services/shortlink.service');

const router = express.Router();

const page = (title, msg) => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' + title + '</title>' +
  '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f6fa;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1e293b;padding:24px}' +
  '.c{max-width:380px;text-align:center}h1{font-size:22px;margin:0 0 8px;color:#3E5C8A}p{margin:0 0 18px;line-height:1.5;color:#475569}a{display:inline-block;background:#3E5C8A;color:#fff;text-decoration:none;padding:11px 22px;border-radius:12px;font-weight:700}</style></head>' +
  '<body><div class="c"><h1>' + title + '</h1><p>' + msg + '</p><a href="/">Go to Wreddi</a></div></body></html>';

router.get('/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').toLowerCase();
    res.set('Cache-Control', 'no-store');
    if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(code)) return res.status(404).send(page('Link not found', 'This short link does not exist. Check the address and try again.'));
    const link = await ShortLink.findOne({ code }).lean();
    if (!link) return res.status(404).send(page('Link not found', 'This short link does not exist. Check the address and try again.'));
    if (!S.isLive(link)) return res.status(410).send(page('Link unavailable', 'This short link has expired or been switched off.'));
    res.redirect(302, link.url);
    // count after responding so a slow database never slows the redirect; HEAD requests (link previews) are not counted
    if (req.method === 'GET') {
      const now = Date.now();
      ShortLink.updateOne({ _id: link._id }, { $inc: { clicks: 1 }, $set: { lastClickAt: new Date(now) } }).catch(() => {});
      ShortClick.updateOne({ link: link._id, day: S.dayKey(now) }, { $inc: { n: 1 }, $setOnInsert: { at: new Date(now) } }, { upsert: true }).catch(() => {});
    }
  } catch (e) { console.error('[short link]', e); if (!res.headersSent) res.status(500).send(page('Something went wrong', 'Please try the link again in a moment.')); }
});

module.exports = router;
