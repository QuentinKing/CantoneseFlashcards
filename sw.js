// Offline support, tuned for flaky connections (e.g. the subway):
// "stale-while-revalidate" - answer instantly from the on-device cache, then fetch
// a fresh copy in the background for next time. The app never waits on the network
// once it has been opened online at least once.
// Trade-off: after you push a change to cards.txt, the phone shows it on the
// *second* launch (first launch downloads it, second launch uses it).
const CACHE = 'cantonese-flashcards-v2';
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
  // Pronunciation audio is fetched straight from its host; the app falls back to TTS when it can't load.
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const refresh = fetch(req)
      .then((res) => {
        if (res.status === 200) cache.put(req, res.clone());
        return res;
      })
      .catch(() => null);
    if (cached) {
      e.waitUntil(refresh); // keep the background update alive after we've responded
      return cached;
    }
    return (await refresh) || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
