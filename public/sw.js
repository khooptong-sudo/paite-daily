// Paite Daily service worker.
// Fresh copy first. The stored copy answers only when the network is gone, so
// the app still opens with no connection.
//
// An earlier version of this file trusted the stored copy first. That pinned
// the old styles and strings on every device that had visited, and hid every
// later deploy. Do not go back to that order. Raise CACHE when the shell
// changes, so the old store is dropped on activate.

const CACHE = "paite-daily-v2";

const SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/contributors.css",
  "/strings.js",
  "/app.js",
  "/back.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One missing file must not stop the install.
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only reads of our own pages and files. Answers must reach the server, and
  // the review pages belong to Cloudflare Access.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/review")) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
      return response;
    } catch (error) {
      const hit = await caches.match(request);
      if (hit) return hit;
      if (request.mode === "navigate") return (await caches.match("/index.html")) || Response.error();
      throw error;
    }
  })());
});
