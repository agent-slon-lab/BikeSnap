"use client";

import { useEffect } from "react";

/**
 * Регистрация service worker'а для PWA.
 *
 * v1.13.1: надёжное обновление версии.
 * Раньше страница после релиза продолжала работать на СТАРОМ JS: новый SW
 * ставился в очередь, но уже открытая страница не перезагружалась, а dev-чанки
 * под /_next/static отдаются кэш-первым. Пользователь видел старое поведение,
 * хотя новая версия уже «установлена».
 * Теперь:
 *  - updateViaCache:"none" — браузер всегда перепроверяет sw.js;
 *  - reg.update() на старте — обновление ищется сразу, не только по навигации;
 *  - controllerchange → авто-перезагрузка страницы ОДИН раз (только если у
 *    страницы уже был контроллер, т.е. это реальное обновление, а не первый
 *    визит; защита от цикла через sessionStorage).
 * Монтируется в layout один раз; ошибки регистрации молча игнорируются
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
