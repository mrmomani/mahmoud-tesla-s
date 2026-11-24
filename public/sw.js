// Offline support. Bump CACHE_NAME when files in public/ change so installed copies refresh;
// hashed build assets under assets/ never change in place, so they are safe to cache forever.
const CACHE_NAME = 'mahmoud-tesla-s-v1';
const CORE_ASSETS = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg'];
const MAX_ENTRIES = 60;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data?.type !== 'cache-urls' || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter(
    (url) =>
      typeof url === 'string' && new URL(url, self.location.href).origin === self.location.origin,
  );
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(urls))
      .catch(() => undefined),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  } else if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? (await cache.match('./index.html')) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached ?? Response.error());
  return cached ?? refresh;
}

async function trim(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_ENTRIES;
  for (const key of keys.slice(0, Math.max(0, excess))) await cache.delete(key);
}
