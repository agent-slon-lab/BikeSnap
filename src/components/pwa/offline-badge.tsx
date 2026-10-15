"use client";

import { useEffect, useState } from "react";
import { APP_VERSION } from "@/lib/app-version";

/**
 * Офлайн-бейдж (v1.14.38): «показана сохранённая копия».
 *
 * Проблема (кусала дважды): без VPN bike-snap.vercel.app недоступен, service
 * worker отдаёт закэшированный экран прошлой версии. Приложение выглядит
 * рабочим, но это «заморозка»: обновления не приходят, баннер «Обновить»
 * не показывается (version.json взять неоткуда — он на том же домене).
 * Пользователь путает офлайн-копию vercel-ориджина с зеркалом github.io
 * (это РАЗНЫЕ origin со своими SW и кэшами) и неделями сидит на старом.
 *
 * Механика: страница опрашивает /version.json. SW ходит за ним в СЕТЬ
 * (network-first), а при недоступности сети отдаёт кэш с маркером
 * X-BikeSnap-From-Cache: 1 (см. sw.js). Маркер или сетевая ошибка →
 * янтарная плашка с подсказкой. Связь восстановилась — плашка исчезает
 * сама (следующий опрос проходит по сети без маркера). Опрос: при старте,
 * раз в минуту и мгновенно по событию online.
 */
const CHECK_INTERVAL_MS = 60_000;
const CACHE_MARKER = "X-BikeSnap-From-Cache";

export default function OfflineBadge() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let alive = true;

    const check = async () => {
      try {
        const res = await fetch("/version.json", { cache: "no-store" });
        if (!alive) return;
        // Маркер ставит только sw.js, когда ушёл в кэш из-за недоступной сети
        setOffline(res.headers.get(CACHE_MARKER) === "1");
      } catch {
        // Ответа нет вообще (нет SW, кэш пуст, сеть мертва) — тоже офлайн
        if (alive) setOffline(true);
      }
    };

    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    const onOnline = () => check();
    window.addEventListener("online", onOnline);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-3 z-[99] rounded-xl border border-amber-400/60 bg-amber-50 p-4 text-sm shadow-xl sm:inset-x-auto sm:right-4 sm:max-w-sm dark:border-amber-500/40 dark:bg-amber-950"
    >
      <p className="mb-1 font-medium text-amber-900 dark:text-amber-100">
        Нет связи с сайтом — показана сохранённая копия {APP_VERSION}.
      </p>
      <p className="text-amber-800 dark:text-amber-200">
        Обновление придёт при подключении: включите VPN (bike-snap.vercel.app)
        или откройте зеркало agent-slon-lab.github.io и нажмите «Обновить».
      </p>
    </div>
  );
}
