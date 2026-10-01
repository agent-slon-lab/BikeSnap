"use client";

import { useEffect, useState } from "react";

/**
 * Реактивный флаг media query (v1.5.0, ландшафтная адаптация).
 *
 * Зачем не Tailwind-варианты: в модалке камеры дефолтные классы DialogContent
 * (sm:max-w-lg) конфликтуют с нашими sm:/landscape: стилями — порядок правил
 * в сгенерированном CSS не гарантирован. JS-флаг через matchMedia даёт
 * детерминированную логику и МГНОВЕННЫЙ re-render при повороте телефона:
 * пользователь вертит устройство — видоискатель перестраивается на лету.
 *
 * SSR-безопасно: до монтирования всегда false.
 */
export function useMediaFlag(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Телефон, положенный набок: ширина ≥ высоты и высота ≤ 500px
 *  (десктопные окна выше; на десктопе флаг не срабатывает). */
export const PHONE_LANDSCAPE_QUERY =
  "(orientation: landscape) and (max-height: 500px)";

/** Десктопный «оконный» диалог: достаточно ширины И высоты. */
export const DESKTOP_DIALOG_QUERY =
  "(min-width: 640px) and (min-height: 501px)";
