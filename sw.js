const CACHE_NAME = "parranda-v36";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=26",
  "./script.js?v=39",
  "./ux-pass1.js?v=10",
  "./manifest.webmanifest",
  "./vendor/leaflet/leaflet.css",
  "./vendor/leaflet/leaflet.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
];

// Place photos (/media/, docs/PLACE_MEDIA.md): network-first in their own
// bounded cache, so a photo the server no longer serves (404/410) also leaves
// the device, and an offline view still shows the photos it has seen.
const MEDIA_CACHE_NAME = "parranda-media-v1";
const MEDIA_CACHE_MAX_ENTRIES = 200;

const DYNAMIC_CACHEABLE_HOSTS = new Set([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "tile.openstreetmap.org",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== MEDIA_CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

async function cacheFirst(request) {
  const cached = await caches.match(request);

  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  const cache = await caches.open(CACHE_NAME);
  cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok || response.type === "opaque") {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || networkPromise;
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  // Cache keys keep insertion order and a put moves the key to the end, so the
  // front holds the photos fetched longest ago.
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maxEntries)).map((key) => cache.delete(key)));
}

async function networkFirstMedia(request) {
  const cache = await caches.open(MEDIA_CACHE_NAME);
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
  if (response.status === 404 || response.status === 410) {
    await cache.delete(request);
    return response;
  }
  if (response.ok) {
    await cache.put(request, response.clone());
    await trimCache(cache, MEDIA_CACHE_MAX_ENTRIES);
    return response;
  }
  // Upstream down (503) or rate limited (429): a photo seen before still shows.
  return (await cache.match(request)) || response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html")),
    );
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith("/media/")) {
    event.respondWith(networkFirstMedia(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (DYNAMIC_CACHEABLE_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
