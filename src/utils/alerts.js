'use strict';
// v1.14 — turns raw monitor numbers into the plain-English alerts at the top of Admin > System & controls (pure, unit-tested).
function buildAlerts({ snap, dbPingMs, dbState, cfg, pendingSupport }) {
  const a = [];
  const add = (level, text) => a.push({ level, text });
  if (dbState !== 1) add('danger', 'The database connection is not healthy right now.');
  else if (dbPingMs > 800) add('warn', `Database is slow to answer (${dbPingMs} ms).`);
  if (snap.errorRate5 >= 5) add('danger', `${snap.errorRate5}% of requests failed with a server error in the last 5 minutes.`);
  else if (snap.errorRate5 >= 1) add('warn', `${snap.errorRate5}% of requests failed with a server error in the last 5 minutes.`);
  if (snap.p95Ms15 >= 2500) add('warn', `The slowest 5% of requests are taking ${snap.p95Ms15} ms.`);
  if (snap.now.lag >= 250) add('warn', `The server is busy: event-loop delay reached ${snap.now.lag} ms.`);
  if (snap.now.rss >= 420) add('warn', `Memory use is high (${snap.now.rss} MB). A restart may be needed soon.`);
  if (cfg.maintenance.enabled) add('danger', 'Maintenance mode is ON. Students cannot use Wreddi.');
  const off = Object.entries(cfg.switches).filter(([, v]) => v === false).map(([k]) => k);
  if (off.length) add('warn', `Switched off: ${off.join(', ')}.`);
  if (!cfg.secondary.enabled) add('warn', 'Wreddi Secondary is switched off.');
  if (pendingSupport >= 10) add('warn', `${pendingSupport} support requests are waiting.`);
  return a;
}


module.exports = { buildAlerts };
