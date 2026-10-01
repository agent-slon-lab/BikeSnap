/**
 * WHEEL DETECTOR — поиск колёс велосипеда в живом кадре камеры (Pure TS / Zero-Dependency)
 * ========================================================================================
 *
 * Назначение: помощник ракурса в видоискателе (фича «дорисуй колёса в объективе»).
 * Колесо, снятое СТРОГО сбоку — идеальный круг; под углом — эллипс, и его сжатие
 * равно cos(угла между плоскостью колеса и плоскостью кадра). Детектор находит
 * тёмные кольца (покрышки), вписывает в них эллипсы (метод моментов) и оценивает
 * «круглость» — по ней пользователь понимает, что встал в правильный ракурс.
 *
 * Кадр приходит уже уменьшенным (~320px по ширине) — детектор обязан работать
 * за единицы миллисекунд, чтобы не сжигать батарею на телефоне.
 *
 * Ограничения (честно):
 * - Ищем ТЁМНЫЕ кольца на более светлом фоне. Колесо полностью в тени /
 *   диск-колесо того же цвета, что покрышка / фон темнее колеса — не найдётся.
 * - Детектор ассистивный: ложных срабатываний почти нет (жёсткие фильтры пары),
 *   но иногда просто не найдёт колёса — тогда показываем нейтральную подсказку.
 */

// ============================================================
// ТИПЫ
// ============================================================

/** Минимальный интерфейс кадра — совместим и с ImageData, и с тестовым шимом */
export interface RawFrame {
  width: number;
  height: number;
  /** RGBA, длина = width * height * 4 */
  data: Uint8ClampedArray;
}

export interface DetectedEllipse {
  /** центр, координаты кадра (px) */
  cx: number;
  cy: number;
  /** полуоси: a — большая, b — малая */
  a: number;
  b: number;
  /** угол большой полуоси (рад, система координат изображения, Y вниз) */
  theta: number;
  /** «круглость» = b/a, 1.0 — идеальный круг */
  roundness: number;
  /** доверие 0..1 */
  score: number;
}

export type WheelDetectStatus =
  | "none" /** колёса не найдены */
  | "partial" /** найдено только одно колесо */
  | "ok" /** оба колеса найдены, ракурс строго сбоку (круглость ≥ 0.88) */
  | "tilted"; /** оба колеса найдены, но видны как овалы — ракурс сбоку под углом */

export interface WheelDetectResult {
  status: WheelDetectStatus;
  /** найденные колёса, отсортированы слева направо (0..2 штуки) */
  wheels: DetectedEllipse[];
  /** минимальная круглость пары (0, если ничего не найдено) */
  roundness: number;
  /** угол линии осей колёс к горизонтали кадра (град) — 0, если пары нет */
  axleTiltDeg: number;
  /** человекопонятная подсказка (RU) для оверлея */
  hint: string;
}

// ============================================================
// ПОРОГИ И КОНСТАНТЫ
// ============================================================

/** Круглость, при которой считаем колесо кругом (ракурс ровный) */
const ROUNDNESS_OK = 0.88;
/** Ниже этой круглости пара всё ещё признаётся колёсами (овал) */
const ROUNDNESS_MIN = 0.5;
/** Доля тёмных пикселей кадра, за пределами которой сцена не годится */
const DARK_FRACTION_MIN = 0.012;
const DARK_FRACTION_MAX = 0.78;
/** Диапазон площади компоненты (доля от кадра) */
const AREA_FRACTION_MIN = 0.0025;
const AREA_FRACTION_MAX = 0.5;
/** Диаметр колеса относительно ширины кадра */
const DIAMETER_MIN_FRAC = 0.1;
const DIAMETER_MAX_FRAC = 0.95;

// ============================================================
// ГЛАВНАЯ ФУНКЦИЯ
// ============================================================

export function detectWheels(img: RawFrame): WheelDetectResult {
  const W = img.width;
  const H = img.height;
  const total = W * H;
  const none: WheelDetectResult = {
    status: "none",
    wheels: [],
    roundness: 0,
    axleTiltDeg: 0,
    hint: "Наведите камеру на велосипед — оба колеса должны быть полностью в кадре",
  };
  if (total < 64 || img.data.length < total * 4) return none;

  // --- 1. Полутон ---
  const gray = new Uint8Array(total);
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    gray[i] = (img.data[p] * 299 + img.data[p + 1] * 587 + img.data[p + 2] * 114) / 1000;
  }

  // --- 2. Порог темноты: Отсу, ограниченный средним (защита от сцен без тёмных объектов) ---
  let mean = 0;
  const hist = new Int32Array(256);
  for (let i = 0; i < total; i++) {
    const g = gray[i];
    mean += g;
    hist[g]++;
  }
  mean /= total;
  const otsu = otsuThreshold(hist, total);
  const threshold = Math.min(otsu, mean * 0.82);

  // ВАЖНО: конвенция Оцу — класс 1 это gray <= threshold (строгий < теряет
  // весь класс, когда порог выпал ровно на значение покрышки)
  const mask = new Uint8Array(total);
  let darkCount = 0;
  for (let i = 0; i < total; i++) {
    if (gray[i] <= threshold) {
      mask[i] = 1;
      darkCount++;
    }
  }
  const darkFraction = darkCount / total;
  if (darkFraction < DARK_FRACTION_MIN || darkFraction > DARK_FRACTION_MAX) return none;

  // --- 3. Связные компоненты (4-связность, BFS) с агрегатами для моментов ---
  const labels = new Int32Array(total); // 0 = фон
  let nextLabel = 0;
  // агрегаты по меткам
  const aCount: number[] = [];
  const aSumX: number[] = [];
  const aSumY: number[] = [];
  const aSumXX: number[] = [];
  const aSumYY: number[] = [];
  const aSumXY: number[] = [];
  const aMinX: number[] = [];
  const aMaxX: number[] = [];
  const aMinY: number[] = [];
  const aMaxY: number[] = [];

  const queue = new Int32Array(total);
  for (let start = 0; start < total; start++) {
    if (mask[start] === 0 || labels[start] !== 0) continue;
    nextLabel++;
    const lbl = nextLabel;
    let qHead = 0;
    let qTail = 0;
    queue[qTail++] = start;
    labels[start] = lbl;
    let count = 0, sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0;
    let minX = W, maxX = 0, minY = H, maxY = 0;

    while (qHead < qTail) {
      const idx = queue[qHead++];
      const x = idx % W;
      const y = (idx - x) / W;
      count++;
      sumX += x; sumY += y;
      sumXX += x * x; sumYY += y * y; sumXY += x * y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      // соседи
      if (x > 0 && mask[idx - 1] === 1 && labels[idx - 1] === 0) { labels[idx - 1] = lbl; queue[qTail++] = idx - 1; }
      if (x < W - 1 && mask[idx + 1] === 1 && labels[idx + 1] === 0) { labels[idx + 1] = lbl; queue[qTail++] = idx + 1; }
      if (y > 0 && mask[idx - W] === 1 && labels[idx - W] === 0) { labels[idx - W] = lbl; queue[qTail++] = idx - W; }
      if (y < H - 1 && mask[idx + W] === 1 && labels[idx + W] === 0) { labels[idx + W] = lbl; queue[qTail++] = idx + W; }
    }

    aCount[lbl] = count; aSumX[lbl] = sumX; aSumY[lbl] = sumY;
    aSumXX[lbl] = sumXX; aSumYY[lbl] = sumYY; aSumXY[lbl] = sumXY;
    aMinX[lbl] = minX; aMaxX[lbl] = maxX; aMinY[lbl] = minY; aMaxY[lbl] = maxY;
  }

  // --- 4. Кандидаты: эллипс по моментам + фильтры правдоподобия ---
  const candidates: DetectedEllipse[] = [];
  for (let lbl = 1; lbl <= nextLabel; lbl++) {
    const count = aCount[lbl];
    if (count < Math.max(80, total * AREA_FRACTION_MIN)) continue;
    if (count > total * AREA_FRACTION_MAX) continue;

    const cx = aSumX[lbl] / count;
    const cy = aSumY[lbl] / count;
    const mu20 = aSumXX[lbl] / count - cx * cx;
    const mu02 = aSumYY[lbl] / count - cy * cy;
    const mu11 = aSumXY[lbl] / count - cx * cy;

    const tr = mu20 + mu02;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - (mu20 * mu02 - mu11 * mu11)));
    const l1 = tr / 2 + disc;
    const l2 = Math.max(0, tr / 2 - disc);
    let a = 2 * Math.sqrt(l1);
    let b = 2 * Math.sqrt(l2);
    if (a < 3 || b < 1) continue;
    let theta = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
    const roundness = b / a;
    if (roundness < ROUNDNESS_MIN || roundness > 1.05) continue;

    // Диаметр относительно ширины кадра
    const d = 2 * a;
    if (d < W * DIAMETER_MIN_FRAC || d > W * DIAMETER_MAX_FRAC) continue;

    // Согласованность bbox и моментов (кольцо должно вписываться в эллипс)
    const bw = aMaxX[lbl] - aMinX[lbl] + 1;
    const bh = aMaxY[lbl] - aMinY[lbl] + 1;
    if (bw > 2.8 * a || bh > 2.8 * a) continue;
    if (bw < 0.9 * a) continue; // вытянутый мусор

    // Заполненность эллипса: диск ≈ 1, кольцо ≈ 0.3-0.8
    const fill = count / (Math.PI * a * b);
    if (fill < 0.18 || fill > 1.35) continue;

    // Почти круг — стабилизируем угол (иначе theta дрожит и ломает сглаживание)
    if (roundness > 0.95) {
      theta = 0;
      a = (a + b) / 2;
      b = a;
    }

    const insideFrame = aMinX[lbl] > 1 && aMaxX[lbl] < W - 2 && aMinY[lbl] > 1 && aMaxY[lbl] < H - 2;
    const hollow = hollowScore(gray, W, H, cx, cy, a, b, theta);
    let score = 0.45 + roundness * 0.1;
    score += hollow > 10 ? 0.28 : hollow > 2 ? 0.12 : 0;
    score += insideFrame ? 0.2 : 0.05;
    if (fill < 0.2) score -= 0.05; // подозрительно «полый» мусор

    candidates.push({ cx, cy, a, b, theta, roundness, score: Math.min(1, score) });
  }

  if (candidates.length === 0) return none;

  // --- 5. Выбор пары (два колеса): похожие по размеру, на одной высоте, разнесены по X ---
  candidates.sort((p, q) => q.score * Math.sqrt(q.a) - p.score * Math.sqrt(p.a));
  const shortlist = candidates.slice(0, 8);

  let best: { pair: DetectedEllipse[]; combined: number } | null = null;
  for (let i = 0; i < shortlist.length; i++) {
    for (let j = i + 1; j < shortlist.length; j++) {
      const p = shortlist[i];
      const q = shortlist[j];
      const dx = Math.abs(p.cx - q.cx);
      const dy = Math.abs(p.cy - q.cy);
      const aMax = Math.max(p.a, q.a);
      const sizeSim = Math.min(p.a, q.a) / aMax;
      if (sizeSim < 0.5) continue;
      if (dx < 0.8 * aMax) continue; // колёса не должны сильно перекрываться
      if (dy > 1.0 * aMax) continue; // оси на близкой высоте
      const combined = Math.min(p.roundness, q.roundness) * ((p.score + q.score) / 2) * sizeSim;
      if (!best || combined > best.combined) {
        const pair = p.cx <= q.cx ? [p, q] : [q, p];
        best = { pair, combined };
      }
    }
  }

  if (best) {
    const [w1, w2] = best.pair;
    const roundness = Math.min(w1.roundness, w2.roundness);
    const axleTiltDeg = (Math.atan2(w2.cy - w1.cy, w2.cx - w1.cx) * 180) / Math.PI;
    const status: WheelDetectStatus = roundness >= ROUNDNESS_OK ? "ok" : "tilted";
    const pct = Math.round(roundness * 100);
    return {
      status,
      wheels: [w1, w2],
      roundness,
      axleTiltDeg,
      hint:
        status === "ok"
          ? "Ракурс ровный — колёса круглые. Можно снимать!"
          : `Колёса видны как овалы (${pct}%) — сместитесь чуть в сторону, пока не станут кругами`,
    };
  }

  // --- 6. Только одно колесо ---
  const single = shortlist[0];
  if (single.score >= 0.6) {
    return {
      status: "partial",
      wheels: [single],
      roundness: single.roundness,
      axleTiltDeg: 0,
      hint: "Видно только одно колесо — отойдите дальше, чтобы в кадр поместились оба",
    };
  }

  return none;
}

// ============================================================
// ВСПОМОГАТЕЛЬНОЕ
// ============================================================

/** Порог Оцу по гистограмме 256 бинов */
function otsuThreshold(hist: Int32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) {
      maxVar = v;
      threshold = i;
    }
  }
  return threshold;
}

/**
 * «Полость» кольца: насколько центр эллипса (спицы, втулка) светлее обода.
 * Положительное значение — признак настоящего колеса.
 */
function hollowScore(
  gray: Uint8Array,
  W: number,
  H: number,
  cx: number,
  cy: number,
  a: number,
  b: number,
  theta: number,
): number {
  // центр: средняя яркость диска радиусом 0.3·a
  const rIn = 0.3 * a;
  let cSum = 0;
  let cN = 0;
  const x0 = Math.max(0, Math.floor(cx - rIn));
  const x1 = Math.min(W - 1, Math.ceil(cx + rIn));
  const y0 = Math.max(0, Math.floor(cy - rIn));
  const y1 = Math.min(H - 1, Math.ceil(cy + rIn));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= rIn * rIn) {
        cSum += gray[y * W + x];
        cN++;
      }
    }
  }
  if (cN === 0) return 0;
  const cMean = cSum / cN;

  // обод: выборки на радиусе 0.92 эллипса
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  let rSum = 0;
  let rN = 0;
  for (let k = 0; k < 24; k++) {
    const phi = (k / 24) * 2 * Math.PI;
    const ex = a * 0.92 * Math.cos(phi);
    const ey = b * 0.92 * Math.sin(phi);
    const px = Math.round(cx + ex * cos - ey * sin);
    const py = Math.round(cy + ex * sin + ey * cos);
    if (px >= 0 && px < W && py >= 0 && py < H) {
      rSum += gray[py * W + px];
      rN++;
    }
  }
  if (rN === 0) return 0;
  return cMean - rSum / rN;
}
