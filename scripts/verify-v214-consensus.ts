/**
 * Верификация v1.14.0: консенсус-масштаб + физические гейты.
 *
 * Кейс A — ТОЧНО данные пользователя из debug-лога v1.13.5
 *   (bb поставлена у верха фото, SH=690 как primary, ETT=580, WB=1080, WH=334,
 *   фото 1200×901, bikeType mtb). Ожидания v2.1:
 *   - масштаб = консенсус-медиана ≈ 1.51 мм/px (НЕ 2.13 по сломанному SH);
 *   - SH-override ОТВЕРГНУТ с предупреждением;
 *   - WB по фото ≈ 1072 мм (было 1511!), ETT прямой ≈ 560 мм (было 790);
 *   - физические нарушения: bb выше седла, bb выше осей, руль ниже каретки.
 *
 * Кейс B — та же фотография, но bb/stTop/saddle на местах (санитарный):
 *   - строгий override SH сохраняется (консенсус подтверждает);
 *   - физические нарушения = 0; Reach/Stack/STA правдоподобны.
 */
import {
  calculateBikeGeometry,
  type BikeKeypoints,
  type CalibrationConfig,
} from "../src/lib/bike-geometry-engine";

const W = 1200;
const H = 901;

// Нормализованные точки из лога пользователя → пиксели
const n = (x: number, y: number) => ({ x: x * W, y: y * H });

// ---- КЕЙС A: данные пользователя 1:1 из debug-лога ----
const ptsA: BikeKeypoints = {
  bb: n(0.4156, 0.0866),
  stTop: n(0.6359, 0.3530),
  saddleMount: n(0.6762, 0.1802),
  htTop: n(0.3227, 0.2445),
  htBottom: n(0.2970, 0.3488),
  rearAxle: n(0.7847, 0.6554),
  frontAxle: n(0.1941, 0.6912),
};

// Радиусы колёс (как их считает UI для dual scale/консенсуса)
const frontPxR = Math.hypot(
  (0.1863 - 0.1941) * W,
  (0.4232 - 0.6912) * H
);
const rearPxR = Math.hypot(
  (0.7858 - 0.7847) * W,
  (0.4084 - 0.6554) * H
);

const cfgA: CalibrationConfig = {
  userOverrideKey: "saddleHeight",
  userOverrideValueMm: 690,
  fallbackWheelbaseMm: 1080,
  extraMeasurements: { saddleHeight: 690, ett: 580, wheelbase: 1080 },
  auxScaleCandidates: [
    { key: "wheelFront", label: "радиус переднего колеса", valueMm: 334, px: frontPxR, suspectPoints: "точки frontWheelTop/frontAxle" },
    { key: "wheelRear", label: "радиус заднего колеса", valueMm: 334, px: rearPxR, suspectPoints: "точки rearWheelTop/rearAxle" },
  ],
};

let failed = 0;
function check(name: string, cond: boolean, detail: string) {
  if (!cond) failed++;
  console.log(`${cond ? "✓" : "❌"} ${name} — ${detail}`);
}

console.log("════ КЕЙС A: мусорная разметка пользователя (bb у верха фото) ════\n");
const A = calculateBikeGeometry(ptsA, cfgA);

console.log(`Масштаб: ${A.scaleMmPerPx.toFixed(4)} мм/px`);
console.log(`Источник: ${A.scaleSource}\n`);

check("Масштаб ≠ сломанному SH (не 2.13)", A.scaleMmPerPx < 1.7, `${A.scaleMmPerPx.toFixed(3)} — консенсус, а не выброс SH`);
check("Источник = CONSENSUS", A.scaleSource.startsWith("CONSENSUS"), A.scaleSource.slice(0, 80));
check("SH-override отвергнут", A.warnings.some((w) => w.includes("ОТВЕРГНУТ") && w.includes("высота седла")), "есть громкое предупреждение");
check("WB по фото ≈ 1072 (было 1511)", Math.abs(A.metricsMm.wheelbase - 1072) <= 15, `${A.metricsMm.wheelbase} мм`);
check("ETT прямой ≈ 560 (было 790)", Math.abs(A.extendedMm.ettDirect - 560) <= 15, `${A.extendedMm.ettDirect} мм`);
check("Stack/Reach = null (был 0)", A.extendedMm.stackReachRatio === null, String(A.extendedMm.stackReachRatio));

const titles = A.physicsViolations.map((v) => v.title).join(" | ");
console.log(`\nФизические нарушения (${A.physicsViolations.length}):`);
for (const v of A.physicsViolations) console.log(`  ❌ [${v.point}] ${v.title}`);
check("bb выше седла поймано", titles.includes("ВЫШЕ седла"), "гейт сработал");
check("bb выше осей поймано", titles.includes("ВЫШЕ оси колёс"), "гейт сработал");
check("руль ниже каретки (Stack<0) поймано", titles.includes("НИЖЕ каретки"), "гейт сработал");
check("есть кнопка-подсказка для bb", A.physicsViolations.some((v) => v.point === "bb"), "point=bb");

// ---- КЕЙС B: та же сцена, точки на местах (ось колёс горизонтальна — без поворота) ----
console.log("\n════ КЕЙС B: санитарный (bb/stTop/sedло на местах) ════\n");
const ptsB: BikeKeypoints = {
  // bb: RC≈430 мм → 287 px от задней оси, BB Drop 40 мм → 26.5 px ниже
  bb: { x: 941.6 - 287, y: 600 + 26.5 },
  // stTop: STA 75°, труба 450 мм (300 px) вверх
  stTop: { x: 941.6 - 287 + 80, y: 600 + 26.5 - 300 },
  // saddleMount: SH ≈ 690 мм (460 px) вдоль трубы (STA 75°)
  saddleMount: { x: 941.6 - 287 + 119, y: 600 + 26.5 - 444 },
  // htTop: Reach 440 мм (291 px), Stack 600 мм (397 px)
  htTop: { x: 941.6 - 287 - 291, y: 600 + 26.5 - 397 },
  // htBottom: HTA 67°, стакан 180 мм (120 px) вниз с наклоном вперёд
  htBottom: { x: 941.6 - 287 - 291 - 51, y: 600 + 26.5 - 397 + 120 },
  rearAxle: { x: 941.6, y: 600 },
  frontAxle: { x: 232.9, y: 600 },
};
const cfgB: CalibrationConfig = {
  userOverrideKey: "saddleHeight",
  userOverrideValueMm: 690,
  fallbackWheelbaseMm: 1080,
  extraMeasurements: { saddleHeight: 690, ett: 555, wheelbase: 1080 },
  auxScaleCandidates: [
    { key: "wheelFront", label: "радиус переднего колеса", valueMm: 334, px: 241.6 },
    { key: "wheelRear", label: "радиус заднего колеса", valueMm: 334, px: 222.6 },
  ],
};
const B = calculateBikeGeometry(ptsB, cfgB);
console.log(`Масштаб: ${B.scaleMmPerPx.toFixed(4)} мм/px (${B.scaleSource.slice(0, 60)})`);
console.log(`Reach=${B.metricsMm.reach} Stack=${B.metricsMm.stack} WB=${B.metricsMm.wheelbase} STA=${B.anglesDeg.seatTubeAngle}° HTA=${B.anglesDeg.headTubeAngle}°`);

check("Строгий override сохранён", B.scaleSource.startsWith("USER_OVERRIDE"), B.scaleSource.slice(0, 70));
check("Физических нарушений нет", B.physicsViolations.length === 0, `${B.physicsViolations.length}`);
check("Reach правдоподобен", Math.abs(B.metricsMm.reach - 437) <= 15, `${B.metricsMm.reach} мм`);
check("Stack правдоподобен", Math.abs(B.metricsMm.stack - 596) <= 15, `${B.metricsMm.stack} мм`);
check("STA правдоподобен", Math.abs(B.anglesDeg.seatTubeAngle - 75) <= 2, `${B.anglesDeg.seatTubeAngle}°`);
check("Stack/Reach посчитан", B.extendedMm.stackReachRatio !== null && Math.abs(B.extendedMm.stackReachRatio - 1.36) < 0.06, String(B.extendedMm.stackReachRatio));

console.log(`\n${failed === 0 ? "✅ ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" : `❌ ПРОВАЛЕНО: ${failed}`}`);
process.exit(failed === 0 ? 0 : 1);
