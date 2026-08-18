// 45 Minutes · Stats — Service Worker
// App-shell cache-first; snapshot fetches (GitHub) bypass cache for freshness.

const CACHE = "45stats-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icon.svg",
  "./icon-maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Live snapshot data → always fetch fresh, never cache.
  if (
    url.hostname === "api.github.com" ||
    url.hostname === "raw.githubusercontent.com"
  ) {
    return;
  }

  // Own origin → cache-first, fall back to network, then to cached index for navigations.
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req)
            .then((resp) => {
              if (resp && resp.status === 200 && resp.type === "basic") {
                const copy = resp.clone();
                caches.open(CACHE).then((c) => c.put(req, copy));
              }
              return resp;
            })
            .catch(() => {
              if (req.mode === "navigate") return caches.match("./index.html");
            })
      )
    );
    return;
  }

  // Google Fonts → cache-first, refresh in background.
  if (
    url.hostname.endsWith("googleapis.com") ||
    url.hostname.endsWith("gstatic.com")
  ) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const fetching = fetch(req)
            .then((resp) => {
              if (resp && resp.status === 200) cache.put(req, resp.clone());
              return resp;
            })
            .catch(() => cached);
          return cached || fetching;
        })
      )
    );
  }
});
