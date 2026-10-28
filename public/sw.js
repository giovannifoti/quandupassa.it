// Service worker: app utilizzabile offline (ricerca, preferiti, elenco fermate).
// Le tessere della mappa (OpenFreeMap) non vengono salvate.
const VERSION = 'v21';
const SHELL_CACHE = `qp-shell-${VERSION}`;
const VENDOR_CACHE = 'qp-vendor-maplibre-6.16.0';
const SHELL_ASSETS = [
  '/',
  '/css/base.css',
  '/css/app.css',
  '/js/sun.js',
  '/js/app.js',
  '/js/stops.js',
  '/js/favorites.js',
  '/js/map.js',
  '/stops_fixed.json',
  '/manifest.json',
  '/img/favicon.svg',
  '/icon-192.png'
];
const VENDOR_ASSETS = [
  '/vendor/maplibre-gl-6.16.0/maplibre-gl.mjs',
  '/vendor/maplibre-gl-6.16.0/maplibre-gl-worker.mjs',
  '/vendor/maplibre-gl-6.16.0/maplibre-gl.css'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL_ASSETS);
    const vendor = await caches.open(VENDOR_CACHE);
    // La libreria della mappa è opzionale per l'avvio offline: un errore non blocca l'installazione.
    await vendor.addAll(VENDOR_ASSETS).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, VENDOR_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.filter(name => !keep.has(name)).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request, url));
    return;
  }

  if (url.pathname.startsWith('/vendor/')) {
    event.respondWith(cacheFirst(request, VENDOR_CACHE));
    return;
  }

  event.respondWith(networkFirst(request));
});

async function handleNavigation(request, url) {
  try {
    const response = await fetch(request);
    // Solo le risposte valide della home aggiornano la copia offline
    // (mai una pagina 404 o di errore).
    if (response.ok && url.pathname === '/') {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put('/', response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(url.pathname, { ignoreSearch: true })) ||
      (await cache.match('/')) ||
      Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

// File dell'app: sempre dalla rete quando possibile, così HTML, CSS e JS
// restano coerenti dopo ogni deploy; la cache serve solo offline.
async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}
