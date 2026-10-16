/**
 * BIKE MATCH VALIDATION — сравнение пропорций двух фото (v1.14.34, ТЗ п. 5.4)
 * ===========================================================================
 * Проблема: пользователь загружает на Шаг 1 (фото с райдером) и Шаг 2
 * (фото чистого вела) кадры РАЗНЫХ велосипедов — все «сравнения с рамой»
 * становятся бессмысленными, а советы противоречат друг другу.
 *
 * Решение: масштабно-инвариантная пропорция
 *     ratio = pxWheelbase / pxWheelDiameter
 * (расстояние между осями колёс / диаметр колеса). Для одного и того же
 * вела ratio ≈ const независимо от масштаба съёмки и расстояния до камеры
 * (перспектива даёт единицы процентов). Типичные значения: шоссе ≈ 1.40,
 * MTB ≈ 1.45–1.55.
 *
 * Два источника ratio:
 *  - Фото Шага 2 (разметка есть): по размеченным точкам осей и верхов
 *    покрышек (точный приоритет).
 *  - Фото Шага 1 (разметки нет): авто-детектор колёс (wheel-detect.ts,
 *    лучевое голосование) на уменьшенном кадре.
 *
 * Сравнение: |r1 − r2| / среднее > 10% → ЖЁСТКИЙ блок автоматического
 * расчёта сравнения с рамой + модальное окно (v1.14.41, ТЗ «Жесткий
 * чек-поинт совпадения велосипедов»; раньше было 12% и только предупреждение).
 */

import { detectWheels, type RawFrame } from "./wheel-detect";

/**
 * Порог расхождения пропорций (v1.14.41, ТЗ «Жесткий чек-поинт»):
 * > 10% — хард-блок сравнения с рамой + модалка подтверждения.
 */
export const WHEEL_RATIO_MISMATCH_PCT = 10;

/** Пропорция колесной базы к диаметру колеса по размеченным точкам (Шаг 2) */
export interface WheelRatioPoints {
  rearAxle: { x: number | null; y: number | null } | null | undefined;
  frontAxle: { x: number | null; y: number | null } | null | undefined;
  rearWheelTop?: { x: number | null; y: number | null } | null | undefined;
  frontWheelTop?: { x: number | null; y: number | null } | null | undefined;
  /** Размеры фото в px — для честных пиксельных расстояний (X по ширине, Y по высоте) */
  imgWidth: number;
  imgHeight: number;
}

const complete = (
  p: { x?: number | null; y?: number | null } | null | undefined
): p is { x: number; y: number } =>
  !!p && p.x != null && p.y != null && Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * Ratio по РАЗМЕТКЕ (приоритет — точки ставит пользователь).
 * wheelbase = расстояние между центрами осей; диаметр = 2 × средний радиус
 * (ось → верх покрышки). Нужны обе оси и ХОТЯ БЫ один верх колеса.
 * Возвращает null, если точек недостаточно (детектор не нужен).
 */
export function computeWheelRatioFromKeypoints(pts: WheelRatioPoints): number | null {
  if (!complete(pts.rearAxle) || !complete(pts.frontAxle)) return null;
  const wheelbasePx = Math.hypot(
    (pts.frontAxle.x - pts.rearAxle.x) * pts.imgWidth,
    (pts.frontAxle.y - pts.rearAxle.y) * pts.imgHeight
  );
  if (wheelbasePx < 10) return null;
  const radii: number[] = [];
  if (complete(pts.rearWheelTop) && complete(pts.rearAxle)) {
    radii.push(
      Math.hypot(
        (pts.rearWheelTop.x - pts.rearAxle.x) * pts.imgWidth,
        (pts.rearWheelTop.y - pts.rearAxle.y) * pts.imgHeight
      )
    );
  }
  if (complete(pts.frontWheelTop) && complete(pts.frontAxle)) {
    radii.push(
      Math.hypot(
        (pts.frontWheelTop.x - pts.frontAxle.x) * pts.imgWidth,
        (pts.frontWheelTop.y - pts.frontAxle.y) * pts.imgHeight
      )
    );
  }
  if (radii.length === 0) return null;
  const avgRadius = radii.reduce((s, r) => s + r, 0) / radii.length;
  if (avgRadius < 5) return null;
  return wheelbasePx / (2 * avgRadius);
}

/**
 * Ratio по АВТО-ДЕТЕКТОРУ колёс (Шаг 1 — фото райдера без разметки).
 * frame — уменьшенный кадр (~320–480px по ширине). Требует ОБА колеса
 * (status "ok"/"tilted"); частичное обнаружение = null (сравнение тихо
 * пропускается — это предупреждение, а не блокер).
 * v1.14.44: радиус — по ВНЕШНЕЙ границе покрышки (rOuter), как в разметке
 * Шага 2 (ось → верх покрышки): фит эллипса занижает радиус на 5–8%,
 * что давало ложное расхождение 10–14% на ОДНОМ и том же веле
 * (замер на user-reports: разметка 1.509 против детектора 1.734).
 */
export function computeWheelRatioFromFrame(frame: RawFrame): number | null {
  const result = detectWheels(frame);
  if (result.wheels.length < 2) return null;
  const [left, right] = result.wheels;
  const wheelbasePx = Math.hypot(right.cx - left.cx, right.cy - left.cy);
  if (wheelbasePx < 10) return null;
  const avgRadius = (left.rOuter + right.rOuter) / 2;
  if (avgRadius < 5) return null;
  return wheelbasePx / (2 * avgRadius);
}

/**
 * Расхождение двух пропорций в процентах (относительно среднего).
 * null — одна из пропорций неизвестна.
 */
export function wheelRatioDivergencePct(
  a: number | null | undefined,
  b: number | null | undefined
): number | null {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a <= 0 || b <= 0) return null;
  const avg = (a + b) / 2;
  return (Math.abs(a - b) / avg) * 100;
}

/**
 * Bike Match Validation: пропорции расходятся больше чем на 10%?
 */
export function isBikeMismatch(
  a: number | null | undefined,
  b: number | null | undefined
): boolean {
  const d = wheelRatioDivergencePct(a, b);
  return d != null && d > WHEEL_RATIO_MISMATCH_PCT;
}

/**
 * v1.14.36: честный трёхступенчатый вердикт сверки велосипедов.
 * Раньше «не удалось сверить» (детектор колёс не нашёл оба колеса на фото
 * райдера — частый случай: нога закрывает колесо) молча выглядел как
 * «совпадает» — защита от дурака пропускала подмену вела. Теперь:
 *   - "match"    — обе пропорции известны, расхождение ≤ 10%;
 *   - "mismatch" — обе известны, расхождение > 10% (два разных вела?);
 *   - "unknown"  — хоть одна пропорция не посчиталась: сверка НЕ состоялась,
 *                  это НЕ «совпадение» (UI обязан показать честное «не сверено»).
 */
export type BikeMatchVerdict = "match" | "mismatch" | "unknown";

export interface BikeMatchResult {
  verdict: BikeMatchVerdict;
  /** Расхождение в %; null, если хотя бы одна пропорция неизвестна */
  divergencePct: number | null;
}

export function bikeMatchVerdict(
  a: number | null | undefined,
  b: number | null | undefined
): BikeMatchResult {
  const divergencePct = wheelRatioDivergencePct(a, b);
  if (divergencePct == null) return { verdict: "unknown", divergencePct: null };
  return {
    verdict: divergencePct > WHEEL_RATIO_MISMATCH_PCT ? "mismatch" : "match",
    divergencePct,
  };
}

/**
 * v1.14.43 (multi-factor bike match): метаданные колёс из кадра детектора —
 * не только пропорция, но и нормированные положение осей + радиус (для
 * фактора «масштаб посадки» F3) — точка семпла цвета считается из них же.
 * Требует оба колеса (как computeWheelRatioFromFrame); null — не нашли.
 */
export interface RiderWheelFrameMeta {
  /** пропорция база/диаметр (та же, что computeWheelRatioFromFrame) */
  ratio: number;
  /** midpoint осей, норм. 0..1 */
  axleMidXn: number;
  axleMidYn: number;
  /** средний радиус колёс, норм. по ВЫСОТЕ кадра */
  radiusNormY: number;
}

export function computeWheelFrameMeta(
  frame: RawFrame
): RiderWheelFrameMeta | null {
  const result = detectWheels(frame);
  if (result.wheels.length < 2) return null;
  const [left, right] = result.wheels;
  const wheelbasePx = Math.hypot(right.cx - left.cx, right.cy - left.cy);
  if (wheelbasePx < 10) return null;
  // v1.14.44: внешний радиус (согласован с computeWheelRatioFromFrame)
  const avgRadius = (left.rOuter + right.rOuter) / 2;
  if (avgRadius < 5) return null;
  if (frame.height < 8) return null;
  return {
    ratio: wheelbasePx / (2 * avgRadius),
    axleMidXn: (left.cx + right.cx) / 2 / frame.width,
    axleMidYn: (left.cy + right.cy) / 2 / frame.height,
    radiusNormY: avgRadius / frame.height,
  };
}

/**
 * Уменьшить изображение до рабочего кадра детектора и снять ImageData.
 * Детектор спроектирован под кадры ~320px; 480px по ширине — компромисс
 * точность/скорость (единицы мс). Возвращает null на битом/пустом кадре.
 */
export function downscaleToRawFrame(
  img: HTMLImageElement,
  targetWidth = 480
): RawFrame | null {
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  if (!w0 || !h0) return null;
  const scale = Math.min(1, targetWidth / w0);
  const w = Math.max(32, Math.round(w0 * scale));
  const h = Math.max(32, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  try {
    return ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
}
