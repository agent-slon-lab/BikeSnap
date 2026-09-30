/**
 * Двойной масштаб (Dual Scale) — компенсация перспективы по двум колёсам.
 *
 * Если фото снято не строго сбоку, переднее колесо ближе к камере и кажется
 * больше заднего. Единый масштаб (mm/px) здесь не работает в принципе.
 *
 * Решение: считаем отдельный масштаб по переднему и заднему колесу, затем
 * интерполируем масштаб по оси X для любой точки между осями.
 *
 * Требует 2 опциональные точки: rearWheelTop, frontWheelTop — верх покрышки
 * над осью. Радиус в пикселях = расстояние от оси до верха покрышки.
 */

import type { BikeKeyPoints, NullablePoint } from "./bike-photo-scale";

export interface ImageSize {
  width: number;
  height: number;
}

export interface DualScale {
  /** Масштаб на передней оси (мм / норм.ед.) */
  scaleFront: number;
  /** Масштаб на задней оси (мм / норм.ед.) */
  scaleRear: number;
  /** Средний масштаб (для UI) */
  scaleAvg: number;
  /** Насколько сильна перспектива: 0 = нет, >0.05 = заметна, >0.15 = сильная */
  perspectiveSeverity: number;
  /** Радиус переднего колеса в пикселях */
  frontPxRadius: number;
  /** Радиус заднего колеса в пикселях */
  rearPxRadius: number;
  /** Описание для UI */
  description: string;
}

/**
 * Вычисляет расстояние между двумя NullablePoint в пикселях с учётом imgSize.
 * Нормализованные [0..1] → реальные пиксели.
 */
function distancePx(a: NullablePoint, b: NullablePoint, imgSize: ImageSize): number {
  if (a.x == null || a.y == null || b.x == null || b.y == null) return 0;
  const dx = (a.x - b.x) * imgSize.width;
  const dy = (a.y - b.y) * imgSize.height;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Вычисляет dual scale по двум колёсам.
 *
 * @param points Ключевые точки (нормализованные [0..1])
 * @param wheelHeightMm Радиус колеса с покрышкой в мм (из формы)
 * @param imgSize Реальные размеры фото
 * @returns DualScale или null, если данных недостаточно
 */
export function calculateDualScale(
  points: BikeKeyPoints,
  wheelHeightMm: number,
  imgSize: ImageSize
): DualScale | null {
  if (!wheelHeightMm || wheelHeightMm <= 0) return null;
  if (!imgSize.width || !imgSize.height) return null;

  const rearAxle = points.rearAxle;
  const frontAxle = points.frontAxle;
  const rearTop = points.rearWheelTop;
  const frontTop = points.frontWheelTop;

  if (!rearAxle || !frontAxle || !rearTop || !frontTop) return null;
  if (
    rearAxle.x == null || rearAxle.y == null ||
    frontAxle.x == null || frontAxle.y == null ||
    rearTop.x == null || rearTop.y == null ||
    frontTop.x == null || frontTop.y == null
  ) {
    return null;
  }

  const rearPxRadius = distancePx(rearAxle, rearTop, imgSize);
  const frontPxRadius = distancePx(frontAxle, frontTop, imgSize);

  if (rearPxRadius <= 0 || frontPxRadius <= 0) return null;

  // Преобразуем "норм.ед." в "пиксели^2/мм" — но на самом деле:
  // Если точки в [0..1], distancePx возвращает расстояние в пикселях.
  // Тогда scale = mm / px (мм на пиксель).
  // Это отлично работает для интерполяции по X.
  const scaleRear = wheelHeightMm / rearPxRadius; // мм/пикс
  const scaleFront = wheelHeightMm / frontPxRadius; // мм/пикс

  const scaleAvg = (scaleFront + scaleRear) / 2;
  const perspectiveSeverity = Math.abs(scaleFront - scaleRear) / scaleAvg;

  let description: string;
  if (perspectiveSeverity < 0.03) {
    description = "Перспективы нет — оба колеса одного размера. Dual scale не нужен.";
  } else if (perspectiveSeverity < 0.10) {
    description = "Лёгкая перспектива — переднее колесо немного ближе. Dual scale улучшит точность на 5–10%.";
  } else if (perspectiveSeverity < 0.20) {
    description = "Заметная перспектива — переднее колесо значительно ближе. Dual scale обязателен.";
  } else {
    description = "Сильная перспектива — разница масштабов >20%. Лучше переснять, но dual scale даст ±15 мм погрешность.";
  }

  return {
    scaleFront,
    scaleRear,
    scaleAvg,
    perspectiveSeverity,
    frontPxRadius,
    rearPxRadius,
    description,
  };
}

/**
 * Возвращает локальный масштаб в точке с координатой X (норм. ед. 0..1).
 *
 * Линейная интерполяция между front axle и rear axle.
 * - Если X спереди от frontAxle → используем scaleFront
 * - Если X сзади от rearAxle → используем scaleRear
 * - Между — интерполяция
 *
 * @param pointX Нормализованная X координата точки
 * @param frontAxleX Нормализованная X координата передней оси
 * @param rearAxleX Нормализованная X координата задней оси
 * @param scaleFront Масштаб на передней оси (мм/пикс)
 * @param scaleRear Масштаб на задней оси (мм/пикс)
 */
export function getLocalScale(
  pointX: number,
  frontAxleX: number,
  rearAxleX: number,
  scaleFront: number,
  scaleRear: number
): number {
  if (Math.abs(rearAxleX - frontAxleX) < 1e-6) {
    return (scaleFront + scaleRear) / 2;
  }
  const t = (pointX - frontAxleX) / (rearAxleX - frontAxleX);
  const clampedT = Math.max(0, Math.min(1, t));
  return scaleFront + clampedT * (scaleRear - scaleFront);
}

/**
 * Безопасно определить, безопасно ли применять авто-выравнивание горизонта.
 *
 * Если есть dual scale и perspectiveSeverity > 0.10 — НЕЛЬЗЯ применять
 * авто-выравнивание по осям колёс: разница Y между осями вызвана перспективой,
 * а не наклоном велосипеда. Вращение сделает только хуже.
 *
 * @returns true если авто-выравнивание безопасно, false если запрещено
 */
export function isAutoAlignSafe(dualScale: DualScale | null): {
  safe: boolean;
  reason: string;
} {
  if (!dualScale) {
    return {
      safe: true,
      reason: "Dual scale недоступен — предполагаем, что это просто наклон. Авто-выравнивание безопасно.",
    };
  }
  if (dualScale.perspectiveSeverity < 0.05) {
    return {
      safe: true,
      reason: "Перспективы нет — разница Y между осями это наклон велосипеда. Авто-выравнивание безопасно.",
    };
  }
  if (dualScale.perspectiveSeverity < 0.12) {
    return {
      safe: true,
      reason: "Перспектива лёгкая — авто-выравнивание допустимо, но лучше сначала исправить перспективу.",
    };
  }
  return {
    safe: false,
    reason: `Перспектива сильная (${(dualScale.perspectiveSeverity * 100).toFixed(0)}%) — разница Y между осями вызвана перспективой, не наклоном. Авто-выравнивание сделает хуже. Сначала примени dual scale или пересними фото строго сбоку.`,
  };
}
