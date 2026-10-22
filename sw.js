/*
 * BikeSnap service worker (v1.14.47) — НАСТОЯЩЕЕ офлайн-приложение.
 *
 * Спека пользователя (v1.14.46): «Vercel нужен только для обновы! У нас
 * офлайн-прил! Никаких переходов на зеркало — только скачать обновление!»
 *
 * Стратегии:
 *  - навигация (HTML)  → КЭШ-ПЕРВЫМ, МГНОВЕННО. Приложение всегда
 *                        открывается из локального кэша, сеть не участвует
 *                        на критическом пути. НИКАКИХ РЕДИРЕКТОВ.
 *                        Только первый визит (кэша ещё нет): этот origin
 *                        1 сек → зеркало 1 сек (кросс-доменный cors-ответ
 *                        показывается с текущего адреса, БЕЗ перехода).
 *  - /api/*            → только сеть (релеи анализа/калибровки/отчётов).
 *  - /version.json     → кэш мгновенно + фоновая ревалидация 1 сек.
 *  - /_next/static/*   → кэш-первым (чанки иммутабельны, имена хэшированы).
 *  - /cdn/mediapipe/*  → кэш-первым (самохостинг ИИ-модулей: офлайн-анализ
 *                        поз без внешних CDN).
 *  - иконки/манифест   → кэш-первым.
 *  - прочее GET        → сеть-первым с фолбэком на кэш.
 *
 * ЗАГРУЗЧИК ОБНОВЫ (фон, никогда не блокирует открытие):
 *  1) зонд VERCEL /version.json — 1 сек (спека: «запросы по 1сек»);
 *  2) мёртв → зонд ЗЕРКАЛО (github.io, CORS открыт) — 1 сек;
 *  3) оба молчат → живём на локальной копии, ждём следующей проверки.
 *  Живой источник ≠ версия в кэше → скачиваем ОБНОВУ ЦЕЛИКОМ (HTML +
 *  замыкание /_next/static/* + недостающие ИИ-модули) и кладём В ЛОКАЛЬНЫЙ
 *  кэш под обычными путями. Следующее открытие — уже новая версия, всё
 *  офлайн. Адресная строка не меняется, переходов нет.
 *
 * Жизненный цикл:
 *  - install НЕ делает skipWaiting; активация по SKIP_WAITING от клиента
 *    (тихое автообновление v1.14.45) — без плашек и баннеров.
 *  - activate: чистка старых bikesnap-кэшей, clients.claim(), фоновый
 *    префетч замыкания /_next/static/* этого origin + ИИ-модулей.
 *  - проверка обновы: activate + каждое открытие приложения (троттлинг
 *    3 мин) + сообщение CHECK_UPDATE от страницы.
 */
const VERSION = "v1.14.47";
const CACHE = `bikesnap-${VERSION}`;

// Источники обновы по приоритету (спека: сначала Vercel, потом ГХ).
const PROD_ORIGIN = "https://bike-snap.vercel.app";
const MIRROR_ORIGIN = "https://agent-slon-lab.github.io/BikeSnap";

// Спека пользователя: «эти запросы по 1сек сделай».
const PROBE_TIMEOUT_MS = 1000;
const NAV_TIMEOUT_MS = 1000;
// Скачивание ассетов обновы — не «запрос наличия», даём 15 сек на файл.
const ASSET_TIMEOUT_MS = 15000;
// Троттлинг фоновой проверки обновы.
const UPDATE_THROTTLE_MS = 3 * 60 * 1000;
let lastUpdateCheck = 0;

const SHELL = [
  "/BikeSnap/",
  "/BikeSnap/manifest.webmanifest",
  "/BikeSnap/version.json",
  "/BikeSnap/icon-192.png",
  "/BikeSnap/icon-512.png",
  "/BikeSnap/icon-maskable-512.png",
  "/BikeSnap/apple-touch-icon.png",
];

// Самохостинг MediaPipe (копия node_modules/@mediapipe/tasks-vision@1.0.1/wasm
// + pose_landmarker_full — v1.14.42, lite остался в репо как запасной):
// качаются в кэш сразу после активации; загрузчик обновы докачивает их
// с источника обновы, только если их ещё нет в кэше (модель тяжёлая).
const AI_ASSETS = [
  "/BikeSnap/cdn/mediapipe/wasm/vision_wasm_internal.js",
  "/BikeSnap/cdn/mediapipe/wasm/vision_wasm_internal.wasm",
  "/BikeSnap/cdn/mediapipe/wasm/vision_wasm_nosimd_internal.js",
  "/BikeSnap/cdn/mediapipe/wasm/vision_wasm_nosimd_internal.wasm",
  "/BikeSnap/cdn/mediapipe/models/pose_landmarker_full.task",
];

// Легаси-CDN: если какой-то модуль ещё тянет откуда-то извне — кэшируем
// в рантайме (opaque-ответы кэшируются и отдаются офлайн).
const CDN_HOSTS = new Set(["cdn.jsdelivr.net", "storage.googleapis.com"]);

// Пути ассетов внутри HTML/JS/CSS — в т.ч. экранированные (Next.js в
// JSON/RSC-полезной нагрузке экранирует КАЖДЫЙ слеш: "\/_next\/static\/...").
const ASSET_RE =
  /\\?\/(?:BikeSnap\\?\/)?\\?_next\\?\/static\\?\/[A-Za-z0-9._\-/\\]+?\.(?:js|css|woff2?|png|jpe?g|svg|webp|avif|mp4|json|ico|txt)/g;
// Глубина замыкания: HTML → чанки JS/CSS → медиа/шрифты/вложенные чанки.
const PREFETCH_CAP = 400;

/** fetch с жёстким таймаутом (AbortController). */
function fetchTimeout(url, timeoutMs, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() =>
    clearTimeout(timer)
  );
}

/**
 * Зонд источника обновы: fetch /version.json (cors, 1 сек) — сразу и
 * проверка «жив ли», и получение номера версии. Ответ сохраняется для
 * последующего cache.put (клон делаем ДО чтения тела).
 */
async function probeVersion(origin) {
  try {
    const res = await fetchTimeout(
      origin + "/version.json?t=" + Date.now(),
      PROBE_TIMEOUT_MS,
      { mode: "cors", cache: "no-store" }
    );
    if (!res.ok) return null;
    const clone = res.clone();
    const data = await res.json();
    if (!data || typeof data.version !== "string") return null;
    return { origin: origin, version: data.version, res: clone };
  } catch {
    return null;
  }
}

/** Первый живой источник обновы: Vercel → зеркало. Оба молчат → null. */
async function findUpdateSource() {
  const prod = await probeVersion(PROD_ORIGIN);
  if (prod) return prod;
  return await probeVersion(MIRROR_ORIGIN);
}

/** Версия, записанная в локальном кэше (результат прошлой закачки). */
async function cachedVersion() {
  const hit = await caches.match("/BikeSnap/version.json");
  if (!hit) return null;
  try {
    const data = await hit.json();
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * СКАЧАТЬ ОБНОВУ с живого источника в ЛОКАЛЬНЫЙ кэш (без переходов!):
 * HTML + замыкание /_next/static/* + недостающие ИИ-модули. Лучшие
 * усилия: отдельные сбои не отменяют закачку; version.json кладётся
 * ПОСЛЕДНИМ — он же флаг «обновление скачано целиком».
 */
async function downloadUpdateFrom(source) {
  const cache = await caches.open(CACHE);
  let html = "";
  try {
    const res = await fetchTimeout(source.origin + "/", ASSET_TIMEOUT_MS, {
      mode: "cors",
      cache: "reload",
    });
    if (res.ok) {
      html = await res.text();
      await cache.put(
        "/BikeSnap/",
        new Response(html, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        })
      );
    }
  } catch {
    /* без HTML замыкание пустое — докачается при следующей проверке */
  }

  const queue = [];
  for (const m of html.matchAll(ASSET_RE)) {
    queue.push(m[0].replace(/\\/g, ""));
  }
  // ИИ-модули — только если их ещё нет в кэше (модель тяжёлая, ~20 МБ).
  for (const path of AI_ASSETS) {
    const hit = await caches.match(path);
    if (!hit) queue.push(path);
  }

  const seen = new Set();
  let scanned = 0;
  for (let i = 0; i < queue.length && seen.size < PREFETCH_CAP; i++) {
    const path = queue[i];
    if (seen.has(path)) continue;
    seen.add(path);
    try {
      const res = await fetchTimeout(source.origin + path, ASSET_TIMEOUT_MS, {
        mode: "cors",
        cache: "reload",
      });
      if (!res.ok) continue;
      await cache.put(path, res.clone());
      const ct = res.headers.get("content-type") || "";
      if (
        (ct.includes("javascript") || ct.includes("css")) &&
        scanned < 120
      ) {
        scanned++;
        const text = await res.text();
        for (const m of text.matchAll(ASSET_RE)) {
          const clean = m[0].replace(/\\/g, "");
          if (!seen.has(clean)) queue.push(clean);
        }
      }
    } catch {
      /* best effort: недокачанное доберётся при следующей проверке */
    }
  }

  // Маркер версии — последним: он же флаг «обновление скачано целиком».
  try {
    await cache.put("/BikeSnap/version.json", source.res.clone());
  } catch {
    /* даже без маркера ассеты уже в кэше, повтор будет идемпотентным */
  }

  const clients = await self.clients.matchAll();
  for (const client of clients) {
    client.postMessage({ type: "UPDATE_DOWNLOADED", version: source.version });
  }
}

/**
 * Проверка обновы (фон): зонд Vercel 1 сек → зеркало 1 сек; версия
 * отличается от закачанной в кэш → качаем обнову в локальный кэш.
 * Оба молчат → тихо живём на локальной копии.
 */
async function checkForUpdate(trigger) {
  const now = Date.now();
  if (now - lastUpdateCheck < UPDATE_THROTTLE_MS) return;
  lastUpdateCheck = now;
  try {
    const source = await findUpdateSource();
    if (!source) return;
    const cached = await cachedVersion();
    if (cached && cached === source.version) return;
    await downloadUpdateFrom(source);
  } catch {
    /* обновление — фоновая забота: любой сбой молча откладывается */
  }
}

/** Фоновая проверка после навигации (троттлинг внутри checkForUpdate). */
function scheduleUpdateCheck(event) {
  try {
    if (typeof event.waitUntil === "function") {
      event.waitUntil(checkForUpdate("navigate"));
    } else {
      void checkForUpdate("navigate");
    }
  } catch {
    /* проверка обновы не должна ронять обработку запроса */
  }
}

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
  if (
    event.data === "SKIP_WAITING" ||
    (event.data && event.data.type === "SKIP_WAITING")
  ) {
    self.skipWaiting();
    return;
  }
  if (event.data && event.data.type === "CHECK_UPDATE") {
    // Страница просит проверить обнову прямо сейчас (троттлинг общий).
    if (typeof event.waitUntil === "function") {
      event.waitUntil(checkForUpdate("message"));
    } else {
      void checkForUpdate("message");
    }
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
      // Фоновые задачи — вторым waitUntil: claim не ждёт их, но SW не
      // убьют, пока идёт закачка замыкания.
      event.waitUntil(prefetchClosure());
      event.waitUntil(checkForUpdate("activate"));
    })()
  );
});

/**
 * Замыкание ассетов ЭТОГО origin: "/BikeSnap/" (HTML) → все /_next/static/* из HTML
 * → скан этих JS/CSS на вложенные пути → повтор до стабилизации. Плюс
 * ИИ-модули AI_ASSETS. Лучшие усилия: отдельные сбои не отменяют общий
 * префетч (runtime cache-first доберёт).
 */
async function prefetchClosure() {
  const cache = await caches.open(CACHE);
  const queue = ["/BikeSnap/", ...AI_ASSETS];
  const seen = new Set();

  for (let i = 0; i < queue.length && i < PREFETCH_CAP; i++) {
    const path = queue[i];
    if (seen.has(path)) continue;
    seen.add(path);
    try {
      const res = await fetchTimeout(path, ASSET_TIMEOUT_MS, {
        cache: "reload",
      });
      if (!res.ok) continue;
      await cache.put(path, res.clone());
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("text/html")) {
        const html = await res.text();
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
  if (sameOrigin && url.pathname.startsWith("/BikeSnap/_next/webpack-hmr")) return;

  // Навигация: ОФЛАЙН-ПРИЛОЖЕНИЕ (v1.14.46) — кэш мгновенно, БЕЗ сети на
  // критическом пути, БЕЗ переходов на зеркало. Сеть трогает только
  // фоновый загрузчик обновы.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const hit = (await caches.match("/BikeSnap/")) || (await caches.match(request));
        if (hit) {
          scheduleUpdateCheck(event);
          return hit;
        }
        // Первый визит (кэша ещё нет): этот origin 1 сек…
        try {
          const response = await fetchTimeout(request, NAV_TIMEOUT_MS);
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put("/BikeSnap/", copy));
            scheduleUpdateCheck(event);
            return response;
          }
        } catch {
          /* ниже пробуем зеркало */
        }
        // …затем зеркало 1 сек — cors-ответ показываем С ТЕКУЩЕГО адреса,
        // никакого перехода (спека: «самого перехода делать не надо»).
        try {
          const mirrorTarget =
            self.location.origin === MIRROR_ORIGIN
              ? request.url
              : MIRROR_ORIGIN + url.pathname + url.search;
          const mirrorRes = await fetchTimeout(mirrorTarget, NAV_TIMEOUT_MS, {
            mode: "cors",
            cache: "no-store",
          });
          if (mirrorRes.ok) {
            const html = await mirrorRes.text();
            const local = new Response(html, {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
            caches.open(CACHE).then((cache) => cache.put("/BikeSnap/", local.clone()));
            scheduleUpdateCheck(event);
            return local;
          }
        } catch {
          /* офлайн первый визит — честная ошибка сети */
        }
        return Response.error();
      })()
    );
    return;
  }

  // version.json: кэш мгновенно + фоновая ревалидация 1 сек
  // (страница больше не строит на нём плашек — потребитель удалён).
  if (sameOrigin && url.pathname === "/BikeSnap/version.json") {
    event.respondWith(
      (async () => {
        const hit = await caches.match(request);
        const revalidate = fetchTimeout(request, PROBE_TIMEOUT_MS, {
          cache: "no-store",
        })
          .then((response) => {
            if (!response.ok) return;
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          })
          .catch(() => {});
        try {
          if (typeof event.waitUntil === "function") event.waitUntil(revalidate);
        } catch {
          /* ревалидация — фоновая забота */
        }
        if (hit) return hit;
        try {
          const response = await fetchTimeout(request, PROBE_TIMEOUT_MS, {
            cache: "no-store",
          });
          return response.ok ? response : Response.error();
        } catch {
          return Response.error();
        }
      })()
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
      (url.pathname.startsWith("/BikeSnap/_next/static/") ||
        url.pathname.startsWith("/BikeSnap/cdn/mediapipe/") ||
        url.pathname === "/BikeSnap/manifest.webmanifest" ||
        url.pathname.startsWith("/BikeSnap/icon-") ||
        url.pathname === "/BikeSnap/apple-touch-icon.png")) ||
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
