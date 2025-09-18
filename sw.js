const CACHE = "ifc-fragments-viewer-v1";
const ASSETS = ["./", "./index.html"]; // the app shell

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Cache-first for our shell; network for everything else (CDNs, models).
  if (ASSETS.includes(new URL(request.url).pathname.replace(/\/+$/, "/"))) {
    event.respondWith(caches.match(request).then((r) => r || fetch(request)));
  }
});
