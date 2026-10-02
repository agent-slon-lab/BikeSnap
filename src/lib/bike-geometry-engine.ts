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
 *
 * v2.1 (консенсус-масштаб + физические гейты):
 * f) Слепое «СТРОГО userOverride» давало чушь, когда сам override был
 *    выбросом (кейс: SH=690 мм → 2.13 мм/px, тогда как WB/ETT/радиусы колёс
 *    дружно дают ≈1.5 мм/px — расхождение 40% уезжало во ВСЕ метрики).
 *    Теперь собираются ВСЕ кандидаты масштаба (primary-override, остальные
 *    введённые размеры, радиусы колёс), находится крупнейший кластер
 *    согласленных (±15%) и берётся медиана кластера; override-выброс
 *    отклоняется с громким предупреждением и адресной подсказкой.
 * g) Физические гейты: нарушения типа «каретка выше седла», «каретка выше
 *    осей», «руль ниже каретки» возвращаются отдельным полем
 *    physicsViolations (не текстом warning) — UI показывает красную
 *    карточку с текстовой подсказкой (что не так и куда переставить)
 *    и блокирует запись в карточку велика, пока разметка физически
 *    невозможна.
 * h) stackReachRatio = null (а не фейковый 0), когда Stack/Reach невалидны.
 *
 * v2.2 (перспективный градиент масштаба — интеграция dual-scale идеи):
 * i) Единый масштаб консенсуса — это масштаб В ТОЧКЕ отрезка-источника
 *    (калибровки). Между осями колёс масштаб плавно меняется: переднее
 *    колесо ближе к камере и кажется больше. Если оба колёсных кандидата
 *    (радиусы по верхам покрышек) согласованы с рабочим масштабом, а сила
 *    перспективы >= 3%, движок интерполирует масштаб по X между осями
 *    (градиент формы — от колёс) и нормирует его на ЯКОРЬ — отрезок
 *    кандидата-источника рабочего масштаба. Каждая метрика умножается на
 *    локальный масштаб в середине СВОЕГО отрезка: Reach/Stack — у рулевой,
 *    RC — у задней оси, FC — у передней. Калибровка (напр. SH=690 мм)
 *    остаётся точной ровно в точке калибровки — строгий override не
 *    нарушается, а метрики между осями перестают наследовать чужой масштаб.
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
  /** верх седла там, где оно сидит на подседельном штыре (отрезок SH) */
  saddleMount: Point2D;
  /** нижний торец рулевого стакана */
  htBottom: Point2D;
  /** верхний торец рулевого стакана */
  htTop: Point2D;
  /**
   * TOP CAP — верхняя крышка рулевой: опорная точка Stack/Reach
   * (куда реально тянется райдер). Опциональна: без неё Stack/Reach
   * считаются до верха стакана (htTop).
   */
  htTopCap?: Point2D;
}

export type CalibrationKey =
  | "saddleHeight"
  | "wheelbase"
  | "ett"
  | "wheelDiameter";

export interface CalibrationConfig {
  /** Если пользователь задал точное значение вручную — приоритетный кандидат */
  userOverrideKey?: CalibrationKey;
  userOverrideValueMm?: number;
  /** Запасной fallback (например, заводская колёсная база) */
  fallbackWheelbaseMm?: number;
  /**
   * Остальные введённые пользователем размеры (мм) — участвуют в
   * консенсусе масштаба. Кандидат с ключом = userOverrideKey игнорируется
   * (он уже представлен override-кандидатом).
   */
  extraMeasurements?: Partial<Record<Exclude<CalibrationKey, "wheelDiameter">, number>>;
  /**
   * Произвольные дополнительные кандидаты масштаба (напр. радиусы колёс
   * по точкам верха покрышек). px — длина отрезка в пикселях фото.
   */
  auxScaleCandidates?: AuxScaleCandidate[];
}

/** Дополнительный (не primary) кандидат масштаба */
export interface AuxScaleCandidate {
  key: string;
  /** Человекочитаемое имя для предупреждений: «радиус переднего колеса» */
  label: string;
  /** Реальное значение отрезка, мм */
  valueMm: number;
  /** Длина отрезка на фото, пиксели */
  px: number;
  /** Какие точки проверить, если кандидат — выброс */
  suspectPoints?: string;
}

/** Жёсткое нарушение физики в разметке — блокирует достоверность расчёта */
export interface PhysicsViolation {
  /** Ключ точки BikeKeypoints, которую надо поправить (для подсказки в UI) */
  point: string | null;
  /** Что физически невозможно */
  title: string;
  /** Куда переставить точку */
  fix: string;
}

/**
 * Информация о применённом перспективном градиенте масштаба (v2.2).
 * В результате движка поле perspective = null, когда градиент НЕ применён
 * (нет обоих колёсных кандидатов / они не согласованы / сила перспективы < 3%).
 */
export interface PerspectiveGradientInfo {
  /** Локальный масштаб на передней оси, мм/px (нормирован на якорь) */
  scaleFrontAxle: number;
  /** Локальный масштаб на задней оси, мм/px (нормирован на якорь) */
  scaleRearAxle: number;
  /** Сырые масштабы от колёс (мм/px) — до нормировки на якорь */
  wheelScaleFront: number;
  wheelScaleRear: number;
  /** Сила перспективы |scaleF−scaleR| / среднее, % */
  severityPct: number;
  /** Что принято за якорь рабочего масштаба (отрезок-источник) */
  anchor: string;
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
  /** Жёсткие физические нарушения разметки — результаты недостоверны, пока
   *  не исправлены (UI показывает красную карточку и блокирует запись) */
  physicsViolations: PhysicsViolation[];
  /** Параметры выровненной системы координат — позволяет спроецировать
   *  произвольную дополнительную точку (например, top cap) тем же
   *  преобразованием (см. makeAlignedTransform) */
  frame: AlignedFrameInfo;
  /** Точки в выровненной системе (ось колёс горизонтальна, перед справа) —
   *  для расширенных метрик и отладки */
  rotated: BikeKeypoints;
  /** Расширенные метрики в выровненной системе (для интеграции с UI) */
  extendedMm: ExtendedMetricsMm;
  /** Перспективный градиент масштаба — null, если не применён (v2.2) */
  perspective: PerspectiveGradientInfo | null;
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
  /** горизонтальный сдвиг седла относительно каретки (мм; + = седло позади BB) —
   *  байкфит-определение setback в выровненной системе */
  setback: number;
  /** BB → rearAxle */
  rearCenter: number;
  /** BB → frontAxle */
  frontCenter: number;
  /** вертикаль BB ниже оси колёс (в выровненной системе) */
  bbDrop: number;
  /** null, когда Stack/Reach невалидны (отрицательные/нулевые) */
  stackReachRatio: number | null;
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

/** Человекочитаемые названия отрезков калибровки (для предупреждений консенсуса) */
const OVERRIDE_LABELS: Record<Exclude<CalibrationKey, "wheelDiameter">, string> = {
  saddleHeight: "высота седла (SH)",
  ett: "ETT",
  wheelbase: "колёсная база (WB)",
};

/** Какие точки проверить, если отрезок калибровки — выброс */
const OVERRIDE_SUSPECTS: Record<Exclude<CalibrationKey, "wheelDiameter">, string> = {
  saddleHeight: "точки bb/saddleMount",
  ett: "точки stTop/htTop",
  wheelbase: "точки осей колёс",
};

/** Допуск согласованности кандидатов масштаба (15% — терпит погрешность радиуса покрышки) */
const CLUSTER_REL_TOL = 0.15;

/** Медиана набора чисел */
function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
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
    ...(pts.htTopCap ? { htTopCap: transform(pts.htTopCap) } : {}),
  };

  // 2. РАСЧЁТ МАСШТАБА (px → мм) С ЖЁСТКИМ ПРИОРИТЕТОМ
  //
  // Отрезки калибровки в ВЫРОВНЕННОЙ системе:
  //   - saddleHeight: от центра BB ДО ВЕРХА СЕДЛА СТРОГО ПО ЛИНИИ
  //     подседельной трубы (мировой стандарт байкфита): saddleMount
  //     проецируется на ось bb → stTop, меряется длина проекции.
  //     Так мелкий боковой промах точки (нос/зад седла — у сёдел разная
  //     толщина набивки) не искажает высоту. Поворот кадра длину
  //     осевого отрезка не меняет;
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
  /** Середина ETT-отрезка по X — точка, в которой берётся локальный масштаб (v2.2) */
  let ettMidX: number;
  if (ettAxisDyUp > 1e-6) {
    // Наклон оси: на каждый px подъёма ось уходит назад на ettBackPerUp
    const ettBackPerUp = ettAxisDx / ettAxisDyUp;
    const ettIntersectX = rot.bb.x - ettBackPerUp * (rot.bb.y - rot.htTop.y);
    ettPx = Math.abs(rot.htTop.x - ettIntersectX);
    ettMidX = (rot.htTop.x + ettIntersectX) / 2;
  } else {
    // Вырожденный случай — вертикальная подседельная: ETT = горизонталь ST→HT
    ettPx = Math.abs(rot.htTop.x - rot.stTop.x);
    ettMidX = (rot.htTop.x + rot.stTop.x) / 2;
    ettFallbackUsed = true;
  }

  // SH-px: длина проекции saddleMount на ось подседельной трубы (bb → stTop).
  // Если stTop вырожден — ось штыря bb → saddleMount (проекция = сама точка).
  const stAxisLen = distance(rot.bb, rot.stTop);
  const shPx =
    stAxisLen >= MIN_CALIB_PX
      ? Math.abs(
          ((rot.stTop.x - rot.bb.x) * (rot.saddleMount.x - rot.bb.x) +
            (rot.stTop.y - rot.bb.y) * (rot.saddleMount.y - rot.bb.y)) / stAxisLen
        )
      : distance(rot.bb, rot.saddleMount);

  const pxFor: Record<CalibrationKey, number> = {
    saddleHeight: shPx,
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
      `❌ МАСШТАБ ПО ${config.userOverrideKey} = ${config.userOverrideValueMm} мм ОТКЛОНЁН: вне физического диапазона ${range.min}–${range.max} мм (опечатка в поле калибровки?). Применён fallback по остальным измерениям — метрики ниже НЕ соответствуют этому мусорному значению.`
    );
  }

  // --- КОНСЕНСУС-МАСШТАБ v2.1 -------------------------------------------
  // Собираем ВСЕХ кандидатов: primary-override, остальные введённые размеры
  // (extraMeasurements), радиусы колёс (auxScaleCandidates). Если кандидатов
  // >= 3 — находим крупнейший кластер согласленных (±15%) и берём его медиану.
  // Override-выброс отклоняется с громким предупреждением и адресной
  // подсказкой; override в кластере — применяется СТРОГО (консенсус подтверждает).
  //
  // Середина колёсной базы в выровненной системе — якорь по умолчанию
  // (WB-кандидат «живёт» ровно здесь).
  const midSpanX = (rot.rearAxle.x + rot.frontAxle.x) / 2;
  /**
   * X-координата точки, в которой «живёт» масштаб кандидата (v2.2):
   * каждый кандидат измеряет отрезок в своём месте кадра, и локальный
   * масштаб там свой. Используется перспективным градиентом как якорь.
   */
  const anchorXFor = (key: string): number => {
    switch (key) {
      case "saddleHeight":
        return (rot.bb.x + rot.saddleMount.x) / 2;
      case "ett":
        return (rot.stTop.x + rot.htTop.x) / 2;
      case "wheelFront":
        return rot.frontAxle.x;
      case "wheelRear":
        return rot.rearAxle.x;
      default:
        return midSpanX; // wheelbase и прочие — середина базы
    }
  };

  const scaleCandidates: Array<{
    key: string;
    label: string;
    scale: number;
    valueMm: number;
    px: number;
    isOverride: boolean;
    suspectPoints?: string;
    /** Где на оси X «живёт» этот кандидат (v2.2, перспективный градиент) */
    anchorX: number;
  }> = [];

  if (
    overridePlausible &&
    config.userOverrideKey &&
    config.userOverrideKey !== "wheelDiameter" &&
    pxFor[config.userOverrideKey] >= MIN_CALIB_PX
  ) {
    scaleCandidates.push({
      key: config.userOverrideKey,
      label: OVERRIDE_LABELS[config.userOverrideKey],
      scale: config.userOverrideValueMm! / pxFor[config.userOverrideKey],
      valueMm: config.userOverrideValueMm!,
      px: pxFor[config.userOverrideKey],
      isOverride: true,
      suspectPoints: OVERRIDE_SUSPECTS[config.userOverrideKey],
      anchorX: anchorXFor(config.userOverrideKey),
    });
  }
  // Прямая горизонталь stTop→htTop: стабильный ETT-кандидат (пересечение
  // через ось ST взрывается при кривой STA, поэтому для консенсуса не годится)
  const ettDirectPx = Math.abs(rot.htTop.x - rot.stTop.x);
  const extraMeasurements = config.extraMeasurements ?? {};
  for (const key of ["saddleHeight", "ett", "wheelbase"] as const) {
    if (key === config.userOverrideKey) continue;
    const mm = extraMeasurements[key];
    if (mm == null || !Number.isFinite(mm) || !isPlausibleOverrideMm(key, mm)) continue;
    const px = key === "ett" ? ettDirectPx : pxFor[key];
    if (px < MIN_CALIB_PX) continue;
    scaleCandidates.push({
      key,
      label: OVERRIDE_LABELS[key],
      scale: mm / px,
      valueMm: mm,
      px,
      isOverride: false,
      suspectPoints: OVERRIDE_SUSPECTS[key],
      anchorX: anchorXFor(key),
    });
  }
  for (const aux of config.auxScaleCandidates ?? []) {
    if (!aux) continue;
    if (!Number.isFinite(aux.px) || aux.px < MIN_CALIB_PX) continue;
    if (!Number.isFinite(aux.valueMm) || aux.valueMm <= 0) continue;
    scaleCandidates.push({
      key: aux.key,
      label: aux.label,
      scale: aux.valueMm / aux.px,
      valueMm: aux.valueMm,
      px: aux.px,
      isOverride: false,
      suspectPoints: aux.suspectPoints,
      anchorX: anchorXFor(aux.key),
    });
  }

  const overrideIdx = scaleCandidates.findIndex((c) => c.isOverride);
  // Кластер = максимальное окно в отсортированном по scale списке, где
  // каждый следующий кандидат отстоит от НАИМЕНЬШЕГО в окне не более чем
  // на CLUSTER_REL_TOL. Ничья → окно, содержащее override.
  let clusterIdx: number[] = [];
  if (scaleCandidates.length >= 3) {
    const order = scaleCandidates
      .map((c, i) => ({ c, i }))
      .sort((a, b) => a.c.scale - b.c.scale);
    for (let a = 0; a < order.length; a++) {
      let b = a;
      while (
        b + 1 < order.length &&
        order[b + 1].c.scale - order[a].c.scale <= CLUSTER_REL_TOL * order[a].c.scale
      ) {
        b++;
      }
      const win = order.slice(a, b + 1).map((o) => o.i);
      const winHasOverride = win.some((i) => scaleCandidates[i].isOverride);
      const bestHasOverride = clusterIdx.some((i) => scaleCandidates[i].isOverride);
      if (
        win.length > clusterIdx.length ||
        (win.length === clusterIdx.length && winHasOverride && !bestHasOverride)
      ) {
        clusterIdx = win;
      }
    }
  }

  if (clusterIdx.length >= 2) {
    const clusterScales = clusterIdx.map((i) => scaleCandidates[i].scale);
    const clusterLabels = clusterIdx.map((i) => scaleCandidates[i].label).join(", ");
    if (overrideIdx >= 0 && clusterIdx.includes(overrideIdx)) {
      const o = scaleCandidates[overrideIdx];
      scaleMmPerPx = o.scale;
      scaleSource = `USER_OVERRIDE (${o.key} = ${o.valueMm}mm) — СТРОГО (консенсус подтверждает: ${clusterIdx.length}/${scaleCandidates.length} кандидатов согласованы)`;
    } else {
      scaleMmPerPx = median(clusterScales);
      scaleSource = `CONSENSUS (медиана ${clusterIdx.length} измерений: ${clusterLabels})`;
      if (overrideIdx >= 0) {
        const o = scaleCandidates[overrideIdx];
        const photoMm = o.px * scaleMmPerPx;
        const devPct = ((o.valueMm - photoMm) / photoMm) * 100;
        warnings.push(
          `❗ МАСШТАБ ПО «${o.label}» = ${o.valueMm} мм ОТВЕРГНУТ: по фото этот отрезок равен ≈${Math.round(photoMm)} мм — расхождение ${Math.abs(devPct).toFixed(0)}% с ${clusterIdx.length} другими измерениями (${clusterLabels}). Использован консенсус-масштаб ${scaleMmPerPx.toFixed(3)} мм/px. Проверьте ${o.suspectPoints ?? "точки"} или само значение.`
        );
      } else {
        warnings.push(
          `Масштаб = консенсус-медиана ${clusterIdx.length} измерений (${clusterLabels}) — надёжнее одного отрезка.`
        );
      }
    }
    // Отчёт по каждому кандидату-выбросу вне кластера (кроме override — он отчитан выше)
    for (let i = 0; i < scaleCandidates.length; i++) {
      if (clusterIdx.includes(i)) continue;
      const c = scaleCandidates[i];
      if (c.isOverride) continue;
      const photoMm = c.px * scaleMmPerPx;
      const devPct = ((c.valueMm - photoMm) / photoMm) * 100;
      warnings.push(
        `↳ ${c.label}: вы ввели ${c.valueMm} мм, а по рабочему масштабу этот отрезок на фото ≈ ${Math.round(photoMm)} мм (Δ${devPct > 0 ? "+" : ""}${Math.round(devPct)}%). Проверьте ${c.suspectPoints ?? "точки"} или значение.`
      );
    }
  } else if (
    overrideRequested &&
    overridePlausible &&
    config.userOverrideKey
  ) {
    // Кандидатов мало для консенсуса — прежнее поведение: СТРОГО по override.
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

  // --- ПЕРСПЕКТИВНЫЙ ГРАДИЕНТ МАСШТАБА (v2.2) ----------------------------
  // Единый scaleMmPerPx — это масштаб в точке отрезка-ИСТОЧНИКА (якоря).
  // Между осями колёс масштаб плавно меняется (перед ближе к камере).
  // Если оба колёсных кандидата согласованы с рабочим масштабом и сила
  // перспективы >= 3% — строим локальный масштаб по X:
  //     scaleAt(x) = scaleMmPerPx × wheelScaleAt(x) / wheelScaleAt(якорь),
  // где wheelScaleAt — линейная интерполяция между масштабами колёс
  // (идея bike-dual-scale / bike-perspective, интегрированная в ядро).
  // Итог: калибровка точна в точке калибровки, метрики между осями берут
  // локальный масштаб вместо чужого.
  let scaleAt: (x: number) => number = () => scaleMmPerPx;
  let perspective: PerspectiveGradientInfo | null = null;

  const wheelFrontCand = scaleCandidates.find((c) => c.key === "wheelFront");
  const wheelRearCand = scaleCandidates.find((c) => c.key === "wheelRear");
  if (wheelFrontCand && wheelRearCand && scaleMmPerPx > 0) {
    const sF = wheelFrontCand.scale;
    const sR = wheelRearCand.scale;
    const avgWheel = (sF + sR) / 2;
    const severity = Math.abs(sF - sR) / avgWheel;
    const bothConsistent =
      Math.abs(sF - scaleMmPerPx) <= CLUSTER_REL_TOL * scaleMmPerPx &&
      Math.abs(sR - scaleMmPerPx) <= CLUSTER_REL_TOL * scaleMmPerPx;
    if (bothConsistent && severity >= 0.03) {
      const frontX = rot.frontAxle.x;
      const rearX = rot.rearAxle.x;
      const wheelScaleAt = (x: number): number => {
        if (Math.abs(rearX - frontX) < 1e-6) return avgWheel;
        const t = Math.max(0, Math.min(1, (x - frontX) / (rearX - frontX)));
        return sF + t * (sR - sF);
      };

      // Якорь = отрезок-источник рабочего масштаба (где масштаб ТОЧНО
      // равен scaleMmPerPx): строгий override — его отрезок; медиана
      // консенсуса — кандидат, ближайший к медиане; иначе середина базы.
      let anchorX = midSpanX;
      let anchorLabel = "середина колёсной базы";
      if (
        scaleSource.startsWith("USER_OVERRIDE") &&
        config.userOverrideKey &&
        config.userOverrideKey !== "wheelDiameter"
      ) {
        anchorX = anchorXFor(config.userOverrideKey);
        anchorLabel = `калибровка ${OVERRIDE_LABELS[config.userOverrideKey]}`;
      } else if (scaleSource.startsWith("CONSENSUS")) {
        let best: (typeof scaleCandidates)[number] | null = null;
        for (const idx of clusterIdx) {
          const c = scaleCandidates[idx];
          if (!best || Math.abs(c.scale - scaleMmPerPx) < Math.abs(best.scale - scaleMmPerPx)) {
            best = c;
          }
        }
        if (best) {
          anchorX = best.anchorX;
          anchorLabel = `медиана консенсуса (${best.label})`;
        }
      }

      const anchorScale = wheelScaleAt(anchorX);
      if (anchorScale > 0) {
        scaleAt = (x: number) => scaleMmPerPx * (wheelScaleAt(x) / anchorScale);
        const scaleFrontAxle = scaleAt(frontX);
        const scaleRearAxle = scaleAt(rearX);
        perspective = {
          scaleFrontAxle,
          scaleRearAxle,
          wheelScaleFront: sF,
          wheelScaleRear: sR,
          severityPct: severity * 100,
          anchor: anchorLabel,
        };
        warnings.push(
          `📐 Перспективная компенсация: масштаб градиентом между осями — ${scaleRearAxle.toFixed(3)} мм/px на задней оси → ${scaleFrontAxle.toFixed(3)} мм/px на передней (якорь: ${anchorLabel}); сила перспективы ${(severity * 100).toFixed(1)}%.${severity > 0.2 ? " Перспектива сильная — лучше переснять строго сбоку." : ""}`
        );
      }
    }
  }

  // Перекрёстная проверка «строгого» режима: если ручной ввод и известный WB
  // противоречат друг другу (только когда override реально применён и
  // консенсус НЕ решал исход — иначе сообщение дублирует вердикт консенсуса)
  if (
    scaleSource.startsWith("USER_OVERRIDE") &&
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
  // v2.2: каждая метрика умножается на ЛОКАЛЬНЫЙ масштаб в середине
  // СВОЕГО отрезка (перспективный градиент scaleAt). Без градиента
  // scaleAt(x) ≡ scaleMmPerPx — поведение идентично прежнему.
  //
  // Колёсная база: строго по X (оси горизонтальны после поворота)
  const wheelbaseMm =
    pxFor.wheelbase * scaleAt((rot.rearAxle.x + rot.frontAxle.x) / 2);

  // Stack/Reach: байкфит-опорная точка — ТОПКАП (верхняя крышка рулевой,
  // куда реально тянется райдер). Крышка не размечена → fallback на верх
  // стакана рамы (htTop).
  const srRef = rot.htTopCap ?? rot.htTop;
  const srPointName = rot.htTopCap
    ? "«Крышка рулевой» (top cap)"
    : "«Рулевой верх»";
  // Stack: вертикаль от BB до опорной точки.
  // В canvas Y растёт ВНИЗ, поэтому (bb.y - srRef.y) > 0 для стоящего велосипеда.
  const stackMm = (rot.bb.y - srRef.y) * scaleAt((rot.bb.x + srRef.x) / 2);

  // Reach: горизонталь от BB до опорной точки
  // (перед нормализован вправо → положительный)
  const reachMm = (srRef.x - rot.bb.x) * scaleAt((rot.bb.x + srRef.x) / 2);

  // Saddle Height: BB → верх седла ВДОЛЬ линии подседельной трубы
  // (проекция saddleMount на ось bb → stTop — см. shPx выше)
  const saddleHeightMm =
    pxFor.saddleHeight * scaleAt((rot.bb.x + rot.saddleMount.x) / 2);

  // Точка седла должна лежать НА линии трубы (верх седла над штырём).
  // Большое боковое отклонение = точка на носу/заде седла: у сёдел разная
  // длина и форма, мерять по ним нельзя — SH и масштаб уедут.
  if (stAxisLen >= MIN_CALIB_PX) {
    const saddleOffAxisMm =
      perpendicularDistance(rot.saddleMount, rot.bb, rot.stTop) * scaleAt(rot.saddleMount.x);
    if (saddleOffAxisMm > 15) {
      warnings.push(
        `Точка «Верх седла» отклонилась от линии подседельной трубы на ${Math.round(saddleOffAxisMm)} мм — она должна стоять РОВНО НАД штырём, где линия трубы пересекает верх седла (не нос и не зад седла). SH меряется вдоль трубы, поэтому промах искажает высоту и масштаб.`
      );
    }
  }

  // ETT (Effective Top Tube):
  // Проекция от верха рулевого стакана по горизонтали до пересечения
  // с осью подседельной трубы — ettPx уже рассчитан выше (единое
  // определение для калибровки по ETT и для метрики).
  const ettMm = ettPx * scaleAt(ettMidX);
  if (ettFallbackUsed) {
    warnings.push(
      "Подседельная ось вертикальна — ETT принят равным горизонтали ST→HT."
    );
  }

  // 5. РАСШИРЕННЫЕ МЕТРИКИ (в выровненной системе, с локальным масштабом)
  const extended = computeExtendedBikeParams(rot, scaleAt);

  // BB Drop: норма 40-90 мм (спека валидации). Фото-оценка — вертикаль BB→ось.
  if (Number.isFinite(extended.bbDrop) && (extended.bbDrop < 40 || extended.bbDrop > 90)) {
    warnings.push(
      `BB Drop (${extended.bbDrop} мм) вне нормы 40-90 мм. Чаще всего виновата точка «Каретка (BB)» — она должна быть чуть ниже осей колёс; проверьте также точки осей.`
    );
  }

  // 6. ВАЛИДАЦИЯ И ПРЕДУПРЕЖДЕНИЯ (sanity checks по спеке:
  // Reach > 250, Stack > 400, SH > 600, STA 60-80°, HTA 65-75°)
  if (Number.isFinite(saddleHeightMm) && saddleHeightMm < 600) {
    warnings.push(
      `Высота седла (${Math.round(saddleHeightMm)} мм) ниже нормы 600 мм. Проверьте точку saddleMount: верх седла РОВНО НАД линией подседельного штыря (не нос, не зад седла), SH меряется от каретки вдоль трубы.`
    );
  }
  if (Math.abs(frameTiltDeg) > 8) {
    warnings.push(
      `Сильный наклон оси колёс (${frameTiltDeg.toFixed(1)}°). Кадр выровнен математически, но лучше переснять фото ровнее — уменьшатся перспективные искажения.`
    );
  }
  if (Number.isFinite(reachMm) && reachMm < 250) {
    warnings.push(
      `Значение Reach (${Math.round(reachMm)} мм) ниже нормы 250 мм. Проверьте точки bb и ${srPointName}.`
    );
  }
  if (Number.isFinite(stackMm) && stackMm < 400) {
    warnings.push(
      `Значение Stack (${Math.round(stackMm)} мм) ниже нормы 400 мм. Проверьте точки bb и ${srPointName}.`
    );
  }
  if (Number.isFinite(wheelbaseMm) && (wheelbaseMm < 850 || wheelbaseMm > 1500)) {
    warnings.push(
      `Колёсная база (${Math.round(wheelbaseMm)} мм) вне типичного диапазона 850-1500 мм. Проверьте точки осей колёс.`
    );
  }
  if (Number.isFinite(seatTubeAngleDeg) && (seatTubeAngleDeg < 60 || seatTubeAngleDeg > 80)) {
    warnings.push(
      `Угол подседельной трубы (${seatTubeAngleDeg.toFixed(1)}°) вне нормы 60-80°. Проверьте точки bb/stTop (или saddleMount).`
    );
  }
  if (Number.isFinite(headTubeAngleDeg) && (headTubeAngleDeg < 65 || headTubeAngleDeg > 75)) {
    warnings.push(
      `Угол рулевой трубы (${headTubeAngleDeg.toFixed(1)}°) вне нормы 65-75°. Проверьте точки htTop/htBottom.`
    );
  }
  // Инвертированные/невозможные точки — ЖЁСТКИЕ физические гейты (v2.1).
  // Это не «предупреждение», а признак мусорной разметки: результаты
  // недостоверны, пока точки не исправлены. UI показывает красную карточку
  // с текстовой подсказкой (что не так и куда переставить), запись в
  // карточку велика блокируется.
  const pxPerMm = 1 / scaleMmPerPx;
  const physicsViolations: PhysicsViolation[] = [];

  if (rot.bb.y <= rot.saddleMount.y + 2 * pxPerMm) {
    physicsViolations.push({
      point: "bb",
      title: "Каретка (BB) стоит ВЫШЕ седла — так не бывает",
      fix: "Точка «Каретка (BB)» должна стоять у каретки — в центре шатунного узла, где крутятся педали. Это самая низкая точка рамы между колёсами, обычно чуть ниже осей колёс. Сейчас она отмечена гораздо выше — вероятно, на раме или руле.",
    });
  }
  if (rot.bb.y < rot.rearAxle.y - 15 * pxPerMm) {
    physicsViolations.push({
      point: "bb",
      title: `Каретка ВЫШЕ оси колёс на ${Math.round((rot.rearAxle.y - rot.bb.y) * scaleMmPerPx)} мм — так не бывает`,
      fix: "Каретка всегда НИЖЕ осей колёс (BB Drop обычно 20–80 мм). Точка «Каретка (BB)» должна быть примерно на уровне осей или чуть ниже.",
    });
  }
  if (
    rot.bb.x < rot.rearAxle.x - 15 * pxPerMm ||
    rot.bb.x > rot.frontAxle.x + 15 * pxPerMm
  ) {
    physicsViolations.push({
      point: "bb",
      title: "Каретка вне колёсной базы (позади задней или впереди передней оси)",
      fix: "Каретка всегда МЕЖДУ осями колёс, ближе к задней. Поправьте точку «Каретка (BB)».",
    });
  }
  if (rot.saddleMount.y > rot.rearAxle.y - 5 * pxPerMm) {
    physicsViolations.push({
      point: "saddleMount",
      title: "Седло ниже осей колёс — так не бывает",
      fix: "Седло всегда существенно ВЫШЕ осей колёс. Точка «Верх седла с подседелом» должна стоять на самой верхней точке седла, где оно сидит на штыре.",
    });
  }
  if (rot.saddleMount.y > rot.stTop.y + 2 * pxPerMm) {
    physicsViolations.push({
      point: "saddleMount",
      title: "Верх седла НИЖЕ верха подседельной трубы — так не бывает",
      fix: "Точка «Верх седла с подседелом» должна быть ВЫШЕ верха подседельной трубы: седло стоит на штыре, вставленном в трубу.",
    });
  }
  if (rot.htTop.y > rot.htBottom.y + 2 * pxPerMm) {
    physicsViolations.push({
      point: "htTop",
      title: "Верх рулевого стакана НИЖЕ низа — так не бывает",
      fix: "Точка «Рулевой верх» должна быть ВЫШЕ «Рулевой низ»: стакан наклонён назад, но его верх всегда выше низа.",
    });
  }
  if (reachMm <= 0) {
    physicsViolations.push({
      point: rot.htTopCap ? "htTopCap" : "htTop",
      title: "Руль ПОЗАДИ каретки — так не бывает",
      fix: `Опорная точка Stack/Reach ${srPointName} всегда впереди каретки. Проверьте точки «Каретка (BB)» и ${srPointName} (и то, что переднее колесо отмечено спереди).`,
    });
  }
  if (stackMm <= 0) {
    physicsViolations.push({
      point: rot.htTopCap ? "htTopCap" : "htTop",
      title: `Руль НИЖЕ каретки (Stack = ${Math.round(stackMm)} мм) — так не бывает`,
      fix: `Опорная точка Stack/Reach ${srPointName} всегда ВЫШЕ каретки. Чаще всего виновата точка «Каретка (BB)» — она стоит слишком высоко на фото; перенесите её вниз, к педальному узлу.`,
    });
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
    physicsViolations,
    frame,
    rotated: rot,
    extendedMm: extended,
    perspective,
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
 *
 * v2.2: вместо скалярного масштаба принимается ЧИСЛО ИЛИ ФУНКЦИЯ
 * scaleAt(x) — локальный масштаб в точке X (перспективный градиент).
 * Каждая метрика берёт масштаб в середине СВОЕГО отрезка (перпендикуляр
 * форка — в точке передней оси). Скаляр сохранён для обратной
 * совместимости: без функции поведение идентично прежнему.
 */
export function computeExtendedBikeParams(
  rot: BikeKeypoints,
  scale: number | ((x: number) => number)
): ExtendedMetricsMm {
  const scaleAt = typeof scale === "function" ? scale : () => scale as number;
  const midX = (a: Point2D, b: Point2D) => (a.x + b.x) / 2;
  const dist = (a: Point2D, b: Point2D) => distance(a, b) * scaleAt(midX(a, b));
  const vert = (a: Point2D, b: Point2D) => Math.abs(a.y - b.y) * scaleAt(midX(a, b));
  const horiz = (a: Point2D, b: Point2D) => Math.abs(a.x - b.x) * scaleAt(midX(a, b));
  // Перпендикуляр «живёт» в точке p (напр. fork offset — у передней оси)
  const perp = (p: Point2D, a: Point2D, b: Point2D) =>
    perpendicularDistance(p, a, b) * scaleAt(p.x);

  const seatTubeLength = dist(rot.bb, rot.stTop);
  const headTubeLength = dist(rot.htTop, rot.htBottom);
  const forkLength = dist(rot.htBottom, rot.frontAxle);
  const forkOffset = perp(rot.frontAxle, rot.htTop, rot.htBottom);
  // Setback (байкфит): горизонтальный сдвиг седла относительно каретки
  // в выровненной системе. Перед нормализован вправо → седло позади BB
  // (saddleMount.x < bb.x) даёт положительный сетбэк.
  const setback =
    (rot.bb.x - rot.saddleMount.x) * scaleAt(midX(rot.bb, rot.saddleMount));
  const rearCenter = dist(rot.bb, rot.rearAxle);
  const frontCenter = dist(rot.bb, rot.frontAxle);
  const bbDrop = vert(rot.bb, rot.rearAxle);
  const ettDirect = horiz(rot.stTop, rot.htTop);

  // Stack/Reach — та же опорная точка, что в основных метриках:
  // топкап, если размечен, иначе верх стакана (fallback)
  const srRef = rot.htTopCap ?? rot.htTop;
  const reachMm = (srRef.x - rot.bb.x) * scaleAt(midX(rot.bb, srRef));
  const stackMm = (rot.bb.y - srRef.y) * scaleAt(midX(rot.bb, srRef));
  const stackReachRatio =
    reachMm > 0 && stackMm > 0
      ? Math.round((stackMm / reachMm) * 100) / 100
      : null;

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
