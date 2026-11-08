// Wreddi service worker (v1.9.1). Deliberately does nothing but exist: a fetch handler makes the app installable on Android,
// and passing every request straight through means it can never serve stale pages. Offline support would be a separate decision.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
