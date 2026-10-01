/**
 * WHEEL DETECTOR v2 — градиентный поиск колёс велосипеда (Pure TS / Zero-Dependency)
 * ===================================================================================
 *
 * Назначение: помощник ракурса в видоискателе. Колесо, снятое СТРОГО сбоку —
 * идеальный круг; под углом — эллипс, и его сжатие равно cos(угла между
 * плоскостью колеса и плоскостью кадра). Детектор находит колёса, вписывает
 * эллипсы и оценивает «круглость» — по ней пользователь понимает, что встал
 * в правильный ракурс.
 *
 * ПОЧЕМУ V2 (полный реворк): v1 (глобальный порог Отсу → связные компоненты →
 * эллипс по моментам) не работал в реальных кадрах:
 *  - глобальная бинаризация смешивает асфальт, тени, раму и покрышки в одно
 *    пятно → гигантская компонента отбрасывается фильтром площади → «колёс
 *    не видно»;
 *  - когда маска распадается удачно, эллипс по моментам натягивается на
 *    мусор (тень, нога, столб) → «видит, но криво».
 *
 * V2 — лучевое голосование (радиальная симметрия, родня Hough для кругов):
 *
 *  1. Собель-градиенты: локальные перепады яркости. Не зависят от общего
 *     уровня освещения, не требуют порога «темноты», работают на любом фоне.
 *  2. Каждый краевой пиксель рисует ЛУЧ вдоль своего градиента в обе
 *     стороны, через все расстояния t ∈ [rMin, rMax]. Покрышка даёт два
 *     концентрических края (внешний и внутренний) — их лучи пересекаются
 *     в центре колеса, который собирает сотни голосов в одну точку.
 *     (Пробег по всем радиусам сразу убирает квантование по радиусу:
 *     дискретные «бины» дают промах-кольцо вокруг центра и рвут сигнал.)
 *  3. Пик аккумулятора → центр кандидата; радиальный профиль по кругу
 *     восстанавливает радиус.
 *  4. Перебор формы (ry/r0 × rx/ry) + спуск по координатам (центр ↔ форма)
 *     → эллипс ракурса. Сжатие по горизонтали: плоскость колеса вертикальна,
 *     при съёмке под углом b/a = cos(угла).
 *  5. Верификация: покрытие эллипса краями (≥ 50% выборок — краевой пиксель
 *     с градиентом поперёк кольца) + контраст «кольцо темнее соседей»
 *     (мягкий — дисковое колесо не отсекает).
 *  6. Пара колёс: похожие размеры, одна высота осей, правдоподобное
 *     разнесение по X.
 *
 * Кадр приходит уже уменьшенным (~320px по ширине) — детектор обязан работать
 * за единицы миллисекунд (в Web Worker).
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

/** Диагностика внутренностей детектора (для verify-скриптов и тюнинга) */
export interface DetectDebugInfo {
  edgeCount: number;
  edgeT: number;
  pool: Array<{ cx: number; cy: number; votes: number }>;
  refined: Array<{
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    coverage: number;
    ring: number;
    sym: number;
    score: number;
  }>;
  accepted: Array<{ cx: number; cy: number; rx: number; ry: number; score: number }>;
}

// ============================================================
// ПОРОГИ И КОНСТАНТЫ
// ============================================================

/** Круглость, при которой считаем колесо кругом (ракурс ровный) */
const ROUNDNESS_OK = 0.88;
/** Доля пикселей кадра, которую держим как «краевые» (топ градиентов) */
const EDGE_FRACTION = 0.1;
/** Абсолютный потолок числа краевых пикселей (портретные кадры 320×569) */
const MAX_EDGES = 3000;
/** Минимальная абсолютная величина градиента для краевого пикселя */
const EDGE_MAG_FLOOR = 12;
/** Диапазон луча голосования относительно меньшей стороны кадра */
const R_MIN_FRAC = 0.055;
const R_MAX_FRAC = 0.4;
/** Диапазон диаметра колеса относительно меньшей стороны кадра (гейт) */
const DIAMETER_MIN_FRAC = 0.1;
const DIAMETER_MAX_FRAC = 1.05;
/** Минимальное покрытие эллипса краями — жёсткий гейт кандидата */
const COVERAGE_MIN = 0.5;
/** Минимальное сжатие эллипса по горизонтали (ниже — уже «линия», не колесо) */
const RX_RY_MIN = 0.42;
/** Сколько кандидатов после NMS несём в уточнение */
const REFINE_LIMIT = 8;
/** Пиков на один аспект-проход голосования */
const PEAKS_PER_PASS = 4;
/** Минимальный score одиночного колеса для статуса partial */
const PARTIAL_MIN_SCORE = 0.55;
/** NMS пиков аккумулятора, px */
const PEAK_NMS_PX = 10;
/** Шаг вдоль луча голосования, px (размытие покрывает дыру в 2px) */
const RAY_STEP = 2;
/**
 * Аспект-проходы: голосуем в пространствах, растянутых по X в k раз.
 * Овал с сжатием s = 1/k в своём проходе — круг: нормали проходят через
 * центр, пик один и чистый. Нормали эллипса в исходном пространстве идут
 * мимо центра (эволута) и порождают ложные пики-«куспы» сверху/снизу.
 */
const ASPECT_PASSES = [1.0, 1.4, 1.9];

// ============================================================
// ГЛАВНАЯ ФУНКЦИЯ
// ============================================================

interface Candidate {
  cx: number;
  cy: number;
  /** голоса в пике (после размытия) */
  votes: number;
  /** аспект-проход, в котором найден пик (k растяжения по X) */
  k: number;
}

interface RefinedCandidate extends Candidate {
  rx: number;
  ry: number;
  /** покрытие эллипса краями 0..1 */
  coverage: number;
  /** контраст «кольцо темнее соседей» 0..1 */
  ring: number;
  /** нормализованная сила пика голосования 0..1 */
  sym: number;
  /** итоговый score 0..1 */
  score: number;
}

export function detectWheels(img: RawFrame, debug?: (info: DetectDebugInfo) => void): WheelDetectResult {
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

  // --- 2. Собель-градиенты + модуль ---
  const gx = new Float32Array(total);
  const gy = new Float32Array(total);
  const mag = new Float32Array(total);
  let magMax = 0;
  for (let y = 1; y < H - 1; y++) {
    const row = y * W;
    for (let x = 1; x < W - 1; x++) {
      const i = row + x;
      const tl = gray[i - W - 1];
      const t = gray[i - W];
      const tr = gray[i - W + 1];
      const l = gray[i - 1];
      const r = gray[i + 1];
      const bl = gray[i + W - 1];
      const b = gray[i + W];
      const br = gray[i + W + 1];
      const sx = tr + 2 * r + br - (tl + 2 * l + bl);
      const sy = bl + 2 * b + br - (tl + 2 * t + tr);
      gx[i] = sx;
      gy[i] = sy;
      const m = Math.sqrt(sx * sx + sy * sy);
      mag[i] = m;
      if (m > magMax) magMax = m;
    }
  }
  // Равномерный кадр (стена, стол) — краёв нет вовсе
  if (magMax < 16) return none;

  // --- 3. Порог краёв: топ EDGE_FRACTION (но не больше MAX_EDGES) ---
  const minWH = Math.min(W, H);
  const fracCap = Math.min(1 - EDGE_FRACTION, 1 - MAX_EDGES / total);
  const edgeT = Math.max(EDGE_MAG_FLOOR, magnitudePercentile(mag, total, fracCap));

  // --- 4. Список краевых пикселей (строится один раз) ---
  const ex = new Int16Array(MAX_EDGES);
  const ey = new Int16Array(MAX_EDGES);
  const enx = new Float32Array(MAX_EDGES);
  const eny = new Float32Array(MAX_EDGES);
  let edgeCount = 0;
  for (let y = 1; y < H - 1 && edgeCount < MAX_EDGES; y++) {
    const row = y * W;
    for (let x = 1; x < W - 1 && edgeCount < MAX_EDGES; x++) {
      const i = row + x;
      const m = mag[i];
      if (m < edgeT) continue;
      const inv = 1 / m;
      ex[edgeCount] = x;
      ey[edgeCount] = y;
      enx[edgeCount] = gx[i] * inv;
      eny[edgeCount] = gy[i] * inv;
      edgeCount++;
    }
  }
  if (edgeCount === 0) return none;

  // --- 5. Лучевое голосование с аспект-проходами ---
  // Каждый краевой пиксель рисует луч вдоль градиента в обе стороны через
  // все расстояния. Центр колеса — точка пересечения лучей всей окружности
  // покрышки: собирает O(периметр) голосов, тогда как случайные пересечения
  // (прямые края, текстура) дают O(1) на точку.
  //
  // Проход k растягивает край по X (x' = k·x, n' = norm(nx/k, ny)): овал с
  // сжатием 1/k превращается в круг с одним чистым пиком (см. ASPECT_PASSES).
  const rMin = Math.max(7, Math.round(minWH * R_MIN_FRAC));
  const rMax = Math.max(rMin + 3, Math.round(minWH * R_MAX_FRAC));
  const acc = new Float32Array(total);
  const tmp = new Float32Array(total);
  const pool: Candidate[] = [];

  for (const k of ASPECT_PASSES) {
    acc.fill(0);
    // Центро-сохраняющее растяжение: x' = mid + k·(x − mid). Растяжение от
    // левого края выталкивает правую половину кадра за пределы аккумулятора
    // (колесо на x=235 при k=1.9 уезжает в x'=446 > 320 и пропадает).
    const mid = (W - 1) / 2;
    for (let e = 0; e < edgeCount; e++) {
      const px = mid + k * (ex[e] - mid);
      const py = ey[e];
      let nx = enx[e] / k;
      const ny = eny[e];
      const nn = Math.sqrt(nx * nx + ny * ny);
      nx /= nn;
      const nyN = ny / nn;
      // инлайн splat (без вызова функции — горячий цикл)
      for (let t = rMin; t <= rMax; t += RAY_STEP) {
        let xi = (px + nx * t + 0.5) | 0;
        let yi = (py + nyN * t + 0.5) | 0;
        if (xi >= 1 && yi >= 1 && xi <= W - 2 && yi <= H - 2) acc[yi * W + xi]++;
        xi = (px - nx * t + 0.5) | 0;
        yi = (py - nyN * t + 0.5) | 0;
        if (xi >= 1 && yi >= 1 && xi <= W - 2 && yi <= H - 2) acc[yi * W + xi]++;
      }
    }
    // Двойное blur3 (≈ гаусс σ≈1.7) обязательно: подавляет боковые «куспы»
    // эволют и стабилизирует пик для спуска. Одиночный blur роняет качество.
    blur3(acc, tmp, W, H);
    blur3(acc, tmp, W, H);

    let maxV = 0;
    for (let i = 0; i < total; i++) if (acc[i] > maxV) maxV = acc[i];
    const absThresh = Math.max(8, 0.15 * maxV);
    const peaks: Candidate[] = [];
    for (let y = 2; y < H - 2; y++) {
      const row = y * W;
      for (let x = 2; x < W - 2; x++) {
        const i = row + x;
        const v = acc[i];
        if (v < absThresh) continue;
        if (v < acc[i - 1] || v < acc[i + 1] || v < acc[i - W] || v < acc[i + W]) continue;
        // обратно в исходные координаты
        peaks.push({ cx: mid + (x - mid) / k, cy: y, votes: v, k });
      }
    }
    if (peaks.length === 0) continue;
    peaks.sort((a, b) => b.votes - a.votes);

    // NMS внутри прохода: топ PEAKS_PER_PASS, разнесённые на PEAK_NMS_PX
    let taken = 0;
    for (const p of peaks) {
      if (taken >= PEAKS_PER_PASS) break;
      let ok = true;
      for (const q of pool) {
        const dx = p.cx - q.cx;
        const dy = p.cy - q.cy;
        if (dx * dx + dy * dy < PEAK_NMS_PX * PEAK_NMS_PX) {
          ok = false;
          break;
        }
      }
      if (ok) {
        pool.push(p);
        taken++;
      }
    }
  }

  if (pool.length === 0) return none;
  // Сильнейшие пики (круги в своём проходе) — первыми на уточнение
  pool.sort((a, b) => b.votes - a.votes);

  if (debug) {
    debug({
      edgeCount,
      edgeT,
      pool: pool.map((p) => ({ cx: p.cx, cy: p.cy, votes: p.votes })),
      refined: [],
      accepted: [],
    });
  }

  // --- 7. Уточнение кандидатов: радиус → форма → центр (координатный спуск) ---
  const refined: RefinedCandidate[] = [];
  for (const cand of pool) {
    const res = refineCandidate(cand, gray, gx, gy, mag, edgeT, W, H, minWH, rMin, rMax);
    if (res) refined.push(res);
  }

  // --- 8. NMS по score (перекрывающиеся кандидаты — оставляем сильнейшего) ---
  refined.sort((a, b) => b.score - a.score);
  const accepted: RefinedCandidate[] = [];
  for (const cand of refined) {
    let clash = false;
    for (const a of accepted) {
      const dx = cand.cx - a.cx;
      const dy = cand.cy - a.cy;
      if (dx * dx + dy * dy < (0.9 * Math.max(cand.ry, a.ry)) ** 2) {
        clash = true;
        break;
      }
    }
    if (!clash) accepted.push(cand);
  }

  if (accepted.length === 0) return none;

  if (debug) {
    debug({
      edgeCount,
      edgeT,
      pool: [],
      refined: [],
      accepted: accepted.map((a) => ({
        cx: a.cx,
        cy: a.cy,
        rx: a.rx,
        ry: a.ry,
        score: a.score,
      })),
    });
  }

  const toEllipse = (w: RefinedCandidate): DetectedEllipse => {
    // Вертикальная полуось ry ≥ rx в подавляющем большинстве ракурсов
    // (плоскость колеса вертикальна). Если rx > ry (съёмка сверху/снизу) —
    // большая полуось горизонтальна.
    const a = Math.max(w.rx, w.ry);
    const b = Math.min(w.rx, w.ry);
    const theta = w.ry >= w.rx ? Math.PI / 2 : 0;
    return {
      cx: w.cx,
      cy: w.cy,
      a,
      b,
      theta,
      roundness: b / a,
      score: w.score,
    };
  };

  // --- 9. Выбор пары: похожие размеры, одна высота, разнесены по X ---
  let best: { pair: DetectedEllipse[]; combined: number } | null = null;
  for (let i = 0; i < accepted.length; i++) {
    for (let j = i + 1; j < accepted.length; j++) {
      const p = accepted[i];
      const q = accepted[j];
      const rMaxP = Math.max(p.ry, q.ry);
      const dx = Math.abs(p.cx - q.cx);
      const dy = Math.abs(p.cy - q.cy);
      const sizeSim = Math.min(p.ry, q.ry) / rMaxP;
      if (sizeSim < 0.55) continue;
      if (dx < 1.25 * Math.max(p.rx, q.rx)) continue;
      if (dy > 0.75 * rMaxP) continue;
      const roundnessP = Math.min(p.rx, p.ry) / Math.max(p.rx, p.ry);
      const roundnessQ = Math.min(q.rx, q.ry) / Math.max(q.rx, q.ry);
      const combined =
        Math.min(roundnessP, roundnessQ) * ((p.score + q.score) / 2) * sizeSim;
      if (!best || combined > best.combined) {
        const pair = p.cx <= q.cx ? [toEllipse(p), toEllipse(q)] : [toEllipse(q), toEllipse(p)];
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

  // --- 10. Только одно колесо ---
  const single = accepted[0];
  if (single.score >= PARTIAL_MIN_SCORE) {
    return {
      status: "partial",
      wheels: [toEllipse(single)],
      roundness: Math.min(single.rx, single.ry) / Math.max(single.rx, single.ry),
      axleTiltDeg: 0,
      hint: "Видно только одно колесо — отойдите дальше, чтобы в кадр поместились оба",
    };
  }

  return none;
}

// ============================================================
// ГОЛОСОВАНИЕ И РАЗМЫТИЕ
// ============================================================

/**
 * Один голос с округлением до целого пикселя. В горячем цикле голосования
 * инлайнится — функция оставлена для ясности/отладки.
 */
function splat(acc: Float32Array, W: number, H: number, x: number, y: number): void {
  const xi = (x + 0.5) | 0;
  const yi = (y + 0.5) | 0;
  if (xi < 1 || yi < 1 || xi > W - 2 || yi > H - 2) return;
  acc[yi * W + xi] += 1;
}

/** Размытие [1 2 1] × [1 2 1] / 16, разделимо: src → tmp → src */
function blur3(src: Float32Array, tmp: Float32Array, W: number, H: number): void {
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 1; x < W - 1; x++) {
      tmp[row + x] = (src[row + x - 1] + 2 * src[row + x] + src[row + x + 1]) / 4;
    }
  }
  for (let y = 1; y < H - 1; y++) {
    const row = y * W;
    for (let x = 1; x < W - 1; x++) {
      src[row + x] = (tmp[row + x - W] + 2 * tmp[row + x] + tmp[row + x + W]) / 4;
    }
  }
}

/** Значение величины градиента, ниже которого лежит `frac` всех пикселей */
function magnitudePercentile(mag: Float32Array, total: number, frac: number): number {
  const bins = 512;
  const hist = new Int32Array(bins);
  let maxM = 0;
  for (let i = 0; i < total; i++) if (mag[i] > maxM) maxM = mag[i];
  if (maxM <= 0) return EDGE_MAG_FLOOR;
  const scale = (bins - 1) / maxM;
  for (let i = 0; i < total; i++) hist[Math.round(mag[i] * scale)]++;
  const target = total * frac;
  let cum = 0;
  for (let b = 0; b < bins; b++) {
    cum += hist[b];
    if (cum >= target) return Math.max(EDGE_MAG_FLOOR, b / scale);
  }
  return EDGE_MAG_FLOOR;
}

// ============================================================
// УТОЧНЕНИЕ КАНДИДАТА
// ============================================================

/** Билинейная выборка из Float32-буфера */
function sampleF(buf: Float32Array, W: number, H: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) return 0;
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * W + x0;
  return (
    buf[i] * (1 - fx) * (1 - fy) +
    buf[i + 1] * fx * (1 - fy) +
    buf[i + W] * (1 - fx) * fy +
    buf[i + W + 1] * fx * fy
  );
}

/** Билинейная выборка из Uint8-буфера */
function sampleU(buf: Uint8Array, W: number, H: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) return 0;
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * W + x0;
  return (
    buf[i] * (1 - fx) * (1 - fy) +
    buf[i + 1] * fx * (1 - fy) +
    buf[i + W] * (1 - fx) * fy +
    buf[i + W + 1] * fx * fy
  );
}

/**
 * Сила краёв вдоль эллипса: средняя (нормированный градиент × |cos| к нормали
 * эллипса) и доля выборок с выраженным поперечным краем. Полярность не важна:
 * у покрышки два края — внешний и внутренний.
 *
 * cos/sin берутся из кеша таблиц (28k+ trig-вызовов на кадр иначе).
 */
const trigCache = new Map<number, { cos: Float64Array; sin: Float64Array }>();
function trigTable(n: number): { cos: Float64Array; sin: Float64Array } {
  let t = trigCache.get(n);
  if (!t) {
    const cos = new Float64Array(n);
    const sin = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const phi = (k / n) * 2 * Math.PI;
      cos[k] = Math.cos(phi);
      sin[k] = Math.sin(phi);
    }
    t = { cos, sin };
    trigCache.set(n, t);
  }
  return t;
}

function ellipseEdgeResponse(
  gx: Float32Array,
  gy: Float32Array,
  mag: Float32Array,
  W: number,
  H: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  samples: number,
  edgeT: number,
): { strength: number; coverage: number } {
  const { cos, sin } = trigTable(samples);
  let sum = 0;
  let cov = 0;
  for (let k = 0; k < samples; k++) {
    const cosPhi = cos[k];
    const sinPhi = sin[k];
    const px = cx + rx * cosPhi;
    const py = cy + ry * sinPhi;
    const m = sampleF(mag, W, H, px, py);
    if (m < edgeT) continue;
    const sx = sampleF(gx, W, H, px, py);
    const sy = sampleF(gy, W, H, px, py);
    const gm = Math.sqrt(sx * sx + sy * sy);
    if (gm < 1e-3) continue;
    // нормаль эллипса (градиент x²/rx² + y²/ry² в точке)
    const nx = cosPhi / rx;
    const ny = sinPhi / ry;
    const nm = Math.sqrt(nx * nx + ny * ny);
    const align = Math.abs((sx / gm) * (nx / nm) + (sy / gm) * (ny / nm));
    sum += Math.min(1, m / 140) * align;
    if (align > 0.25) cov++;
  }
  return { strength: sum / samples, coverage: cov / samples };
}

function refineCandidate(
  cand: Candidate,
  gray: Uint8Array,
  gx: Float32Array,
  gy: Float32Array,
  mag: Float32Array,
  edgeT: number,
  W: number,
  H: number,
  minWH: number,
  rMin: number,
  rMax: number,
): RefinedCandidate | null {
  // --- 7a. Радиальный профиль с приоритетным аспектом прохода ---
  // В проходе k край колеса — почти круг радиуса rr: исходная форма
  // (rx = rr/k, ry = rr). Сканируем размер, а не форму.
  const k = cand.k;
  let r0 = rMin;
  let bestStrength = -1;
  for (let rr = rMin; rr <= rMax; rr += 3) {
    const resp = ellipseEdgeResponse(gx, gy, mag, W, H, cand.cx, cand.cy, rr / k, rr, 20, edgeT);
    if (resp.strength > bestStrength) {
      bestStrength = resp.strength;
      r0 = rr;
    }
  }
  const rx0 = r0 / k;
  const ry0 = r0;

  // --- 7b. Мультипликативная сетка вокруг seeded-формы (аспект может
  // отклониться от приоритета прохода на ±25%) ---
  const muls = [0.8, 0.9, 1.0, 1.1, 1.25];
  let rx = rx0;
  let ry = ry0;
  let best = { strength: -1, coverage: 0 };
  for (const a of muls) {
    const rxT = rx0 * a;
    for (const b of muls) {
      const ryT = ry0 * b;
      if (rxT < RX_RY_MIN * ryT || ryT < 4 || ryT > minWH * 0.6) continue;
      const resp = ellipseEdgeResponse(gx, gy, mag, W, H, cand.cx, cand.cy, rxT, ryT, 24, edgeT);
      if (resp.strength > best.strength) {
        best = resp;
        rx = rxT;
        ry = ryT;
      }
    }
  }
  if (best.strength <= 0) return null;

  // --- 7c. Координатный спуск: центр ↔ форма (3 раунда, шаг сжимается) ---
  const rounds = [
    { c: 3, s: 2, samples: 24 },
    { c: 2, s: 1.5, samples: 24 },
    { c: 1.5, s: 1, samples: 32 },
  ];
  for (const round of rounds) {
    // центр: 8 соседей с шагом round.c
    const cDeltas: Array<[number, number]> = [
      [-round.c, 0], [round.c, 0], [0, -round.c], [0, round.c],
      [-round.c, -round.c], [round.c, round.c], [-round.c, round.c], [round.c, -round.c],
    ];
    let bcx = cand.cx;
    let bcy = cand.cy;
    for (const [dx, dy] of cDeltas) {
      const cxT = bcx + dx;
      const cyT = bcy + dy;
      const resp = ellipseEdgeResponse(gx, gy, mag, W, H, cxT, cyT, rx, ry, round.samples, edgeT);
      if (resp.strength > best.strength) {
        best = resp;
        bcx = cxT;
        bcy = cyT;
      }
    }
    cand.cx = bcx;
    cand.cy = bcy;

    // форма: 8 соседей с шагом round.s
    const s = round.s;
    const sDeltas: Array<[number, number]> = [
      [0, -s], [0, s], [-s, 0], [s, 0], [-s, -s], [s, s], [-s, s], [s, -s],
    ];
    let brx = rx;
    let bry = ry;
    for (const [drx, dry] of sDeltas) {
      const rxT = brx + drx;
      const ryT = bry + dry;
      if (rxT < RX_RY_MIN * ryT || ryT < 4 || ryT > minWH * 0.6) continue;
      const resp = ellipseEdgeResponse(gx, gy, mag, W, H, cand.cx, cand.cy, rxT, ryT, round.samples, edgeT);
      if (resp.strength > best.strength) {
        best = resp;
        brx = rxT;
        bry = ryT;
      }
    }
    rx = brx;
    ry = bry;
  }

  // --- 7d. Гейты: сжатие, размер, покрытие ---
  const roundness = rx / ry; // rx ≤ ry по построению сетки
  if (roundness < RX_RY_MIN) return null;
  const d = 2 * ry;
  if (d < minWH * DIAMETER_MIN_FRAC || d > minWH * DIAMETER_MAX_FRAC) return null;
  if (best.coverage < COVERAGE_MIN) return null;

  // --- 7e. Контраст «кольцо темнее соседей» (мягкий признак) ---
  const ring = ringContrastScore(gray, W, H, cand.cx, cand.cy, rx, ry);

  // --- 7f. Итоговый score ---
  const sym = Math.min(1, cand.votes / (2.2 * Math.PI * r0));
  const dFrac = d / minWH;
  const sizePrior = dFrac >= 0.14 && dFrac <= 0.85 ? 1 : dFrac >= 0.1 && dFrac <= 0.95 ? 0.5 : 0;
  const margin = 3;
  const insideFrame =
    cand.cx - rx > margin &&
    cand.cx + rx < W - margin &&
    cand.cy - ry > margin &&
    cand.cy + ry < H - margin;

  const score =
    0.34 * sym + 0.33 * best.coverage + 0.18 * ring + 0.08 * sizePrior + 0.07 * (insideFrame ? 1 : 0.35);

  return {
    cx: cand.cx,
    cy: cand.cy,
    votes: cand.votes,
    k,
    rx,
    ry,
    coverage: best.coverage,
    ring,
    sym,
    score: Math.min(1, score),
  };
}

/**
 * Контраст покрышки: средняя яркость на кольце эллипса против яркости
 * внутри (0.5·ry) и снаружи (1.18 масштаб). Мягкий вклад в score —
 * дисковое колесо (тёмное и внутри) не отсеивается.
 */
function ringContrastScore(
  gray: Uint8Array,
  W: number,
  H: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): number {
  const N = 32;
  const { cos, sin } = trigTable(N);
  let ringSum = 0;
  for (let k = 0; k < N; k++) {
    ringSum += sampleU(gray, W, H, cx + rx * cos[k], cy + ry * sin[k]);
  }
  const ringMean = ringSum / N;

  let inSum = 0;
  const inR = 0.5 * ry;
  for (let k = 0; k < N; k++) {
    inSum += sampleU(gray, W, H, cx + inR * cos[k], cy + inR * sin[k]);
  }
  const inMean = inSum / N;

  const outRx = rx * 1.18;
  const outRy = ry * 1.18;
  let outSum = 0;
  let outN = 0;
  for (let k = 0; k < N; k++) {
    const px = cx + outRx * cos[k];
    const py = cy + outRy * sin[k];
    if (px < 0 || py < 0 || px >= W || py >= H) continue;
    outSum += sampleU(gray, W, H, px, py);
    outN++;
  }
  const outMean = outN > 0 ? outSum / outN : inMean;

  const contrast = Math.max(inMean - ringMean, outMean - ringMean) / 255;
  return Math.max(0, Math.min(1, (contrast - 0.015) / 0.1));
}
