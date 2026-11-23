'use strict';
// v1.14 — lightweight in-process monitoring. No database writes and no extra dependencies: requests are counted into
// per-minute buckets, routes are aggregated, 5xx errors and slow requests are kept in small rings, and a 30-second sampler
// records memory, CPU and event-loop lag. Everything resets on restart; that is by design (it is a "right now" view).
const MIN = 60000, KEEP_MIN = 70, SLOW_MS = 1500;
const st = { startedAt: Date.now(), buckets: new Map(), routes: new Map(), errors: [], slow: [], durs: [], samples: [], lagMax: 0, lastTick: Date.now(), lastCpu: process.cpuUsage(), lastCpuAt: Date.now(), timers: [] };

function percentile(arr, p) {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1))];
}

// "/api/questions/chm141" -> "/api/questions/:key" so routes group together instead of one row per id.
function normalizePath(url) {
  return String(url || '').split('?')[0].split('/').map(seg => {
    if (!seg) return seg;
    if (/^[0-9a-f]{24}$/i.test(seg)) return ':id';
    if (/^\d+$/.test(seg)) return ':n';
    if (seg.length >= 20) return ':token';
    if (/\d/.test(seg) && /[A-Za-z]/.test(seg) && seg.length >= 5) return ':key';
    return seg;
  }).join('/') || '/';
}

const push = (arr, item, cap) => { arr.push(item); if (arr.length > cap) arr.splice(0, arr.length - cap); };

function record(method, url, status, ms, now = Date.now()) {
  const minute = Math.floor(now / MIN) * MIN;
  let b = st.buckets.get(minute); if (!b) { b = { n: 0, e4: 0, e5: 0, ms: 0, max: 0 }; st.buckets.set(minute, b); }
  b.n++; b.ms += ms; if (ms > b.max) b.max = ms; if (status >= 500) b.e5++; else if (status >= 400) b.e4++;
  for (const k of st.buckets.keys()) if (k < minute - KEEP_MIN * MIN) st.buckets.delete(k);

  const route = `${method} ${normalizePath(url)}`;
  let r = st.routes.get(route); if (!r) { if (st.routes.size > 600) return; r = { n: 0, e4: 0, e5: 0, ms: 0, max: 0, last: 0 }; st.routes.set(route, r); }
  r.n++; r.ms += ms; r.last = now; if (ms > r.max) r.max = ms; if (status >= 500) r.e5++; else if (status >= 400) r.e4++;

  push(st.durs, { t: now, ms }, 3000);
  if (ms >= SLOW_MS) push(st.slow, { t: now, route, status, ms: Math.round(ms) }, 50);
}

function middleware(req, res, next) {
  if (!String(req.originalUrl || req.url).startsWith('/api')) return next();
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    record(req.method, req.originalUrl || req.url, res.statusCode, ms);
    if (res.statusCode >= 500 && !(res.locals && res.locals.__errLogged)) push(st.errors, { t: Date.now(), route: `${req.method} ${normalizePath(req.originalUrl || req.url)}`, status: res.statusCode, message: '' }, 100);
  });
  next();
}

// Called from the global error handler: remembers what actually went wrong.
function recordError(err, req, res) {
  try {
    if (res && res.locals) res.locals.__errLogged = true;
    const line = String((err && err.stack) || '').split('\n').find(l => /\/src\/|server\.js/.test(l)) || '';
    push(st.errors, { t: Date.now(), route: req ? `${req.method} ${normalizePath(req.originalUrl || req.url)}` : '', status: 500, message: String((err && err.message) || err).slice(0, 300), where: line.trim().slice(0, 160) }, 100);
  } catch (e) { /* never let monitoring throw */ }
}

function sample() {
  const now = Date.now(), mem = process.memoryUsage(), cpu = process.cpuUsage();
  const used = (cpu.user - st.lastCpu.user + cpu.system - st.lastCpu.system) / 1000;   // ms of CPU
  const pct = Math.min(100, Math.round((used / Math.max(1, now - st.lastCpuAt)) * 100));
  st.lastCpu = cpu; st.lastCpuAt = now;
  push(st.samples, { t: now, rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576), lag: Math.round(st.lagMax), cpu: pct }, 120);
  st.lagMax = 0;
}

function start() {
  if (st.timers.length) return;
  st.lastTick = Date.now();
  st.timers.push(setInterval(() => { const now = Date.now(); const drift = now - st.lastTick - 1000; st.lastTick = now; if (drift > st.lagMax) st.lagMax = Math.max(0, drift); }, 1000));
  st.timers.push(setInterval(sample, 30000));
  st.timers.forEach(t => t.unref && t.unref());
  sample();
}

function snapshot(now = Date.now()) {
  const minute = Math.floor(now / MIN) * MIN;
  const series = [];
  for (let i = 59; i >= 0; i--) { const b = st.buckets.get(minute - i * MIN); series.push({ t: minute - i * MIN, n: b ? b.n : 0, e4: b ? b.e4 : 0, e5: b ? b.e5 : 0, avg: b && b.n ? Math.round(b.ms / b.n) : 0 }); }
  const sum = (from, f) => series.filter(s => s.t >= from).reduce((a, s) => a + s[f], 0);
  const last5 = now - 5 * MIN, last15 = now - 15 * MIN;
  const n5 = sum(last5, 'n'), e5_5 = sum(last5, 'e5'), e4_5 = sum(last5, 'e4');
  const recent = st.durs.filter(d => d.t >= last15).map(d => d.ms);
  const routes = [...st.routes.entries()].map(([route, r]) => ({ route, n: r.n, e4: r.e4, e5: r.e5, avg: Math.round(r.ms / r.n), max: Math.round(r.max) }));
  const latest = st.samples[st.samples.length - 1] || { rss: 0, heap: 0, lag: 0, cpu: 0 };
  return {
    startedAt: st.startedAt, uptimeSec: Math.round(process.uptime()),
    rpm5: Math.round((n5 / 5) * 10) / 10, requests60: sum(minute - 59 * MIN, 'n'),
    errorRate5: n5 ? Math.round((e5_5 / n5) * 1000) / 10 : 0, clientErrorRate5: n5 ? Math.round((e4_5 / n5) * 1000) / 10 : 0,
    avgMs15: recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 0, p95Ms15: Math.round(percentile(recent, 95)), p99Ms15: Math.round(percentile(recent, 99)),
    series, samples: st.samples.slice(-120), now: latest,
    topRoutes: routes.slice().sort((a, b) => b.n - a.n).slice(0, 12),
    slowestRoutes: routes.filter(r => r.n >= 3).sort((a, b) => b.avg - a.avg).slice(0, 8),
    errorRoutes: routes.filter(r => r.e5 > 0).sort((a, b) => b.e5 - a.e5).slice(0, 8),
    slow: st.slow.slice(-20).reverse(), errorCount: st.errors.length,
  };
}

const getErrors = () => st.errors.slice().reverse();
const clearErrors = () => { const n = st.errors.length; st.errors.length = 0; st.slow.length = 0; return n; };

module.exports = { middleware, recordError, start, snapshot, getErrors, clearErrors, percentile, normalizePath, record, _state: st };
