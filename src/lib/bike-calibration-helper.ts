/**
 * Авто-калибровка масштаба и угла наклона горизонта (БЕЗ поворота точек).
 *
 * Принципы:
 * 1. Авто-выбор primary параметра — тот, у которого наибольшее расстояние в пикселях
 *    (обычно WB — колесная база), т.к. он даёт минимальную погрешность масштаба.
 * 2. Остальные параметры — для скрытой валидации (если расхождение >12% → warning).
 * 3. Наклон горизонта (tiltAngleRad) считается математически и передаётся в расчёты.
 *    ТОЧКИ НЕ ПОВОРАЧИВАЮТСЯ — они остаются на своих местах на фото.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface UserInputDimensions {
  shMm?: number;  // Saddle Height (мм)
  wbMm?: number;  // Wheelbase (мм)
  ettMm?: number; // Effective Top Tube (мм)
}

export interface KnownPoints {
  bb: Point2D;
  saddle: Point2D;
  rearAxle: Point2D;
  frontAxle: Point2D;
  stTop?: Point2D;
  htTop?: Point2D;
}

export interface CalibrationResult {
  /** Итоговый масштаб (мм в 1 пикселе) */
  scalePxToMm: number;
  /** Ключевой параметр, который был выбран основным */
  primaryParam: "WB" | "SH" | "ETT";
  /** Расчитанный угол завала горизонта (в радианах) для математической поправки */
  tiltAngleRad: number;
  /** Предупреждение о некорректно расставленных точках (если есть) */
  validationWarning?: string;
}

/** Вспомогательная функция расчёта расстояния между точками в ПИКСЕЛЯХ (с учётом imgSize) */
function getPxDistance(p1: Point2D, p2: Point2D, imgSize?: { width: number; height: number }): number {
  if (imgSize) {
    // Конвертируем нормализованные [0..1] в пиксели
    const dx = (p2.x - p1.x) * imgSize.width;
    const dy = (p2.y - p1.y) * imgSize.height;
    return Math.hypot(dx, dy);
  }
  // Фоллбэк без imgSize (менее точно для неквадратных фото)
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Рассчитывает масштаб без физического поворота точек и без ручной мульти-калибровки.
 *
 * Логика:
 * 1. Если введён 1 параметр — калибруем по нему.
 * 2. Если 2+ параметра — берём primary = параметр с максимальным px-расстоянием.
 * 3. Остальные — для скрытой валидации (>12% расхождения → warning).
 * 4. tiltAngleRad считается из rearAxle→frontAxle (угол к горизонтали).
 *
 * ВАЖНО: imgSize нужен для корректного расчёта на неквадратных фото!
 * Без imgSize нормализованные [0..1] координаты по X и Y масштабируются
 * по-разному (ширина vs высота), что даёт ошибку до 40%.
 */
export function calculateAutoFitCalibration(
  points: KnownPoints,
  dimensions: UserInputDimensions,
  imgSize?: { width: number; height: number }
): CalibrationResult {
  const candidates: Array<{
    type: "WB" | "SH" | "ETT";
    pxDist: number;
    realMm: number;
    scale: number;
  }> = [];

  // 1. Собираем доступные отрезки (в пикселях!)
  if (dimensions.wbMm && points.rearAxle && points.frontAxle) {
    const px = getPxDistance(points.rearAxle, points.frontAxle, imgSize);
    if (px > 0) {
      candidates.push({
        type: "WB",
        pxDist: px,
        realMm: dimensions.wbMm,
        scale: dimensions.wbMm / px,
      });
    }
  }

  if (dimensions.shMm && points.bb && points.saddle) {
    const px = getPxDistance(points.bb, points.saddle, imgSize);
    if (px > 0) {
      candidates.push({
        type: "SH",
        pxDist: px,
        realMm: dimensions.shMm,
        scale: dimensions.shMm / px,
      });
    }
  }

  if (dimensions.ettMm && points.stTop && points.htTop) {
    const px = getPxDistance(points.stTop, points.htTop, imgSize);
    if (px > 0) {
      candidates.push({
        type: "ETT",
        pxDist: px,
        realMm: dimensions.ettMm,
        scale: dimensions.ettMm / px,
      });
    }
  }

  // Фолбэк, если размеры не ввели
  if (candidates.length === 0) {
    return {
      scalePxToMm: 1.0,
      primaryParam: "WB",
      tiltAngleRad: 0,
      validationWarning: "Не введены физические размеры для калибровки.",
    };
  }

  // 2. ВЫБОР PRIMARY: выбираем отрезок с наибольшим расстоянием в пикселях (минимальная ошибка)
  candidates.sort((a, b) => b.pxDist - a.pxDist);
  const primary = candidates[0];

  // 3. ВАЛИДАЦИЯ: проверяем, не противоречат ли остальные параметры основному
  let validationWarning: string | undefined;
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    const diffPercent = Math.abs(candidate.scale - primary.scale) / primary.scale;

    // Если разница масштабов больше 12%, точка где-то стоит неточно
    if (diffPercent > 0.12) {
      validationWarning = `Точки параметров ${primary.type} и ${candidate.type} расходятся на ${(diffPercent * 100).toFixed(1)}%. Проверьте правильность установки точек на фото.`;
      break;
    }
  }

  // 4. РАСЧЕТ НАКЛОНА ГОРИЗОНТА (Без изменения координат точек!)
  let tiltAngleRad = 0;
  if (points.rearAxle && points.frontAxle) {
    const dx = points.frontAxle.x - points.rearAxle.x;
    const dy = points.frontAxle.y - points.rearAxle.y;
    // Находим угол наклона линии осей к горизонту
    tiltAngleRad = Math.atan2(dy, dx);
  }

  return {
    scalePxToMm: primary.scale,
    primaryParam: primary.type,
    tiltAngleRad,
    validationWarning,
  };
}

/**
 * Пример: Угол подседельной трубы с учетом поправки завала горизонта.
 *
 * Корректировка на tiltAngleRad применяется математически (минусуем),
 * без изменения координат самих точек.
 */
export function calculateAdjustedSeatAngle(
  bb: Point2D,
  saddle: Point2D,
  tiltAngleRad: number
): number {
  const dx = saddle.x - bb.x;
  const dy = bb.y - saddle.y; // Инверсия Y для Canvas

  // Сырой угол относительно экрана
  const rawAngleRad = Math.atan2(dy, dx);

  // Корректируем на завал велосипеда (минусуем tilt)
  const correctedAngleRad = rawAngleRad - tiltAngleRad;

  // Переводим в градусы
  return (correctedAngleRad * 180) / Math.PI;
}

/**
 * Применяет математическую коррекцию наклона к горизонтальной проекции вектора.
 *
 * Используется для Reach, ETT, Setback — где нужна только горизонталь
 * относительно ИСТИННОЙ горизонтали (с учётом завала велосипеда на фото).
 */
export function correctedHorizontalProjection(
  p1: Point2D,
  p2: Point2D,
  tiltAngleRad: number
): number {
  // Вектор между точками
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;

  // Поворачиваем вектор на -tiltAngleRad (чтобы привести к истинной горизонтали)
  const cos = Math.cos(-tiltAngleRad);
  const sin = Math.sin(-tiltAngleRad);
  const correctedDx = dx * cos - dy * sin;

  return Math.abs(correctedDx);
}

/**
 * Применяет математическую коррекцию наклона к вертикальной проекции вектора.
 *
 * Используется для Stack, BB Drop, BBH — где нужна только вертикаль.
 */
export function correctedVerticalProjection(
  p1: Point2D,
  p2: Point2D,
  tiltAngleRad: number
): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;

  const cos = Math.cos(-tiltAngleRad);
  const sin = Math.sin(-tiltAngleRad);
  const correctedDy = dx * sin + dy * cos;

  return Math.abs(correctedDy);
}
