/* Account-scoped, expiring browser recovery records for unfinished student attempts. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PhqAttemptRecovery = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const VERSION = 1;
  const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const kinds = new Set(['quiz', 'written']);

  // Keep the account identifier out of the key and record while still separating shared-browser accounts.
  function scopeFor(student) {
    const value = String(student == null ? '' : student).trim().toUpperCase();
    if (!value) return '';
    let a = 2166136261, b = 2246822519;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      a = Math.imul(a ^ code, 16777619);
      b = Math.imul(b ^ (code + (a >>> 16)), 3266489917);
    }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }

  function keyFor(kind, student) {
    if (!kinds.has(kind)) throw new TypeError('Unknown attempt type');
    const owner = scopeFor(student);
    return owner ? `phq_${kind}_resume_v${VERSION}_${owner}` : null;
  }

  function write(storage, kind, student, data, updatedAt) {
    const key = keyFor(kind, student);
    if (!key || !storage || !data || typeof data !== 'object') return null;
    const now = Number.isFinite(updatedAt) ? updatedAt : Date.now();
    const record = { ...data, version: VERSION, owner: scopeFor(student), updatedAt: now };
    try { storage.setItem(key, JSON.stringify(record)); return record; }
    catch (e) { return null; }
  }

  function read(storage, kind, student, now, validate) {
    const key = keyFor(kind, student);
    if (!key || !storage) return null;
    let record;
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      record = JSON.parse(raw);
    } catch (e) {
      try { storage.removeItem(key); } catch (ignored) {}
      return null;
    }
    if (!record || record.owner !== scopeFor(student)) return null;
    const time = Number.isFinite(now) ? now : Date.now();
    const age = time - Number(record.updatedAt);
    const envelopeOK = record.version === VERSION && Number.isFinite(record.updatedAt) && age >= -5 * 60 * 1000 && age <= MAX_AGE_MS;
    let dataOK = envelopeOK;
    if (dataOK && typeof validate === 'function') {
      try { dataOK = !!validate(record); } catch (e) { dataOK = false; }
    }
    if (!dataOK) {
      try { storage.removeItem(key); } catch (ignored) {}
      return null;
    }
    return record;
  }

  function clear(storage, kind, student) {
    const key = keyFor(kind, student);
    if (!key || !storage) return false;
    try { storage.removeItem(key); return true; } catch (e) { return false; }
  }

  return { VERSION, MAX_AGE_MS, scopeFor, keyFor, write, read, clear };
});
