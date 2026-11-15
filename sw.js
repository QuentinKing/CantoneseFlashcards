// Offline support: network-first so edits to cards.txt show up right away,
// with a cached copy used when there is no connection.
const CACHE = 'cantonese-flashcards-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'cards.txt', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;
  // Pronunciation audio is fetched straight from its host (offline, the app falls back to TTS).
  if (!sameOrigin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
