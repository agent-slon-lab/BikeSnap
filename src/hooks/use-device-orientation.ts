import { useState, useEffect } from "react";

export interface DeviceOrientationState {
  /** Боковой крен телефона (град): 0 = идеально ровно, + = наклон вправо */
  roll: number;
  /** Наклон вперёд/назад (град): ~90 = телефон вертикально, экраном к себе */
  pitch: number;
  /** Датчик реально отдаёт данные (на десктопе событий нет) */
  supported: boolean;
}

/**
 * Запрос доступа к гироскопу. На iOS 13+ Safari требует явного разрешения,
 * вызванного ИЗ обработчика пользовательского жеста (клик по кнопке).
 * На Android/десктопе разрешения не нужно — просто проверяем наличие API.
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
 * Гироскоп телефона для помощника ракурса.
 *
 * Крен (roll) вычисляется с учётом ориентации экрана:
 * портрет — gamma, ландшафт — beta (с знаком по направлению поворота).
 * Точность ±1° достаточно для индикатора «телефон ровно».
 *
 * Обратная совместимость: isLevel/pitch (использовались в v1.2.x).
 */
export function useDeviceOrientation() {
  const [state, setState] = useState<DeviceOrientationState>({
    roll: 0,
    pitch: 0,
    supported: false,
  });

  useEffect(() => {
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
      return;
    }

    const handleOrientation = (e: DeviceOrientationEvent) => {
      // Десктопный Chrome может послать одно событие с null-значениями —
      // это НЕ данные датчика, не помечаем supported (иначе на десктопе
      // навсегда висит «Выровняйте телефон»)
      if (e.beta === null && e.gamma === null) return;
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;
      const angle =
        (typeof screen !== "undefined" && screen.orientation?.angle) || 0;

      // Крен относительно линии горизонта для текущей ориентации экрана
      let roll: number;
      if (angle === 90) roll = -beta;
      else if (angle === 270 || angle === -90) roll = beta;
      else roll = gamma; // портрет (0) и 180 — эвристика

      setState({ roll, pitch: beta, supported: true });
    };

    window.addEventListener("deviceorientation", handleOrientation);
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
    };
  }, []);

  const { roll, pitch, supported } = state;
  // Телефон «ровно»: крен < 3° и вертикальная ориентация (портрет)
  const isLevel = supported && Math.abs(roll) < 3 && pitch > 80 && pitch < 100;

  return { isLevel, pitch, roll, supported };
}
