// Tiny in-process, per-key mutex. Serializes async work that must not
// interleave (a student double-tapping "Join", parallel transfer
// requests from one sender, etc). PrepHQ runs as a single Node process,
// so this is enough; if it ever scales to several instances, replace
// with a Mongo-backed or Redis lock and keep the same call signature.
const tails = new Map();

async function withLock(key, fn) {
  const prev = tails.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tail = prev.then(() => gate);
  tails.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

module.exports = { withLock };
