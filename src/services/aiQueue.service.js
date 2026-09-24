// Spaces out and retries every AI (Groq) request so nobody has to keep re-clicking after a
// "rate limit — wait a few seconds" error.
//  - Requests START at least GROQ_MIN_GAP_MS apart (default 2.2s), never all at once.
//  - On a rate-limit (429) the whole queue pauses for the time Groq asks for, then the request is retried
//    automatically. Interactive requests (students, admin single clicks) go first; bulk jobs use 'low'.
//  - Interactive requests give up after a short wait with a friendly message; bulk jobs wait as long as needed
//    (up to GROQ_LOW_MAX_WAIT_MS, default 30 min) so a big note run just carries on when the limit resets.
const MIN_GAP = () => Number(process.env.GROQ_MIN_GAP_MS || 2200);
const MAX_CONCURRENT = () => Math.max(1, Number(process.env.GROQ_CONCURRENCY || 3));
const HIGH_MAX_WAIT = () => Number(process.env.GROQ_HIGH_MAX_WAIT_MS || 30000);
const LOW_MAX_WAIT = () => Number(process.env.GROQ_LOW_MAX_WAIT_MS || 30 * 60000);

const queues = { high: [], low: [] };
let active = 0, activeLow = 0, nextStart = 0, pausedUntil = 0, timer = null;

const sleepLeft = (t) => Math.max(0, t - Date.now());

function status() {
  return { waiting: queues.high.length + queues.low.length, active, pausedUntil: pausedUntil > Date.now() ? pausedUntil : null };
}

function pump() {
  if (timer) { clearTimeout(timer); timer = null; }
  while (active < MAX_CONCURRENT()) {
    const job = queues.high[0] ? 'high' : (queues.low[0] && activeLow < 1 ? 'low' : null);
    if (!job) return;
    const wait = Math.max(sleepLeft(nextStart), sleepLeft(pausedUntil));
    if (wait > 0) { timer = setTimeout(pump, wait); return; }
    const item = queues[job].shift();
    nextStart = Date.now() + MIN_GAP();
    active++; if (job === 'low') activeLow++;
    runItem(item, job).finally(() => { active--; if (job === 'low') activeLow--; pump(); });
  }
}

async function runItem(item, lane) {
  try {
    item.resolve(await item.fn());
  } catch (e) {
    if (e && e.code === 'GROQ_RATE_LIMITED') {
      const wait = Math.max(e.retryAfterMs || 5000, 1000) + Math.floor(Math.random() * 700);
      const limit = lane === 'low' ? LOW_MAX_WAIT() : HIGH_MAX_WAIT();
      item.attempts++;
      if (wait > limit || item.attempts > (lane === 'low' ? 40 : 4)) {
        const err = new Error(`The AI is very busy right now. Please try again in about ${fmt(wait)}.`);
        err.code = 'GROQ_BUSY'; err.retryAfterMs = wait;
        return item.reject(err);
      }
      pausedUntil = Math.max(pausedUntil, Date.now() + wait);
      queues[lane].unshift(item);   // retry first, in the same lane
      return;
    }
    item.reject(e);
  }
}

function fmt(ms) { const s = Math.ceil(ms / 1000); return s < 90 ? `${s} seconds` : `${Math.ceil(s / 60)} minutes`; }

// run(fn, { priority: 'high' | 'low' }) -> Promise of fn()'s result
function run(fn, { priority = 'high' } = {}) {
  return new Promise((resolve, reject) => {
    queues[priority === 'low' ? 'low' : 'high'].push({ fn, resolve, reject, attempts: 0 });
    pump();
  });
}

// Parses how long Groq wants us to wait, from the Retry-After header or the message text
// ("Please try again in 7.66s", "in 1m3.4s", "in 23m12s", "in 450ms").
function parseRetryAfter(headers, text) {
  const h = headers && headers.get && headers.get('retry-after');
  if (h && !isNaN(Number(h))) return Math.ceil(Number(h) * 1000);
  const m = /try again in\s+(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)s)?\s*(?:([\d.]+)ms)?/i.exec(text || '');
  if (m && (m[1] || m[2] || m[3] || m[4])) {
    return Math.ceil(((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000 + (+m[4] || 0));
  }
  return 8000;
}

module.exports = { run, status, parseRetryAfter, _reset() { queues.high.length = 0; queues.low.length = 0; active = activeLow = 0; nextStart = pausedUntil = 0; } };
