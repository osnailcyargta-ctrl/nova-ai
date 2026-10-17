// sw.js - service worker: offline shell + cached model weights
const VERSION = "nova-v1";
const SHELL = [
  "./", "./index.html", "./css/style.css",
  "./js/model.js", "./js/games.js", "./js/app.js",
  "./manifest.webmanifest", "./icons/icon-64.png", "./icons/icon-192.png", "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  // model weights: cache-first, immutable
  if (url.pathname.includes("/models/")) {
    e.respondWith(
      caches.open(VERSION).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }

  // navigation: network-first, fallback to cached shell (offline)
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          caches.open(VERSION).then((c) => c.put("./index.html", res.clone()));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // other shell assets: stale-while-revalidate
  e.respondWith(
    caches.open(VERSION).then(async (c) => {
      const hit = await c.match(e.request);
      const fetchP = fetch(e.request).then((res) => {
        if (res.ok) c.put(e.request, res.clone());
        return res;
      }).catch(() => hit);
      return hit || fetchP;
    })
  );
});
