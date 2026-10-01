/**
 * BIKE GEOMETRY CORE ENGINE v2 (Pure TS / Zero-Dependency)
 * =========================================================
 *
 * Строгое математическое ядро геометрии ВЕЛОСИПЕДА (bike-only focus:
 * только рама и компоненты — никаких точек тела райдера).
 *
 * ТРИ ЖЁСТКИХ ПРАВИЛА (ТЗ):
 * 1. BIKE-ONLY: на входе ровно 7 ключевых точек рамы/колёс.
 * 2. STRICT SCALE HIERARCHY:
 *    - если задан userOverrideKey и userOverrideValueMm > 0 — масштаб
 *      (мм/пиксель) считается СТРОГО по этому отрезку;
 *    - колёсная база (WB) — ТОЛЬКО fallback (когда ручной ввод отсутствует).
 *    Движок физически не может «переключиться» на авто-WB при валидном
 *    ручном вводе — источник масштаба виден в scaleSource.
 * 3. ISOLATED ROTATION FIRST:
 *    - сначала строим вектор между центрами осей колёс (rearAxle → frontAxle);
 *    - поворачиваем ВСЕ 2D-координаты на угол наклона оси колёс θ,
 *      приводя велосипед к строго горизонтальной оси X;
 *    - только ПОСЛЕ поворота считаем масштаб и проекции (Stack, Reach, ETT).
 *
 * Отличия от черновой версии ТЗ (исправления математики, задокументированы):
 * a) Нормализация направления: фото бывают «смотрит влево» (frontAxle.x <
 *    rearAxle.x). Сырой atan2 даёт там угол ≈ ±180°, и поворот на -θ
 *    переворачивает велосипед вверх ногами (Stack становится отрицательным).
 *    Поэтому перед поворотом фото «смотрящее влево» зеркалится по X, и
 *    поворот всегда выполняется на МАЛЫЙ угол. Результат: передняя ось
 *    всегда справа, велосипед всегда «стоит» в системе координат.
 * b) Углы приводятся к велосипедной конвенции (STA/HTA — угол от горизонтали,
 *    типичные 63-79°), а не сырой canvas-atan2 (который для подседельной
 *    оси даёт 180°-STA).
 * c) STA и ось для ETT считаются по подседельной ТРУБЕ (bb → stTop) — это
 *    отраслевой стандарт (сравнимо со spec sheet производителя). Если точка
 *    stTop вырождена — фолбэк на ось штыря (bb → saddleMount) с warning.
 * d) ETT как CalibrationKey поддержан (горизонталь stTop→htTop в выровненной
 *    системе) — нужен для калибровки по ETT из UI.
 * e) wheelDiameter остался в типе API по ТЗ, но по 7-точечной схеме он не
 *    измерим (нужны точки обода) — при использовании даётся честный warning
 *    и срабатывает fallback.
 */

// ============================================================
// ТИПЫ (по ТЗ)
// ============================================================

export interface Point2D {
  x: number;
  y: number;
}

/** 7 обязательных ключевых точек в ПИКСЕЛЯХ */
export interface BikeKeypoints {
  /** центр оси заднего колеса */
  rearAxle: Point2D;
  /** центр оси переднего колеса */
  frontAxle: Point2D;
  /** центр вала каретки (Bottom Bracket) */
  bb: Point2D;
  /** пересечение подседельного хомута и рамы (Top of Seat Tube) */
  stTop: Point2D;
  /** точка зажима рамок (рельсов) седла на подседельном штыре */
  saddleMount: Point2D;
  /** нижний торец рулевого стакана */
  htBottom: Point2D;
  /** верхний торец рулевого стакана */
  htTop: Point2D;
}

export type CalibrationKey =
  | "saddleHeight"
  | "wheelbase"
  | "ett"
  | "wheelDiameter";

export interface CalibrationConfig {
  /** Если пользователь задал точное значение вручную — СТРОГОЕ приоритет */
  userOverrideKey?: CalibrationKey;
  userOverrideValueMm?: number;
  /** Запасной fallback (например, заводская колёсная база) */
  fallbackWheelbaseMm?: number;
}

export interface BikeGeometryResult {
  scaleMmPerPx: number;
  scaleSource: string;
  metricsMm: {
    wheelbase: number;
    stack: number;
    reach: number;
    /** Effective Top Tube */
    ett: number;
    /** BB → Saddle Mount */
    saddleHeight: number;
  };
  anglesDeg: {
    seatTubeAngle: number;
    headTubeAngle: number;
    /** Угол, на который был повёрнут кадр (малый знаковый угол оси колёс) */
    frameTilt: number;
  };
  warnings: string[];
  /** Параметры выровненной системы координат — позволяет спроецировать
   *  произвольную дополнительную точку (например, top cap) тем же
   *  преобразованием (см. makeAlignedTransform) */
  frame: AlignedFrameInfo;
  /** Точки в выровненной системе (ось колёс горизонтальна, перед справа) —
   *  для расширенных метрик и отладки */
  rotated: BikeKeypoints;
  /** Расширенные метрики в выровненной системе (для интеграции с UI) */
  extendedMm: ExtendedMetricsMm;
}

export interface ExtendedMetricsMm {
  /** ETT по прямой горизонтали ST→HT (диагностика формульного ETT) */
  ettDirect: number;
  /** BB → stTop */
  seatTubeLength: number;
  /** htTop → htBottom */
  headTubeLength: number;
  /** htBottom → frontAxle */
  forkLength: number;
  /** перпендикуляр от frontAxle к оси рулевой трубы */
  forkOffset: number;
  /** перпендикуляр от saddleMount к оси подседельной трубы */
  setback: number;
  /** BB → rearAxle */
  rearCenter: number;
  /** BB → frontAxle */
  frontCenter: number;
  /** вертикаль BB ниже оси колёс (в выровненной системе) */
  bbDrop: number;
  stackReachRatio: number;
}

/**
 * Параметры выровненной системы координат (после Isolated Rotation):
 * ось колёс горизонтальна, передняя ось справа, велосипед «стоит».
 */
export interface AlignedFrameInfo {
  /** Точка вращения — центр задней оси (в исходных пикселях) */
  origin: Point2D;
  /** Малый знаковый угол оси колёс относительно горизонтали изображения (рад) */
  tiltAngleRad: number;
  /** Фото «смотрит вправо» (false = было зеркалено по X) */
  facingRight: boolean;
}

/**
 * Фабрика преобразования в выровненную систему.
 *
 * Ядро обрабатывает ровно 7 bike-only точек, но обёртке (UI) может
 * понадобиться спроецировать дополнительную точку (top cap для высоты
 * руля) тем же преобразованием — без дублирования математики.
 */
export function makeAlignedTransform(
  frame: AlignedFrameInfo
): (p: Point2D) => Point2D {
  const rotAngle = -frame.tiltAngleRad;
  return (p: Point2D) => {
    const mirrored = frame.facingRight
      ? p
      : { x: 2 * frame.origin.x - p.x, y: p.y };
    return rotatePoint(mirrored, frame.origin, rotAngle);
  };
}

/**
 * Обратное преобразование к makeAlignedTransform.
 *
 * Прямое:  F(p) = R(−θ) · M(p),  M — зеркало относительно origin.x (involution).
 * Обратное: F⁻¹(q) = M · R(+θ)(q) — сначала обратный поворот, потом зеркало.
 *
 * Нужно, чтобы ЦЕЛЬ из выровненной системы (например, рекомендуемое
 * положение htTop при целевом Stack) вернуть в исходные координаты фото.
 */
export function makeInverseAlignedTransform(
  frame: AlignedFrameInfo
): (p: Point2D) => Point2D {
  return (p: Point2D) => {
    const unrotated = rotatePoint(p, frame.origin, frame.tiltAngleRad);
    return frame.facingRight
      ? unrotated
      : { x: 2 * frame.origin.x - unrotated.x, y: unrotated.y };
  };
}

// ============================================================
// Вспомогательная математика 2D векторов
// ============================================================

export function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function rotatePoint(p: Point2D, origin: Point2D, angleRad: number): Point2D {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return {
    x: origin.x + (dx * cos - dy * sin),
    y: origin.y + (dx * sin + dy * cos),
  };
}

/** Перпендикулярное расстояние от точки P до прямой A→B (в единицах координат) */
export function perpendicularDistance(p: Point2D, lineA: Point2D, lineB: Point2D): number {
  const num = Math.abs(
    (lineB.y - lineA.y) * p.x - (lineB.x - lineA.x) * p.y + lineB.x * lineA.y - lineB.y * lineA.x
  );
  const den = distance(lineA, lineB);
  return den === 0 ? 0 : num / den;
}

/** Все координаты конечны? */
function isFinitePoint(p: Point2D): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

// ============================================================
// Главная функция вычисления геометрии
// ============================================================

/** Минимальное px-расстояние отрезка калибровки (защита от совпавших точек) */
const MIN_CALIB_PX = 2;

/**
 * Физические диапазоны (мм) для ручной калибровки масштаба.
 * Значение ВНЕ диапазона физически невозможно (опечатка/мусор в поле)
 * и НЕ может использоваться как строгий масштаб — иначе все метрики
 * уезжают в 100 раз (кейс «SH=8 вместо 800»: масштаб 0.0046 мм/px,
 * Reach=5 мм, WB=11 мм). Диапазоны широкие (детские/тандем), ловят
 * только заведомый мусор.
 */
export const OVERRIDE_PHYSICAL_RANGE_MM: Record<
  Exclude<CalibrationKey, "wheelDiameter">,
  { min: number; max: number }
> = {
  saddleHeight: { min: 400, max: 1000 },
  ett: { min: 300, max: 700 },
  wheelbase: { min: 700, max: 1600 },
};

/** Значение калибровки физически возможно? */
export function isPlausibleOverrideMm(
  key: CalibrationKey,
  valueMm: number
): boolean {
  if (!Number.isFinite(valueMm) || valueMm <= 0) return false;
  if (key === "wheelDiameter") return true;
  const range = OVERRIDE_PHYSICAL_RANGE_MM[key];
  return valueMm >= range.min && valueMm <= range.max;
}

export function calculateBikeGeometry(
  pts: BikeKeypoints,
  config: CalibrationConfig
): BikeGeometryResult {
  const warnings: string[] = [];

  // 0. ВАЛИДАЦИЯ ВХОДА
  for (const [name, p] of Object.entries(pts)) {
    if (!isFinitePoint(p)) {
      throw new Error(
        `Точка ${name} содержит NaN/Infinity — проверьте разметку.`
      );
    }
  }
  const axlePx = distance(pts.rearAxle, pts.frontAxle);
  if (axlePx < MIN_CALIB_PX) {
    throw new Error(
      `Оси колёс почти совпадают (${axlePx.toFixed(1)} px) — невозможно выровнять горизонт и калибровать масштаб. Проверьте точки rearAxle/frontAxle.`
    );
  }

  // 1. ВЫРАВНИВАНИЕ ГОРИЗОНТА (по оси колёс) — ПЕРВАЯ ОПЕРАЦИЯ
  //
  // Сырой угол линии осей. Для фото «смотрит влево» (frontAxle.x < rearAxle.x)
  // он ≈ ±180°, поэтому:
  //   - зеркалим X относительно rearAxle (физически корректно: велосипед
  //     симметричен относительно вертикальной плоскости, а мы смотрим
  //     на него с другой стороны);
  //   - после зеркала угол линии осей всегда малый, и поворот не
  //     переворачивает геометрию.
  const dxAxles = pts.frontAxle.x - pts.rearAxle.x;
  const dyAxles = pts.frontAxle.y - pts.rearAxle.y;
  const facingRight = dxAxles >= 0;
  // Малый знаковый угол оси колёс относительно горизонтали изображения
  const tiltAngleRad = facingRight
    ? Math.atan2(dyAxles, dxAxles)
    : Math.atan2(dyAxles, -dxAxles);
  const frameTiltDeg = (tiltAngleRad * 180) / Math.PI;

  const origin = pts.rearAxle;
  const frame: AlignedFrameInfo = {
    origin,
    tiltAngleRad,
    facingRight,
  };
  const transform = makeAlignedTransform(frame);

  // ПОВОРОТ всех точек (Isolated Rotation First)
  const rot: BikeKeypoints = {
    rearAxle: transform(pts.rearAxle),
    frontAxle: transform(pts.frontAxle),
    bb: transform(pts.bb),
    stTop: transform(pts.stTop),
    saddleMount: transform(pts.saddleMount),
    htBottom: transform(pts.htBottom),
    htTop: transform(pts.htTop),
  };

  // 2. РАСЧЁТ МАСШТАБА (px → мм) С ЖЁСТКИМ ПРИОРИТЕТОМ
  //
  // Отрезки калибровки в ВЫРОВНЕННОЙ системе:
  //   - saddleHeight: BB → saddleMount (гипотенуза, поворот не меняет длину);
  //   - wheelbase: строго по X (оси теперь горизонтальны);
  //   - ett: ПЕРЕСЕЧЕНИЕ горизонтали htTop с осью подседельной трубы
  //     (тот же определение, что у метрики ETT ниже — иначе калибровка
  //     по ETT и отчётный ETT разошлись бы на слагаемое Stack/tan(STA));
  //   - wheelDiameter: не измерим по 7-точечной схеме.
  //
  // ETT-px (пересечение) считаем ДО pxFor — используется и для калибровки
  // по ETT, и как метрика metricsMm.ett.
  const ettAxisDx = Math.abs(rot.stTop.x - rot.bb.x);
  const ettAxisDyUp = Math.abs(rot.bb.y - rot.stTop.y);
  let ettPx: number;
  let ettFallbackUsed = false;
  if (ettAxisDyUp > 1e-6) {
    // Наклон оси: на каждый px подъёма ось уходит назад на ettBackPerUp
    const ettBackPerUp = ettAxisDx / ettAxisDyUp;
    const ettIntersectX = rot.bb.x - ettBackPerUp * (rot.bb.y - rot.htTop.y);
    ettPx = Math.abs(rot.htTop.x - ettIntersectX);
  } else {
    // Вырожденный случай — вертикальная подседельная: ETT = горизонталь ST→HT
    ettPx = Math.abs(rot.htTop.x - rot.stTop.x);
    ettFallbackUsed = true;
  }

  const pxFor: Record<CalibrationKey, number> = {
    saddleHeight: distance(rot.bb, rot.saddleMount),
    wheelbase: Math.abs(rot.frontAxle.x - rot.rearAxle.x),
    ett: ettPx,
    wheelDiameter: 0,
  };

  let scaleMmPerPx = 0;
  let scaleSource = "";

  // Строгий override применяется ТОЛЬКО если значение физически возможно.
  // Мусор вида «SH = 8 мм» не должен масштабировать всю геометрию —
  // уходим на fallback по колёсной базе с громким предупреждением.
  const overrideRequested = !!(
    config.userOverrideKey &&
    config.userOverrideValueMm &&
    config.userOverrideValueMm > 0
  );
  const overridePlausible =
    overrideRequested &&
    config.userOverrideKey !== undefined &&
    config.userOverrideValueMm !== undefined &&
    isPlausibleOverrideMm(config.userOverrideKey, config.userOverrideValueMm);

  if (overrideRequested && !overridePlausible && config.userOverrideKey !== "wheelDiameter") {
    const range = OVERRIDE_PHYSICAL_RANGE_MM[config.userOverrideKey as Exclude<CalibrationKey, "wheelDiameter">];
    warnings.push(
      `❌ МАСШТАБ ПО ${config.userOverrideKey} = ${config.userOverrideValueMm} мм ОТКЛОНЁН: вне физического диапазона ${range.min}–${range.max} мм (опечатка в поле калибровки?). Применён fallback по колёсной базе — метрики ниже НЕ соответствуют этому мусорному значению.`
    );
  }

  if (
    overrideRequested &&
    overridePlausible &&
    config.userOverrideKey
  ) {
    if (config.userOverrideKey === "wheelDiameter") {
      warnings.push(
        "Калибровка по wheelDiameter требует точек обода — в 7-точечной схеме недоступна. Применён fallback по колёсной базе."
      );
    } else if (pxFor[config.userOverrideKey] >= MIN_CALIB_PX) {
      scaleMmPerPx =
        config.userOverrideValueMm! / pxFor[config.userOverrideKey];
      scaleSource = `USER_OVERRIDE (${config.userOverrideKey} = ${config.userOverrideValueMm}mm) — СТРОГО`;
    } else {
      warnings.push(
        `Отрезок для ${config.userOverrideKey} вырожден (${pxFor[config.userOverrideKey].toFixed(1)} px) — точки почти совпадают. Применён fallback по колёсной базе.`
      );
    }
  }

  // Fallback: если нет ручного ввода (или он отклонён как мусор) — колёсная база
  if (scaleMmPerPx === 0) {
    const pxWB = pxFor.wheelbase;
    if (pxWB < MIN_CALIB_PX) {
      throw new Error(
        "Невозможно откалибровать масштаб: нет ручного ввода, а оси колёс вырождены."
      );
    }
    const fallbackWbPlausible =
      config.fallbackWheelbaseMm != null &&
      config.fallbackWheelbaseMm > 0 &&
      isPlausibleOverrideMm("wheelbase", config.fallbackWheelbaseMm);
    if (
      config.fallbackWheelbaseMm != null &&
      config.fallbackWheelbaseMm > 0 &&
      !fallbackWbPlausible
    ) {
      warnings.push(
        `❌ Fallback WB = ${config.fallbackWheelbaseMm} мм тоже вне физического диапазона 700–1600 мм — использован типовой 1080 мм.`
      );
    }
    const defaultWB = fallbackWbPlausible
      ? (config.fallbackWheelbaseMm as number)
      : 1080;
    scaleMmPerPx = defaultWB / pxWB;
    scaleSource = `FALLBACK_AUTO (Wheelbase = ${defaultWB}mm)`;
  }

  // Перекрёстная проверка: если ручной ввод и известный WB противоречат друг другу
  // (только для ПРИНЯТОГО override — отклонённый мусор сравнивать бессмысленно)
  if (
    overridePlausible &&
    config.userOverrideKey &&
    config.userOverrideKey !== "wheelDiameter" &&
    pxFor[config.userOverrideKey] >= MIN_CALIB_PX &&
    pxFor.wheelbase >= MIN_CALIB_PX
  ) {
    const overrideScale =
      (config.userOverrideValueMm as number) / pxFor[config.userOverrideKey];
    const wbFallbackMm =
      config.fallbackWheelbaseMm && config.fallbackWheelbaseMm > 0
        ? config.fallbackWheelbaseMm
        : null;
    if (wbFallbackMm) {
      const wbScale = wbFallbackMm / pxFor.wheelbase;
      const divergencePct =
        (Math.abs(overrideScale - wbScale) / wbScale) * 100;
      if (divergencePct > 5) {
        warnings.push(
          `Масштаб по ${config.userOverrideKey} и по WB=${wbFallbackMm}мм расходятся на ${divergencePct.toFixed(1)}% — либо разметка точек неточна, либо введённые значения противоречат друг другу. Рабочий масштаб — по ${config.userOverrideKey} (СТРОГО).`
        );
      }
    }
  }

  // 3. РАСЧЁТ УГЛОВ (в выровненной системе, велосипедная конвенция)
  //
  // STA — угол подседельной ТРУБЫ (bb → stTop) от горизонтали.
  // Если stTop вырожден (слишком близко к BB) — ось штыря (bb → saddleMount).
  const stTubeDx = Math.abs(rot.stTop.x - rot.bb.x);
  const stTubeDy = Math.abs(rot.bb.y - rot.stTop.y);
  const stMountDx = Math.abs(rot.saddleMount.x - rot.bb.x);
  const stMountDy = Math.abs(rot.bb.y - rot.saddleMount.y);

  let seatTubeAngleDeg: number;
  if (distance(rot.bb, rot.stTop) >= MIN_CALIB_PX && stTubeDy > 0) {
    seatTubeAngleDeg = (Math.atan2(stTubeDy, stTubeDx) * 180) / Math.PI;
  } else if (stMountDy > 0) {
    seatTubeAngleDeg = (Math.atan2(stMountDy, stMountDx) * 180) / Math.PI;
    warnings.push(
      "Точка stTop вырождена — STA рассчитан по оси подседельного штыря (bb → saddleMount), а не по трубе."
    );
  } else {
    seatTubeAngleDeg = NaN;
    warnings.push("Подседельная ось вырождена — STA не рассчитан.");
  }

  // HTA — угол рулевой трубы (htBottom → htTop) от горизонтали
  const htDx = Math.abs(rot.htTop.x - rot.htBottom.x);
  const htDy = Math.abs(rot.htBottom.y - rot.htTop.y);
  let headTubeAngleDeg: number;
  if (distance(rot.htTop, rot.htBottom) >= MIN_CALIB_PX && htDy > 0) {
    headTubeAngleDeg = (Math.atan2(htDy, htDx) * 180) / Math.PI;
  } else {
    headTubeAngleDeg = NaN;
    warnings.push("Рулевая труба вырождена (точки htTop/htBottom почти совпадают) — HTA не рассчитан.");
  }

  // 4. РАСЧЁТ МЕТРИК ГЕОМЕТРИИ (мм, в выровненной системе)
  //
  // Колёсная база: строго по X (оси горизонтальны после поворота)
  const wheelbaseMm = pxFor.wheelbase * scaleMmPerPx;

  // Stack: вертикаль от BB до верха рулевого стакана.
  // В canvas Y растёт ВНИЗ, поэтому (bb.y - htTop.y) > 0 для стоящего велосипеда.
  const stackMm = (rot.bb.y - rot.htTop.y) * scaleMmPerPx;

  // Reach: горизонталь от BB до верха рулевого стакана
  // (перед нормализован вправо → положительный)
  const reachMm = (rot.htTop.x - rot.bb.x) * scaleMmPerPx;

  // Saddle Height: BB → Saddle Mount (гипотенуза)
  const saddleHeightMm = pxFor.saddleHeight * scaleMmPerPx;

  // ETT (Effective Top Tube):
  // Проекция от верха рулевого стакана по горизонтали до пересечения
  // с осью подседельной трубы — ettPx уже рассчитан выше (единое
  // определение для калибровки по ETT и для метрики).
  const ettMm = ettPx * scaleMmPerPx;
  if (ettFallbackUsed) {
    warnings.push(
      "Подседельная ось вертикальна — ETT принят равным горизонтали ST→HT."
    );
  }

  // 5. РАСШИРЕННЫЕ МЕТРИКИ (в выровненной системе)
  const extended = computeExtendedBikeParams(rot, scaleMmPerPx);

  // 6. ВАЛИДАЦИЯ И ПРЕДУПРЕЖДЕНИЯ (sanity checks)
  if (Number.isFinite(saddleHeightMm) && (saddleHeightMm < 400 || saddleHeightMm > 950)) {
    warnings.push(
      `Высота седла (${Math.round(saddleHeightMm)} мм) выходит за пределы нормы 400-950 мм. Проверьте точку saddleMount (должна быть на хомуте рельсов седла, не на носу седла и не на кромке штыря).`
    );
  }
  if (Math.abs(frameTiltDeg) > 8) {
    warnings.push(
      `Сильный наклон оси колёс (${frameTiltDeg.toFixed(1)}°). Кадр выровнен математически, но лучше переснять фото ровнее — уменьшатся перспективные искажения.`
    );
  }
  if (Number.isFinite(reachMm) && (reachMm < 300 || reachMm > 550)) {
    warnings.push(
      `Значение Reach (${Math.round(reachMm)} мм) нетипично (норма 300-550 мм). Проверьте точки bb и htTop.`
    );
  }
  if (Number.isFinite(stackMm) && (stackMm < 350 || stackMm > 800)) {
    warnings.push(
      `Значение Stack (${Math.round(stackMm)} мм) нетипично (норма 350-800 мм). Проверьте точки bb и htTop.`
    );
  }
  if (Number.isFinite(wheelbaseMm) && (wheelbaseMm < 850 || wheelbaseMm > 1500)) {
    warnings.push(
      `Колёсная база (${Math.round(wheelbaseMm)} мм) вне типичного диапазона 850-1500 мм. Проверьте точки осей колёс.`
    );
  }
  if (Number.isFinite(seatTubeAngleDeg) && (seatTubeAngleDeg < 60 || seatTubeAngleDeg > 85)) {
    warnings.push(
      `Угол подседельной трубы (${seatTubeAngleDeg.toFixed(1)}°) вне типичного диапазона 60-85°. Проверьте точки bb/stTop (или saddleMount).`
    );
  }
  if (Number.isFinite(headTubeAngleDeg) && (headTubeAngleDeg < 60 || headTubeAngleDeg > 85)) {
    warnings.push(
      `Угол рулевой трубы (${headTubeAngleDeg.toFixed(1)}°) вне типичного диапазона 60-85°. Проверьте точки htTop/htBottom.`
    );
  }
  // Инвертированные точки (частые ошибки разметки)
  if (rot.saddleMount.y > rot.stTop.y) {
    warnings.push(
      "saddleMount НИЖЕ stTop — так не бывает. Точка крепления седла должна быть ВЫШЕ верха подседельной трубы."
    );
  }
  if (rot.htTop.y > rot.htBottom.y) {
    warnings.push(
      "htTop НИЖЕ htBottom — так не бывает. Верх рулевого стакана должен быть ВЫШЕ низа."
    );
  }
  if (rot.bb.y < rot.rearAxle.y) {
    warnings.push(
      "Каретка ВЫШЕ оси колёс — так не бывает (BB всегда ниже осей). Проверьте точку bb."
    );
  }

  const r = (v: number) => Math.round(v);

  return {
    scaleMmPerPx,
    scaleSource,
    metricsMm: {
      wheelbase: r(wheelbaseMm),
      stack: r(stackMm),
      reach: r(reachMm),
      ett: r(ettMm),
      saddleHeight: r(saddleHeightMm),
    },
    anglesDeg: {
      seatTubeAngle: Number.isFinite(seatTubeAngleDeg)
        ? Number(seatTubeAngleDeg.toFixed(1))
        : NaN,
      headTubeAngle: Number.isFinite(headTubeAngleDeg)
        ? Number(headTubeAngleDeg.toFixed(1))
        : NaN,
      frameTilt: Number(frameTiltDeg.toFixed(1)),
    },
    warnings,
    frame,
    rotated: rot,
    extendedMm: extended,
  };
}

// ============================================================
// РАСШИРЕННЫЕ МЕТРИКИ (в выровненной системе координат)
// ============================================================

/**
 * Дополнительные параметры рамы, вычисленные в ВЫРОВНЕННОЙ системе
 * (после Isolated Rotation). Все проекции честные: X — вдоль оси колёс,
 * Y — перпендикулярно ей. Это устраняет погрешность наклона кадра
 * для ВСЕХ метрик, а не только для Stack/Reach/ETT.
 */
export function computeExtendedBikeParams(
  rot: BikeKeypoints,
  scaleMmPerPx: number
): ExtendedMetricsMm {
  const s = scaleMmPerPx;
  const dist = (a: Point2D, b: Point2D) => distance(a, b) * s;
  const vert = (a: Point2D, b: Point2D) => Math.abs(a.y - b.y) * s;
  const horiz = (a: Point2D, b: Point2D) => Math.abs(a.x - b.x) * s;
  const perp = (p: Point2D, a: Point2D, b: Point2D) =>
    perpendicularDistance(p, a, b) * s;

  const seatTubeLength = dist(rot.bb, rot.stTop);
  const headTubeLength = dist(rot.htTop, rot.htBottom);
  const forkLength = dist(rot.htBottom, rot.frontAxle);
  const forkOffset = perp(rot.frontAxle, rot.htTop, rot.htBottom);
  const setback = perp(rot.saddleMount, rot.bb, rot.stTop);
  const rearCenter = dist(rot.bb, rot.rearAxle);
  const frontCenter = dist(rot.bb, rot.frontAxle);
  const bbDrop = vert(rot.bb, rot.rearAxle);
  const ettDirect = horiz(rot.stTop, rot.htTop);

  const reachMm = (rot.htTop.x - rot.bb.x) * s;
  const stackMm = (rot.bb.y - rot.htTop.y) * s;
  const stackReachRatio =
    reachMm > 0 && stackMm > 0
      ? Math.round((stackMm / reachMm) * 100) / 100
      : 0;

  return {
    ettDirect: Math.round(ettDirect),
    seatTubeLength: Math.round(seatTubeLength),
    headTubeLength: Math.round(headTubeLength),
    forkLength: Math.round(forkLength),
    forkOffset: Math.round(forkOffset),
    setback: Math.round(setback),
    rearCenter: Math.round(rearCenter),
    frontCenter: Math.round(frontCenter),
    bbDrop: Math.round(bbDrop),
    stackReachRatio,
  };
}
