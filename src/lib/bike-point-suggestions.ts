/**
 * Авто-подсказки для положения точек.
 *
 * Если точка стоит нереально (например, Stack > 700 — HT верх слишком высоко),
 * помогаем пользователю понять, где она должна быть.
 *
 * Логика:
 * 1. Для каждого bikeType есть типичный диапазон Stack/Reach.
 * 2. Зная текущий scale (мм/норм.ед.) и координаты BB,
 *    можно вычислить ожидаемое Y для HT верх.
 * 3. Если текущая позиция точки сильно отличается —
 *    предлагаем поправить (или сделать автоматически).
 */

import type { BikeType } from "./bike-params";
import type { BikeKeyPoints, NullablePoint } from "./bike-photo-scale";

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

export interface PointSuggestion {
  /** Ключ точки, к которой относится подсказка */
  pointKey: keyof BikeKeyPoints;
  /** Текущее положение точки */
  current: NullablePoint;
  /** Рекомендуемое положение (где точка должна быть) */
  suggested: { x: number; y: number };
  /** Что не так с текущим положением */
  problem: string;
  /** Что нужно сделать */
  action: string;
  /** Расстояние от текущего до рекомендуемого (норм.ед.) */
  distance: number;
  /** Серьёзность (большое расхождение = major) */
  severity: "minor" | "major";
}

/**
 * Вычислить подсказки для точек на основе:
 * - текущего масштаба (scale)
 * - типа велосипеда (bikeType) — типичные Stack/Reach
 * - известных точек (BB, rearAxle) — для привязки
 *
 * @param points Текущие точки
 * @param scale Масштаб (мм/норм.ед.) — если null, не можем вычислять
 * @param bikeType Тип велосипеда
 * @param multiCalibration Опционально: результат мульти-калибровки для согласованности параметров
 * @returns Массив подсказок (пустой = всё ок)
 */
export function suggestPointCorrections(
  points: BikeKeyPoints,
  scale: number,
  bikeType: BikeType | null,
  multiCalibration?: {
    perParameter: Array<{ key: string; knownValueMm: number; pxDistance: number; scale: number; deviation: number }>;
    outlier: string | null;
  } | null
): PointSuggestion[] {
  const suggestions: PointSuggestion[] = [];

  if (!bikeType || scale <= 0) return suggestions;

  const bb = points.bb;
  const htTop = points.htTop;
  const htBottom = points.htBottom;
  const rearAxle = points.rearAxle;
  const frontAxle = points.frontAxle;
  const saddleMount = points.saddleMount;
  const stTop = points.stTop;

  // === ПРОВЕРКА SH: если saddleHeight "выбивается" в мульти-калибровке,
  // значит либо BB либо saddleMount стоят неточно.
  // Используем другой scale (от WB/ETT) чтобы понять где saddleMount должна быть.
  if (multiCalibration && multiCalibration.outlier === "saddleHeight") {
    // Средний масштаб по другим параметрам (без SH).
    // Берём параметры с разумным отклонением (до 25% — иначе они тоже подозрительные).
    const others = multiCalibration.perParameter.filter(
      (p) => p.key !== "saddleHeight" && Math.abs(p.deviation) < 25
    );
    if (
      others.length > 0 &&
      bb && bb.x != null && bb.y != null &&
      saddleMount && saddleMount.x != null && saddleMount.y != null
    ) {
      const otherScale =
        others.reduce((s, p) => s + p.scale, 0) / others.length;

      // Известный SH (который мы доверяем как реальный)
      const realSH = multiCalibration.perParameter.find(
        (p) => p.key === "saddleHeight"
      )?.knownValueMm;

      if (realSH && realSH > 0) {
        // Ожидаемое расстояние на фото
        const expectedPx = realSH / otherScale;
        // Текущее расстояние
        const dx = saddleMount.x - bb.x;
        const dy = saddleMount.y - bb.y;
        const currentPx = Math.sqrt(dx * dx + dy * dy);
        const ratio = currentPx / expectedPx;

        // Если текущее расстояние > 1.10× ожидаемого — точки слишком далеко
        if (ratio > 1.10) {
          // Сдвигаем saddleMount ближе к BB, сохраняя направление
          const factor = expectedPx / currentPx;
          const newX = bb.x + dx * factor;
          const newY = bb.y + dy * factor;

          const dist = Math.sqrt(
            Math.pow(newX - saddleMount.x, 2) + Math.pow(newY - saddleMount.y, 2)
          );

          suggestions.push({
            pointKey: "saddleMount",
            current: saddleMount,
            suggested: { x: newX, y: newY },
            problem:
              `Расстояние BB→saddleMount по фото = ${currentPx.toFixed(3)} норм.ед., ` +
              `а должно быть ≈ ${expectedPx.toFixed(3)} (при scale=${otherScale.toFixed(0)} мм/ед. от WB/ETT, ` +
              `SH=${realSH} мм). Точки стоят на ${((ratio - 1) * 100).toFixed(0)}% дальше чем надо. ` +
              `Скорее всего saddleMount стоит на верхней кромке штыря, а не на хомуте крепления седла.`,
            action:
              `Сдвинуть saddleMount ближе к BB (сохраняя направление) — ` +
              `новые координаты: x=${newX.toFixed(3)}, y=${newY.toFixed(3)} ` +
              `(сейчас: x=${saddleMount.x.toFixed(3)}, y=${saddleMount.y.toFixed(3)})`,
            distance: dist,
            severity: dist > 0.05 ? "major" : "minor",
          });
        }
      }
    }
  }

  // === ПРОВЕРКА HT ВЕРХ (Stack) ===
  if (
    bb && bb.x != null && bb.y != null &&
    htTop && htTop.x != null && htTop.y != null
  ) {
    // Текущий Stack в мм
    const currentStackMm = (bb.y - htTop.y) * scale;
    const typicalStack = TYPICAL_STACK[bikeType];

    // Если текущий Stack выходит за типичный диапазон более чем на 30 мм
    if (currentStackMm > typicalStack.max + 30 || currentStackMm < typicalStack.min - 30) {
      // Вычисляем целевой Stack (середину диапазона, если текущий сильно выходит)
      const targetStackMm = currentStackMm > typicalStack.max
        ? typicalStack.max  // слишком высоко — цель = максимум
        : typicalStack.min; // слишком низко — цель = минимум

      // Целевой Y для HT верх
      const targetY = bb.y - targetStackMm / scale;

      // По X: HT верх должен быть примерно над передней осью или чуть правее BB
      // Используем frontAxle.x если есть, иначе берём 0.3 (типичное значение для бокового фото)
      const targetX = frontAxle?.x != null ? frontAxle.x : htTop.x;

      const dist = Math.sqrt(
        Math.pow(targetX - htTop.x, 2) + Math.pow(targetY - htTop.y, 2)
      );

      const problem =
        currentStackMm > typicalStack.max
          ? `Stack = ${Math.round(currentStackMm)} мм — слишком высоко (норма для ${bikeType}: ${typicalStack.min}-${typicalStack.max} мм). Точка HT верх стоит слишком высоко на фото.`
          : `Stack = ${Math.round(currentStackMm)} мм — слишком низко (норма для ${bikeType}: ${typicalStack.min}-${typicalStack.max} мм). Точка HT верх стоит слишком низко на фото.`;

      suggestions.push({
        pointKey: "htTop",
        current: htTop,
        suggested: { x: targetX, y: targetY },
        problem,
        action: `Опустить/поднять точку HT верх на y=${targetY.toFixed(3)} (сейчас y=${htTop.y.toFixed(3)})`,
        distance: dist,
        severity: dist > 0.05 ? "major" : "minor",
      });
    }
  }

  // === ПРОВЕРКА HT ВЕРХ и HT НИЗ (длина рулевой трубы) ===
  // Длина рулевой трубы = HT верх → HT низ (а HT низ совпадает с короной вилки).
  // Норма: шоссе 90-180 мм, MTB 90-130 мм.
  // Если получается > 250 мм — HT верх стоит слишком высоко (на руле или выносе, а не на раме).
  if (
    htTop && htTop.x != null && htTop.y != null &&
    htBottom && htBottom.x != null && htBottom.y != null
  ) {
    const htLengthMm = Math.sqrt(
      Math.pow((htTop.x - htBottom.x) * scale, 2) +
      Math.pow((htTop.y - htBottom.y) * scale, 2)
    );
    if (htLengthMm > 250) {
      // Скорее всего HT верх стоит на руле или на выносе, а не на трубе рамы.
      // Опускаем HT верх к HT низу на типичное расстояние рулевой трубы (120 мм).
      const targetY = htBottom.y - (120 / scale);
      const targetX = htBottom.x; // примерно вертикально над HT низ

      const dist = Math.sqrt(
        Math.pow(targetX - htTop.x, 2) + Math.pow(targetY - htTop.y, 2)
      );

      suggestions.push({
        pointKey: "htTop",
        current: htTop,
        suggested: { x: targetX, y: targetY },
        problem: `Длина рулевой трубы (HT верх → HT низ) = ${Math.round(htLengthMm)} мм — нереально (норма 80-180 мм). Скорее всего HT верх стоит на руле или выносе, а не на трубе рамы. HT низ правильно стоит на короне вилки.`,
        action: `Опустить HT верх к трубе рамы: y=${targetY.toFixed(3)} (сейчас y=${htTop.y.toFixed(3)})`,
        distance: dist,
        severity: dist > 0.05 ? "major" : "minor",
      });
    }
  }

  // === ПРОВЕРКА ОСЕЙ: должны быть примерно на одном Y ===
  if (
    rearAxle && rearAxle.x != null && rearAxle.y != null &&
    frontAxle && frontAxle.x != null && frontAxle.y != null
  ) {
    const deltaY = Math.abs(frontAxle.y - rearAxle.y);
    if (deltaY > 0.05) {
      const targetY = rearAxle.y;
      const dist = Math.abs(targetY - frontAxle.y);

      suggestions.push({
        pointKey: "frontAxle",
        current: frontAxle,
        suggested: { x: frontAxle.x, y: targetY },
        problem: `Передняя ось на ${(deltaY * 100).toFixed(1)}% выше/ниже задней. Либо фото снято под углом, либо ось стоит неточно. Можно выровнять по задней или применить коррекцию перспективы.`,
        action: `Выровнять переднюю ось по Y задней (y=${targetY.toFixed(3)}, сейчас y=${frontAxle.y.toFixed(3)})`,
        distance: dist,
        severity: dist > 0.08 ? "major" : "minor",
      });
    }
  }

  // === ПРОВЕРКА ST ВЕРХ: должен быть примерно над/под BB ===
  if (
    bb && bb.x != null && bb.y != null &&
    stTop && stTop.x != null && stTop.y != null &&
    saddleMount && saddleMount.x != null && saddleMount.y != null
  ) {
    // ST верх обычно чуть правее BB (по направлению к седлу), на ~30-50% пути от BB к saddleMount
    // Если ST верх стоит далеко от линии BB→saddleMount — возможно ошибка
    const dxToSaddle = saddleMount.x - bb.x;
    const dyToSaddle = saddleMount.y - bb.y;
    // ST верх должен быть на ~30-50% от BB к saddleMount (по длине подседельной трубы)
    // Если saddleMount высоко (y=0.2), а BB внизу (y=0.69), то ST верх ≈ y=0.35-0.40
    const expectedStTopRatio = 0.35; // 35% пути от BB к saddleMount
    const expectedStTopX = bb.x + dxToSaddle * expectedStTopRatio;
    const expectedStTopY = bb.y + dyToSaddle * expectedStTopRatio;
    const stTopDist = Math.sqrt(
      Math.pow(stTop.x - expectedStTopX, 2) + Math.pow(stTop.y - expectedStTopY, 2)
    );
    if (stTopDist > 0.1) {
      suggestions.push({
        pointKey: "stTop",
        current: stTop,
        suggested: { x: expectedStTopX, y: expectedStTopY },
        problem: `Верх подседельной трубы стоит далеко от ожидаемого места (на ~35% пути от BB к седлу).`,
        action: `Сдвинуть ST верх ближе к (x=${expectedStTopX.toFixed(3)}, y=${expectedStTopY.toFixed(3)})`,
        distance: stTopDist,
        severity: stTopDist > 0.15 ? "major" : "minor",
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
