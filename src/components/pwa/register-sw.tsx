"use client";

import { useEffect } from "react";

/**
 * Регистрация service worker'а для PWA.
 *
 * v1.13.3: SW регистрируется ТОЛЬКО в проде (next build/start). В dev —
 * наоборот, разворачиваем ранее зарегистрированный SW и чистим кэши:
 * Turbopack в dev меняет контент чанков /_next/static под теми же URL,
 * и cache-first стратегия SW отдавала мёртвый код — «module factory is
 * not available / deleted in an HMR update».
 *
 * Прод (v1.14.45, сохранено):
 *  - updateViaCache:"none" — браузер всегда перепроверяет sw.js;
 *  - reg.update() на старте — обновление ищется сразу;
 *  - НОВОЕ (v1.14.45): обновления применяются ТИХО — баннер «Доступна новая
 *    версия» удалён по требованию пользователя (плашки не должны появляться).
 *    Ждущий SW получает SKIP_WAITING автоматически, controllerchange
 *    перезагружает страницу ОДИН раз (защита от цикла через sessionStorage).
 *    Чтобы авто-перезагрузка не застала пользователя за работой посреди
 *    сессии, применяем обновление только в первые секунды после загрузки
 *    страницы; найденное позже дождётся следующего открытия приложения.
 * Монтируется в layout один раз; ошибки молча игнорируются
 * (приложение остаётся обычным сайтом, если SW недоступен).
 * Service worker требует HTTPS либо localhost — на прочих протоколах не регистрируемся.
 */
const SW_RELOAD_KEY = "bikesnap-sw-reloaded";
// Окно тихого применения обновления после загрузки страницы (мс).
const AUTO_APPLY_WINDOW_MS = 20_000;

export default function RegisterSW() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const { protocol, hostname } = window.location;
    const secure =
      protocol === "https:" ||
      protocol === "chrome-extension:" ||
      hostname === "localhost" ||
      hostname === "127.0.0.1";
    if (!secure) return;

    // v1.13.3: dev — без SW. Сносим унаследованный от прошлых сессий SW и
    // bikesnap-кэши, чтобы HMR-чанки всегда приходили по сети.
    if (process.env.NODE_ENV === "development") {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) =>
          Promise.all(regs.map((r) => r.unregister().catch(() => {})))
        )
        .catch(() => {});
      if ("caches" in window) {
        caches
          .keys()
          .then((keys) =>
            Promise.all(
              keys
                .filter((k) => k.startsWith("bikesnap-"))
                .map((k) => caches.delete(k).catch(() => {}))
            )
          )
          .catch(() => {});
      }
      return;
    }

    // Флаг «уже перезагрузились ради обновления» живёт ≤ 20 сек: сразу после
    // авто-перезагрузки новая страница его снимет, чтобы СЛЕДУЮЩЕЕ обновление
    // тоже могло перезагрузить вкладку.
    try {
      sessionStorage.removeItem(SW_RELOAD_KEY);
    } catch {
      /* sessionStorage недоступен — авто-перезагрузка просто не сработает */
    }

    let refreshing = false;
    // Если контроллера ещё не было — это первый визит, перезагружаться не зачем
    const hadController = !!navigator.serviceWorker.controller;
    const bootedAt = Date.now();

    // v1.14.45: тихое автообновление вместо баннера. Если обнаружен ждущий
    // SW в первые секунды после загрузки — применяем сразу (SKIP_WAITING);
    // controllerchange ниже перезагрузит вкладку ОДИН раз. Обновление,
    // найденное посреди сессии, тихо дождётся следующего открытия —
    // никаких плашек и внезапных перезагрузок во время работы.
    const autoApplyWaiting = (reg: ServiceWorkerRegistration) => {
      if (Date.now() - bootedAt > AUTO_APPLY_WINDOW_MS) return;
      if (reg.waiting && navigator.serviceWorker.controller) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      }
    };

    // v1.14.46: офлайн-приложение — SW сам качает обнову в кэш (Vercel 1с
    // → ГХ 1с). После успешной закачки SW шлёт UPDATE_DOWNLOADED; если
    // страница ещё в стартовом окне — тихо перезагружаемся ОДИН раз,
    // чтобы открыть уже новую версию из кэша. Позже окна — обновление
    // подхватится при следующем открытии, без внезапной перезагрузки.
    const guardedReload = () => {
      if (Date.now() - bootedAt > AUTO_APPLY_WINDOW_MS) return;
      try {
        if (sessionStorage.getItem(SW_RELOAD_KEY) === "1") return;
        sessionStorage.setItem(SW_RELOAD_KEY, "1");
      } catch {
        return; // без защиты от цикла не рискуем
      }
      refreshing = true;
      window.location.reload();
    };

    const onSwMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (data && data.type === "UPDATE_DOWNLOADED") guardedReload();
    };
    navigator.serviceWorker.addEventListener("message", onSwMessage);

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        if (!hadController || refreshing) return;
        try {
          if (sessionStorage.getItem(SW_RELOAD_KEY) === "1") return;
          sessionStorage.setItem(SW_RELOAD_KEY, "1");
        } catch {
          return; // без защиты от цикла не рискуем
        }
        refreshing = true;
        window.location.reload();
      },
      { once: false }
    );

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .then((reg) => {
          // Обновление уже ждёт с прошлой сессии — применяем тихо.
          autoApplyWaiting(reg);
          // v1.14.46: просим SW проверить обнову сразу (Vercel 1с → ГХ 1с);
          // троттлинг 3 мин внутри SW защитит от дублей.
          try {
            const target = reg.active || navigator.serviceWorker.controller;
            target?.postMessage({ type: "CHECK_UPDATE" });
          } catch {
            /* проверка обновы — best effort */
          }
          // Новый SW дошёл до installed при живом контроллере — применяем тихо.
          reg.addEventListener("updatefound", () => {
            const sw = reg.installing;
            if (!sw) return;
            sw.addEventListener("statechange", () => {
              if (sw.state === "installed") autoApplyWaiting(reg);
            });
          });
          // Ищем бинарное обновление SW сразу, не дожидаясь следующей
          // навигации. При новой версии: install → WAITING →
          // авто-SKIP_WAITING → activate → clients.claim →
          // controllerchange перезагрузит страницу (один раз).
          reg.update().catch(() => {});
        })
        .catch(() => {
          /* PWA — опциональное улучшение: тихо игнорируем */
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
    return () => {
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("message", onSwMessage);
    };
  }, []);

  return null;
}
