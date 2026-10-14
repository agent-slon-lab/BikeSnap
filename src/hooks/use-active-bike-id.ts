"use client";

/**
 * v1.14.30 (Stale State): реактивный id активного велосипеда.
 *
 * Источник истины — localStorage (bikefit-active-bike, bike-storage.ts).
 * Само значение меняется через setActiveBike/createBike/deleteBike, которые
 * диспатчат ACTIVE_BIKE_CHANGED_EVENT; хук подписан на событие (+ cross-tab
 * «storage») и возвращает актуальный id.
 *
 * Зачем: page.tsx рендерит шаги «Велосипед/Сводка/Анализ» с
 * key={activeBikeId} — при смене велика React принудительно РАЗМОНТИРУЕТ
 * старые компоненты вместе с их состоянием (ТЗ «Fix Stale State Leakage»,
 * п. A.1: «Использовать уникальный ключ рендеринга (key={activeBikeId})»).
 */

import { useEffect, useState } from "react";
import {
  getActiveBikeId,
  ACTIVE_BIKE_CHANGED_EVENT,
} from "@/lib/bike-storage";

export function useActiveBikeId(): string | null {
  // Ленивая инициализация: page.tsx рендерит контент только после маунта,
  // поэтому localStorage доступен сразу и двойного маунта шагов нет.
  const [id, setId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return getActiveBikeId();
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const sync = () => {
      try {
        setId(getActiveBikeId());
      } catch {
        /* localStorage недоступен — держим последнее значение */
      }
    };
    // На случай, если активный велик изменили до подписки (гидрация,
    // восстановление сценария) — синхронизируемся сразу
    sync();
    window.addEventListener(ACTIVE_BIKE_CHANGED_EVENT, sync);
    // Синхронизация между вкладками
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ACTIVE_BIKE_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return id;
}
