const express = require('express');
const ActivityLog = require('../../models/ActivityLog');
const { requireAdmin } = require('../../middleware/auth');
const { csvRow } = require('../../utils/csv');
const { escapeRegex } = require('../../utils/validate');

const router = express.Router();
router.use(requireAdmin);
// Owner-only: enforced centrally by adminGate (utils/adminAccess.js → 'OWNER').

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const wat = (d) => new Date(new Date(d).getTime() + 3600000).toISOString().replace('Z', '+01:00');

function buildFilter(q) {
  const filter = {};
  if (!DAY_RE.test(String(q.date || ''))) return null;
  filter.day = q.date;
  if (typeof q.actor === 'string' && q.actor.trim()) filter.actor = new RegExp(escapeRegex(q.actor.trim().slice(0, 60)), 'i');
  if (typeof q.action === 'string' && q.action.trim()) filter.action = new RegExp(escapeRegex(q.action.trim().slice(0, 80)), 'i');
  if (typeof q.source === 'string' && ['http', 'page', 'socket', 'system', 'credit'].includes(q.source)) filter.source = q.source;
  if (q.status === 'errors') filter.status = { $gte: 400 };
  return filter;
}

// GET /api/admin/activity/days — which days have logs, with counts (newest first)
router.get('/activity/days', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 400);
    const rows = await ActivityLog.aggregate([
      { $group: { _id: '$day', count: { $sum: 1 }, errors: { $sum: { $cond: [{ $gte: ['$status', 400] }, 1, 0] } } } },
      { $sort: { _id: -1 } },
      { $limit: limit },
    ]);
    res.json(rows.map(r => ({ date: r._id, count: r.count, errors: r.errors })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/activity?date=YYYY-MM-DD&actor=&action=&source=&status=errors&page=1
router.get('/activity', async (req, res) => {
  try {
    const filter = buildFilter(req.query);
    if (!filter) return res.status(400).json({ error: 'date (YYYY-MM-DD) is required' });
    const limit = 100;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const [total, rows] = await Promise.all([
      ActivityLog.countDocuments(filter),
      ActivityLog.find(filter).sort({ ts: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    res.json({ total, page, pages: Math.ceil(total / limit) || 1, rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/activity/download?date=YYYY-MM-DD&format=csv|jsonl — the full day, streamed.
router.get('/activity/download', async (req, res) => {
  try {
    const date = String(req.query.date || '');
    if (!DAY_RE.test(date)) return res.status(400).json({ error: 'date (YYYY-MM-DD) is required' });
    const asJson = req.query.format === 'jsonl';

    res.setHeader('Content-Type', asJson ? 'application/x-ndjson; charset=utf-8' : 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="prephq-activity-${date}.${asJson ? 'jsonl' : 'csv'}"`);
    if (!asJson) {
      res.write('\ufeff'); // BOM so Excel opens it as UTF-8
      res.write('time_wat,time_utc,source,actor_type,actor,action,method,path,query,status,duration_ms,ip,user_agent,detail\n');
    }

    const cursor = ActivityLog.find({ day: date }).sort({ ts: 1 }).lean().cursor();
    let n = 0;
    for (let r = await cursor.next(); r; r = await cursor.next()) {
      if (asJson) res.write(JSON.stringify({ ...r, _id: undefined, time_wat: wat(r.ts) }) + '\n');
      else res.write(csvRow([wat(r.ts), r.ts, r.source, r.actorType, r.actor, r.action, r.method, r.path, r.query, r.status, r.ms, r.ip, r.ua, r.detail]) + '\n');
      n++;
    }
    if (!n && !asJson) res.write('\n');
    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else res.end();
  }
});

module.exports = router;
