// sw.js
const VERSION = "v3";
const APP_SHELL_CACHE = `ifc-fragments-viewer-shell-${VERSION}`;
const RUNTIME_CACHE   = `ifc-fragments-viewer-runtime-${VERSION}`;

const ASSETS = [
  "./",
  "./index.html",
  "./sw.js",
];

// Helpers
const isCDN = (url) =>
  /(^https:\/\/cdn\.jsdelivr\.net\/)|(^https:\/\/unpkg\.com\/)|(^https:\/\/thatopen\.github\.io\/)/.test(url);

// Install: precache the app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_SHELL_CACHE);
      await cache.addAll(ASSETS.map((p) => new Request(p, { cache: "reload" })));
    })()
  );
  self.skipWaiting();
});

// Activate: clean old caches + enable navigation preload (if available)
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== APP_SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
      if ("navigationPreload" in self.registration) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

// Fetch handler
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1) SPA navigation: serve cached index.html as fallback
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          if (preload) return preload;
          return await fetch(request);
        } catch {
          const cache = await caches.open(APP_SHELL_CACHE);
          const cached = await cache.match("./index.html");
          return cached || new Response("Offline", { status: 503, statusText: "Offline" });
        }
      })()
    );
    return;
  }

  // 2) App shell static files (same-origin): cache-first
  if (url.origin === self.location.origin && ASSETS.includes(url.pathname.replace(/\/+$/, "/") || "/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_SHELL_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const resp = await fetch(request);
        cache.put(request, resp.clone());
        return resp;
      })()
    );
    return;
  }

  // 3) CDN & ThatOpen resources (Fragments, UI, worker, web-ifc WASM): stale-while-revalidate
  if (isCDN(request.url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((resp) => {
            try { cache.put(request, resp.clone()); } catch {}
            return resp;
          })
          .catch(() => null);
        return cached || (await networkPromise) || new Response("Network error", { status: 502 });
      })()
    );
    return;
  }

  // 4) Everything else: network first, fallback to cache if available
  event.respondWith(
    (async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(request);
        return cached || new Response("Offline", { status: 503 });
      }
    })()
  );
});

// Allow the page to trigger an immediate SW update
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
