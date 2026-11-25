const CACHE_NAME = "habitt-offline-v1";
const OFFLINE_URL = "/offline";
const EXCLUDED_PREFIXES = [
  "/api/",
  "/admin/",
  "/checkout",
  "/account",
  "/staff",
  "/auth",
];

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

  if (EXCLUDED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return;
  }

  if (request.headers.has("Authorization")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.headers.has("Set-Cookie")) {
            return response;
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(OFFLINE_URL);
          return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        })
    );
  }
});
