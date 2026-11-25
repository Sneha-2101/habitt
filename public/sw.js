const CACHE_NAME = "habitt-offline-v1";
const OFFLINE_URL = "/offline";
const EXCLUDED_BASES = [
  "/admin",
  "/checkout",
  "/account",
  "/staff",
  "/auth",
];

function isExcludedPath(pathname) {
  if (pathname.startsWith("/api/")) {
    return true;
  }
  return EXCLUDED_BASES.some(
    (base) => pathname === base || pathname.startsWith(`${base}/`)
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (isExcludedPath(url.pathname)) {
    return;
  }

  if (request.headers.has("Authorization")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      })
    );
  }
});
