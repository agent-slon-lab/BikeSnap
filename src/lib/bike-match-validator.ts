/**
 * MULTI-FACTOR BIKE MATCH VALIDATOR (v1.14.43, ТЗ «Защита от дурака»)
 * ====================================================================
 * Расширение bike-match-validation (v1.14.34/41): раньше сверка фото
 * райдера (Шаг 1) с фото вела (Шаг 2) опиралась на ОДИН фактор —
 * пропорцию «колёсная база / диаметр колеса». Пользователь с разными
 * велами схожих пропорций (шоссейник vs выносливый гравийник) или с
 * одинаковым цветом рамы обходил проверку.
 *
 * Теперь 4 независимых фактора (каждый → pass / fail / unknown):
 *
 *  F1 proportions — пропорция «база / диаметр колеса», порог 10%
 *     (bike-wheel-ratio.ts, хард-блок v1.14.41 сохранён).
 *  F2 frameColor — медианный цвет рамы. Шаг 2: окно в середине
 *     подседельной трубы (BB→saddleMount — там нет ног и шатунов),
 *     фоллбэк — окно вокруг BB. Шаг 1: окно в зоне верхней трубы /
 *     переднего треугольника, оцениваемой из авто-детектора колёс
 *     (midpoint осей, 0.26–0.58 R над осями). ΔC (Евклид RGB) > 90 →
 *     fail (по ТЗ; порог грубый: ловит «белый vs чёрный», не ловит
 *     оттенки). Не сработает, если одежда перекрыла зону семпла —
 *     поэтому фактор НЕ блокирующий сам по себе.
 *  F3 riderScale — масштабно-инвариантная высота посадки:
 *     (axleMidY − точка таза/седла) / радиус колеса. Шаг 2: saddleMount
 *     из разметки; Шаг 1: midpoint бёдер BlazePose. Таз ≈ седло ±
 *     несколько сантиметров (~0.15 R) → допуск 25% (относительно среднего).
 *  F4 gripType — высота кистей относительно плеч (BlazePose) против
 *     заявленного типа вела: road/gravel («пистолеты») — кисти не бывают
 *     ЯВНО выше плеч; mtb/city/hybrid (прямой руль) — кисти не опускаются
 *     на пол-торса ниже плеч (это шоссейный drop). Фактор мягкий: ловит
 *     грубую подмену «шоссейник ↔ МТБ», посадка индивидуальна.
 *
 * Вердикт: "block" — провалились ≥ 2 факторов ИЛИ F1 (хард-блок
 * v1.14.41 не ослабляется); "warn" — один провал; "ok" — ноль провалов
 * при хотя бы одном оценённом факторе; "unknown" — нечего оценивать.
 *
 * Ограничения (документирую честно): наклон верхней трубы (Factor B ТЗ)
 * на Шаге 1 НЕ измерим — на фото райдера нет разметки рамы, а поза даёт
 * только тело. Поэтому фактор B реализован как «внутренняя» сверка
 * нового F3/F4 (тип вела ↔ тело), а не сравнение slope двух кадров.
 */

import { bikeMatchVerdict } from "./bike-wheel-ratio";
import type { BikeType } from "./bike-params";
import type { Point } from "./bike-fit";
import { POSE_LANDMARKS } from "./bike-fit";

/** RGB-цвет 0..255 */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface P2 {
  x: number;
  y: number;
}

/** Порог цветового расхождения (Евклид RGB) — по ТЗ Factor C */
export const FRAME_COLOR_DIFF_THRESHOLD = 90;
/** Допуск масштаба посадки (относительно среднего) — Factor F3 */
export const RIDER_SCALE_TOLERANCE = 0.25;
/** Кисти выше плеч на >15% торса у road/gravel — fail (F4) */
export const GRIP_ROAD_ABOVE_TORSO = 0.15;
/** Кисти ниже плеч на >50% торса у mtb/city/hybrid — fail (F4) */
export const GRIP_MTB_BELOW_TORSO = 0.5;
/** Минимальная видимая длина торса (норм. по высоте кадра) для F4 */
export const GRIP_MIN_TORSO_DY = 0.05;
/** Минимальная visibility BlazePose-точки */
export const POSE_MIN_VISIBILITY = 0.3;

export type FactorVerdict = "pass" | "fail" | "unknown";

export interface FactorResult {
  verdict: FactorVerdict;
  /** Человекочитаемое пояснение (для плашек/модалки) */
  detail: string;
}

export interface BikeMatchFactors {
  proportions: FactorResult;
  frameColor: FactorResult;
  riderScale: FactorResult;
  gripType: FactorResult;
}

export type BikeMatchVerdict = "ok" | "warn" | "block" | "unknown";

export interface BikeMatchValidation {
  verdict: BikeMatchVerdict;
  /** Число факторов с вердиктом fail */
  failedCount: number;
  /** Число ОЦЕНЁННЫХ факторов (pass + fail) */
  evaluatedCount: number;
  factors: BikeMatchFactors;
  /** Причины провалов — для модалки (человекочитаемые) */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Сигналы сторон
// ---------------------------------------------------------------------------

/** Колёса + цвет рамы, измеренные на боковом фото райдера (Шаг 1) */
export interface RiderWheelMeta {
  /** midpoint осей колёс, норм. 0..1 (от детектора колёс, кадр ~480px) */
  axleMidXn: number;
  axleMidYn: number;
  /** средний радиус колеса, норм. по ВЫСОТЕ кадра */
  radiusNormY: number;
  /** медианный цвет зоны рамы вокруг точки семпла (null — не удалось) */
  frameColorRgb: Rgb | null;
}

/** Поза райдера из BlazePose (Шаг 1): midpoint видимых пар суставов */
export interface RiderPoseSignals {
  hipMid: P2 | null;
  shoulderMid: P2 | null;
  wristMid: P2 | null;
  /** v1.14.44: midpoint коленей/лодыжек — гейт «райдер стоит над рамой» для F3 */
  kneeMid: P2 | null;
  ankleMid: P2 | null;
}

/** Сигналы карточки вела (Шаг 2: разметка + фото + тип) */
export interface BikeCardSignals {
  /** пропорция база/диаметр из разметки (photoCalib.wheelRatio) */
  wheelRatio: number | null;
  /** медианный цвет рамы (подседельная труба / BB) */
  bbColorRgb: Rgb | null;
  /** saddleMount.y (норм.) */
  saddleYn: number | null;
  /** (rearAxle.y + frontAxle.y) / 2 (норм.) */
  axleMidYn: number | null;
  /** средний радиус колеса, норм. по высоте фото (нужен wheelTop) */
  radiusNormY: number | null;
  /** заявленный тип вела */
  bikeType: BikeType | null;
}

// ---------------------------------------------------------------------------
// Чистые математические функции (юнит-тестируемые без DOM)
// ---------------------------------------------------------------------------

/** Евклидово цветовое расстояние ΔC = sqrt(Δr² + Δg² + Δb²) */
export function euclidColorDiff(a: Rgb, b: Rgb): number {
  return Math.sqrt(
    (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2
  );
}

/**
 * Медианный RGB из пикселей RGBA-буфера (окно семпла). Медиана (а не
 * среднее) устойчива к перекрытиям: нога/тень занимают часть окна, но
 * рама при достаточной площади доминирует в медиане по каждому каналу.
 * Возвращает null на пустом/малом буфере.
 */
export function medianRgbFromPixels(
  pixels: Uint8ClampedArray | number[]
): Rgb | null {
  const n = pixels.length;
  if (n < 4 || n % 4 !== 0) return null;
  const count = n / 4;
  if (count < 4) return null;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let i = 0; i < n; i += 4) {
    rs.push(pixels[i]);
    gs.push(pixels[i + 1]);
    bs.push(pixels[i + 2]);
  }
  const med = (arr: number[]): number => {
    arr.sort((x, y) => x - y);
    const m = arr.length >> 1;
    return arr.length % 2 ? arr[m] : Math.round((arr[m - 1] + arr[m]) / 2);
  };
  return { r: med(rs), g: med(gs), b: med(bs) };
}

/**
 * Точка семпла цвета рамы на ФОТО РАЙДЕРА (Шаг 1) из колёс детектора:
 * midpoint осей; по вертикали — зона верхней трубы / подседельной трубы
 * (0.26–0.58 R над осями: у шоссе труба ~0.45–0.55 R, у sloping-МТБ
 * ~0.3–0.4 R — окно 0.16 R накрывает обе геометрии). Возвращает
 * нормированные координаты и полуразмер окна (норм.), null — нет колёс.
 */
export function estimateTriangleSamplePoint(
  axleMidXn: number,
  axleMidYn: number,
  radiusNormY: number
): { nx: number; ny: number; halfNorm: number } | null {
  if (
    !Number.isFinite(axleMidXn) ||
    !Number.isFinite(axleMidYn) ||
    !Number.isFinite(radiusNormY) ||
    radiusNormY <= 0.005
  ) {
    return null;
  }
  return {
    nx: axleMidXn,
    ny: axleMidYn - 0.42 * radiusNormY,
    halfNorm: 0.16 * radiusNormY,
  };
}

/**
 * Наклон верхней трубы в градусах (для телеметрии и будущих проверок):
 * угол линии stTop→htTop с горизонталью, с поправкой на аспект фото
 * (норм. координаты по X и Y масштабируются по-разному). > 0 — htTop
 * выше stTop (sloping вверх к рулю); типично: шоссе −5..+10°, МТБ 15..35°.
 */
export function computeTopTubeSlopeDeg(
  stTop: P2 | null | undefined,
  htTop: P2 | null | undefined,
  imgW: number,
  imgH: number
): number | null {
  if (
    !stTop ||
    !htTop ||
    !Number.isFinite(stTop.x) ||
    !Number.isFinite(stTop.y) ||
    !Number.isFinite(htTop.x) ||
    !Number.isFinite(htTop.y) ||
    imgW <= 0 ||
    imgH <= 0
  ) {
    return null;
  }
  const dx = (htTop.x - stTop.x) * imgW;
  const dy = (stTop.y - htTop.y) * imgH; // вверх = положительный
  if (Math.abs(dx) < 1e-6) return null;
  return (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI;
}

/**
 * Угол колена (hip→knee→ankle) в градусах, 180 = нога полностью прямая.
 * v1.14.44: гейт F3 — если нога выпрямлена (райдер СТОИТ над рамой,
 * а не сидит в седле), высота таза не имеет отношения к высоте седла
 * и сравнивать её с разметкой Шага 2 нельзя (ложный fail).
 * Чистая функция — юнит-тестируется без DOM.
 */
export function kneeAngleDeg(
  hip: P2 | null | undefined,
  knee: P2 | null | undefined,
  ankle: P2 | null | undefined
): number | null {
  if (!hip || !knee || !ankle) return null;
  const v1x = hip.x - knee.x;
  const v1y = hip.y - knee.y;
  const v2x = ankle.x - knee.x;
  const v2y = ankle.y - knee.y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-6 || m2 < 1e-6) return null;
  const cos = (v1x * v2x + v1y * v2y) / (m1 * m2);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Порог прямого колена: ≥ 150° — райдер стоит, F3 не интерпретируем */
export const KNEE_STANDING_DEG = 150;

/**
 * Угол колена по midpoint'ам видимых суставов (на строгом боковом фото
 * видима одна нога — midpoint совпадает с ней). null — суставы не видны.
 */
export function standingKneeAngle(pose: RiderPoseSignals): number | null {
  return kneeAngleDeg(pose.hipMid, pose.kneeMid, pose.ankleMid);
}

/**
 * Midpoint пары видимых BlazePose-точек (visibility ≥ 0.3). Если видима
 * только одна — возвращается она (боковое фото: дальняя сторона скрыта).
 */
function visibleMidpoint(
  a: Point | undefined,
  b: Point | undefined
): P2 | null {
  const okA =
    a && Number.isFinite(a.x) && Number.isFinite(a.y)
      ? (a.visibility ?? 1) >= POSE_MIN_VISIBILITY
      : false;
  const okB =
    b && Number.isFinite(b.x) && Number.isFinite(b.y)
      ? (b.visibility ?? 1) >= POSE_MIN_VISIBILITY
      : false;
  if (okA && okB) return { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
  if (okA) return { x: a!.x, y: a!.y };
  if (okB) return { x: b!.x, y: b!.y };
  return null;
}

/**
 * Извлечь сигналы позы (таз / плечи / кисти) из landmarks BlazePose.
 * Чистая функция — для UI и юнит-тестов.
 */
export function extractRiderPoseSignals(
  landmarks: Point[] | null | undefined
): RiderPoseSignals {
  if (!landmarks || landmarks.length === 0) {
    return { hipMid: null, shoulderMid: null, wristMid: null, kneeMid: null, ankleMid: null };
  }
  return {
    hipMid: visibleMidpoint(
      landmarks[POSE_LANDMARKS.LEFT_HIP],
      landmarks[POSE_LANDMARKS.RIGHT_HIP]
    ),
    shoulderMid: visibleMidpoint(
      landmarks[POSE_LANDMARKS.LEFT_SHOULDER],
      landmarks[POSE_LANDMARKS.RIGHT_SHOULDER]
    ),
    wristMid: visibleMidpoint(
      landmarks[POSE_LANDMARKS.LEFT_WRIST],
      landmarks[POSE_LANDMARKS.RIGHT_WRIST]
    ),
    kneeMid: visibleMidpoint(
      landmarks[POSE_LANDMARKS.LEFT_KNEE],
      landmarks[POSE_LANDMARKS.RIGHT_KNEE]
    ),
    ankleMid: visibleMidpoint(
      landmarks[POSE_LANDMARKS.LEFT_ANKLE],
      landmarks[POSE_LANDMARKS.RIGHT_ANKLE]
    ),
  };
}

// ---------------------------------------------------------------------------
// Главный валидатор
// ---------------------------------------------------------------------------

export interface BikeMatchValidationInput {
  wheelRatio: number | null;
  wheelMeta: RiderWheelMeta | null;
  pose: RiderPoseSignals;
  bike: BikeCardSignals;
}

/**
 * Полная 4-факторная сверка «фото райдера ↔ фото вела».
 * См. докблок модуля. Чистая функция.
 */
export function validateBikeMatch(
  input: BikeMatchValidationInput
): BikeMatchValidation {
  const { wheelRatio, wheelMeta, pose, bike } = input;
  const reasons: string[] = [];

  // === F1: пропорции колёс (хард-блок v1.14.41) ===
  const m = bikeMatchVerdict(bike.wheelRatio, wheelRatio);
  let proportions: FactorResult;
  if (m.verdict === "mismatch") {
    proportions = {
      verdict: "fail",
      detail: `Пропорции «база/колесо» расходятся на ${m.divergencePct?.toFixed(0)}% (порог 10%)`,
    };
    reasons.push(
      `Пропорции колёсной базы и диаметра колеса не совпадают (расхождение ${m.divergencePct?.toFixed(0)}% при пороге 10%).`
    );
  } else if (m.verdict === "match") {
    proportions = {
      verdict: "pass",
      detail: `Пропорции совпадают (расхождение ${m.divergencePct?.toFixed(0)}%)`,
    };
  } else {
    proportions = {
      verdict: "unknown",
      detail: "Пропорции не сверены (колёса не распознаны или вел не размечен)",
    };
  }

  // === F2: цвет рамы ===
  let frameColor: FactorResult;
  if (bike.bbColorRgb && wheelMeta?.frameColorRgb) {
    const diff = euclidColorDiff(bike.bbColorRgb, wheelMeta.frameColorRgb);
    if (diff > FRAME_COLOR_DIFF_THRESHOLD) {
      frameColor = {
        verdict: "fail",
        detail: `Цвет рамы различается: ΔC=${diff.toFixed(0)} (порог ${FRAME_COLOR_DIFF_THRESHOLD})`,
      };
      reasons.push(
        `Цвет рамы на двух фото существенно различается (ΔC=${diff.toFixed(0)} при пороге ${FRAME_COLOR_DIFF_THRESHOLD}). Возможно и другое: одежда или тень перекрыли зону замера на фото с райдером — проверьте глазами.`
      );
    } else {
      frameColor = {
        verdict: "pass",
        detail: `Цвет рамы совпадает (ΔC=${diff.toFixed(0)})`,
      };
    }
  } else {
    frameColor = {
      verdict: "unknown",
      detail: "Цвет рамы не сверен (нет фото вела, разметки BB или семпла)",
    };
  }

  // === F3: масштаб посадки (таз/седло над осями, норм. на радиус) ===
  let riderScale: FactorResult;
  const hipY = pose.hipMid?.y ?? null;
  const hipKnown = hipY != null && wheelMeta != null;
  const bikeScaleKnown =
    bike.saddleYn != null && bike.axleMidYn != null && bike.radiusNormY != null && bike.radiusNormY > 0;
  // v1.14.44: гейт «стоит над рамой» — прямое колено (≥ 150°) означает,
  // что таз НЕ в седле: сравнивать высоту таза с высотой седла нельзя.
  const standingDeg = standingKneeAngle(pose);
  if (hipKnown && bikeScaleKnown && standingDeg != null && standingDeg >= KNEE_STANDING_DEG) {
    riderScale = {
      verdict: "unknown",
      detail: `Посадка не измерима: райдер стоит над рамой (колено ${standingDeg.toFixed(0)}°)`,
    };
  } else if (hipKnown && bikeScaleKnown) {
    const rScale = (wheelMeta!.axleMidYn - hipY!) / wheelMeta!.radiusNormY;
    const bScale =
      (bike.axleMidYn! - bike.saddleYn!) / bike.radiusNormY!;
    if (rScale > 0 && bScale > 0) {
      const diff = Math.abs(rScale - bScale) / ((rScale + bScale) / 2);
      if (diff > RIDER_SCALE_TOLERANCE) {
        riderScale = {
          verdict: "fail",
          detail: `Высота посадки над осями не сходится: ${(rScale * 100).toFixed(0)}% против ${(bScale * 100).toFixed(0)}% радиуса (допуск ${(RIDER_SCALE_TOLERANCE * 100).toFixed(0)}%)`,
        };
        reasons.push(
          `Высота посадки относительно колёс не сходится с размеченным велом (${(rScale * 100).toFixed(0)}% против ${(bScale * 100).toFixed(0)}% радиуса колеса) — рамы очень разных размеров/типов.`
        );
      } else {
        riderScale = {
          verdict: "pass",
          detail: `Высота посадки сходится (${(rScale * 100).toFixed(0)}% против ${(bScale * 100).toFixed(0)}% радиуса)`,
        };
      }
    } else {
      // Отрицательная высота: таз ниже осей / седло ниже осей —
      // вырожденный кадр (фото сверху/снизу) — не интерпретируем.
      riderScale = {
        verdict: "unknown",
        detail: "Вырожденная геометрия кадра (таз/седло ниже осей колёс)",
      };
    }
  } else {
    riderScale = {
      verdict: "unknown",
      detail: "Масштаб посадки не сверен (нет позы, колёс или разметки седла/колёс)",
    };
  }

  // === F4: хват (кисти vs плечи) против заявленного типа вела ===
  let gripType: FactorResult;
  const { shoulderMid, wristMid } = pose;
  const torsoDy =
    shoulderMid && pose.hipMid ? Math.abs(pose.hipMid.y - shoulderMid.y) : null;
  if (
    bike.bikeType &&
    shoulderMid &&
    wristMid &&
    torsoDy != null &&
    torsoDy > GRIP_MIN_TORSO_DY
  ) {
    // > 0 — кисти НИЖЕ плеч (Y растёт вниз), нормировано на длину торса
    const wristRel = (wristMid.y - shoulderMid.y) / torsoDy;
    const isDropBar = bike.bikeType === "road" || bike.bikeType === "gravel";
    if (isDropBar && wristRel < -GRIP_ROAD_ABOVE_TORSO) {
      gripType = {
        verdict: "fail",
        detail: `Кисти на ${(wristRel * 100).toFixed(0)}% торса ВЫШЕ плеч — не похоже на «пистолеты» (${bike.bikeType})`,
      };
      reasons.push(
        `Положение рук не соответствует типу «${bike.bikeType}»: кисти заметно выше плеч, как на прямом городском руле, а не на руле-«баране».`
      );
    } else if (!isDropBar && wristRel > GRIP_MTB_BELOW_TORSO) {
      gripType = {
        verdict: "fail",
        detail: `Кисти на ${(wristRel * 100).toFixed(0)}% торса НИЖЕ плеч — не похоже на прямой руль (${bike.bikeType})`,
      };
      reasons.push(
        `Положение рук не соответствует типу «${bike.bikeType}»: кисти сильно ниже плеч — это посадка под руль с drop (шоссе/гравий), не под прямой руль.`
      );
    } else {
      gripType = {
        verdict: "pass",
        detail: `Хват соответствует типу «${bike.bikeType}»`,
      };
    }
  } else {
    gripType = {
      verdict: "unknown",
      detail: "Тип хвата не сверен (нет позы/типа вела или торс не виден)",
    };
  }

  const factors: BikeMatchFactors = { proportions, frameColor, riderScale, gripType };
  const all = Object.values(factors);
  const failedCount = all.filter((f) => f.verdict === "fail").length;
  const evaluatedCount = all.filter((f) => f.verdict !== "unknown").length;

  let verdict: BikeMatchVerdict;
  if (failedCount >= 2 || proportions.verdict === "fail") {
    verdict = "block";
  } else if (failedCount === 1) {
    verdict = "warn";
  } else if (evaluatedCount > 0) {
    verdict = "ok";
  } else {
    verdict = "unknown";
  }

  return { verdict, failedCount, evaluatedCount, factors, reasons };
}
