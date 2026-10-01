/*
 * BikeSnap service worker (v1.8.0)
 * Стратегии:
 *  - /api/*            → только сеть (анализ/калибровка не кэшируются)
 *  - навигация         → сеть-первым, офлайн-фолбэк на "/"
 *  - /_next/static/*   → кэш-первым (immutable, хэши в имени)
 *  - иконки/манифест   → кэш-первым
 *  - остальное GET     → сеть-первым с фолбэком на кэш
 * Имя кэша синхронизировано с APP_VERSION: при релизе обновлять вместе с ней.
 */
const CACHE = "bikesnap-v1.8.0";
const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        // cache:'reload' — обойти HTTP-кэш, чтобы в офлайн попало свежее
        Promise.allSettled(
          SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })))
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("bikesnap-") && k !== CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Только GET, только свой origin
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API — всегда сеть, никогда не кэшируем результаты анализа
  if (url.pathname.startsWith("/api/")) return;

  // HMR/EventSource в dev — не перехватываем
  if (url.pathname.startsWith("/_next/webpack-hmr")) return;

  // Иммутабельные статики Next (хэш в имени) и наши иконки — кэш-первым
  const cacheFirst =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/apple-touch-icon.png";

  if (cacheFirst) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
    return;
  }

  // Навигация: сеть-первым, офлайн → оболочка "/"
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/").then((hit) => hit || Response.error()))
    );
    return;
  }

  // Остальное: сеть-первым с фолбэком на кэш (офлайн-запуск MediaPipe и пр.)
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || Response.error()))
  );
});
