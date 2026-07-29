/*
 * MANIFEST service worker.
 *
 * Deliberately minimal. This database holds private notes about real people,
 * so the cache holds the app shell and nothing else — no rolodex data is ever
 * written to disk by this worker. Offline capture is queued in IndexedDB by the
 * page (see src/lib/offline-queue.ts) and replayed over the network on
 * reconnect; the worker only makes the shell load so that queue is reachable.
 */

const SHELL_CACHE = 'manifest-shell-v1';
const SHELL_ASSETS = ['/offline', '/manifest.webmanifest', '/icons/icon-192.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API responses or auth. Those carry live data and session state.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  // Navigations: network first, falling back to the offline page. The operator
  // gets stale-free data when online and a working capture form when not.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match('/offline');
        return cached ?? new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }),
    );
    return;
  }

  // Static build assets are content-hashed, so cache-first is safe.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});

// The page asks for a replay when it comes back online; this also covers the
// case where the tab was closed before reconnecting.
self.addEventListener('sync', (event) => {
  if (event.tag === 'manifest-flush-captures') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
        for (const client of clients) client.postMessage({ type: 'flush-captures' });
      }),
    );
  }
});
