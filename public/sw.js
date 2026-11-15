/* FacilitiesManagement service worker: caches the app shell so it opens on poor connections.
   API calls (Supabase) are never cached; offline task updates are queued by the app itself (src/lib/offlineQueue.ts). */

/* Raise this version whenever the caching rules change. On activate every cache whose name does
   not match is deleted, which is also how a browser holding a bad entry is repaired. */
const CACHE = 'fm-shell-v2';
const SHELL = ['/', '/index.html', '/offline.html', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/fonts/Inter-Regular.woff', '/fonts/Inter-SemiBold.woff', '/fonts/Inter-Bold.woff'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

/* Only store a response that is actually the thing that was asked for.

   A single-page host answers a request for a file it does not have with index.html. If that HTML
   were stored under a .js or .css URL, every later load would serve markup where the browser
   expects a module — and because this cache is consulted before the network, the app would stay
   broken until the cache was cleared by hand. Checking the content type keeps one bad moment
   during a deploy from becoming a lasting fault. */
function worthCaching(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return false;
  const path = new URL(request.url).pathname;
  const type = response.headers.get('content-type') || '';
  if (/\.(js|mjs)$/.test(path)) return type.includes('javascript');
  if (/\.css$/.test(path)) return type.includes('css');
  if (/\.(woff2?|ttf|otf)$/.test(path)) return type.includes('font') || type.includes('octet-stream');
  return true;
}

function store(request, response) {
  if (!worthCaching(request, response)) return;
  const copy = response.clone();
  caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => undefined);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, tiles, etc. go straight to the network

  /* Pages come from the network first, so a new deploy is picked up immediately, and the copy
     kept for offline use is refreshed each time that succeeds. */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) store(new Request('/index.html'), res);
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/offline.html'))),
    );
    return;
  }

  /* Assets and fonts carry a content hash in the name, so a hit is always the right file. */
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/')) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      store(req, res);
      return res;
    })));
  }
});
