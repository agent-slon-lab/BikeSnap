/**
 * Авто-подсказки для положения точек — ЯДРО v2 (rotation-first).
 * ================================================================
 *
 * Все проверки работают в ПИКСЕЛЬНОМ пространстве и используют результат
 * движка геометрии (bike-geometry-engine) как единственный источник истины:
 *   - масштаб — engine.scaleMmPerPx (мм/пиксель, строгая иерархия);
 *   - Stack/Reach и другие проекции — из выровненной системы (после
 *     поворота кадра по оси колёс), т.е. СОВПАДАЮТ с цифрами в отчёте;
 *   - цели подсказок вычисляются в выровненной системе и переводятся
 *     обратно в координаты фото через makeInverseAlignedTransform.
 *
 * История (v1.2.0 и ранее): функция получала scale в «мм/норм.ед.», а после
 * перехода на ядро v2 ей стали передавать мм/пиксель. Это давало абсурдные
 * подсказки вида «Stack = 1 мм, цель y = −401.9» (смешение единиц).
 * Кроме того, эвристика «stTop на 35% пути BB→седло» двигала ПРАВИЛЬНО
 * стоящую точку (стOp валиден в любой точке оси подседельной трубы) —
 * заменена на геометрически честную проверку «stTop на ОСИ трубы».
 */

import type { BikeType } from "./bike-params";
import type { BikeKeyPoints, NullablePoint } from "./bike-photo-scale";
import {
  type BikeGeometryResult,
  type Point2D,
  makeInverseAlignedTransform,
  perpendicularDistance,
  distance,
} from "./bike-geometry-engine";

/** Типичные значения Stack (мм) по типу велосипеда */
export const TYPICAL_STACK: Record<BikeType, { min: number; max: number; mid: number }> = {
  road:    { min: 490, max: 590, mid: 540 },
  gravel:  { min: 530, max: 620, mid: 575 },
  mtb:     { min: 580, max: 640, mid: 610 },
  hybrid:  { min: 540, max: 640, mid: 590 },
  city:    { min: 540, max: 660, mid: 600 },
};

/** Типичные значения Reach (мм) по типу велосипеда */
export const TYPICAL_REACH: Record<BikeType, { min: number; max: number; mid: number }> = {
  road:    { min: 350, max: 420, mid: 385 },
  gravel:  { min: 360, max: 440, mid: 400 },
  mtb:     { min: 415, max: 480, mid: 448 },
  hybrid:  { min: 360, max: 420, mid: 390 },
  city:    { min: 350, max: 410, mid: 380 },
};

/** Допуск за пределами типичного диапазона, прежде чем подсказывать (мм) */
const STACK_TOLERANCE_MM = 30;

/** Нормальная длина рулевой трубы (мм) — цель при авто-исправлении */
const TYPICAL_HEAD_TUBE_MM = 120;

/** Максимально правдоподобная длина рулевой трубы (мм) */
const MAX_HEAD_TUBE_MM = 250;

/** Допуск «stTop в стороне от оси подседельной трубы» (мм) */
const ST_TOP_OFF_AXIS_MM = 25;

export interface PointSuggestion {
  /** Ключ точки, к которой относится подсказка */
  pointKey: keyof BikeKeyPoints;
  /** Текущее положение точки (нормированные 0..1) */
  current: NullablePoint;
  /** Рекомендуемое положение (нормированные 0..1 — как хранятся точки) */
  suggested: { x: number; y: number };
  /** Что не так с текущим положением */
  problem: string;
  /** Что нужно сделать */
  action: string;
  /** Расстояние от текущего до рекомендуемого (мм, по масштабу движка) */
  distance: number;
  /** Серьёзность (большое расхождение = major) */
  severity: "minor" | "major";
}

/** Контекст подсказок: размер фото + результат ядра v2 */
export interface SuggestionContext {
  /** Размер фото в пикселях (нормированные координаты X по ширине, Y по высоте) */
  imgSize: { width: number; height: number };
  /** Результат calculateBikeGeometry — источник истины (масштаб, поворот, метрики) */
  engine: BikeGeometryResult;
}

/**
 * Вычислить подсказки для точек (v2).
 *
 * @param points Текущие точки (нормированные 0..1)
 * @param ctx Размер фото + результат движка v2
 * @param bikeType Тип велосипеда — типичные диапазоны Stack/Reach
 */
export function suggestPointCorrections(
  points: BikeKeyPoints,
  ctx: SuggestionContext,
  bikeType: BikeType | null
): PointSuggestion[] {
  const suggestions: PointSuggestion[] = [];
  if (!bikeType) return suggestions;

  const { imgSize, engine } = ctx;
  if (!imgSize.width || !imgSize.height || !Number.isFinite(engine.scaleMmPerPx)) {
    return suggestions;
  }
  const s = engine.scaleMmPerPx;

  // Перевод нормированная → пиксельная (X по ширине, Y по высоте)
  const px = (p: NullablePoint): Point2D | null => {
    if (!p || p.x == null || p.y == null) return null;
    return { x: p.x * imgSize.width, y: p.y * imgSize.height };
  };
  // Пиксельная → нормированная, с ограничением внутрь фото
  const toNorm = (p: Point2D): { x: number; y: number } => ({
    x: Math.min(0.99, Math.max(0.01, p.x / imgSize.width)),
    y: Math.min(0.99, Math.max(0.01, p.y / imgSize.height)),
  });

  const unrotate = makeInverseAlignedTransform(engine.frame);

  const bbPx = px(points.bb);
  const htTopPx = px(points.htTop);
  const htBottomPx = px(points.htBottom);
  const stTopPx = px(points.stTop);
  const saddleMountPx = px(points.saddleMount);
  const rearAxlePx = px(points.rearAxle);
  const frontAxlePx = px(points.frontAxle);

  // ============================================================
  // 1. HT ВЕРХ / STACK — по метрике движка (выровненная система)
  // ============================================================
  if (bbPx && htTopPx && htBottomPx) {
    const currentStackMm = engine.metricsMm.stack;
    const typicalStack = TYPICAL_STACK[bikeType];

    if (
      Number.isFinite(currentStackMm) &&
      (currentStackMm > typicalStack.max + STACK_TOLERANCE_MM ||
        currentStackMm < typicalStack.min - STACK_TOLERANCE_MM)
    ) {
      const targetStackMm = currentStackMm > typicalStack.max
        ? typicalStack.max
        : typicalStack.min;

      // Цель в ВЫРОВНЕННОЙ системе: на оси рулевой трубы (htBottom → htTop),
      // на высоте targetStack над BB. Сохраняем угол трубы — двигаем только
      // вдоль её оси.
      const rot = engine.rotated;
      const dirX = rot.htTop.x - rot.htBottom.x;
      const dirY = rot.htTop.y - rot.htBottom.y;
      const targetYrot = rot.bb.y - targetStackMm / s;

      let targetRot: Point2D;
      if (Math.abs(dirY) > 1e-6) {
        const t = (targetYrot - rot.htBottom.y) / dirY;
        targetRot = { x: rot.htBottom.x + t * dirX, y: targetYrot };
      } else {
        // Вырожденная (горизонтальная) рулевая — двигаем вертикально
        targetRot = { x: rot.htTop.x, y: targetYrot };
      }
      const targetImg = unrotate(targetRot);
      const suggested = toNorm(targetImg);

      const distMm = distance(
        { x: engine.rotated.htTop.x, y: engine.rotated.htTop.y },
        targetRot
      ) * s;

      const tooHigh = currentStackMm > typicalStack.max;
      const outOfPhoto =
        targetImg.x < 0 || targetImg.x > imgSize.width ||
        targetImg.y < 0 || targetImg.y > imgSize.height;

      suggestions.push({
        pointKey: "htTop",
        current: points.htTop,
        suggested,
        problem:
          `Stack = ${Math.round(currentStackMm)} мм — слишком ${tooHigh ? "высоко" : "низко"} ` +
          `(норма для ${bikeType}: ${typicalStack.min}-${typicalStack.max} мм). ` +
          `Точка HT верх стоит слишком ${tooHigh ? "высоко" : "низко"} на фото.` +
          (outOfPhoto
            ? " Ожидаемое место выходит за край фото — проверьте разметку BB и рулевой."
            : ""),
        action:
          `Поставить HT верх на оси рулевой трубы со Stack ≈ ${Math.round(targetStackMm)} мм: ` +
          `x=${suggested.x.toFixed(3)}, y=${suggested.y.toFixed(3)} ` +
          `(сейчас: x=${points.htTop?.x?.toFixed(3) ?? "—"}, y=${points.htTop?.y?.toFixed(3) ?? "—"})`,
        distance: Math.round(distMm),
        severity: distMm > 50 ? "major" : "minor",
      });
    }
  }

  // ============================================================
  // 2. HT ВЕРХ / ДЛИНА РУЛЕВОЙ ТРУБЫ — по метрике движка
  //
  // Пропускается, если подсказка для htTop уже выдана проверкой Stack —
  // иначе две цели для одной точки конфликтуют в UI («применить все»).
  // ============================================================
  if (htTopPx && htBottomPx && !suggestions.some((s) => s.pointKey === "htTop")) {
    const htLengthMm = engine.extendedMm.headTubeLength;
    if (Number.isFinite(htLengthMm) && htLengthMm > MAX_HEAD_TUBE_MM) {
      // HT верх стоит на руле/выносе, а не на трубе. Цель: на оси трубы,
      // на типичном расстоянии (120 мм) от HT низ (корона вилки).
      const rot = engine.rotated;
      const len = distance(rot.htTop, rot.htBottom);
      const dirX = len > 1e-6 ? (rot.htTop.x - rot.htBottom.x) / len : 0;
      const dirY = len > 1e-6 ? (rot.htTop.y - rot.htBottom.y) / len : -1;
      const targetRot: Point2D = {
        x: rot.htBottom.x + dirX * (TYPICAL_HEAD_TUBE_MM / s),
        y: rot.htBottom.y + dirY * (TYPICAL_HEAD_TUBE_MM / s),
      };
      const suggested = toNorm(unrotate(targetRot));
      const distMm = distance(rot.htTop, targetRot) * s;

      suggestions.push({
        pointKey: "htTop",
        current: points.htTop,
        suggested,
        problem:
          `Длина рулевой трубы (HT верх → HT низ) = ${Math.round(htLengthMm)} мм — нереально ` +
          `(норма 80-180 мм). Скорее всего HT верх стоит на руле или выносе, а не на трубе рамы. ` +
          `HT низ правильно стоит на короне вилки.`,
        action:
          `Опустить HT верх к трубе рамы (≈${TYPICAL_HEAD_TUBE_MM} мм над короной, по оси трубы): ` +
          `x=${suggested.x.toFixed(3)}, y=${suggested.y.toFixed(3)}`,
        distance: Math.round(distMm),
        severity: distMm > 50 ? "major" : "minor",
      });
    }
  }

  // ============================================================
  // 3. ST ВЕРХ — должен лежать на ОСИ подседельной трубы (BB → седло)
  //
  // stTop валиден в ЛЮБОЙ точке оси (положение верха трубы рамы зависит от
  // размера рамы), поэтому проверяем не «35% пути», а поперечное
  // отклонение от линии BB → saddleMount. Цель — на оси на сохранённом
  // расстоянии от BB (метрика ST length не меняется).
  // ============================================================
  if (bbPx && stTopPx && saddleMountPx) {
    const offAxisMm =
      perpendicularDistance(stTopPx, bbPx, saddleMountPx) * s;
    if (offAxisMm > ST_TOP_OFF_AXIS_MM) {
      const dx = saddleMountPx.x - bbPx.x;
      const dy = saddleMountPx.y - bbPx.y;
      // Цель: на оси подседельной трубы (BB → saddleMount), на СОХРАНЁННОМ
      // расстоянии от BB — метрика «длина подседельной» не меняется после
      // применения подсказки, убирается только поперечное отклонение.
      const stLenPx = distance(stTopPx, bbPx);
      const len = Math.sqrt(dx * dx + dy * dy);
      const target: Point2D = len > 1e-9
        ? { x: bbPx.x + (dx / len) * stLenPx, y: bbPx.y + (dy / len) * stLenPx }
        : stTopPx;
      const suggested = toNorm(target);
      const stLenMm = engine.extendedMm.seatTubeLength;

      suggestions.push({
        pointKey: "stTop",
        current: points.stTop,
        suggested,
        problem:
          `Верх подседельной трубы стоит на ${Math.round(offAxisMm)} мм в стороне от оси ` +
          `подседельной (линия BB → крепление седла)` +
          (Number.isFinite(stLenMm) ? `. Длина трубы по фото: ${Math.round(stLenMm)} мм.` : "") +
          ` Обычно точка попадает на линию BB → седло.`,
        action:
          `Сдвинуть ST верх на ось подседельной трубы (сохранив длину ${Number.isFinite(stLenMm) ? Math.round(stLenMm) + " мм" : "трубы"}): ` +
          `x=${suggested.x.toFixed(3)}, y=${suggested.y.toFixed(3)} ` +
          `(сейчас: x=${points.stTop?.x?.toFixed(3) ?? "—"}, y=${points.stTop?.y?.toFixed(3) ?? "—"})`,
        distance: Math.round(offAxisMm),
        severity: offAxisMm > 50 ? "major" : "minor",
      });
    }
  }

  // ============================================================
  // 4. ОСИ КОЛЁС — разница Y на сыром фото (перспектива/наклон)
  //
  // Проверка по СЫРЫМ координатам фото: движок v2 компенсирует наклон
  // математически, но сильная разница Y — признак перспективы, которую
  // лучше исправить (панель «Коррекция перспективы»).
  // ============================================================
  if (rearAxlePx && frontAxlePx) {
    const deltaY = Math.abs(frontAxlePx.y - rearAxlePx.y) / imgSize.height;
    if (deltaY > 0.05) {
      const targetY = rearAxlePx.y;
      const distMm = Math.abs(targetY - frontAxlePx.y) * s;

      suggestions.push({
        pointKey: "frontAxle",
        current: points.frontAxle,
        suggested: toNorm({ x: frontAxlePx.x, y: targetY }),
        problem:
          `Передняя ось на ${(deltaY * 100).toFixed(1)}% выше/ниже задней. Либо фото снято под углом, ` +
          `либо ось стоит неточно. Можно выровнять по задней или применить коррекцию перспективы ` +
          `(движок уже компенсирует наклон ${engine.anglesDeg.frameTilt.toFixed(1)}° математически).`,
        action:
          `Выровнять переднюю ось по Y задней (y=${(targetY / imgSize.height).toFixed(3)}, ` +
          `сейчас y=${points.frontAxle?.y?.toFixed(3) ?? "—"})`,
        distance: Math.round(distMm),
        severity: distMm > imgSize.height * 0.08 * s ? "major" : "minor",
      });
    }
  }

  return suggestions;
}

/**
 * Применить подсказку: переместить точку в рекомендованное положение.
 */
export function applySuggestion(
  points: BikeKeyPoints,
  suggestion: PointSuggestion
): BikeKeyPoints {
  return {
    ...points,
    [suggestion.pointKey]: { x: suggestion.suggested.x, y: suggestion.suggested.y },
  };
}
