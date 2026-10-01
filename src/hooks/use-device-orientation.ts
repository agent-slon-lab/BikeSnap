import { useCallback, useEffect, useState } from "react";

export interface DeviceOrientationState {
  /** Боковой крен телефона (град): 0 = идеально ровно, + = наклон вправо */
  roll: number;
  /** Наклон вперёд/назад (град): ~90 = телефон вертикально, экраном к себе */
  pitch: number;
  /** Датчик реально отдаёт данные (на десктопе событий нет) */
  supported: boolean;
  /** Право на датчик получено (iOS 13+ — после requestPermission, остальные — true) */
  permissionGranted: boolean;
}

/**
 * Запрос доступа к гироскопу. На iOS 13+ Safari требует явного разрешения,
 * вызванного ИЗ обработчика пользовательского жеста (клик по кнопке).
 * На Android/десктопе разрешения не нужно — просто проверяем наличие API.
 *
 * iOS запоминает решение для origin: повторный вызов после grant мгновенно
 * возвращает granted, поэтому безопасно вызывать при каждом открытии камеры.
 */
export async function ensureOrientationPermission(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const DOE = window.DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<"granted" | "denied">;
  } | null;
  if (DOE && typeof DOE.requestPermission === "function") {
    try {
      return (await DOE.requestPermission()) === "granted";
    } catch {
      return false;
    }
  }
  return "DeviceOrientationEvent" in window;
}

/**
 * Гироскоп телефона для помощника ракурса (v3).
 *
 * Ключевые свойства:
 *  - `active` — подписка только пока видоискатель открыт (переоткрытие модалки
 *    пересоздаёт слушатель: iOS 13+ сохраняет выданное разрешение для origin,
 *    поэтому повторный запрос НЕ нужен — события сразу текут);
 *  - roll/pitch корректируются по screen.orientation (портрет: roll = gamma,
 *    ландшафт: roll = ±beta с учётом стороны поворота);
 *  - `supported` = true только при реальных данных (десктопный Chrome шлёт
 *    одно событие с null — отсечено, чтобы не висли «Выровняйте телефон»);
 *  - `requestPermission()` — для iOS 13+, вызывать из клика.
 *
 * Обратная совместимость: isLevel/pitch (использовались в v1.2.x).
 */
export function useDeviceOrientation(active: boolean = true) {
  const [state, setState] = useState<DeviceOrientationState>({
    roll: 0,
    pitch: 0,
    supported: false,
    permissionGranted: false,
  });

  const requestPermission = useCallback(async (): Promise<boolean> => {
    const granted = await ensureOrientationPermission();
    setState((prev) => ({ ...prev, permissionGranted: granted }));
    return granted;
  }, []);

  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    if (!("DeviceOrientationEvent" in window)) return;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      // Десктопный Chrome может послать одно событие с null-значениями —
      // это НЕ данные датчика, не помечаем supported (иначе на десктопе
      // навсегда висит «Выровняйте телефон»)
      if (e.beta === null && e.gamma === null) return;
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;
      // Текущий поворот экрана. screen.orientation нет на iOS < 16.4 —
      // там работает устаревший, но живой window.orientation (-90/90/180).
      // Без фолбэка на старых iOS в ландшафте pitch/roll считались бы
      // по портретной схеме и авто-спуск блокировался бы вечным warning'ом.
      const angle =
        (typeof screen !== "undefined" && screen.orientation?.angle) ||
        (typeof window !== "undefined" &&
        typeof (window as unknown as { orientation?: number }).orientation ===
          "number"
          ? ((window as unknown as { orientation?: number }).orientation ??
            0)
          : 0) || 0;

      // Крен/наклон относительно линии горизонта для текущей ориентации экрана
      let roll: number;
      let pitch: number;
      if (angle === 90) {
        roll = -beta;
        pitch = -gamma;
      } else if (angle === 270 || angle === -90) {
        roll = beta;
        pitch = gamma;
      } else {
        // портрет (0) и 180 — эвристика
        roll = gamma;
        pitch = beta;
      }

      setState({
        roll,
        pitch,
        supported: true,
        permissionGranted: true,
      });
    };

    window.addEventListener("deviceorientation", handleOrientation);
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
    };
  }, [active]);

  const { roll, pitch, supported, permissionGranted } = state;
  // Телефон «ровно»: крен < 3° и вертикальная ориентация (портрет)
  const isLevel = supported && Math.abs(roll) < 3 && pitch > 80 && pitch < 100;

  return { isLevel, pitch, roll, supported, permissionGranted, requestPermission };
}
