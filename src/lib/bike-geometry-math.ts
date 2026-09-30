/**
 * Честная математика геометрии велосипеда.
 *
 * Исправления по сравнению со старым кодом:
 * 1. ETT = Reach + Stack / tan(STA) — учитывает наклон подседельной трубы
 * 2. Fork Offset — перпендикуляр от оси передней оси до линии рулевой трубы
 * 3. STA и HTA вычисляются по фактическим точкам, а не берутся из таблиц
 */

// Локальные типы (без импорта из bike-photo-scale, чтобы избежать циклической зависимости)
export type NullablePoint = { x: number | null; y: number | null };

/**
 * Простая 2D точка (не-nullable). Используется для утилитарных расчётов
 * (calculateDistance, calculateJointAngle) — для позы райдера.
 */
export interface Point2D {
  x: number;
  y: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface BikeKeyPoints {
  bb: NullablePoint;
  stTop: NullablePoint;
  saddleMount: NullablePoint;
  htTop: NullablePoint;
  htBottom: NullablePoint;
  htTopCap: NullablePoint;
  rearAxle: NullablePoint;
  frontAxle: NullablePoint;
}

/** Преобразование нормализованной точки [0..1] в пиксели */
export function toPx(pt: { x: number | null; y: number | null }, imgSize: ImageSize): { x: number; y: number } {
  return {
    x: (pt.x ?? 0) * imgSize.width,
    y: (pt.y ?? 0) * imgSize.height,
  };
}

/** Евклидово расстояние в пикселях */
export function pixelDistance(
  a: NullablePoint | null | undefined,
  b: NullablePoint | null | undefined,
  imgSize: ImageSize
): number | null {
  if (!a || a.x == null || a.y == null) return null;
  if (!b || b.x == null || b.y == null) return null;
  const pA = toPx(a, imgSize);
  const pB = toPx(b, imgSize);
  return Math.hypot(pB.x - pA.x, pB.y - pA.y);
}

/** Горизонтальное расстояние в пикселях */
export function pixelHorizontal(
  a: NullablePoint | null | undefined,
  b: NullablePoint | null | undefined,
  imgSize: ImageSize
): number | null {
  if (!a || a.x == null) return null;
  if (!b || b.x == null) return null;
  const pA = toPx(a, imgSize);
  const pB = toPx(b, imgSize);
  return Math.abs(pB.x - pA.x);
}

/** Вертикальное расстояние в пикселях */
export function pixelVertical(
  a: NullablePoint | null | undefined,
  b: NullablePoint | null | undefined,
  imgSize: ImageSize
): number | null {
  if (!a || a.y == null) return null;
  if (!b || b.y == null) return null;
  const pA = toPx(a, imgSize);
  const pB = toPx(b, imgSize);
  return Math.abs(pB.y - pA.y);
}

/**
 * Перпендикулярное расстояние от точки P до прямой, заданной точками A и B (в пикселях).
 *
 * Используется для:
 * - Fork Offset: расстояние от frontAxle до оси рулевой трубы (htTop → htBottom)
 * - Setback: расстояние от saddleMount до оси подседельной трубы (BB → stTop)
 */
export function perpendicularDistancePx(
  p: NullablePoint | null | undefined,
  lineA: NullablePoint | null | undefined,
  lineB: NullablePoint | null | undefined,
  imgSize: ImageSize
): number | null {
  if (!p || p.x == null || p.y == null) return null;
  if (!lineA || lineA.x == null || lineA.y == null) return null;
  if (!lineB || lineB.x == null || lineB.y == null) return null;

  const P = toPx(p, imgSize);
  const A = toPx(lineA, imgSize);
  const B = toPx(lineB, imgSize);

  const num = Math.abs(
    (B.y - A.y) * P.x - (B.x - A.x) * P.y + B.x * A.y - B.y * A.x
  );
  const den = Math.hypot(B.x - A.x, B.y - A.y);

  return den === 0 ? 0 : num / den;
}

/**
 * Угол прямой (в градусах относительно горизонтали).
 * Y в браузерах направлен вниз, поэтому инвертируем dy.
 *
 * Возвращает угол в диапазоне [-90, 90]:
 * - 90° = вертикально вверх
 * - 0° = горизонтально
 * - -90° = вертикально вниз
 */
export function getLineAngleDeg(
  a: NullablePoint | null | undefined,
  b: NullablePoint | null | undefined,
  imgSize: ImageSize
): number | null {
  if (!a || a.x == null || a.y == null) return null;
  if (!b || b.x == null || b.y == null) return null;

  const pA = toPx(a, imgSize);
  const pB = toPx(b, imgSize);

  const dy = -(pB.y - pA.y); // инверсия Y
  const dx = pB.x - pA.x;

  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

// ============================================================
// БЕЗОПАСНЫЕ МАТЕМАТИЧЕСКИЕ УТИЛИТЫ (hardening)
// ============================================================

/**
 * Ограничивает значение в диапазоне [min, max].
 *
 * Используется для защиты Math.acos / Math.asin от NaN из-за ошибок
 * плавающей точки (например, cos должен быть в [-1, 1], но из-за
 * точности float может чуть-чуть выйти за диапазон).
 */
export function clamp(value: number, min: number = -1, max: number = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Евклидово расстояние между двумя НЕ-null точками Point2D.
 *
 * В отличие от pixelDistance (которая работает с NullablePoint + imgSize),
 * эта функция работает с уже переведёнными в пиксели координатами.
 *
 * Используется в расчётах позы райдера (плечо → локоть → запястье).
 */
export function calculateDistance(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Безопасный расчёт угла в суставе (в градусах) по трём точкам:
 *   p1 — первая конечная точка
 *   vertex — вершина сустава
 *   p2 — вторая конечная точка
 *
 * Использует теорему косинусов:
 *   c² = a² + b² − 2ab·cos(γ)
 * где:
 *   a = distance(vertex, p1)
 *   b = distance(vertex, p2)
 *   c = distance(p1, p2)
 *   γ — искомый угол при вершине vertex
 *
 * Защита:
 *   - Если a или b = 0 (совпадающие точки) → возвращаем 0
 *   - cos(angle) зажимается в [-1, 1] через clamp() — иначе Math.acos даёт NaN
 *
 * Используется для позы райдера:
 *   - угол колена (бедро → колено → лодыжка)
 *   - угол локтя (плечо → локоть → запястье)
 *   - угол бедра (плечо → бедро → колено)
 */
export function calculateJointAngle(
  p1: Point2D,
  vertex: Point2D,
  p2: Point2D
): number {
  const a = calculateDistance(p1, vertex);
  const b = calculateDistance(p2, vertex);
  const c = calculateDistance(p1, p2);

  // Защита от деления на 0 при совпадении точек
  if (a === 0 || b === 0) {
    return 0;
  }

  // Теорема косинусов
  const cosAngle = (a * a + b * b - c * c) / (2 * a * b);

  // Защита от NaN: из-за точности float cosAngle может чуть-чуть выйти за [-1, 1]
  const safeCos = clamp(cosAngle, -1, 1);
  const angleRad = Math.acos(safeCos);

  return (angleRad * 180) / Math.PI;
}

/**
 * Безопасный Math.acos — обёртка с clamp [-1, 1].
 */
export function safeAcos(value: number): number {
  return Math.acos(clamp(value, -1, 1));
}

/**
 * Безопасный Math.asin — обёртка с clamp [-1, 1].
 */
export function safeAsin(value: number): number {
  return Math.asin(clamp(value, -1, 1));
}

/**
 * Безопасное деление: возвращает 0, если делитель ≈ 0.
 *
 * Используется для защит от NaN в формулах вроде atan2(y/x) при x → 0.
 */
export function safeDivide(numerator: number, denominator: number, epsilon: number = 1e-9): number {
  if (Math.abs(denominator) < epsilon) return 0;
  return numerator / denominator;
}

/**
 * Угол Seat Tube Angle (STA) — угол подседельной трубы относительно горизонтали.
 *
 * STA измеряется от оси BB к верху подседельной трубы.
 * По стандарту: STA = 90° - угол наклона от вертикали.
 *
 * Но в велосипедной геометрии STA — это угол между подседельной трубой
 * и горизонталью (линией земли). Типичные значения: 70-78°.
 *
 * Если подседельная труба наклонена назад (седло позади BB),
 * то угол от горизонтали = 180° - arctan(|dy|/|dx|).
 * Но стандартно STA = arctan(Stack_ST / Setback_ST) где:
 *   Stack_ST = вертикаль BB → stTop
 *   Setback_ST = горизонталь BB → stTop
 *
 * Упрощённо: STA = arctan(вертикаль / горизонталь) в градусах.
 */
export function computeSTA(
  bb: NullablePoint,
  stTop: NullablePoint,
  imgSize: ImageSize
): number | null {
  if (!bb || bb.x == null || bb.y == null) return null;
  if (!stTop || stTop.x == null || stTop.y == null) return null;

  const bbPx = toPx(bb, imgSize);
  const stPx = toPx(stTop, imgSize);

  // Вертикаль: BB ниже stTop → dy > 0 (в координатах экрана)
  const dy = bbPx.y - stPx.y; // положительное, т.к. stTop выше BB
  // Горизонталь: stTop позади BB → dx может быть > 0 или < 0
  const dx = Math.abs(stPx.x - bbPx.x);

  if (dx < 1) return 90; // подседельная труба вертикальная

  // STA = arctan(вертикаль / горизонталь) — угол от горизонтали
  const staRad = Math.atan2(dy, dx);
  return (staRad * 180) / Math.PI;
}

/**
 * Угол Head Tube Angle (HTA) — угол рулевой трубы относительно горизонтали.
 *
 * HTA измеряется от оси рулевой трубы (htBottom → htTop) к горизонтали.
 * Типичные значения: 63-73° (MTB более пологий, шоссе более крутой).
 */
export function computeHTA(
  htBottom: NullablePoint,
  htTop: NullablePoint,
  imgSize: ImageSize
): number | null {
  if (!htBottom || htBottom.x == null || htBottom.y == null) return null;
  if (!htTop || htTop.x == null || htTop.y == null) return null;

  const bottomPx = toPx(htBottom, imgSize);
  const topPx = toPx(htTop, imgSize);

  // htTop выше htBottom → dy > 0
  const dy = bottomPx.y - topPx.y;
  // htTop позади htBottom (руль позади вилки) → dx > 0
  const dx = Math.abs(topPx.x - bottomPx.x);

  if (dx < 1) return 90; // рулевая вертикальная

  const htaRad = Math.atan2(dy, dx);
  return (htaRad * 180) / Math.PI;
}

// ============================================================
// ПОЛНЫЙ РАСЧЁТ ПАРАМЕТРОВ
// ============================================================

export interface RigorousBikeParams {
  saddleHeight: number | null;
  ett: number | null;
  reach: number | null;
  stack: number | null;
  stem: number | null;
  wheelbase: number | null;
  wheelHeight: number | null;
  bbHeight: number | null;
  bbDrop: number | null;
  rearCenter: number | null;
  frontCenter: number | null;
  stackReachRatio: number | null;
  setback: number | null;
  seatTubeLength: number | null;
  forkLength: number | null;
  headTubeLength: number | null;
  forkOffset: number | null;
  handlebarHeight: number | null;
  spacerStackHeight: number | null;
  sta: number | null;
  hta: number | null;
  scale: number;
  calibratedBy: string;
}

/**
 * Вычислить честные параметры велосипеда из точек на фото.
 *
 * Ключевые отличия от старой версии:
 * 1. ETT = Reach + Stack / tan(STA) — учитывает наклон подседельной трубы
 * 2. Fork Offset = перпендикуляр от frontAxle до оси рулевой (htTop → htBottom)
 * 3. STA и HTA вычисляются по точкам, а не берутся из таблиц
 * 4. Setback = перпендикуляр от saddleMount до оси подседельной (BB → stTop)
 */
export function computeRigorousBikeParams(
  points: BikeKeyPoints,
  scaleMmPerPx: number,
  known: string,
  imgSize: ImageSize
): RigorousBikeParams {
  const safeScale = Number.isFinite(scaleMmPerPx) && scaleMmPerPx > 0 ? scaleMmPerPx : 0;
  if (safeScale === 0) {
    return {
      saddleHeight: null, ett: null, reach: null, stack: null, stem: null,
      wheelbase: null, wheelHeight: null, bbHeight: null, bbDrop: null,
      rearCenter: null, frontCenter: null, stackReachRatio: null, setback: null,
      seatTubeLength: null, forkLength: null, headTubeLength: null, forkOffset: null,
      handlebarHeight: null, spacerStackHeight: null, sta: null, hta: null,
      scale: 0, calibratedBy: known,
    };
  }

  // ПИКСЕЛЬНЫЕ помощники — конвертируем [0..1] в пиксели через imgSize.
  // КРИТИЧНО для неквадратных фото: X нормализован по ширине, Y по высоте.
  // Без конвертации в пиксели Euclidean distance даёт ошибку до 40%.
  const pxDist = (a: NullablePoint | null, b: NullablePoint | null): number | null => {
    const d = pixelDistance(a, b, imgSize);
    return d != null ? d * safeScale : null;
  };
  const pxH = (a: NullablePoint | null, b: NullablePoint | null): number | null => {
    const d = pixelHorizontal(a, b, imgSize);
    return d != null ? d * safeScale : null;
  };
  const pxV = (a: NullablePoint | null, b: NullablePoint | null): number | null => {
    const d = pixelVertical(a, b, imgSize);
    return d != null ? d * safeScale : null;
  };
  const pxPerp = (
    p: NullablePoint | null,
    lineA: NullablePoint | null,
    lineB: NullablePoint | null
  ): number | null => {
    const d = perpendicularDistancePx(p, lineA, lineB, imgSize);
    return d != null ? d * safeScale : null;
  };

  // === 1. ОСНОВНЫЕ КООРДИНАТЫ ===
  // Reach: горизонталь от BB до HT верха
  const reach = pxH(points.bb, points.htTop);
  // Stack: вертикаль от BB до HT верха
  const stack = pxV(points.bb, points.htTop);

  // === 2. УГЛЫ ===
  // STA: угол подседельной трубы (BB → stTop) относительно горизонтали
  const sta = computeSTA(points.bb, points.stTop, imgSize);
  // HTA: угол рулевой трубы (htBottom → htTop) относительно горизонтали
  const hta = computeHTA(points.htBottom, points.htTop, imgSize);

  // === 3. ETT — ИСПРАВЛЕННАЯ ФОРМУЛА ===
  // ETT = Reach + Stack / tan(STA)
  // Это учитывает наклон подседельной трубы:
  // горизонталь от HT верха до пересечения с линией BB→stTop
  let ett: number | null = null;
  if (reach != null && stack != null && sta != null && sta > 0 && sta < 90) {
    const staRad = (sta * Math.PI) / 180;
    const tanSTA = Math.tan(staRad);
    if (Math.abs(tanSTA) > 0.001) {
      ett = Math.round(reach + stack / tanSTA);
    }
  }
  // Fallback: если STA не вычислен — старый метод (горизонталь stTop → htTop)
  if (ett == null) {
    ett = pxH(points.stTop, points.htTop);
  }

  // === 4. FORK OFFSET — ИСПРАВЛЕННАЯ ФОРМУЛА ===
  // Перпендикуляр от frontAxle до оси рулевой трубы (htTop → htBottom)
  const forkOffset = pxPerp(points.frontAxle, points.htTop, points.htBottom);

  // === 5. ОСТАЛЬНЫЕ ПАРАМЕТРЫ ===
  const saddleHeight = pxDist(points.bb, points.saddleMount);
  const wheelbase = pxH(points.rearAxle, points.frontAxle);
  const bbDrop = pxV(points.bb, points.rearAxle);
  const rearCenter = pxDist(points.bb, points.rearAxle);
  const frontCenter = pxDist(points.bb, points.frontAxle);

  // Setback — перпендикуляр от saddleMount до оси подседельной (BB → stTop)
  const setback = pxPerp(points.saddleMount, points.bb, points.stTop);

  const seatTubeLength = pxDist(points.bb, points.stTop);
  const headTubeLength = pxDist(points.htTop, points.htBottom);
  const forkLength = pxDist(points.htBottom, points.frontAxle);

  // Для посадки райдера
  const handlebarHeight = pxV(points.bb, points.htTopCap);
  const spacerStackHeight = pxV(points.htTop, points.htTopCap);

  const stackReachRatio = reach != null && reach > 0 && stack != null
    ? Math.round((stack / reach) * 100) / 100
    : null;

  return {
    saddleHeight: saddleHeight != null && saddleHeight > 0 ? Math.round(saddleHeight) : null,
    ett: ett != null ? Math.round(ett) : null,
    reach: reach != null ? Math.round(reach) : null,
    stack: stack != null ? Math.round(stack) : null,
    stem: null,
    wheelbase: wheelbase != null ? Math.round(wheelbase) : null,
    wheelHeight: null,
    bbHeight: null,
    bbDrop: bbDrop != null ? Math.round(bbDrop) : null,
    rearCenter: rearCenter != null ? Math.round(rearCenter) : null,
    frontCenter: frontCenter != null ? Math.round(frontCenter) : null,
    stackReachRatio,
    setback: setback != null ? Math.round(setback) : null,
    seatTubeLength: seatTubeLength != null ? Math.round(seatTubeLength) : null,
    forkLength: forkLength != null ? Math.round(forkLength) : null,
    headTubeLength: headTubeLength != null ? Math.round(headTubeLength) : null,
    forkOffset: forkOffset != null ? Math.round(forkOffset) : null,
    handlebarHeight: handlebarHeight != null ? Math.round(handlebarHeight) : null,
    spacerStackHeight: spacerStackHeight != null ? Math.round(spacerStackHeight) : null,
    sta: sta != null ? Math.round(sta * 10) / 10 : null,
    hta: hta != null ? Math.round(hta * 10) / 10 : null,
    scale: safeScale,
    calibratedBy: known,
  };
}
