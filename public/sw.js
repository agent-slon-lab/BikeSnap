/*
 * BikeSnap service worker (v1.14.18)
 * Стратегии:
 *  - /api/*            → только сеть (анализ/калибровка не кэшируются)
 *  - навигация         → сеть-первым, офлайн-фолбэк на "/";
 *                        v1.14.18: ответ !ok (503/404 в окно пропагации
 *                        деплоя) тоже падает на кэшированную оболочку —
 *                        старая версия лучше белого экрана
 *  - /_next/static/*   → сеть-первым с фолбэком на кэш (v1.13.3: НЕ кэш-первым —
 *                        в dev Turbopack меняет контент чанков под теми же URL,
 *                        cache-first отдавал мёртвый код после HMR);
 *                        v1.14.18: 404 чанка после нового деплоя → пробуем
 *                        старую копию из кэша, прежде чем отдать 404 странице
 *  - иконки/манифест   → кэш-первым (по-настоящему immutable)
 *  - остальное GET     → сеть-первым с фолбэком на кэш
 * Имя кэша синхронизировано с APP_VERSION: при релизе обновлять вместе с ней.
 */
const CACHE = "bikesnap-v1.14.22";
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

  // Иконки/манифест — по-настоящему immutable → кэш-первым.
  // v1.13.3: /_next/static ИСКЛЮЧЁН из cache-first — в dev Turbopack меняет
  // контент чанков под теми же URL (HMR), кэш-первым отдавал мёртвый код
  // («module factory is not available»). Теперь они идут по сети-первой
  // стратегией внизу (фолбэк на кэш — только для офлайна).
  const cacheFirst =
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

  // Навигация: сеть-первым, офлайн → оболочка "/".
  // v1.14.18: !ok (в т.ч. 503/404 в окно пропагации деплоя) — тоже фолбэк
  // на кэшированную оболочку: старый рабочий экран лучше ошибки.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response.ok) throw new Error("nav-" + response.status);
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/").then((hit) => hit || Response.error()))
    );
    return;
  }

  // Остальное: сеть-первым с фолбэком на кэш (офлайн-запуск MediaPipe и пр.).
  // v1.14.18: !ok (например 404 чанка после нового деплоя) — сначала пробуем
  // старую копию из кэша, и только если её нет — отдаём плохой ответ как есть.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (!response.ok) {
          return caches.match(request).then((hit) => hit || response);
        }
        if (response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || Response.error()))
  );
});
