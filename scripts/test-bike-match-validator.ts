/**
 * Юнит-тест v1.14.43: Multi-Factor Bike Match Validator («защита от дурака»).
 * Проверяет 4 фактора (пропорции / цвет рамы / масштаб посадки / хват),
 * вердикты ok / warn / block / unknown и граничные случаи.
 * Запуск: npx tsx scripts/test-bike-match-validator.ts
 */
import {
  euclidColorDiff,
  medianRgbFromPixels,
  estimateTriangleSamplePoint,
  computeTopTubeSlopeDeg,
  extractRiderPoseSignals,
  validateBikeMatch,
  kneeAngleDeg,
  standingKneeAngle,
  KNEE_STANDING_DEG,
  FRAME_COLOR_DIFF_THRESHOLD,
  RIDER_SCALE_TOLERANCE,
  type Rgb,
  type RiderWheelMeta,
  type BikeCardSignals,
  type RiderPoseSignals,
} from "../src/lib/bike-match-validator";
import type { Point } from "../src/lib/bike-fit";

let ok = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    ok++;
    console.log(`  OK   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function near(a: number, b: number, eps: number): boolean {
  return Math.abs(a - b) <= eps;
}

// ---------------------------------------------------------------------------
// 1. euclidColorDiff
// ---------------------------------------------------------------------------
console.log("\n[1] euclidColorDiff");
check("чёрный vs белый = 441.67", near(euclidColorDiff({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }), 441.67, 0.01));
check("одинаковые = 0", euclidColorDiff({ r: 100, g: 120, b: 130 }, { r: 100, g: 120, b: 130 }) === 0);
check("серые 100 vs 150 = 86.6", near(euclidColorDiff({ r: 100, g: 100, b: 100 }, { r: 150, g: 150, b: 150 }), 86.6, 0.1));
check("порог 90 различает белый/чёрный", euclidColorDiff({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }) > FRAME_COLOR_DIFF_THRESHOLD);

// ---------------------------------------------------------------------------
// 2. medianRgbFromPixels — устойчивость к выбросам
// ---------------------------------------------------------------------------
console.log("\n[2] medianRgbFromPixels");
check("пустой → null", medianRgbFromPixels(new Uint8ClampedArray(0)) === null);
check("не кратный 4 → null", medianRgbFromPixels(new Uint8ClampedArray(7)) === null);
check("3 пикселя → null", medianRgbFromPixels(new Uint8ClampedArray(12)) === null);
{
  // 4 красных + 5 синих пикселей → медиана синяя (выброс не тянет среднее)
  const px: number[] = [];
  for (let i = 0; i < 4; i++) px.push(255, 0, 0, 255);
  for (let i = 0; i < 5; i++) px.push(10, 20, 200, 255);
  const m = medianRgbFromPixels(px);
  check("медиана не затянута выбросом", !!m && m.r === 10 && m.g === 20 && m.b === 200, JSON.stringify(m));
}
{
  // чётное количество — среднее двух средних
  const m = medianRgbFromPixels([0, 0, 0, 255, 10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255]);
  check("чётное количество → среднее средних", !!m && m.r === 15 && m.g === 15 && m.b === 15, JSON.stringify(m));
}

// ---------------------------------------------------------------------------
// 3. estimateTriangleSamplePoint
// ---------------------------------------------------------------------------
console.log("\n[3] estimateTriangleSamplePoint");
{
  const sp = estimateTriangleSamplePoint(0.5, 0.7, 0.25);
  check("точка над осями на 0.42 R", !!sp && near(sp.ny, 0.7 - 0.42 * 0.25, 1e-9) && near(sp.nx, 0.5, 1e-9), JSON.stringify(sp));
  check("полуокно 0.16 R", !!sp && near(sp.halfNorm, 0.16 * 0.25, 1e-9));
}
check("нулевой радиус → null", estimateTriangleSamplePoint(0.5, 0.7, 0.004) === null);
check("NaN → null", estimateTriangleSamplePoint(NaN, 0.7, 0.25) === null);

// ---------------------------------------------------------------------------
// 4. computeTopTubeSlopeDeg
// ---------------------------------------------------------------------------
console.log("\n[4] computeTopTubeSlopeDeg");
check("горизонтальная труба → 0°", computeTopTubeSlopeDeg({ x: 0.3, y: 0.5 }, { x: 0.6, y: 0.5 }, 1000, 750) === 0);
{
  // dy = 0.1×750 = 75 вверх, dx = 0.3×1000 = 300 → atan2(75, 300) ≈ 14.04°
  const a = computeTopTubeSlopeDeg({ x: 0.3, y: 0.5 }, { x: 0.6, y: 0.4 }, 1000, 750);
  check("sloping вверх ≈ 14°", a != null && near(a, 14.036, 0.05), String(a));
}
check("вертикальная труба (dx≈0) → null", computeTopTubeSlopeDeg({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.4 }, 1000, 750) === null);
check("нет точки → null", computeTopTubeSlopeDeg(null, { x: 0.6, y: 0.4 }, 1000, 750) === null);

// ---------------------------------------------------------------------------
// 5. extractRiderPoseSignals
// ---------------------------------------------------------------------------
console.log("\n[5] extractRiderPoseSignals");
check("пустые landmarks → все null", (() => {
  const s = extractRiderPoseSignals(null);
  return s.hipMid === null && s.shoulderMid === null && s.wristMid === null && s.kneeMid === null && s.ankleMid === null;
})());
{
  const lm: Point[] = [];
  lm[23] = { x: 0.40, y: 0.55, visibility: 0.9 };
  lm[24] = { x: 0.44, y: 0.57, visibility: 0.2 }; // слабая — игнор
  const s = extractRiderPoseSignals(lm);
  check("только сильная HIP → её координаты", !!s.hipMid && near(s.hipMid.x, 0.40, 1e-9) && near(s.hipMid.y, 0.55, 1e-9), JSON.stringify(s.hipMid));
}
{
  const lm: Point[] = [];
  lm[23] = { x: 0.40, y: 0.55, visibility: 0.9 };
  lm[24] = { x: 0.44, y: 0.57, visibility: 0.8 };
  lm[11] = { x: 0.42, y: 0.30, visibility: 0.9 };
  lm[12] = { x: 0.46, y: 0.31, visibility: 0.9 };
  lm[15] = { x: 0.60, y: 0.32, visibility: 0.9 };
  lm[16] = { x: 0.61, y: 0.33, visibility: 0.9 };
  lm[25] = { x: 0.43, y: 0.65, visibility: 0.9 };
  lm[26] = { x: 0.45, y: 0.66, visibility: 0.9 };
  lm[27] = { x: 0.44, y: 0.80, visibility: 0.9 };
  lm[28] = { x: 0.46, y: 0.81, visibility: 0.9 };
  const s = extractRiderPoseSignals(lm);
  check("обе HIP видны → midpoint", !!s.hipMid && near(s.hipMid.x, 0.42, 1e-9) && near(s.hipMid.y, 0.56, 1e-9));
  check("shoulderMid посчитан", !!s.shoulderMid && near(s.shoulderMid.y, 0.305, 1e-9));
  check("wristMid посчитан", !!s.wristMid && near(s.wristMid.y, 0.325, 1e-9));
  check("kneeMid посчитан (v1.14.44)", !!s.kneeMid && near(s.kneeMid.x, 0.44, 1e-9));
  check("ankleMid посчитан (v1.14.44)", !!s.ankleMid && near(s.ankleMid.y, 0.805, 1e-9));
}

// ---------------------------------------------------------------------------
// 5b. kneeAngleDeg + гейт «стоит над рамой» (v1.14.44)
// ---------------------------------------------------------------------------
console.log("\n[5b] kneeAngleDeg");
{
  // Прямой угол: hip (0,−1) knee (0,0) ankle (1,0) → 90°
  const a = kneeAngleDeg({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 1, y: 0 });
  check("прямой угол = 90°", a != null && near(a, 90, 1e-6), String(a));
  // Прямая нога: все три на одной вертикали → 180°
  const b = kneeAngleDeg({ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.8 });
  check("прямая нога = 180°", b != null && near(b, 180, 1e-6), String(b));
  // Пропущенные точки → null
  check("нет колена → null", kneeAngleDeg({ x: 0, y: 0 }, null, { x: 1, y: 1 }) === null);
  check("совпадающие точки → null", kneeAngleDeg({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }) === null);
  check("порог KNEE_STANDING_DEG = 150", KNEE_STANDING_DEG === 150);
  // Сидящий (колено ≈ 120°) → не стоящий
  const seated: RiderPoseSignals = {
    hipMid: { x: 0.4, y: 0.294 },
    shoulderMid: { x: 0.44, y: 0.1 },
    wristMid: { x: 0.6, y: 0.13 },
    kneeMid: { x: 0.55, y: 0.5 },
    ankleMid: { x: 0.45, y: 0.75 },
  };
  const seatedAng = standingKneeAngle(seated);
  check("сидящий: колено < порога", seatedAng != null && seatedAng < KNEE_STANDING_DEG, String(seatedAng));
  // Стоящий над рамой (нога прямая) → ≥ порога
  const standing: RiderPoseSignals = {
    ...seated,
    hipMid: { x: 0.4, y: 0.35 },
    kneeMid: { x: 0.47, y: 0.55 },
    ankleMid: { x: 0.53, y: 0.75 },
  };
  const standingAng = standingKneeAngle(standing);
  check("стоящий: колено ≥ порога", standingAng != null && standingAng >= KNEE_STANDING_DEG, String(standingAng));
}

// ---------------------------------------------------------------------------
// 6. validateBikeMatch — вердикты
// ---------------------------------------------------------------------------
console.log("\n[6] validateBikeMatch — базовые вердикты");
const WHITE: Rgb = { r: 235, g: 235, b: 230 };
const riderMeta: RiderWheelMeta = {
  axleMidXn: 0.5,
  axleMidYn: 0.7,
  radiusNormY: 0.28,
  frameColorRgb: { r: 245, g: 240, b: 235 },
};

const baseBike: BikeCardSignals = {
  wheelRatio: 1.45,
  bbColorRgb: WHITE,
  saddleYn: 0.35,
  axleMidYn: 0.75,
  radiusNormY: 0.25,
  bikeType: "road",
};
const uprightPose = {
  hipMid: { x: 0.42, y: 0.294 }, // rScale = (0.7-0.294)/0.28 = 1.45 ≈ bScale 1.6? см. ниже
  shoulderMid: { x: 0.44, y: 0.10 },
  wristMid: { x: 0.60, y: 0.13 }, // кисти ниже плеч слегка (road pass)
kneeMid: null, ankleMid: null, };
// пересчёт hip для pass: bScale = (0.75-0.35)/0.25 = 1.6;
// diff = |r - b|/avg ≤ 0.25 → r ∈ [1.28, 2.0]; r = (0.7-hipY)/0.28
// hipY = 0.7 - 1.45*0.28 = 0.294 → r=1.45, diff=0.098 → pass ✓

{
  const v = validateBikeMatch({ wheelRatio: 1.45, wheelMeta: riderMeta, pose: uprightPose, bike: baseBike });
  check("полное совпадение → ok", v.verdict === "ok", v.verdict);
  check("все 4 фактора оценены", v.evaluatedCount === 4 && v.failedCount === 0);
}

{
  // F1 хард-блок: расхождение пропорций 15.9% → block, даже когда прочие pass
  const v = validateBikeMatch({ wheelRatio: 1.70, wheelMeta: riderMeta, pose: uprightPose, bike: baseBike });
  check("F1 mismatch → block (хард-блок)", v.verdict === "block", v.verdict);
  check("reason упоминает пропорции", v.reasons.some((r) => /пропорц/i.test(r)));
}

{
  // 2+ провала → block: цвет сломан + масштаб сломан, F1 unknown
  const badColorMeta: RiderWheelMeta = { ...riderMeta, frameColorRgb: { r: 20, g: 20, b: 25 } };
  const lowHipPose = { ...uprightPose, hipMid: { x: 0.42, y: 0.60 } }; // rScale = 0.357 → diff 0.77 fail
  const v = validateBikeMatch({
    wheelRatio: null,
    wheelMeta: badColorMeta,
    pose: lowHipPose,
    bike: { ...baseBike, wheelRatio: null },
  });
  check("F2+F3 fail → block", v.verdict === "block", `${v.verdict} failed=${v.failedCount}`);
  check("failedCount = 2", v.failedCount === 2);
  check("2 reason в списке", v.reasons.length === 2);
}

{
  // 1 провал → warn: только цвет
  const badColorMeta: RiderWheelMeta = { ...riderMeta, frameColorRgb: { r: 20, g: 20, b: 25 } };
  const v = validateBikeMatch({
    wheelRatio: 1.45,
    wheelMeta: badColorMeta,
    pose: uprightPose,
    bike: { ...baseBike, bbColorRgb: WHITE },
  });
  check("только F2 fail → warn", v.verdict === "warn", v.verdict);
  check("reason про цвет", v.reasons.some((r) => /цвет/i.test(r)));
}

{
  // все unknown → unknown
  const v = validateBikeMatch({
    wheelRatio: null,
    wheelMeta: null,
    pose: { hipMid: null, shoulderMid: null, wristMid: null, kneeMid: null, ankleMid: null },
    bike: { ...baseBike, wheelRatio: null, bbColorRgb: null, saddleYn: null, bikeType: null },
  });
  check("ничего не оценено → unknown", v.verdict === "unknown", v.verdict);
  check("evaluatedCount = 0", v.evaluatedCount === 0);
}

{
  // только F1 доступен и pass → ok с evaluatedCount=1
  const v = validateBikeMatch({
    wheelRatio: 1.44,
    wheelMeta: null,
    pose: { hipMid: null, shoulderMid: null, wristMid: null, kneeMid: null, ankleMid: null },
    bike: { ...baseBike, bbColorRgb: null, saddleYn: null, bikeType: null },
  });
  check("только F1 pass → ok", v.verdict === "ok", v.verdict);
  check("evaluatedCount = 1", v.evaluatedCount === 1);
}

// ---------------------------------------------------------------------------
// 7. F4 gripType — тип вела против позы рук
// ---------------------------------------------------------------------------
console.log("\n[7] F4 gripType");
{
  // road, кисти ЯВНО выше плеч (wristRel ≈ -0.16) → fail.
  // ВАЖНО: hip согласован с F3 (rScale=1.45 → diff 0.098 → pass),
  // чтобы единственный провал был именно F4
  const pose = {
    hipMid: { x: 0.42, y: 0.294 },
    shoulderMid: { x: 0.44, y: 0.05 },
    wristMid: { x: 0.60, y: 0.011 }, // wristRel = (0.011-0.05)/0.244 = -0.16
  kneeMid: null, ankleMid: null, };
  const v = validateBikeMatch({ wheelRatio: 1.45, wheelMeta: riderMeta, pose, bike: { ...baseBike, bikeType: "road" } });
  check("road + кисти выше плеч → fail", v.factors.gripType.verdict === "fail", JSON.stringify(v.factors.gripType));
  check("F3 при этом pass", v.factors.riderScale.verdict === "pass", JSON.stringify(v.factors.riderScale));
  check("reason про хват", v.reasons.some((r) => /рук/i.test(r)));
  // при F2/F3 pass и F4 fail → warn (1 провал)
  check("единственный F4 fail → warn", v.verdict === "warn", v.verdict);
}
{
  // mtb, кисти сильно ниже плеч (wristRel = 0.6 > 0.5) → fail
  const pose = {
    hipMid: { x: 0.42, y: 0.55 },
    shoulderMid: { x: 0.44, y: 0.30 },
    wristMid: { x: 0.60, y: 0.45 },
  kneeMid: null, ankleMid: null, };
  const v = validateBikeMatch({ wheelRatio: 1.45, wheelMeta: riderMeta, pose, bike: { ...baseBike, bikeType: "mtb" } });
  check("mtb + кисти на пол-торса ниже → fail", v.factors.gripType.verdict === "fail", JSON.stringify(v.factors.gripType));
}
{
  // mtb, кисти на уровне плеч → pass
  const pose = {
    hipMid: { x: 0.42, y: 0.55 },
    shoulderMid: { x: 0.44, y: 0.30 },
    wristMid: { x: 0.60, y: 0.32 },
  kneeMid: null, ankleMid: null, };
  const v = validateBikeMatch({ wheelRatio: 1.45, wheelMeta: riderMeta, pose, bike: { ...baseBike, bikeType: "mtb" } });
  check("mtb + хват на уровне → pass", v.factors.gripType.verdict === "pass", JSON.stringify(v.factors.gripType));
}
{
  // короткий торс → unknown (не интерпретируем)
  const pose = {
    hipMid: { x: 0.42, y: 0.31 },
    shoulderMid: { x: 0.44, y: 0.30 },
    wristMid: { x: 0.60, y: 0.45 },
  kneeMid: null, ankleMid: null, };
  const v = validateBikeMatch({ wheelRatio: 1.45, wheelMeta: riderMeta, pose, bike: baseBike });
  check("торс 0.01 → F4 unknown", v.factors.gripType.verdict === "unknown");
}

// ---------------------------------------------------------------------------
// 8. F3 riderScale — граничные случаи
// ---------------------------------------------------------------------------
console.log("\n[8] F3 riderScale");
{
  // таз ниже осей (вырожденный кадр) → unknown
  const pose = { ...uprightPose, hipMid: { x: 0.42, y: 0.85 } };
  const v = validateBikeMatch({ wheelRatio: 1.45, wheelMeta: riderMeta, pose, bike: baseBike });
  check("таз ниже осей → F3 unknown", v.factors.riderScale.verdict === "unknown", JSON.stringify(v.factors.riderScale));
}
{
  // точные границы допуска: diff = |r-b|/((r+b)/2), b = 1.6
  // r = 2.036 → diff = 0.24 → pass; r = 1.22 → diff = 0.270 → fail
  const hipPass = 0.7 - 2.036 * 0.28; // rScale = 2.036
  const v1 = validateBikeMatch({ wheelRatio: 1.45, wheelMeta: riderMeta, pose: { ...uprightPose, hipMid: { x: 0.42, y: hipPass } }, bike: baseBike });
  check("diff 24% → pass (граница допуска)", v1.factors.riderScale.verdict === "pass", `diff≈0.24 got ${JSON.stringify(v1.factors.riderScale)}`);
  const hipFail = 0.7 - 1.22 * 0.28; // rScale = 1.22 → diff 0.270
  const v2 = validateBikeMatch({ wheelRatio: 1.45, wheelMeta: riderMeta, pose: { ...uprightPose, hipMid: { x: 0.42, y: hipFail } }, bike: baseBike });
  check("diff 27% → fail", v2.factors.riderScale.verdict === "fail", `diff≈0.27 got ${JSON.stringify(v2.factors.riderScale)}`);
}
check("константа допуска = 0.25", RIDER_SCALE_TOLERANCE === 0.25);

console.log(`\n=== ИТОГО: ${ok} OK / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
