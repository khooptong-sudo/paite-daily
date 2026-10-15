// Paite Daily service worker.
// Keeps the shell of the app on the device, so the page opens with no network.
// Nothing under /api/ or /review/ is cached: answers must reach the server, and
// the review pages belong to Cloudflare Access.

const CACHE = "paite-daily-v1";

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
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/review")) return;

  // A page: take the fresh copy, and keep it for the next offline visit.
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
        return response;
      } catch (error) {
        const hit = await caches.match(request);
        return hit || (await caches.match("/index.html")) || Response.error();
      }
    })());
    return;
  }

  // A file: take the stored copy, and fill the store from the network.
  event.respondWith((async () => {
    const hit = await caches.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
    return response;
  })());
});
