const ActivityLog = require('../models/ActivityLog');

// ── Activity logging ──────────────────────────────────────────
// Rows are queued in memory and written in batches (every 2s, or as soon
// as 200 are waiting) so logging never slows a request down. If the DB is
// unreachable the queue is capped rather than growing forever.
const FLUSH_MS = 2000;
const FLUSH_AT = 200;
const MAX_QUEUE = 5000;
let queue = [];
let flushing = false;

// WAT (UTC+1, no DST) calendar day for a timestamp.
function watDay(d = new Date()) {
  return new Date(d.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function flushActivity() {
  if (flushing || !queue.length) return;
  flushing = true;
  const batch = queue.splice(0, queue.length);
  try {
    await ActivityLog.insertMany(batch, { ordered: false });
  } catch (e) {
    console.error(`[activity] Could not write ${batch.length} log rows:`, e.message);
    queue = batch.concat(queue).slice(-MAX_QUEUE); // put them back and retry next tick
  } finally { flushing = false; }
}
setInterval(flushActivity, FLUSH_MS).unref();

// Values under these keys are never stored, and long strings are cut down.
const SECRET_KEY = /pass(word)?|token|secret|authorization|adminkey|apikey|fingerprint|otp|pin/i;
const BULKY_KEY = /^(studyMaterial|message|content|notes|bookmarks)$/i; // user-written text: keep only its length

function redact(value) {
  try {
    const json = JSON.stringify(value, (k, v) => {
      if (k && SECRET_KEY.test(k)) return '[redacted]';
      if (k && BULKY_KEY.test(k)) return typeof v === 'string' ? `[${v.length} chars]` : '[omitted]';
      if (typeof v === 'string' && v.length > 200) return v.slice(0, 200) + '…';
      return v;
    });
    return json && json.length > 1000 ? json.slice(0, 1000) + '…' : (json || '');
  } catch (e) { return ''; }
}

function push(row) {
  const ts = row.ts || new Date();
  queue.push({ ts, day: watDay(ts), ...row });
  if (queue.length > MAX_QUEUE) queue.shift();
  if (queue.length >= FLUSH_AT) flushActivity();
}

// Manual entry for things that aren't HTTP requests (sockets, cron, credits).
function logActivity({ source = 'system', actorType = 'system', actor = '', action, detail = '', ip = '', status = 0 }) {
  push({
    source, actorType, actor: String(actor || ''), action: String(action || ''),
    detail: typeof detail === 'string' ? detail.slice(0, 1000) : redact(detail),
    ip, status,
  });
}

const PAGE_PATHS = new Set(['/', '/login', '/register', '/dashboard', '/admin', '/profile', '/contests', '/leaderboard', '/study-rooms', '/chat']);

// Express middleware: logs every /api request and every page view once the response is sent.
function activityMiddleware(req, res, next) {
  const p = req.path;
  const isApi = p.startsWith('/api/');
  const isPage = req.method === 'GET' && !isApi && (PAGE_PATHS.has(p) || p.endsWith('.html'));
  if (!isApi && !isPage) return next();

  const started = Date.now();
  res.on('finish', () => {
    try {
      const route = req.route && req.route.path ? `${req.baseUrl || ''}${req.route.path}` : null;
      const cleanPath = p.replace(/\/[a-f0-9]{24}(?=\/|$)/gi, '/:id');
      let actorType = 'anonymous';
      let actor = '';
      if (req.student) { actorType = 'student'; actor = req.student.sub; }
      else if (req.admin) { actorType = 'admin'; actor = req.admin.sub; }
      else if (req.body && typeof req.body === 'object') {
        // failed/attempted logins & registrations: record who they claimed to be
        const claimed = req.body.matric || req.body.username;
        if (typeof claimed === 'string') actor = claimed.slice(0, 60);
      }

      const mutating = req.method !== 'GET' && req.method !== 'HEAD';
      push({
        source: isPage ? 'page' : 'http',
        actorType, actor,
        action: isPage ? `page ${cleanPath}` : `${req.method} ${route || cleanPath}`,
        method: req.method,
        path: p,
        query: req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1, 200) : '',
        status: res.statusCode,
        ip: req.ip || '',
        ua: String(req.headers['user-agent'] || '').slice(0, 200),
        ms: Date.now() - started,
        detail: mutating && req.body && Object.keys(req.body).length ? redact(req.body) : '',
      });
    } catch (e) { /* logging must never break a request */ }
  });
  next();
}

// Deletes rows older than the retention window (0 = keep forever).
async function purgeOldActivity() {
  const days = parseInt(process.env.ACTIVITY_LOG_RETENTION_DAYS || '365', 10);
  if (!(days > 0)) return 0;
  const r = await ActivityLog.deleteMany({ ts: { $lt: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } });
  return r.deletedCount || 0;
}

module.exports = { logActivity, activityMiddleware, flushActivity, purgeOldActivity, watDay };
