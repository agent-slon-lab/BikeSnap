/*
 * BikeSnap service worker (v1.14.39) — офлайн-режим v3 с зеркальным фейловером.
 *
 * Стратегии:
 *  - /api/*            → только сеть (релеи анализа/калибровки/отчётов —
 *                        серверные функции, не кэшируются и не мешают офлайну)
 *  - навигация (HTML)  → ЛЕСТНИЦА (спека пользователя v1.14.39):
 *                        1) сеть этого origin;
 *                        2) НЕДОСТУПЕН (сетевая ошибка, напр. SNI-блок
 *                        vercel без VPN) → живое ли ЗЕРКАЛО agent-slon-lab
 *                        .github.io? живое → авто-переход на него (та же
 *                        версия появляется сразу — зеркало синкается с
 *                        каждым пушем);
 *                        3) зеркало тоже мёртв (инета нет) → офлайн-кэш.
 *                        HTTP !ok (503/404 в окно пропагации деплоя) —
 *                        НЕ редирект, а старый кэш: зеркало несёт то же
 *                        содержимое, падать на него незачем.
 *                        Редирект не выполняется на самом зеркале (цикл).
 *  - /version.json     → сеть-первым (детектор обновлений), офлайн → кэш
 *  - /_next/static/*   → кэш-первым: чанки иммутабельны и хэшированы в имени;
 *                        после деплоя новый HTML ссылается на НОВЫЕ имена,
 *                        их нет в кэше → придут по сети (v1.14.34);
 *                        v1.13.3–v1.14.31 были сеть-первыми из-за dev Turbopack,
 *                        но в dev SW вообще не регистрируется (register-sw)
 *  - /cdn/mediapipe/*  → кэш-первым (самохостинг ИИ-модулей: WASM + модель
 *                        лежат на том же origin — офлайн-анализ поз и
 *                        доступность из РФ без внешних CDN)
 *  - иконки/манифест   → кэш-первым
 *  - прочее GET        → сеть-первым с фолбэком на кэш
 *
 * Жизненный цикл (v1.14.34):
 *  - install НЕ делает skipWaiting: новая версия встаёт в ожидание и
 *    активируется ТОЛЬКО по кнопке «Обновить» в баннере (сообщение
 *    SKIP_WAITING от клиента) — никаких внезапных перезагрузок.
 *  - activate: удаляет старые bikesnap-кэши, clients.claim(), затем фоновой
 *    префетч замыкания /_next/static/* из HTML + ИИ-модулей: приложение
 *    становится полностью офлайн-capable уже после ПЕРВОЙ успешной загрузки.
 *  - имя кэша bikesnap-v<версия> синхронизировано с APP_VERSION: бампать
 *    при каждом релизе (activate сам удалит старый кэш).
 */
const VERSION = "v1.14.41";
const CACHE = `bikesnap-${VERSION}`;

// Зеркало (GitHub Pages) — запасной вход, когда этот origin недоступен
// (*.vercel.app блокируется по SNI без VPN). Зеркало синкается с каждым
// пушем в main (mirror-to-pages.yml), поэтому там всегда свежая версия.
const MIRROR_ORIGIN = "https://agent-slon-lab.github.io";

/**
 * Зеркальный URL с сохранением пути и query (зеркало развёрнуто в корне
 * github.io — пути совпадают 1:1). Экспорт не нужен: тест дергает через
 * vm-сэндбокс (scripts/test-mirror-failover.ts).
 */
function mirrorUrlFor(pathname, search) {
  return MIRROR_ORIGIN + pathname + search;
}

/**
 * Жив ли хост: no-cors-запрос с жёстким таймаутом. Резолв = хост ответил
 * (opaque-ответ, тело не нужно). Реджект/таймаут = недоступен.
 */
function probeAlive(url, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    fetch(url, { mode: "no-cors", cache: "no-store" }).then(
      () => done(true),
      () => done(false)
    );
  });
}

/**
 * Авто-переход на зеркало (v1.14.39): инлайновый HTML-редиректор вместо
 * Response.redirect() — работает во всех браузерах (meta refresh + JS),
 * не зависит от поддержки редиректов respondWith для навигаций.
 * location.replace — заменить запись истории, чтобы «Назад» не вело
 * на мёртвый origin.
 */
function mirrorRedirectResponse(target) {
  const html =
    "<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\">" +
    "<meta http-equiv=\"refresh\" content=\"0; url=" + target + "\">" +
    "<title>BikeSnap — переход на зеркало…</title></head><body>" +
    "<p style=\"font-family:sans-serif;padding:2rem\">Сайт недоступен, " +
    "переходим на зеркало…</p>" +
    "<script>location.replace(" + JSON.stringify(target) + ");</script>" +
    "</body></html>";
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/version.json",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

// Самохостинг MediaPipe (копия node_modules/@mediapipe/tasks-vision@1.0.1/wasm
// + pose_landmarker_lite): качаются в кэш сразу после активации.
const AI_ASSETS = [
  "/cdn/mediapipe/wasm/vision_wasm_internal.js",
  "/cdn/mediapipe/wasm/vision_wasm_internal.wasm",
  "/cdn/mediapipe/wasm/vision_wasm_nosimd_internal.js",
  "/cdn/mediapipe/wasm/vision_wasm_nosimd_internal.wasm",
  "/cdn/mediapipe/models/pose_landmarker_lite.task",
];

// Легаси-CDN: если какой-то модуль ещё тянет откуда-то извне — кэшируем
// в рантайме (opaque-ответы кэшируются и отдаются офлайн).
const CDN_HOSTS = new Set(["cdn.jsdelivr.net", "storage.googleapis.com"]);

// Пути ассетов внутри HTML/JS/CSS (в т.ч. экранированные "\/_next\/...").
const ASSET_RE =
  /\\?\/_next\/static\/[A-Za-z0-9._\-/]+\.(?:js|css|woff2?|png|jpe?g|svg|webp|avif|mp4|json|ico|txt)/g;
// Глубина замыкания: HTML → чанки JS/CSS → медиа/шрифты/вложенные чанки.
const PREFETCH_CAP = 400;

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
    // НЕ skipWaiting — см. шапку.
  );
});

self.addEventListener("message", (event) => {
  // Баннер «Доступно обновление» → кнопка «Обновить» шлёт SKIP_WAITING.
  if (
    event.data === "SKIP_WAITING" ||
    (event.data && event.data.type === "SKIP_WAITING")
  ) {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("bikesnap-") && k !== CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
      // Фоновый префетч — второй waitUntil: claim не ждёт его,
      // но SW не убьют, пока идёт закачка замыкания.
      event.waitUntil(prefetchClosure());
    })()
  );
});

/**
 * Замыкание ассетов: "/" (HTML) → все /_next/static/* из HTML → скан этих
 * JS/CSS на вложенные пути (шрифты, медиа, динамические чанки) → повтор,
 * пока не стабилизируется. Плюс ИИ-модули AI_ASSETS. Лучшие усилия:
 * отдельные сбои не отменяют общий префетч (runtime cache-first доберёт).
 */
async function prefetchClosure() {
  const cache = await caches.open(CACHE);
  const queue = ["/", ...AI_ASSETS];
  const seen = new Set();
  let html = "";

  for (let i = 0; i < queue.length && i < PREFETCH_CAP; i++) {
    const path = queue[i];
    if (seen.has(path)) continue;
    seen.add(path);
    try {
      const res = await fetch(path, { cache: "reload" });
      if (!res.ok) continue;
      await cache.put(path, res.clone());
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("text/html")) {
        html = await res.text();
        for (const m of html.matchAll(ASSET_RE)) {
          const clean = m[0].replace(/\\/g, "");
          if (!seen.has(clean)) queue.push(clean);
        }
      } else if (ct.includes("javascript") || ct.includes("css")) {
        const text = await res.text();
        for (const m of text.matchAll(ASSET_RE)) {
          const clean = m[0].replace(/\\/g, "");
          if (!seen.has(clean)) queue.push(clean);
        }
      }
    } catch {
      /* best effort: недоступный сейчас ассет доберётся при следующем онлайне */
    }
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Только GET
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isCdn = !sameOrigin && CDN_HOSTS.has(url.hostname);
  if (!sameOrigin && !isCdn) return;

  // Релеи — всегда сеть, никогда не кэшируем результаты анализа/отчёты
  if (sameOrigin && url.pathname.startsWith("/api/")) return;

  // HMR/EventSource в dev — не перехватываем
  if (sameOrigin && url.pathname.startsWith("/_next/webpack-hmr")) return;

  // Навигация: ЛЕСТНИЦА v1.14.39 —
  //  1) сеть этого origin (свежий HTML всегда, когда origin жив);
  //  2) сетевая ошибка (origin недоступен, напр. vercel без VPN) →
  //     зеркало живое? → авто-переход на него (свежая версия сразу);
  //  3) зеркало мертво / нет инета → офлайн-кэш (старый рабочий экран
  //     лучше белого экрана).
  // HTTP !ok (окно пропагации деплоя) — без редиректа: зеркало несёт то
  // же содержимое, через мгновение оживёт и этот origin → старый кэш.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (!response.ok) {
            const stale =
              (await caches.match("/")) || (await caches.match(request));
            return stale || response;
          }
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/", copy));
          return response;
        } catch (networkError) {
          // Сетевая ошибка = origin недоступен целиком. На самом зеркале
          // редирект не делаем (иначе цикл при его недоступности).
          if (
            self.location.origin !== MIRROR_ORIGIN &&
            (await probeAlive(MIRROR_ORIGIN + "/version.json", 3500))
          ) {
            return mirrorRedirectResponse(
              mirrorUrlFor(url.pathname, url.search)
            );
          }
          const hit =
            (await caches.match("/")) || (await caches.match(request));
          return hit || Response.error();
        }
      })()
    );
    return;
  }

  // version.json: сеть-первым — это детектор обновлений (баннер, CI-поллинг).
  if (sameOrigin && url.pathname === "/version.json") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response.ok) throw new Error("ver-" + response.status);
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((hit) => {
            if (!hit) return Response.error();
            // v1.14.38: маркер «ответ из кэша — сеть до сервера недоступна».
            // Страница (OfflineBadge) по нему показывает офлайн-плашку,
            // вместо молчаливой старой версии («почему обновы не приходят»).
            const headers = new Headers(hit.headers);
            headers.set("X-BikeSnap-From-Cache", "1");
            return new Response(hit.body, {
              status: hit.status,
              statusText: hit.statusText,
              headers,
            });
          })
        )
    );
    return;
  }

  // Иммутабельное → кэш-первым:
  //  - /_next/static/* — имена чанков хэшированы по контенту;
  //  - /cdn/mediapipe/* — самохостинг ИИ (офлайн-анализ поз);
  //  - иконки/манифест;
  //  - легаси-CDN (opaque-ответы кэшируются).
  const cacheFirst =
    (sameOrigin &&
      (url.pathname.startsWith("/_next/static/") ||
        url.pathname.startsWith("/cdn/mediapipe/") ||
        url.pathname === "/manifest.webmanifest" ||
        url.pathname.startsWith("/icon-") ||
        url.pathname === "/apple-touch-icon.png")) ||
    isCdn;

  if (cacheFirst) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok || response.type === "opaque") {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  // Остальное same-origin: сеть-первым с фолбэком на кэш.
  // !ok (например 404 после нового деплоя) — сначала пробуем старую копию.
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
