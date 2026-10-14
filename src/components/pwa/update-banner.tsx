"use client";

import { useEffect, useState } from "react";

/**
 * Баннер «Доступна новая версия» (v1.14.33).
 *
 * Связка с sw.js: install нового SW НЕ делает skipWaiting — работник ждёт
 * в состоянии `waiting`, пока пользователь не нажмёт «Обновить». Тогда
 * страница шлёт SKIP_WAITING, работник активируется, clients.claim() даёт
 * controllerchange, и register-sw перезагружает вкладку ОДИН раз.
 *
 * Источники сигнала:
 *  - CustomEvent "bikesnap-sw-update" от register-sw (updatefound → installed
 *    при наличии контроллера);
 *  - собственная проверка reg.waiting при монтировании (SW мог встать в
 *    ожидание ещё до монтирования или в прошлую сессию).
 */

const UPDATE_EVENT = "bikesnap-sw-update";

export default function UpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const check = (reg?: ServiceWorkerRegistration | null) => {
      const target = reg || null;
      if (target?.waiting && navigator.serviceWorker.controller) {
        setWaiting(target.waiting);
      }
    };

    // SW мог установиться до монтирования баннера — проверяем сразу.
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => check(reg))
      .catch(() => {});

    const onUpdate = (event: Event) => {
      check((event as CustomEvent<ServiceWorkerRegistration>).detail);
    };
    window.addEventListener(UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(UPDATE_EVENT, onUpdate);
  }, []);

  if (!waiting) return null;

  const applyUpdate = () => {
    waiting.postMessage({ type: "SKIP_WAITING" });
    // register-sw перезагрузит вкладку по controllerchange; на случай если
    // контроллер уже сменился до нашего листенера — страховочный таймер.
    setTimeout(() => window.location.reload(), 1500);
  };

  return (
    <div
      role="alert"
      className="fixed inset-x-3 bottom-3 z-[100] rounded-xl border border-sky-400/50 bg-sky-50 p-4 text-sm shadow-xl sm:inset-x-auto sm:right-4 sm:max-w-sm dark:border-sky-500/40 dark:bg-sky-950"
    >
      <p className="mb-3 font-medium text-sky-900 dark:text-sky-100">
        Доступна новая версия BikeSnap. Обновить сейчас? Ваши данные не
        пострадают.
      </p>
      <div className="flex gap-2">
        <button
          onClick={applyUpdate}
          className="rounded-lg bg-sky-600 px-3 py-2 font-medium text-white transition-colors hover:bg-sky-700"
        >
          Обновить
        </button>
        <button
          onClick={() => setWaiting(null)}
          className="rounded-lg border border-sky-300 px-3 py-2 font-medium text-sky-800 transition-colors hover:bg-sky-100 dark:border-sky-700 dark:text-sky-200 dark:hover:bg-sky-900"
        >
          Позже
        </button>
      </div>
    </div>
  );
}
