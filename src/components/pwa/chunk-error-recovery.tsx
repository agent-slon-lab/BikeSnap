"use client";

import { useEffect, useState } from "react";

/**
 * Автовосстановление после «белого экрана» при обновлении деплоя (v1.14.18).
 *
 * Проблема: Next.js деплой меняет имена чанков /_next/static/*.js. Если
 * браузер в момент пропагации получил старый HTML (edge-кэш) или держит
 * устаревший SW-кэш, скрипты нового HTML/старые ссылки дают 404 → белый
 * экран без единой подсказки пользователю.
 *
 * Решение — два уровня:
 *  1. Первый битый чанк за сессию → чистим bikesnap-кэши → авто-перезагрузка
 *     (флаг в sessionStorage защищает от цикла; снимается через 7 c здоровой
 *     работы, чтобы СЛЕДУЮЩИЙ битый деплой снова лечился сам).
 *  2. Если перезагрузка не помогла (за сессию уже была) → показываем баннер
 *     «Очистить кэш и перезагрузить»: unregister всех SW + чистка кэшей.
 *
 * Источники сигнала:
 *  - error в capture-фазе: ресурсные ошибки <script>/<link> с /_next/ в URL
 *    (не всплывают, но ловятся на window в capture);
 *  - unhandledrejection с ChunkLoadError / "Loading chunk" / turbopack-текстами.
 */

const RELOAD_KEY = "bikesnap-chunk-recovery";

const CHUNK_ERROR_RE =
  /ChunkLoadError|Loading (?:CSS )?chunk|dynamically imported module|error while loading route|Failed to fetch dynamically|missing required error components/i;

function isNextResource(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const url =
    target instanceof HTMLScriptElement
      ? target.src
      : target instanceof HTMLLinkElement
        ? target.href
        : "";
  return !!url && url.includes("/_next/");
}

async function purgeBikeSnapCaches(): Promise<void> {
  if (!("caches" in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith("bikesnap-"))
        .map((k) => caches.delete(k).catch(() => {}))
    );
  } catch {
    /* чистка кэша — best effort */
  }
}

async function fullHealAndReload(): Promise<void> {
  try {
    sessionStorage.removeItem(RELOAD_KEY);
    sessionStorage.removeItem("bikesnap-sw-reloaded");
  } catch {
    /* ignore */
  }
  await purgeBikeSnapCaches();
  if ("serviceWorker" in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    } catch {
      /* ignore */
    }
  }
  window.location.reload();
}

export default function ChunkErrorRecovery() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    let armed = true;

    const trigger = () => {
      if (!armed) return;
      armed = false;
      let alreadyReloaded = false;
      try {
        alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === "1";
      } catch {
        alreadyReloaded = true; // без sessionStorage не рискуем циклом
      }
      if (alreadyReloaded) {
        setShowBanner(true);
        return;
      }
      try {
        sessionStorage.setItem(RELOAD_KEY, "1");
      } catch {
        /* авто-перезагрузка всё равно сработает один раз */
      }
      purgeBikeSnapCaches().finally(() => window.location.reload());
    };

    const onError = (event: ErrorEvent) => {
      if (isNextResource(event.target)) {
        trigger();
        return;
      }
      if (event.message && CHUNK_ERROR_RE.test(event.message)) trigger();
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const text =
        reason instanceof Error ? reason.message || String(reason) : String(reason ?? "");
      if (text && CHUNK_ERROR_RE.test(text)) trigger();
    };

    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);

    // 7 c без ошибок → сессия здорова, снимаем флаг: следующий битый деплой
    // снова сможет вылечиться авто-перезагрузкой, а не баннером.
    const healTimer = setTimeout(() => {
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        /* ignore */
      }
    }, 7000);

    return () => {
      armed = false;
      clearTimeout(healTimer);
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  if (!showBanner) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[100] rounded-xl border border-amber-400/50 bg-amber-50 p-4 text-sm shadow-xl sm:inset-x-auto sm:right-4 sm:max-w-sm dark:bg-amber-950">
      <p className="mb-2 font-medium text-amber-900 dark:text-amber-100">
        Приложение обновилось на сервере, а браузер держит старые файлы —
        страница не может запуститься.
      </p>
      <button
        onClick={() => {
          void fullHealAndReload();
        }}
        className="rounded-lg bg-amber-600 px-3 py-2 font-medium text-white transition-colors hover:bg-amber-700"
      >
        Очистить кэш и перезагрузить
      </button>
    </div>
  );
}
