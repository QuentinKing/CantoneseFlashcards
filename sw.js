// Offline support, tuned for flaky connections (e.g. the subway):
// "stale-while-revalidate" - answer instantly from the on-device cache, then fetch
// a fresh copy in the background for next time. The app never waits on the network
// once it has been opened online at least once.
// Trade-off: after you push a change to cards.txt, the phone shows it on the
// *second* launch (first launch downloads it, second launch uses it).
// Pronunciation files in audio/ never change once made, so they are cache-first and
// all of them are downloaded at install so the real recordings work offline too.
const CACHE = 'cantonese-flashcards-v3';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'cards.txt', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

// Local audio paths listed in cards.txt (4th field, e.g. "audio/nei5-hou2.wav").
function audioPathsFrom(text) {
  const paths = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/(?:^|[\s,"])(audio\/[^\s,"]+)/g) || [];
    m.forEach((p) => paths.add(p.replace(/^[\s,"]/, '')));
  }
  return [...paths];
}

async function cacheAudio(cache, cardsText) {
  // Individually, so one missing file can't break the install.
  await Promise.all(audioPathsFrom(cardsText).map(async (p) => {
    if (await cache.match(p)) return;
    try { const r = await fetch(p); if (r.ok) await cache.put(p, r); } catch { /* offline; retry later */ }
  }));
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    const cards = await cache.match('cards.txt');
    if (cards) await cacheAudio(cache, await cards.text());
    await self.skipWaiting();
  })());
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
  const url = new URL(req.url);
  // Audio on other websites is fetched straight from its host; the app falls back to TTS.
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });

    if (url.pathname.includes('/audio/')) {
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res.status === 200) cache.put(req, res.clone());
        return res;
      } catch {
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    }

    const refresh = fetch(req)
      .then((res) => {
        if (res.status === 200) {
          cache.put(req, res.clone());
          // A new deck may list new audio files: fetch those in the background too.
          if (url.pathname.endsWith('/cards.txt')) res.clone().text().then((t) => cacheAudio(cache, t));
        }
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
