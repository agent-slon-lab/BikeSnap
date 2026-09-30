/**
 * Перспективная компенсация через градиент масштаба по X.
 *
 * Если фото снято не строго сбоку, переднее колесо ближе к камере и
 * кажется больше заднего. Это НЕ исправить поворотом (2D rotation) — он только
 * портит Y координаты. Вместо поворота считаем отдельный масштаб по каждому
 * колесу и интерполируем его по X для любой точки между осями.
 */

import type { BikeKeyPoints, NullablePoint } from "./bike-photo-scale";

export interface Point2D {
  x: number;
  y: number;
}

// ============================================================
// ТИПОРАЗМЕРЫ КОЛЁС (для dropdown UI)
// ============================================================

export interface WheelSizeOption {
  id: string;
  label: string;
  rimInches: number;
  radiusMm: number;
  tireDescription: string;
}

export const WHEEL_SIZES: WheelSizeOption[] = [
  { id: "20",  label: '20"',   rimInches: 20, radiusMm: 254, tireDescription: "20″ BMX/сложные" },
  { id: "24",  label: '24"',   rimInches: 24, radiusMm: 305, tireDescription: "24″ детские/фэт" },
  { id: "26",  label: '26"',   rimInches: 26, radiusMm: 334, tireDescription: '26″ MTB классика (559+38 мм покрышка)' },
  { id: "27.5",label: '27.5"', rimInches: 27.5, radiusMm: 358, tireDescription: '27.5″ MTB современный (584+40 мм)' },
  { id: "29",  label: '29"',   rimInches: 29, radiusMm: 371, tireDescription: '29″ MTB/найнер (622+30 мм)' },
  { id: "650b",label: '650b',  rimInches: 27.5, radiusMm: 355, tireDescription: '650b шоссейный (584+28 мм)' },
  { id: "700c",label: '700c',  rimInches: 28, radiusMm: 335, tireDescription: '700c шоссе (622+25 мм)' },
  { id: "650c",label: '650c',  rimInches: 26, radiusMm: 322, tireDescription: '650c триатлон (571+23 мм)' },
];

export function findWheelSize(id: string | null, radiusMm?: number | null): WheelSizeOption | null {
  if (id) {
    const found = WHEEL_SIZES.find((w) => w.id === id);
    if (found) return found;
  }
  if (radiusMm && radiusMm > 0) {
    let closest = WHEEL_SIZES[0];
    let minDiff = Math.abs(closest.radiusMm - radiusMm);
    for (const w of WHEEL_SIZES) {
      const diff = Math.abs(w.radiusMm - radiusMm);
      if (diff < minDiff) {
        minDiff = diff;
        closest = w;
      }
    }
    return closest;
  }
  return null;
}

// ============================================================
// АВТО-РАСЧЁТ ВЕРХА КОЛЁС
// ============================================================

export function ensureWheelTops(
  points: BikeKeyPoints,
  imgSize: { width: number; height: number },
  scale?: number | null,
  wheelHeightMm?: number | null
): BikeKeyPoints {
  const result = { ...points };

  if (
    (!result.frontWheelTop || result.frontWheelTop.x == null || result.frontWheelTop.y == null) &&
    result.frontAxle && result.frontAxle.x != null && result.frontAxle.y != null
  ) {
    const axleY = result.frontAxle.y;
    let radiusNorm: number;
    if (scale && scale > 0 && wheelHeightMm && wheelHeightMm > 0) {
      const radiusPx = wheelHeightMm / scale;
      radiusNorm = radiusPx / imgSize.height;
    } else {
      radiusNorm = 0.15;
    }
    result.frontWheelTop = {
      x: result.frontAxle.x,
      y: Math.max(0, axleY - radiusNorm),
    };
  }

  if (
    (!result.rearWheelTop || result.rearWheelTop.x == null || result.rearWheelTop.y == null) &&
    result.rearAxle && result.rearAxle.x != null && result.rearAxle.y != null
  ) {
    const axleY = result.rearAxle.y;
    let radiusNorm: number;
    if (scale && scale > 0 && wheelHeightMm && wheelHeightMm > 0) {
      const radiusPx = wheelHeightMm / scale;
      radiusNorm = radiusPx / imgSize.height;
    } else {
      radiusNorm = 0.15;
    }
    result.rearWheelTop = {
      x: result.rearAxle.x,
      y: Math.max(0, axleY - radiusNorm),
    };
  }

  return result;
}

// ============================================================
// ПЕРСПЕКТИВНЫЙ ГРАДИЕНТ МАСШТАБА
// ============================================================

export function getLocalScale(
  x: number,
  frontAxleX: number | null,
  rearAxleX: number | null,
  scaleFront: number,
  scaleRear: number
): number {
  if (frontAxleX == null || rearAxleX == null || Math.abs(rearAxleX - frontAxleX) < 1e-6) {
    return (scaleFront + scaleRear) / 2;
  }
  const t = (x - frontAxleX) / (rearAxleX - frontAxleX);
  const clampedT = Math.max(0, Math.min(1, t));
  return scaleFront + clampedT * (scaleRear - scaleFront);
}

export function getPerspectiveDistanceMm(
  p1: NullablePoint,
  p2: NullablePoint,
  imgSize: { width: number; height: number },
  frontAxleX: number | null,
  rearAxleX: number | null,
  scaleFront: number,
  scaleRear: number
): number {
  if (p1.x == null || p1.y == null || p2.x == null || p2.y == null) return 0;
  if (!imgSize.width || !imgSize.height) return 0;

  const x1px = p1.x * imgSize.width;
  const y1px = p1.y * imgSize.height;
  const x2px = p2.x * imgSize.width;
  const y2px = p2.y * imgSize.height;

  const midX = (p1.x + p2.x) / 2;
  const localScale = getLocalScale(midX, frontAxleX, rearAxleX, scaleFront, scaleRear);

  const dx = x2px - x1px;
  const dy = y2px - y1px;
  const distPx = Math.sqrt(dx * dx + dy * dy);

  return distPx * localScale;
}

export function getPerspectiveHorizontalMm(
  p1: NullablePoint,
  p2: NullablePoint,
  imgSize: { width: number; height: number },
  frontAxleX: number | null,
  rearAxleX: number | null,
  scaleFront: number,
  scaleRear: number
): number {
  if (p1.x == null || p2.x == null) return 0;
  if (!imgSize.width) return 0;
  const x1px = p1.x * imgSize.width;
  const x2px = p2.x * imgSize.width;
  const midX = (p1.x + p2.x) / 2;
  const localScale = getLocalScale(midX, frontAxleX, rearAxleX, scaleFront, scaleRear);
  return Math.abs(x2px - x1px) * localScale;
}

export function getPerspectiveVerticalMm(
  p1: NullablePoint,
  p2: NullablePoint,
  imgSize: { width: number; height: number },
  frontAxleX: number | null,
  rearAxleX: number | null,
  scaleFront: number,
  scaleRear: number
): number {
  if (p1.y == null || p2.y == null) return 0;
  if (!imgSize.height) return 0;
  const y1px = p1.y * imgSize.height;
  const y2px = p2.y * imgSize.height;
  const midX = ((p1.x ?? 0.5) + (p2.x ?? 0.5)) / 2;
  const localScale = getLocalScale(midX, frontAxleX, rearAxleX, scaleFront, scaleRear);
  return Math.abs(y2px - y1px) * localScale;
}

// ============================================================
// БЕЗОПАСНЫЙ РАСЧЁТ ПАРАМЕТРОВ (никогда не возвращает null)
// ============================================================

export interface SafeGeometryResult {
  reach: number;
  stack: number;
  ett: number;
  wheelbase: number;
  saddleHeight: number;
  setback: number;
  error: string | null;
  warnings: string[];
}

export function safeCalculateBikeGeometry(
  points: BikeKeyPoints,
  imgSize: { width: number; height: number },
  scaleFront: number,
  scaleRear: number,
  frontAxleX: number | null,
  rearAxleX: number | null
): SafeGeometryResult {
  const warnings: string[] = [];

  let effectiveScaleFront = scaleFront;
  let effectiveScaleRear = scaleRear;
  if (frontAxleX == null || rearAxleX == null) {
    effectiveScaleFront = (scaleFront + scaleRear) / 2;
    effectiveScaleRear = effectiveScaleFront;
    warnings.push("Оси колёс не размечены — использован средний масштаб (без перспективной компенсации).");
  }

  if (effectiveScaleFront <= 0 || effectiveScaleRear <= 0) {
    return {
      reach: 0, stack: 0, ett: 0, wheelbase: 0, saddleHeight: 0, setback: 0,
      error: "Масштаб некорректный (≤ 0). Проверьте WB и точки верха колёс.",
      warnings,
    };
  }

  let reach = 0;
  if (points.bb?.x != null && points.htTop?.x != null) {
    reach = getPerspectiveHorizontalMm(
      points.bb, points.htTop, imgSize,
      frontAxleX, rearAxleX, effectiveScaleFront, effectiveScaleRear
    );
  } else {
    warnings.push("Не хватает точек BB/HT верх для расчёта Reach.");
  }

  let stack = 0;
  if (points.bb?.y != null && points.htTop?.y != null) {
    stack = getPerspectiveVerticalMm(
      points.bb, points.htTop, imgSize,
      frontAxleX, rearAxleX, effectiveScaleFront, effectiveScaleRear
    );
  } else {
    warnings.push("Не хватает точек BB/HT верх для расчёта Stack.");
  }

  const ettRefPoint =
    (points.htTopCap?.x != null && points.htTopCap?.y != null)
      ? points.htTopCap
      : points.htTop;

  let ett = 0;
  if (ettRefPoint?.x != null && points.stTop?.x != null) {
    ett = getPerspectiveHorizontalMm(
      ettRefPoint, points.stTop, imgSize,
      frontAxleX, rearAxleX, effectiveScaleFront, effectiveScaleRear
    );
  } else {
    warnings.push("Не хватает точек для расчёта ETT (нужны stTop + htTop или htTopCap).");
  }

  let wheelbase = 0;
  if (points.rearAxle?.x != null && points.frontAxle?.x != null) {
    wheelbase = getPerspectiveDistanceMm(
      points.rearAxle, points.frontAxle, imgSize,
      frontAxleX, rearAxleX, effectiveScaleFront, effectiveScaleRear
    );
  } else {
    warnings.push("Не хватает точек осей для расчёта WB.");
  }

  let saddleHeight = 0;
  if (points.bb?.x != null && points.saddleMount?.x != null) {
    saddleHeight = getPerspectiveDistanceMm(
      points.bb, points.saddleMount, imgSize,
      frontAxleX, rearAxleX, effectiveScaleFront, effectiveScaleRear
    );
  }

  let setback = 0;
  if (points.bb?.x != null && points.saddleMount?.x != null) {
    setback = getPerspectiveHorizontalMm(
      points.bb, points.saddleMount, imgSize,
      frontAxleX, rearAxleX, effectiveScaleFront, effectiveScaleRear
    );
  }

  return {
    reach: Math.round(reach),
    stack: Math.round(stack),
    ett: Math.round(ett),
    wheelbase: Math.round(wheelbase),
    saddleHeight: Math.round(saddleHeight),
    setback: Math.round(setback),
    error: null,
    warnings,
  };
}
