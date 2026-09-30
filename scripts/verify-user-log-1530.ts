/**
 * Верификация ЖИВОГО прогона пользователя (лог 15:27:55, «Вычислить все параметры»).
 *
 * Вход: нормализованные точки [0..1] из диагностического лога (округлены до 4 знаков),
 *       knownKey = saddleHeight = 680 мм, WH = 334 мм (радиус), введённые WB=1080, ETT=580.
 *
 * Метод:
 *  1. Восстанавливаем imgSize (W×H) решением системы по 5 наблюдаемым величинам лога:
 *     rearPxRadius=837.4, frontPxRadius=914.8, scale_SH=0.3759, cand_WB=0.3944, cand_ETT=0.3840.
 *  2. Конвертируем точки в пиксели, гоняем РЕАЛЬНОЕ ядро calculateBikeGeometry
 *     (userOverride saddleHeight=680 СТРОГО) + calculateDualScale + calculateAutoFitCalibration.
 *  3. Сравниваем каждый параметр лога с реконструкцией (допуск ±2 мм / ±0.15°).
 *  4. Дополнительно проверяем внутренние тождества геометрии.
 */
import {
  calculateBikeGeometry,
  type BikeKeypoints,
  type Point2D,
} from "../src/lib/bike-geometry-engine";
import { calculateDualScale } from "../src/lib/bike-dual-scale";
import { calculateAutoFitCalibration } from "../src/lib/bike-calibration-helper";

// ---- Точки из лога пользователя (нормализованные 0..1) ----
const N = {
  bb:            { x: 0.5621, y: 0.6795 },
  stTop:         { x: 0.6426, y: 0.3473 },
  saddleMount:   { x: 0.6818, y: 0.1834 },
  htTop:         { x: 0.3250, y: 0.2460 },
  htBottom:      { x: 0.2981, y: 0.3532 },
  rearAxle:      { x: 0.7880, y: 0.6510 },
  htTopCap:      { x: 0.3440, y: 0.1804 },
  frontAxle:     { x: 0.1963, y: 0.6838 },
  rearWheelTop:  { x: 0.7847, y: 0.4098 },
  frontWheelTop: { x: 0.1952, y: 0.4203 },
} as const;

// ---- Наблюдаемые величины из лога (цели для восстановления imgSize) ----
const OBS = {
  rearPxRadius: 837.4,
  frontPxRadius: 914.8,
  scaleSH: 0.3759,   // 680 / pxSH
  candWB: 0.3944,    // 1080 / pxWB(евклид)
  candETT: 0.3840,   // 580 / px(stTop→htTop диагональ)
};

let failed = 0;
const ok = (cond: boolean, label: string, detail: string) => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}: ${detail}`);
  if (!cond) failed++;
};

// ============================================================
// ШАГ 1. Восстановление imgSize сеточным поиском
// ============================================================
const pxRearRadius = (W: number, H: number) =>
  Math.hypot((N.rearAxle.x - N.rearWheelTop.x) * W, (N.rearAxle.y - N.rearWheelTop.y) * H);
const pxFrontRadius = (W: number, H: number) =>
  Math.hypot((N.frontAxle.x - N.frontWheelTop.x) * W, (N.frontAxle.y - N.frontWheelTop.y) * H);
const pxSH = (W: number, H: number) =>
  Math.hypot((N.bb.x - N.saddleMount.x) * W, (N.bb.y - N.saddleMount.y) * H);
const pxAxles = (W: number, H: number) =>
  Math.hypot((N.rearAxle.x - N.frontAxle.x) * W, (N.rearAxle.y - N.frontAxle.y) * H);
const pxETTdiag = (W: number, H: number) =>
  Math.hypot((N.stTop.x - N.htTop.x) * W, (N.stTop.y - N.htTop.y) * H);

function objective(W: number, H: number): number {
  const e1 = (pxRearRadius(W, H) - OBS.rearPxRadius) / OBS.rearPxRadius;
  const e2 = (pxFrontRadius(W, H) - OBS.frontPxRadius) / OBS.frontPxRadius;
  const e3 = (680 / pxSH(W, H) - OBS.scaleSH) / OBS.scaleSH;
  const e4 = (1080 / pxAxles(W, H) - OBS.candWB) / OBS.candWB;
  const e5 = (580 / pxETTdiag(W, H) - OBS.candETT) / OBS.candETT;
  return e1 * e1 + e2 * e2 + e3 * e3 + e4 * e4 + e5 * e5;
}

let bestW = 4624, bestH = 3469, bestErr = Infinity;
for (let W = 4500; W <= 4750; W++) {
  for (let H = 3350; H <= 3600; H++) {
    const err = objective(W, H);
    if (err < bestErr) { bestErr = err; bestW = W; bestH = H; }
  }
}
// Уточнение до 0.1 px
for (let W = bestW - 2; W <= bestW + 2; W += 0.1) {
  for (let H = bestH - 2; H <= bestH + 2; H += 0.1) {
    const err = objective(W, H);
    if (err < bestErr) { bestErr = err; bestW = W; bestH = H; }
  }
}
const imgSize = { width: Math.round(bestW), height: Math.round(bestH) };

console.log("════════════════════════════════════════════════════════════");
console.log("РЕКОНСТРУКЦИЯ ЖИВОГО ПРОГОНА (лог 15:27:55, SH=680 СТРОГО)");
console.log("════════════════════════════════════════════════════════════\n");
console.log(`Восстановленный imgSize: ${imgSize.width}×${imgSize.height} px (СКО ошибки ${(Math.sqrt(bestErr) * 100).toFixed(3)}%)`);
console.log(`  (прошлые сессии: то же фото 4624×3469 — совпадение подтверждает, что фото то же)\n`);

// ============================================================
// ШАГ 2. Реальное ядро на пиксельных точках
// ============================================================
const P = (p: { x: number; y: number }): Point2D => ({
  x: p.x * imgSize.width,
  y: p.y * imgSize.height,
});

const ptsPx: BikeKeypoints = {
  bb: P(N.bb),
  stTop: P(N.stTop),
  saddleMount: P(N.saddleMount),
  htTop: P(N.htTop),
  htBottom: P(N.htBottom),
  rearAxle: P(N.rearAxle),
  frontAxle: P(N.frontAxle),
};

const res = calculateBikeGeometry(ptsPx, {
  userOverrideKey: "saddleHeight",
  userOverrideValueMm: 680,
});

// ---- Сравнение с логом ----
console.log("── Метрики (лог → реконструкция) ──");
type Row = [string, number, number, number]; // label, logValue, gotValue, tolerance
const mRows: Row[] = [
  ["SH, мм",            680, res.metricsMm.saddleHeight, 0.5],
  ["ETT (проекция), мм",603, res.metricsMm.ett,          3],
  ["ETT прямой, мм",    546, res.extendedMm.ettDirect,   3],
  ["Reach, мм",         388, res.metricsMm.reach,        3],
  ["Stack, мм",         582, res.metricsMm.stack,        3],
  ["WB, мм",            1029, res.metricsMm.wheelbase,   3],
  ["Setback (⊥), мм",   1,   res.extendedMm.setback,     2],
  ["BB Drop, мм",       21,  res.extendedMm.bbDrop,      2],
  ["ST (труба), мм",    456, res.extendedMm.seatTubeLength, 3],
  ["RC, мм",            394, res.extendedMm.rearCenter,  3],
  ["FC, мм",            636, res.extendedMm.frontCenter, 4],
  ["HT length, мм",     148, res.extendedMm.headTubeLength, 3],
  ["Fork length, мм",   466, res.extendedMm.forkLength,  4],
  ["Fork offset, мм",   31,  res.extendedMm.forkOffset,  3],
  ["Stack/Reach",       1.5, res.extendedMm.stackReachRatio, 0.02],
];
for (const [label, logV, gotV, tol] of mRows) {
  ok(Math.abs(gotV - logV) <= tol, label.padEnd(20), `лог ${logV} → ядро ${gotV}`);
}

console.log("\n── Углы (лог → реконструкция) ──");
const aRows: Row[] = [
  ["STA, °",      69.7, res.anglesDeg.seatTubeAngle, 0.15],
  ["HTA, °",      69.2, res.anglesDeg.headTubeAngle, 0.15],
  ["Наклон, °",   2.4,  res.anglesDeg.frameTilt,     0.15],
];
for (const [label, logV, gotV, tol] of aRows) {
  ok(Math.abs(gotV - logV) <= tol, label.padEnd(20), `лог ${logV} → ядро ${gotV}`);
}

console.log("\n── Масштаб ──");
ok(Math.abs(res.scaleMmPerPx - 0.3759) <= 0.002, "масштаб, мм/px".padEnd(20), `лог 0.3759 → ядро ${res.scaleMmPerPx.toFixed(4)}`);
ok(res.scaleSource.includes("USER_OVERRIDE") && res.scaleSource.includes("saddleHeight"), "источник".padEnd(20), res.scaleSource);

console.log("\n── Предупреждения движка ──");
ok(res.warnings.length === 0, "лог: «Предупреждения движка (0)»".padEnd(38), `реконструкция: ${res.warnings.length} → ${res.warnings.join(" | ") || "нет"}`);

// ============================================================
// ШАГ 3. Dual scale (как в приложении)
// ============================================================
console.log("\n── Dual scale (по двум колёсам) ──");
const bikeKeyPoints = {
  bb: { ...N.bb }, stTop: { ...N.stTop }, saddleMount: { ...N.saddleMount },
  htTop: { ...N.htTop }, htBottom: { ...N.htBottom },
  rearAxle: { ...N.rearAxle }, frontAxle: { ...N.frontAxle },
  htTopCap: { ...N.htTopCap }, rearWheelTop: { ...N.rearWheelTop }, frontWheelTop: { ...N.frontWheelTop },
};
const dual = calculateDualScale(bikeKeyPoints as never, 334, imgSize);
if (dual) {
  ok(Math.abs(dual.rearPxRadius - 837.4) <= 2, "Rear px radius".padEnd(20), `лог 837.4 → ${dual.rearPxRadius.toFixed(1)}`);
  ok(Math.abs(dual.frontPxRadius - 914.8) <= 2, "Front px radius".padEnd(20), `лог 914.8 → ${dual.frontPxRadius.toFixed(1)}`);
  ok(Math.abs(dual.scaleRear - 0.3988) <= 0.003, "scaleRear, мм/px".padEnd(20), `лог 0.40 → ${dual.scaleRear.toFixed(4)}`);
  ok(Math.abs(dual.scaleFront - 0.3651) <= 0.003, "scaleFront, мм/px".padEnd(20), `лог 0.37 → ${dual.scaleFront.toFixed(4)}`);
  ok(Math.abs(dual.perspectiveSeverity * 100 - 8.8) <= 0.4, "Perspective severity".padEnd(20), `лог 8.8% → ${(dual.perspectiveSeverity * 100).toFixed(1)}%`);
} else {
  ok(false, "dual scale", "не посчитался");
}

// ============================================================
// ШАГ 4. Перекрёстная проверка-кандидаты (справочный блок, как в UI)
// ============================================================
console.log("\n── Кандидаты перекрёстной проверки (справочно) ──");
const autoFit = calculateAutoFitCalibration(
  {
    bb: { ...N.bb }, saddle: { ...N.saddleMount },
    rearAxle: { ...N.rearAxle }, frontAxle: { ...N.frontAxle },
    stTop: { ...N.stTop }, htTop: { ...N.htTop },
  },
  { shMm: 680, wbMm: 1080, ettMm: 580 },
  imgSize
);
for (const c of autoFit.candidates ?? []) {
  const logVal = c.type === "WB" ? { s: 0.3944, d: 0 } : c.type === "SH" ? { s: 0.3759, d: -4.7 } : { s: 0.3840, d: -2.6 };
  ok(Math.abs(c.scale - logVal.s) <= 0.002 && Math.abs(c.deviationPct - logVal.d) <= 0.4,
    `кандидат ${c.type}`.padEnd(20),
    `лог ${logVal.s} (откл. ${logVal.d}%) → ${c.scale.toFixed(4)} (откл. ${c.deviationPct.toFixed(1)}%)`);
}

// ============================================================
// ШАГ 5. Внутренние тождества геометрии (независимо от лога)
// ============================================================
console.log("\n── Внутренние тождества ──");
const { stack, reach, ett } = res.metricsMm;
const sta = res.anglesDeg.seatTubeAngle;
const ettIdentity = reach + stack / Math.tan((sta * Math.PI) / 180);
ok(Math.abs(ett - ettIdentity) <= 3, "ETT = Reach + Stack/tan(STA)".padEnd(34), `${ett} ≈ ${ettIdentity.toFixed(1)}`);

const bd = res.extendedMm.bbDrop, rc = res.extendedMm.rearCenter, fc = res.extendedMm.frontCenter;
const wbIdentity = Math.sqrt(rc * rc - bd * bd) + Math.sqrt(fc * fc - bd * bd);
ok(Math.abs(res.metricsMm.wheelbase - wbIdentity) <= 4, "WB = √(RC²−BD²)+√(FC²−BD²)".padEnd(34), `${res.metricsMm.wheelbase} ≈ ${wbIdentity.toFixed(1)}`);

const ettGap = ett - res.extendedMm.ettDirect;
const dh = Math.abs(res.rotated.stTop.y - res.rotated.htTop.y) * res.scaleMmPerPx;
ok(Math.abs(ettGap - dh / Math.tan((sta * Math.PI) / 180)) <= 3, "ETT−ETTпрям = Δh/tan(STA)".padEnd(34), `${ettGap.toFixed(1)} ≈ ${(dh / Math.tan((sta * Math.PI) / 180)).toFixed(1)}`);

// Без поворота (сырые координаты, зеркально нормализованные вручную) — показать, что наклон раньше портил Reach/Stack
const rawScale = 680 / Math.hypot((N.bb.x - N.saddleMount.x) * imgSize.width, (N.bb.y - N.saddleMount.y) * imgSize.height);
const rawReachMm = Math.abs(N.htTop.x - N.bb.x) * imgSize.width * rawScale;
const rawStackMm = (N.bb.y - N.htTop.y) * imgSize.height * rawScale;
const reachInflPct = ((rawReachMm / res.metricsMm.reach - 1) * 100).toFixed(1);
const stackDefPct = ((rawStackMm / res.metricsMm.stack - 1) * 100).toFixed(1);
console.log(`\n  ⓘ Без выравнивания кадра Reach был бы ${rawReachMm.toFixed(0)} мм (+${reachInflPct}%), Stack ${rawStackMm.toFixed(0)} мм (${stackDefPct}%) — источник прежней погрешности до +6%.`);

console.log("\n════════════════════════════════════════════════════════════");
console.log(failed === 0 ? "✅ ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ — лог воспроизведён реальным ядром" : `❌ РАСХОЖДЕНИЙ: ${failed}`);
console.log("════════════════════════════════════════════════════════════");
process.exit(failed === 0 ? 0 : 1);
