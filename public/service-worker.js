const CACHE_STATIC = 'oct-static-v7';
const CACHE_DYNAMIC = 'oct-dyn-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/placeholder-vehicle.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![CACHE_STATIC, CACHE_DYNAMIC].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;

  if (url.origin === self.location.origin) {
    // API: network-first
    if (url.pathname.startsWith('/api/')) {
      event.respondWith(networkFirst(req));
      return;
    }
    // Uploaded images: cache-first
    if (url.pathname.startsWith('/uploads/')) {
      event.respondWith(cacheFirst(req));
      return;
    }
    // Navigations: try network then fallback to cached index
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
      event.respondWith(
        fetch(req)
          .then((res) => {
            const clone = res.clone();
            caches.open(CACHE_STATIC).then((c) => c.put('/index.html', clone));
            return res;
          })
          .catch(() => caches.match('/index.html'))
      );
      return;
    }
    // Static assets: cache-first
    event.respondWith(cacheFirst(req));
    return;
  }

  // Third-party (e.g., icon CDN): stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_STATIC);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE_DYNAMIC);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_DYNAMIC);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  });
  return cached || fetchPromise;
}
