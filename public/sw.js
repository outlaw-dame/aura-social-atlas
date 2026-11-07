/* Atlas service worker — offline shell for the /app phone app.
 *
 * Registered only by /app (scope "/app"), only in production, only over a secure
 * connection and only as a top-level page (src/lib/register-sw.ts).
 *
 * - Navigations: network first (with navigation preload); offline falls back to the cached /app shell.
 * - Hashed build assets (/assets/*): cache first — their names change whenever their content does.
 * - Icons and the manifest: stale-while-revalidate.
 * - API, auth and server-function requests, and anything that isn't GET: never touched.
 *   Where the browser supports Service Worker static routing (Safari 27, Chromium), those
 *   requests skip this worker entirely instead of waking it up just to pass them through.
 */
const VERSION = 'v1';
const SHELL_CACHE = `atlas-shell-${VERSION}`;
const ASSET_CACHE = `atlas-assets-${VERSION}`;
const ASSET_LIMIT = 120;
const SHELL_URL = '/app';
const PRECACHE = [SHELL_URL, '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/favicon.png'];

// Requests that must always go to the network (sign-in, API, server functions, OAuth callbacks).
const NETWORK_ONLY_PATHS = ['/api/', '/auth', '/fedizen.callback', '/_serverFn/', '/_server'];
const isNetworkOnly = (url) => NETWORK_ONLY_PATHS.some((p) => url.pathname.startsWith(p));

// Only same-origin hashed build assets are ever precached.
const MAX_PRECACHE_ASSETS = 100;
function buildAssetUrls(urls) {
  const out = new Set();
  for (const raw of urls) {
    try {
      const url = new URL(raw, self.location.origin);
      if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) out.add(url.pathname);
    } catch { /* not a URL */ }
    if (out.size >= MAX_PRECACHE_ASSETS) break;
  }
  return [...out];
}
async function precacheAssets(urls) {
  const cache = await caches.open(ASSET_CACHE);
  await Promise.allSettled(buildAssetUrls(urls).map(async (path) => {
    if (!(await cache.match(path))) await cache.add(path);
  }));
}

self.addEventListener('install', (event) => {
  // Static routing: let the browser bypass this worker for network-only traffic.
  if (typeof event.addRoutes === 'function') {
    const rules = [
      ...NETWORK_ONLY_PATHS.map((p) => ({ condition: { urlPattern: `${p}*` }, source: 'network' })),
      { condition: { requestMethod: 'POST' }, source: 'network' },
    ];
    // One rule per call: a condition this browser doesn't support must not drop the others.
    event.waitUntil(Promise.allSettled(rules.map((rule) => event.addRoutes(rule))));
  }
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll is all-or-nothing; one missing file must not abort the install.
    await Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
    // The page's own requests happened before this worker controlled it, so cache the scripts and
    // styles the shell HTML references now; otherwise an offline reload could not render it.
    const shell = await cache.match(SHELL_URL);
    if (shell) {
      const html = await shell.clone().text();
      await precacheAssets(html.match(/\/assets\/[^"'\s<>)]+/g) || []);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('atlas-') && !keep.has(n)).map((n) => caches.delete(n)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch { /* unsupported */ }
    }
    await self.clients.claim();
  })());
});

// Lazily loaded chunks (the Framework7 app itself) aren't in the HTML: the page reports what it loaded.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'atlas-precache' || !Array.isArray(data.urls)) return;
  event.waitUntil(precacheAssets(data.urls.filter((u) => typeof u === 'string')));
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function navigation(event) {
  try {
    const preloaded = await event.preloadResponse;
    const response = preloaded || (await fetch(event.request));
    if (response.ok && new URL(event.request.url).pathname === SHELL_URL) {
      const copy = response.clone();
      event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.put(SHELL_URL, copy)));
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(SHELL_URL)) || Response.error();
  }
}

async function cacheFirst(event) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const response = await fetch(event.request);
  if (response.ok) {
    const copy = response.clone();
    event.waitUntil(cache.put(event.request, copy).then(() => trim(ASSET_CACHE, ASSET_LIMIT)));
  }
  return response;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(event.request);
  const network = fetch(event.request).then((response) => {
    if (response.ok) return cache.put(event.request, response.clone()).then(() => response);
    return response;
  }).catch(() => undefined);
  if (hit) { event.waitUntil(network); return hit; }
  return (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isNetworkOnly(url)) return;
  if (request.mode === 'navigate') { event.respondWith(navigation(event)); return; }
  if (url.pathname.startsWith('/assets/')) { event.respondWith(cacheFirst(event)); return; }
  if (PRECACHE.includes(url.pathname)) { event.respondWith(staleWhileRevalidate(event)); }
});
