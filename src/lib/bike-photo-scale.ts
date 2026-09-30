/**
 * Калибровка масштаба фото велосипеда и вычисление параметров геометрии.
 *
 * Принцип:
 * 1. VLM определяет ключевые точки велосипеда в пикселях (BB, седло, руль, оси колёс)
 * 2. Пользователь указывает один известный размер (например, шатун = 172.5 мм)
 * 3. Вычисляем масштаб: scale = known_mm / known_px
 * 4. Все остальные размеры = пиксели × scale
 *
 * Затем вычисленные значения можно сравнить с измеренными вручную
 * и получить усреднённые (более точные) значения.
 */

import { computeRigorousBikeParams, type ImageSize } from "./bike-geometry-math";

// Re-export для обратной совместимости (другие файлы импортируют отсюда)
export type { ImageSize };

// ============================================================
// ТИПЫ
// ============================================================

export interface PixelPoint {
  x: number;
  y: number;
}

/** Точка может быть null (если VLM не смог определить) */
export type NullablePoint = { x: number | null; y: number | null };

export interface BikeKeyPoints {
  /** Центр каретки (BB) */
  bb: NullablePoint;
  /** Верх подседельной трубы (где крепится штырь) */
  stTop: NullablePoint;
  /** Точка крепления седла к подседельному штырю (для расчёта SH и Setback) */
  saddleMount: NullablePoint;
  /** ВЕРХ стакана РАМЫ = НИЗ ВЫНОСА — для расчёта Reach/Stack по стандарту */
  htTop: NullablePoint;
  /** НИЗ стакана РАМЫ = КОРОНА ВИЛКИ — для расчёта длины рулевой и вилки */
  htBottom: NullablePoint;
  /** TOP CAP — верхняя крышка рулевой с болтом (для посадки райдера) */
  htTopCap: NullablePoint;
  /** Центр оси заднего колеса */
  rearAxle: NullablePoint;
  /** Центр оси переднего колеса */
  frontAxle: NullablePoint;
  /** ОПЦИОНАЛЬНО: верх заднего колеса (видимая верхняя точка покрышки) — для dual scale */
  rearWheelTop?: NullablePoint;
  /** ОПЦИОНАЛЬНО: верх переднего колеса — для dual scale */
  frontWheelTop?: NullablePoint;
}

export type KnownDimensionKey =
  | "crank"        // Длина шатуна (BB → ось педали)
  | "wheelHeight"  // Радиус колеса (ось → земля)
  | "saddleHeight" // Высота седла (BB → седло)
  | "ett"          // Эффективная верхняя труба
  | "wheelbase"    // Колёсная база
  | "stem";        // Длина выноса

export interface KnownDimension {
  key: KnownDimensionKey;
  value: number; // в мм
}

export interface ComputedBikeParams {
  /** Высота седла (BB → седло по прямой), мм */
  saddleHeight: number | null;
  /** Эффективная верхняя труба (горизонталь ST→HT), мм */
  ett: number | null;
  /** ETT по прямой горизонтали ST→HT (без формулы Reach + Stack/tan(STA)) — для диагностики, мм */
  ettDirect: number | null;
  /** Reach (горизонталь BB→HT), мм */
  reach: number | null;
  /** Stack (вертикаль BB→HT), мм */
  stack: number | null;
  /** Длина выноса (HT_top → руль), мм */
  stem: number | null;
  /** Колёсная база (задняя ось → передняя ось), мм */
  wheelbase: number | null;
  /** Радиус колеса с покрышкой (ось → земля), мм */
  wheelHeight: number | null;
  /** Высота каретки от земли, мм */
  bbHeight: number | null;
  /** BB Drop = Wheel Height − BB Height, мм */
  bbDrop: number | null;
  /** Задний центр (BB → задняя ось), мм */
  rearCenter: number | null;
  /** Передний центр (BB → передняя ось), мм */
  frontCenter: number | null;
  /** Stack/Reach ratio */
  stackReachRatio: number | null;
  /** Setback (горизонталь BB → точка крепления седла), мм */
  setback: number | null;
  /** Длина подседельной трубы (BB → ST_top), мм */
  seatTubeLength: number | null;
  /** Длина вилки (HT_bottom → передняя ось), мм */
  forkLength: number | null;
  /** Длина рулевой трубы (HT_top → HT_bottom), мм */
  headTubeLength: number | null;
  /** Fork Offset — перпендикуляр от передней оси до оси рулевой трубы, мм */
  forkOffset: number | null;
  /** Высота руля (BB → top cap по вертикали), мм — для расчёта посадки райдера */
  handlebarHeight: number | null;
  /** Высота проставок + top cap (htTop → htTopCap по вертикали), мм */
  spacerStackHeight: number | null;
  /** STA — угол подседельной трубы (градусы), вычислен по точкам */
  sta: number | null;
  /** HTA — угол рулевой трубы (градусы), вычислен по точкам */
  hta: number | null;
  /** Масштаб: мм на пиксель */
  scale: number;
  /** Какой размер использован для калибровки */
  calibratedBy: KnownDimensionKey;
}

// ============================================================
// ПЕРСПЕКТИВА (детекция и коррекция)
// ============================================================

/**
 * Информация о перспективном искажении фото.
 *
 * Если фото снято не строго сбоку (камера не перпендикулярна велосипеду),
 * колёса выглядят как эллипсы, а задняя и передняя оси оказываются
 * на разной высоте Y. Это искажает все вычисления.
 */
export interface PerspectiveInfo {
  /** Разница Y между передней и задней осью (норм. ед., >0 = передняя ниже) */
  deltaY: number;
  /** Абсолютное значение deltaY */
  absDeltaY: number;
  /** Угол наклона камеры (приблизительно, градусы) */
  angleDeg: number;
  /** Степень искажения */
  severity: "none" | "minor" | "major";
  /** Рекомендуется коррекция */
  needsCorrection: boolean;
  /** Понятное описание */
  description: string;
}

/**
 * Детектировать перспективное искажение по разнице Y между осями колёс.
 *
 * Если фото снято строго сбоку — обе оси на одном уровне Y (deltaY ≈ 0).
 * Если камера развёрнута вокруг вертикальной оси — одна ось кажется
 * ниже другой.
 *
 * @param points Ключевые точки
 * @returns PerspectiveInfo или null если осей нет
 */
export function detectPerspective(points: BikeKeyPoints): PerspectiveInfo | null {
  const rear = points.rearAxle;
  const front = points.frontAxle;
  if (!rear || !front) return null;
  if (rear.x == null || rear.y == null) return null;
  if (front.x == null || front.y == null) return null;

  const deltaY = front.y - rear.y;
  const absDeltaY = Math.abs(deltaY);
  const deltaX = Math.abs(front.x - rear.x);
  const angleRad = deltaX > 0.001 ? Math.atan2(deltaY, deltaX) : 0;
  const angleDeg = (angleRad * 180) / Math.PI;

  let severity: PerspectiveInfo["severity"] = "none";
  let description = "Перспектива в норме — фото снято сбоку.";

  // Пороги в долях от высоты фото (норм. ед. [0..1])
  if (absDeltaY > 0.05) {
    severity = "major";
    description = `Сильное искажение: передняя ось на ${(absDeltaY * 100).toFixed(1)}% ниже/выше задней. Камера не перпендикулярна велосипеду — колёса выглядят эллипсами. Расчёты будут неточными. Рекомендуется коррекция.`;
  } else if (absDeltaY > 0.02) {
    severity = "minor";
    description = `Небольшое искажение: разница ${(absDeltaY * 100).toFixed(1)}% по высоте. Допустимо, но для точности лучше применить коррекцию.`;
  } else {
    description = `Перспектива в норме (Δ=${(absDeltaY * 100).toFixed(2)}%).`;
  }

  return {
    deltaY,
    absDeltaY,
    angleDeg,
    severity,
    needsCorrection: severity !== "none",
    description,
  };
}

/**
 * Применить коррекцию перспективы — аффинный сдвиг по Y.
 *
 * Логика: для каждой точки вычисляем, насколько она сдвинута по X
 * относительно rearAxle, и пропорционально корректируем Y так,
 * чтобы точки на rearAxle.x остались на месте, а точки на frontAxle.x
 * оказались на том же Y, что и rear (выровнять оси).
 *
 * Это эквивалентно "вытягиванию" фото как трапеции в прямоугольник.
 *
 * @param points Исходные точки
 * @returns Скорректированные точки (то же количество, тот же тип)
 */
export function applyPerspectiveCorrection(points: BikeKeyPoints): BikeKeyPoints {
  const rear = points.rearAxle;
  const front = points.frontAxle;
  if (!rear || !front) return points;
  if (rear.x == null || rear.y == null) return points;
  if (front.x == null || front.y == null) return points;

  const rearX = rear.x;
  const rearY = rear.y;
  const frontX = front.x;
  const frontY = front.y;
  const deltaY = frontY - rearY;
  const deltaX = frontX - rearX;

  // Если оси почти на одной вертикали — коррекция не нужна
  if (Math.abs(deltaX) < 0.001) return points;

  // Коэффициент сдвига: насколько Y меняется на единицу X
  const k = deltaY / deltaX;

  const corrected: BikeKeyPoints = { ...points };
  const keys = Object.keys(points) as Array<keyof BikeKeyPoints>;
  for (const key of keys) {
    const pt = points[key];
    if (pt && pt.x != null && pt.y != null) {
      // Сдвигаем Y так, чтобы rearAxle остался на месте (x=rearX → shift=0),
      // а frontAxle получил shift=deltaY (что обнулит разницу Y).
      const shift = k * (pt.x - rearX);
      // y_new = y - shift; для frontAxle: y_front - deltaY = y_rear ✓
      const newY = pt.y - shift;
      corrected[key] = {
        x: pt.x,
        y: Math.max(0, Math.min(1, newY)),
      };
    }
  }
  return corrected;
}

// ============================================================
// КАЛИБРОВКА МАСШТАБА
// ============================================================

/**
 * Проверить, что точка валидна (координаты не null).
 */
function isValidPoint(pt: NullablePoint | null | undefined): pt is NullablePoint {
  return !!pt && pt.x != null && pt.y != null && !Number.isNaN(pt.x) && !Number.isNaN(pt.y);
}

/**
 * Вычислить расстояние между двумя точками в пикселях.
 * Возвращает null, если хотя бы одна точка невалидна.
 */
function pixelDistance(a: NullablePoint | null | undefined, b: NullablePoint | null | undefined): number | null {
  if (!isValidPoint(a) || !isValidPoint(b)) return null;
  return Math.sqrt(Math.pow(b.x! - a.x!, 2) + Math.pow(b.y! - a.y!, 2));
}

/**
 * Вычислить горизонтальное расстояние между двумя точками в пикселях.
 */
function pixelHorizontal(a: NullablePoint | null | undefined, b: NullablePoint | null | undefined): number | null {
  if (!isValidPoint(a) || !isValidPoint(b)) return null;
  return Math.abs(b.x! - a.x!);
}

/**
 * Вычислить вертикальное расстояние между двумя точками в пикселях.
 */
function pixelVertical(a: NullablePoint | null | undefined, b: NullablePoint | null | undefined): number | null {
  if (!isValidPoint(a) || !isValidPoint(b)) return null;
  return Math.abs(b.y! - a.y!);
}

/**
 * Определить пиксельное расстояние для известного параметра.
 * Возвращает длину в пикселях, соответствующую известному размеру.
 */
function getPixelDistanceForKey(
  points: BikeKeyPoints,
  key: KnownDimensionKey
): number | null {
  switch (key) {
    case "crank":
      // Шатун: BB → ось педали. Ось педали не входит в BikeKeyPoints.
      // Используем BB → rearAxle как приближение (chainstay ≈ crank для калибровки)
      // НЕТ! Это неправильно. Лучше использовать wheelHeight для калибровки.
      // Если пользователь знает crank, но у нас нет точки педали — не можем откалибровать.
      // Возвращаем null, функция калибровки попробует другой размер.
      return null;

    case "wheelHeight":
      // Радиус колеса: ось → земля.
      // Земля не входит в BikeKeyPoints, но можно вычислить:
      // земля = rearAxle.y + wheelRadius_px
      // wheelRadius_px = расстояние от оси до самой нижней точки колеса
      // Поскольку у нас нет точной нижней точки, используем:
      // rearAxle.y → frontAxle.y (горизонталь осей) и предполагаем,
      // что земля находится на том же уровне, что и нижние точки колёс.
      // НО! Лучше всего использовать wheelbase для калибровки.
      // Для wheelHeight: если фото сделано сбоку и колёса видны полностью,
      // земля = max(rearAxle.y, frontAxle.y) + радиус_колеса_в_пикселях
      // Но радиус мы не знаем. Круговая зависимость.
      // Решение: не используем wheelHeight для калибровки через точки.
      return null;

    case "saddleHeight":
      // BB → седло (по прямой)
      return pixelDistance(points.bb, points.saddleMount);

    case "ett":
      // Горизонталь от ST_top до HT_top
      return pixelHorizontal(points.stTop, points.htTop);

    case "wheelbase":
      // Горизонталь от задней оси до передней оси
      return pixelHorizontal(points.rearAxle, points.frontAxle);

    case "stem":
      // HT_top → руль (руль не входит в BikeKeyPoints)
      // Используем HT_top → HT_bottom как приближение? Нет, это HT length.
      // Stem = HT_top → руль. Не можем вычислить без точки руля.
      return null;

    default:
      return null;
  }
}

/**
 * Откалибровать масштаб фото по известному размеру.
 *
 * Координаты точек — нормализованные [0..1] (не зависят от размера фото).
 * Поэтому масштаб = (мм в реальности) / (расстояние в нормализованных единицах).
 * Например, если saddleHeight = 730 мм, а расстояние BB↔saddleMount в нормализованных
 * координатах = 0.45, то scale = 730 / 0.45 = 1622 мм на единицу.
 *
 * Все остальные расстояния в computeParamsFromPhoto умножаются на scale —
 * итоговые значения получаются в мм.
 *
 * @returns Масштаб (мм/нормализованную единицу) или null если не удалось.
 *          В случае null возвращает diagnostics с причиной.
 */
export function calibrateScale(
  points: BikeKeyPoints,
  known: KnownDimension
): { scale: number | null; diagnostics: CalibrationDiagnostics } {
  const pxDistance = getPixelDistanceForKey(points, known.key);

  const diagnostics: CalibrationDiagnostics = {
    knownKey: known.key,
    knownValueMm: known.value,
    pxDistanceRaw: pxDistance,
    pointA: null,
    pointB: null,
    reason: null,
  };

  // Заполняем координаты точек, использованных для калибровки
  const fillCoords = () => {
    switch (known.key) {
      case "saddleHeight":
        diagnostics.pointA = { label: "bb (каретка)", ...points.bb };
        diagnostics.pointB = { label: "saddleMount (крепление седла)", ...points.saddleMount };
        break;
      case "ett":
        diagnostics.pointA = { label: "stTop (верх подседельной)", ...points.stTop };
        diagnostics.pointB = { label: "htTop (верх рулевой)", ...points.htTop };
        break;
      case "wheelbase":
        diagnostics.pointA = { label: "rearAxle (задняя ось)", ...points.rearAxle };
        diagnostics.pointB = { label: "frontAxle (передняя ось)", ...points.frontAxle };
        break;
      case "crank":
        diagnostics.reason = "Для калибровки по шатуну (CR) нужна точка педали — её нет в схеме. Выберите другой параметр.";
        break;
      case "wheelHeight":
        diagnostics.reason = "Для калибровки по высоте колеса (WH) нужна линия земли — её нет в схеме. Выберите другой параметр.";
        break;
      case "stem":
        diagnostics.reason = "Для калибровки по выносу (Stem) нужна точка руля — её нет в схеме. Выберите другой параметр.";
        break;
    }
  };
  fillCoords();

  if (pxDistance == null) {
    diagnostics.reason =
      diagnostics.reason ??
      "Не удалось вычислить расстояние между точками — одна или обе точки не определены (null координаты). Подвигайте точки вручную.";
    return { scale: null, diagnostics };
  }

  if (!Number.isFinite(pxDistance)) {
    diagnostics.reason = `Расстояние между точками невалидно (NaN/Infinity): ${pxDistance}`;
    return { scale: null, diagnostics };
  }

  // Координаты нормализованы [0..1], поэтому расстояние < √2.
  // Проверяем что точки не совпадают (минимальное значимое расстояние — 0.001).
  if (pxDistance < 0.001) {
    diagnostics.reason = `Точки для калибровки почти совпадают (расстояние = ${pxDistance.toExponential(3)}). Подвигайте их мышкой, чтобы разнести в пространстве.`;
    return { scale: null, diagnostics };
  }

  if (known.value <= 0 || !Number.isFinite(known.value)) {
    diagnostics.reason = `Невалидное известное значение: ${known.value} мм. Введите положительное число в форме выше.`;
    return { scale: null, diagnostics };
  }

  const scale = known.value / pxDistance;
  diagnostics.scale = scale;
  return { scale, diagnostics };
}

/**
 * Результат мульти-калибровки (по нескольким известным параметрам).
 */
export interface MultiCalibrationResult {
  /** Усреднённый масштаб */
  scale: number;
  /** Все рассчитанные масштабы по каждому параметру */
  perParameter: Array<{
    key: KnownDimensionKey;
    knownValueMm: number;
    pxDistance: number;
    scale: number;
    deviation: number; // % от среднего
  }>;
  /** Стандартное отклонение масштабов (для оценки согласованности) */
  stdDev: number;
  /** Согласованность: low (<15%), medium (5-15%), high (<5%) */
  consistency: "high" | "medium" | "low";
  /** Какой параметр выбивается (если есть) */
  outlier: KnownDimensionKey | null;
  /** Понятное описание */
  description: string;
}

/**
 * Откалибровать масштаб по нескольким известным параметрам одновременно.
 *
 * Преимущество: если один параметр введён с ошибкой (например, SH неверный),
 * остальные параметры (ETT, WB) дадут правильный масштаб и усреднение
 * сгладит ошибку.
 *
 * @param points Ключевые точки
 * @param knowns Массив известных параметров (SH + ETT + WB + ...)
 * @returns Мульти-калибровка или null если ни по одному параметру не вышло
 */
export function calibrateScaleMulti(
  points: BikeKeyPoints,
  knowns: Array<{ key: KnownDimensionKey; value: number }>
): MultiCalibrationResult | null {
  const valid: Array<{
    key: KnownDimensionKey;
    knownValueMm: number;
    pxDistance: number;
    scale: number;
  }> = [];

  for (const known of knowns) {
    if (known.value <= 0 || !Number.isFinite(known.value)) continue;
    const px = getPixelDistanceForKey(points, known.key);
    if (px == null || px < 0.001 || !Number.isFinite(px)) continue;
    valid.push({
      key: known.key,
      knownValueMm: known.value,
      pxDistance: px,
      scale: known.value / px,
    });
  }

  if (valid.length === 0) return null;

  // Средний масштаб
  const avgScale = valid.reduce((s, v) => s + v.scale, 0) / valid.length;

  // Отклонения
  const withDeviation = valid.map((v) => ({
    ...v,
    deviation: ((v.scale - avgScale) / avgScale) * 100,
  }));

  // Стандартное отклонение
  const variance =
    valid.reduce((s, v) => s + Math.pow(v.scale - avgScale, 2), 0) /
    valid.length;
  const stdDev = Math.sqrt(variance);

  // Согласованность
  const maxAbsDev = Math.max(
    ...withDeviation.map((v) => Math.abs(v.deviation))
  );
  let consistency: MultiCalibrationResult["consistency"] = "high";
  if (maxAbsDev > 15) consistency = "low";
  else if (maxAbsDev > 5) consistency = "medium";

  // Выброс: параметр с самым большим отклонением
  let outlier: KnownDimensionKey | null = null;
  if (consistency !== "high") {
    const sorted = [...withDeviation].sort(
      (a, b) => Math.abs(b.deviation) - Math.abs(a.deviation)
    );
    outlier = sorted[0].key;
  }

  // Описание
  let description = "";
  if (consistency === "high") {
    description = `Все ${valid.length} параметра согласованы. Масштаб = ${avgScale.toFixed(1)} мм/ед.`;
  } else {
    const out = withDeviation.find((v) => v.key === outlier);
    description =
      `Параметры рассогласованы (макс. отклонение ${maxAbsDev.toFixed(1)}%). ` +
      `Возможно «${out?.key}» (${out?.knownValueMm} мм) введён с ошибкой. ` +
      `Масштаб = ${avgScale.toFixed(1)} мм/ед. — усреднён по ${valid.length} параметрам.`;
  }

  return {
    scale: avgScale,
    perParameter: withDeviation,
    stdDev,
    consistency,
    outlier,
    description,
  };
}

export interface CalibrationDiagnostics {
  knownKey: KnownDimensionKey;
  knownValueMm: number;
  pxDistanceRaw: number | null;
  pointA: { label: string; x: number | null; y: number | null } | null;
  pointB: { label: string; x: number | null; y: number | null } | null;
  reason: string | null;
  scale?: number;
}

// ============================================================
// ВЫЧИСЛЕНИЕ ВСЕХ ПАРАМЕТРОВ ИЗ ПИКСЕЛЕЙ
// ============================================================

/**
 * Вычислить все параметры геометрии велосипеда из пиксельных координат.
 *
 * @param points Ключевые точки в пикселях
 * @param scale Масштаб (мм/пиксель), полученный из calibrateScale()
 * @param known Какой размер использован для калибровки
 * @returns Все вычисленные параметры в мм
 */
/**
 * Вычислить все параметры геометрии велосипеда из точек на фото.
 *
 * Делегирует в computeRigorousBikeParams из bike-geometry-math.ts,
 * который использует честную математику:
 * - ETT = Reach + Stack / tan(STA) — учитывает наклон подседельной трубы
 * - Fork Offset = перпендикуляр от передней оси до оси рулевой
 * - STA и HTA вычисляются по точкам
 */
export function computeParamsFromPhoto(
  points: BikeKeyPoints,
  scale: number,
  known: KnownDimensionKey,
  imgSize?: ImageSize
): ComputedBikeParams {
  if (!imgSize) {
    return {
      saddleHeight: null, ett: null, ettDirect: null, reach: null, stack: null, stem: null,
      wheelbase: null, wheelHeight: null, bbHeight: null, bbDrop: null,
      rearCenter: null, frontCenter: null, stackReachRatio: null, setback: null,
      seatTubeLength: null, forkLength: null, headTubeLength: null, forkOffset: null,
      handlebarHeight: null, spacerStackHeight: null, sta: null, hta: null,
      scale: 0, calibratedBy: known,
    };
  }

  const rigorous = computeRigorousBikeParams(points, scale, known, imgSize);

  return {
    saddleHeight: rigorous.saddleHeight,
    ett: rigorous.ett,
    ettDirect: rigorous.ettDirect,
    reach: rigorous.reach,
    stack: rigorous.stack,
    stem: rigorous.stem,
    wheelbase: rigorous.wheelbase,
    wheelHeight: rigorous.wheelHeight,
    bbHeight: rigorous.bbHeight,
    bbDrop: rigorous.bbDrop,
    rearCenter: rigorous.rearCenter,
    frontCenter: rigorous.frontCenter,
    stackReachRatio: rigorous.stackReachRatio,
    setback: rigorous.setback,
    seatTubeLength: rigorous.seatTubeLength,
    forkLength: rigorous.forkLength,
    headTubeLength: rigorous.headTubeLength,
    forkOffset: rigorous.forkOffset,
    handlebarHeight: rigorous.handlebarHeight,
    spacerStackHeight: rigorous.spacerStackHeight,
    sta: rigorous.sta,
    hta: rigorous.hta,
    scale: rigorous.scale,
    calibratedBy: known,
  };
}

// ============================================================
// СРАВНЕНИЕ ИЗМЕРЕННЫХ И ВЫЧИСЛЕННЫХ ЗНАЧЕНИЙ
// ============================================================

export interface ComparisonResult {
  key: string;
  label: string;
  /** Краткое описание параметра — что это и как вычислено */
  description: string;
  /** Типичная величина для контекста (диапазон или эталон) */
  typicalRange?: string;
  measured: number | null;  // введено пользователем вручную
  computed: number | null;  // вычислено из фото
  delta: number | null;     // computed - measured
  /** Процент расхождения: |delta| / measured * 100 */
  discrepancyPercent: number | null;
  /** Качество совпадения */
  match: "good" | "acceptable" | "poor" | "unknown";
  /** Рекомендуемое усреднённое значение */
  averaged: number | null;
}

/**
 * Сравнить измеренные вручную значения с вычисленными из фото.
 *
 * @param measured Значения из BikeMeasurements (то, что пользователь ввёл в форму)
 * @param computed Значения из ComputedBikeParams (то, что вычислено из фото)
 * @returns Массив сравнений с дельтами и усреднёнными значениями
 */
export function compareMeasuredVsComputed(
  measured: {
    saddleHeight?: number;
    ett?: number;
    reach?: number;
    stack?: number;
    stem?: number;
    crank?: number;
    wheelHeight?: number;
    bbHeight?: number;
    setback?: number;
    wheelbase?: number;
  },
  computed: ComputedBikeParams
): ComparisonResult[] {
  const results: ComparisonResult[] = [];

  const compare = (
    key: string,
    label: string,
    description: string,
    typicalRange: string | undefined,
    m: number | null | undefined,
    c: number | null
  ): ComparisonResult => {
    const measured = m != null ? m : null;
    const computed = c;
    let delta: number | null = null;
    let discrepancyPercent: number | null = null;
    let match: ComparisonResult["match"] = "unknown";
    let averaged: number | null = null;

    if (measured != null && computed != null) {
      delta = Math.round((computed - measured) * 10) / 10;
      discrepancyPercent = measured !== 0
        ? Math.round((Math.abs(delta) / measured) * 1000) / 10
        : null;

      if (discrepancyPercent != null) {
        if (discrepancyPercent < 3) match = "good";
        else if (discrepancyPercent < 7) match = "acceptable";
        else match = "poor";
      }

      // Усреднённое значение: среднее арифметическое
      averaged = Math.round(((measured + computed) / 2) * 10) / 10;
    } else if (measured != null) {
      averaged = measured;
    } else if (computed != null) {
      averaged = computed;
    }

    return { key, label, description, typicalRange, measured, computed, delta, discrepancyPercent, match, averaged };
  };

  // Сравниваем ТОЛЬКО параметры, которые пользователь НЕ измерял вручную
  // (Reach, Stack, Setback) — они вычисляются из фото
  // SH, ETT, WB, Stem — измерены рулеткой, не сравниваем, используем как калибровку
  results.push(compare(
    "reach",
    "Reach",
    "Горизонталь от центра каретки (BB) до центра рулевой трубы. Характеристика «длины» рамы.",
    "Шоссе 350-420 · Грэвел 360-440 · MTB 415-480",
    measured.reach, computed.reach
  ));
  results.push(compare(
    "stack",
    "Stack",
    "Вертикаль от центра каретки до центра рулевой трубы. Характеристика «высоты» рамы.",
    "Шоссе 490-590 · Грэвел 530-620 · MTB 580-630",
    measured.stack, computed.stack
  ));
  results.push(compare(
    "setback",
    "Setback",
    "Горизонталь от BB до точки крепления седла. Зависит от угла подседельной трубы.",
    "Шоссе 50-90 · MTB 50-100",
    measured.setback, computed.setback
  ));
  // Также показываем вычисленные параметры, которых нет в форме
  if (computed.bbDrop != null) {
    results.push(compare(
      "bbDrop",
      "BB Drop",
      "Насколько каретка ниже оси колеса = WH − BBH. Влияет на устойчивость и риск задеть педалью.",
      "Шоссе 65-75 · Грэвел 70-80 · MTB 55-70",
      null, computed.bbDrop
    ));
  }
  if (computed.rearCenter != null) {
    results.push(compare(
      "rearCenter",
      "RC (задний центр)",
      "Расстояние от BB до оси заднего колеса по прямой. Короткий RC = манёвреннее.",
      "Шоссе 405-420 · MTB 430-450",
      null, computed.rearCenter
    ));
  }
  if (computed.frontCenter != null) {
    results.push(compare(
      "frontCenter",
      "FC (передний центр)",
      "Расстояние от BB до оси переднего колеса по прямой.",
      "Шоссе 580-620 · MTB 700-800",
      null, computed.frontCenter
    ));
  }
  if (computed.seatTubeLength != null) {
    results.push(compare(
      "seatTubeLength",
      "ST (длина подседельной)",
      "От BB до верха подседельной трубы рамы (без штыря и седла).",
      "Шоссе 480-580 · MTB 400-520",
      null, computed.seatTubeLength
    ));
  }

  return results;
}

/**
 * Получить усреднённые значения из сравнения.
 * Если оба значения есть — берётся среднее.
 * Если только одно — берётся оно.
 * Если ни одного — null.
 */
export function getAveragedValues(
  comparisons: ComparisonResult[]
): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const c of comparisons) {
    result[c.key] = c.averaged;
  }
  return result;
}

/**
 * Получить общую оценку качества совпадения.
 */
export function getOverallMatch(
  comparisons: ComparisonResult[]
): { good: number; acceptable: number; poor: number; unknown: number } {
  let good = 0, acceptable = 0, poor = 0, unknown = 0;
  for (const c of comparisons) {
    switch (c.match) {
      case "good": good++; break;
      case "acceptable": acceptable++; break;
      case "poor": poor++; break;
      default: unknown++; break;
    }
  }
  return { good, acceptable, poor, unknown };
}
