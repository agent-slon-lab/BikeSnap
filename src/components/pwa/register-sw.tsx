"use client";

import { useEffect } from "react";

/**
 * Регистрация service worker'а для PWA.
 * Монтируется в layout один раз; ошибки регистрации молча игнорируются
 * (приложение остаётся обычным сайтом, если SW недоступен).
 * Service worker требует HTTPS либо localhost — на прочих протоколах не регистрируемся.
 */
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

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
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
