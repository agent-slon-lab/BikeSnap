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
 * Прод (v1.13.1, сохранено):
 *  - updateViaCache:"none" — браузер всегда перепроверяет sw.js;
 *  - reg.update() на старте — обновление ищется сразу;
 *  - controllerchange → авто-перезагрузка страницы ОДИН раз (только если
 *    у страницы уже был контроллер; защита от цикла через sessionStorage).
 * Монтируется в layout один раз; ошибки молча игнорируются
 * (приложение остаётся обычным сайтом, если SW недоступен).
 * Service worker требует HTTPS либо localhost — на прочих протоколах не регистрируемся.
 */
const SW_RELOAD_KEY = "bikesnap-sw-reloaded";

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
          // Ищем обновление сразу, не дожидаясь следующей навигации.
          // При новой версии: install → skipWaiting (в sw.js) → activate →
          // clients.claim → controllerchange выше перезагрузит страницу.
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
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
