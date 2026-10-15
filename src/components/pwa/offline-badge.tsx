"use client";

import { useEffect, useState } from "react";
import { APP_VERSION } from "@/lib/app-version";

/**
 * Офлайн-бейдж (v1.14.38, кнопка зеркала v1.14.39).
 *
 * Проблема (кусала дважды): без VPN bike-snap.vercel.app недоступен, service
 * worker отдаёт закэшированный экран прошлой версии. Приложение выглядит
 * рабочим, но это «заморозка»: обновления не приходят, баннер «Обновить»
 * не показывается (version.json взять неоткуда — он на том же домене).
 *
 * С v1.14.39 SW при НАВИГАЦИИ сам уводит на живое зеркало (лестница
 * vercel → github.io → офлайн-кэш), но таба, открытая ДО блокировки,
 * остаётся на старом origin — для неё бейдж с кнопкой «Открыть зеркало».
 *
 * Механика: страница опрашивает /version.json. SW ходит за ним в СЕТЬ
 * (network-first), а при недоступности сети отдаёт кэш с маркером
 * X-BikeSnap-From-Cache: 1 (см. sw.js). Маркер или сетевая ошибка →
 * янтарная плашка. Параллельно проверяем зеркало (no-cors-зонд): живое →
 * показываем кнопку перехода. Связь восстановилась — плашка исчезает
 * сама. Опрос: при старте, раз в минуту и мгновенно по событию online.
 */
const CHECK_INTERVAL_MS = 60_000;
const CACHE_MARKER = "X-BikeSnap-From-Cache";
const MIRROR_URL = "https://agent-slon-lab.github.io";
const PROBE_TIMEOUT_MS = 3500;

export default function OfflineBadge() {
  const [offline, setOffline] = useState(false);
  const [mirrorAlive, setMirrorAlive] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let alive = true;

    const probeMirror = () => {
      const timer = setTimeout(() => {
        if (alive) setMirrorAlive(false);
      }, PROBE_TIMEOUT_MS);
      fetch(`${MIRROR_URL}/version.json`, { mode: "no-cors", cache: "no-store" })
        .then(() => {
          if (!alive) return;
          clearTimeout(timer);
          setMirrorAlive(true);
        })
        .catch(() => {
          if (!alive) return;
          clearTimeout(timer);
          setMirrorAlive(false);
        });
    };

    const check = async () => {
      try {
        const res = await fetch("/version.json", { cache: "no-store" });
        if (!alive) return;
        // Маркер ставит только sw.js, когда ушёл в кэш из-за недоступной сети
        const isOffline = res.headers.get(CACHE_MARKER) === "1";
        setOffline(isOffline);
        if (isOffline) probeMirror();
      } catch {
        // Ответа нет вообще (нет SW, кэш пуст, сеть мертва) — тоже офлайн
        if (!alive) return;
        setOffline(true);
        probeMirror();
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
        {mirrorAlive
          ? "Зеркало доступно — новая версия там:"
          : "Обновление придёт при подключении: включите VPN или откройте зеркало agent-slon-lab.github.io."}
      </p>
      {mirrorAlive && (
        <a
          href={MIRROR_URL}
          className="mt-2 inline-block rounded-lg bg-amber-600 px-3 py-2 font-medium text-white transition-colors hover:bg-amber-700"
        >
          Открыть зеркало
        </a>
      )}
    </div>
  );
}
