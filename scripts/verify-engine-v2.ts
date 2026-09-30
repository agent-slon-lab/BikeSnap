/**
 * Верификация ЯДРА v2 (bike-geometry-engine) на точках из реального лога
 * ручной разметки 09:56 (MTB, SH=680 / ETT=580 / WB=1080, imgSize 4624x3469).
 *
 * Проверяем три жёстких правила ТЗ:
 * 1. STRICT SCALE HIERARCHY: userOverride SH=680 → SH ровно 680 (не 706),
 *    переключения на авто-WB нет. Без override → fallback WB=1080.
 * 2. ISOLATED ROTATION FIRST: наклон оси колёс применён ДО расчётов.
 * 3. Bike-only: 7 точек, никаких телодвижений.
 *
 * Регрессия: в FALLBACK-режиме числа должны совпасть со старым логом
 * (SH=706, ETT=613, Reach=430, Stack=594, WB=1079) — движок не ломает
 * старый кейс, а в OVERRIDE-режиме даёт честный расчёт по SH.
 */
import {
  calculateBikeGeometry,
  type BikeKeypoints,
} from "../src/lib/bike-geometry-engine";

// Точки из лога (нормализованные 0..1), imgSize восстановлен ранее: 4624x3469
const W = 4624, H = 3469;
const pts = {
  bb: { x: 0.5621, y: 0.6810 },
  stTop: { x: 0.6393, y: 0.3473 },
  saddleMount: { x: 0.6795, y: 0.1864 },
  htTop: { x: 0.3250, y: 0.2445 },
  htBottom: { x: 0.2992, y: 0.3517 },
  rearAxle: { x: 0.7835, y: 0.6599 },
  frontAxle: { x: 0.1885, y: 0.6867 },
};

const toPx = (p: { x: number; y: number }) => ({ x: p.x * W, y: p.y * H });
const px: BikeKeypoints = {
  bb: toPx(pts.bb),
  stTop: toPx(pts.stTop),
  saddleMount: toPx(pts.saddleMount),
  htTop: toPx(pts.htTop),
  htBottom: toPx(pts.htBottom),
  rearAxle: toPx(pts.rearAxle),
  frontAxle: toPx(pts.frontAxle),
};

let failed = 0;
function check(name: string, got: number, want: number, tol: number) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failed++;
  console.log(
    `  ${ok ? "✓" : "✗ ПРОВАЛ"} ${name.padEnd(28)} = ${got.toFixed(1)}  (ожидалось ≈ ${want}, ±${tol})`
  );
}

console.log(`\n========== ТЕСТ 1: FALLBACK (нет override) → WB=1080 ==========`);
const r1 = calculateBikeGeometry(px, { fallbackWheelbaseMm: 1080 });
console.log(`  scaleSource: ${r1.scaleSource}`);
console.log(`  Наклон оси: ${r1.anglesDeg.frameTilt}° (физически: передняя ось ниже на ~93px/2750px ≈ 1.9°)`);
check("scale (мм/пикс)", r1.scaleMmPerPx, 0.3923, 0.001);
check("SH (лог: 706, поворот-инвариантен)", r1.metricsMm.saddleHeight, 706, 3);
// Проекции в ВЫРОВНЕННОЙ системе отличаются от старого лога (430/594/613/72.9/72.3/570),
// который считался БЕЗ поворота. Разница ≈ tilt 1.9-2.0° — это и есть фикс
// «Isolated Rotation First». Ручная проверка:
//   Stack = 1549.6px × 0.39255 = 608   (старый 594 = вертикаль в заваленном кадре)
//   Reach = 1044.8px × 0.39255 = 410   (старый 430)
//   STA/HTA = сырой угол − tilt: 72.9−2.0 = 70.9; 72.3−2.0 = 70.3
check("ETT (выровненная система)", r1.metricsMm.ett, 620, 3);
check("Reach (выровненная система)", r1.metricsMm.reach, 410, 3);
check("Stack (выровненная система)", r1.metricsMm.stack, 608, 3);
check("WB (лог: 1079)", r1.metricsMm.wheelbase, 1080, 3);
check("STA (лог 72.9 − tilt 2.0)", r1.anglesDeg.seatTubeAngle, 70.9, 0.5);
check("HTA (лог 72.3 − tilt 2.0)", r1.anglesDeg.headTubeAngle, 70.3, 0.5);
check("ettDirect (выровненная)", r1.extendedMm.ettDirect, 565, 3);
// Внутренняя согласованность определений: ETT = Reach + Stack / tan(STA)
const ettFromFormula = r1.metricsMm.reach + r1.metricsMm.stack / Math.tan((r1.anglesDeg.seatTubeAngle * Math.PI) / 180);
check("ETT = Reach + Stack/tan(STA)", ettFromFormula, r1.metricsMm.ett, 3);
if (r1.metricsMm.stack <= 0 || r1.metricsMm.reach <= 0) {
  failed++;
  console.log(`  ✗ ПРОВАЛ: велосипед «перевёрнут» — нормализация направления сломана`);
} else {
  console.log(`  ✓ Направление нормализовано (Stack/Reach положительные, фото «смотрит влево»)`);
}

console.log(`\n========== ТЕСТ 2: STRICT userOverride SH=680 ==========`);
const r2 = calculateBikeGeometry(px, {
  userOverrideKey: "saddleHeight",
  userOverrideValueMm: 680,
  fallbackWheelbaseMm: 1080,
});
console.log(`  scaleSource: ${r2.scaleSource}`);
if (!r2.scaleSource.includes("USER_OVERRIDE")) {
  failed++;
  console.log(`  ✗ ПРОВАЛ: override не применился строго!`);
} else {
  console.log(`  ✓ Override СТРОГО: переключения на авто-WB нет`);
}
check("SH = ровно 680", r2.metricsMm.saddleHeight, 680, 0.5);
// scale_SH = 680 / dist(bb→saddleMount). WB/ETT/Reach/Stack масштабируются этим масштабом.
const dSHpx = Math.hypot(
  (0.6795 - 0.5621) * W,
  (0.1864 - 0.6810) * H
);
const scaleSH = 680 / dSHpx;
check("scale = 680/pxSH", scaleSH, r2.scaleMmPerPx, 0.001);
check("WB (пропорц. 1079×680/706)", (r1.metricsMm.wheelbase * 680) / r1.metricsMm.saddleHeight, r2.metricsMm.wheelbase, 4);
check("ETT (пропорц. 613×680/706)", (r1.metricsMm.ett * 680) / r1.metricsMm.saddleHeight, r2.metricsMm.ett, 4);
check("Reach (пропорц.)", (r1.metricsMm.reach * 680) / r1.metricsMm.saddleHeight, r2.metricsMm.reach, 4);
check("Stack (пропорц.)", (r1.metricsMm.stack * 680) / r1.metricsMm.saddleHeight, r2.metricsMm.stack, 4);
const hasCrossWarning = r2.warnings.some((w) => w.includes("расходятся"));
console.log(
  `  ${hasCrossWarning ? "✓" : "ℹ"} Перекрёстная проверка SH↔WB: ${hasCrossWarning ? "есть warning" : "без warning (расхождение < 5%)"}`
);
console.log(`  Все warnings (${r2.warnings.length}):`);
for (const w of r2.warnings) console.log(`    ⚠ ${w}`);

console.log(`\n========== ТЕСТ 3: STRICT userOverride WB=1080 ==========`);
const r3 = calculateBikeGeometry(px, {
  userOverrideKey: "wheelbase",
  userOverrideValueMm: 1080,
  fallbackWheelbaseMm: 1080,
});
console.log(`  scaleSource: ${r3.scaleSource}`);
check("WB = ровно 1080", r3.metricsMm.wheelbase, 1080, 0.5);
check("SH (лог: 706)", r3.metricsMm.saddleHeight, 706, 3);

console.log(`\n========== ТЕСТ 4: STRICT userOverride ETT=580 ==========`);
const r4 = calculateBikeGeometry(px, {
  userOverrideKey: "ett",
  userOverrideValueMm: 580,
  fallbackWheelbaseMm: 1080,
});
console.log(`  scaleSource: ${r4.scaleSource}`);
check("ETT = ровно 580", r4.metricsMm.ett, 580, 0.5);
console.log(`  Все метрики (масштаб по ETT=580):`);
console.log(
    `    SH=${r4.metricsMm.saddleHeight}, Reach=${r4.metricsMm.reach}, Stack=${r4.metricsMm.stack}, WB=${r4.metricsMm.wheelbase}`
);

console.log(`\n========== ТЕСТ 5: ЗЕРКАЛО (фото «смотрит вправо») ==========`);
// Зеркалим по X: x → W - x. Метрики должны совпасть с ТЕСТОМ 1.
const pxMirrored: BikeKeypoints = {
  bb: { x: W - px.bb.x, y: px.bb.y },
  stTop: { x: W - px.stTop.x, y: px.stTop.y },
  saddleMount: { x: W - px.saddleMount.x, y: px.saddleMount.y },
  htTop: { x: W - px.htTop.x, y: px.htTop.y },
  htBottom: { x: W - px.htBottom.x, y: px.htBottom.y },
  rearAxle: { x: W - px.rearAxle.x, y: px.rearAxle.y },
  frontAxle: { x: W - px.frontAxle.x, y: px.frontAxle.y },
};
const r5 = calculateBikeGeometry(pxMirrored, { fallbackWheelbaseMm: 1080 });
check("SH инвариантен к зеркалу", r5.metricsMm.saddleHeight, r1.metricsMm.saddleHeight, 1);
check("ETT инвариантен", r5.metricsMm.ett, r1.metricsMm.ett, 1);
check("Reach инвариантен", r5.metricsMm.reach, r1.metricsMm.reach, 1);
check("Stack инвариантен", r5.metricsMm.stack, r1.metricsMm.stack, 1);
check("WB инвариантен", r5.metricsMm.wheelbase, r1.metricsMm.wheelbase, 1);
check("STA инвариантен", r5.anglesDeg.seatTubeAngle, r1.anglesDeg.seatTubeAngle, 0.1);
check("HTA инвариантен", r5.anglesDeg.headTubeAngle, r1.anglesDeg.headTubeAngle, 0.1);
if (!r5.frame.facingRight) {
  failed++;
  console.log(`  ✗ ПРОВАЛ: зеркальное фото должно определяться как «вправо»`);
} else {
  console.log(`  ✓ Зеркальное фото определено как «вправо» — нормализация симметрична`);
}

console.log(`\n========== ТЕСТ 6: ПОВОРОТ КАДРА (весь велосипед наклонён) ==========`);
// Поворачиваем все точки на 5° вокруг центра изображения — метрики не должны измениться
const cx = W / 2, cy = H / 2;
const a = (5 * Math.PI) / 180;
const rot = (p: { x: number; y: number }) => ({
  x: cx + (p.x - cx) * Math.cos(a) - (p.y - cy) * Math.sin(a),
  y: cy + (p.x - cx) * Math.sin(a) + (p.y - cy) * Math.cos(a),
});
const pxRotated: BikeKeypoints = {
  bb: rot(px.bb),
  stTop: rot(px.stTop),
  saddleMount: rot(px.saddleMount),
  htTop: rot(px.htTop),
  htBottom: rot(px.htBottom),
  rearAxle: rot(px.rearAxle),
  frontAxle: rot(px.frontAxle),
};
const r6 = calculateBikeGeometry(pxRotated, { fallbackWheelbaseMm: 1080 });
console.log(`  Наклон после компенсации: ${r6.anglesDeg.frameTilt}° (canvas Y вниз: поворот на +5° уменьшает наклон: 1.94 − 5 = −3.06)`);
check("frameTilt = 1.94 − 5", r6.anglesDeg.frameTilt, -3.06, 0.2);
check("SH не изменился от поворота", r6.metricsMm.saddleHeight, r1.metricsMm.saddleHeight, 1);
check("Reach не изменился", r6.metricsMm.reach, r1.metricsMm.reach, 2);
check("Stack не изменился", r6.metricsMm.stack, r1.metricsMm.stack, 2);
check("ETT не изменился", r6.metricsMm.ett, r1.metricsMm.ett, 2);
check("STA не изменился", r6.anglesDeg.seatTubeAngle, r1.anglesDeg.seatTubeAngle, 0.15);
check("HTA не изменился", r6.anglesDeg.headTubeAngle, r1.anglesDeg.headTubeAngle, 0.15);

console.log(`\n========== ТЕСТ 7: ВАЛИДАЦИЯ ОШИБОК ==========`);
try {
  calculateBikeGeometry({ ...px, rearAxle: px.frontAxle }, {});
  failed++;
  console.log(`  ✗ ПРОВАЛ: вырожденные оси должны бросать ошибку`);
} catch (e) {
  console.log(`  ✓ Вырожденные оси → ${e instanceof Error ? e.message.slice(0, 60) + "…" : String(e)}`);
}
// Инвертированный saddleMount (ниже stTop)
const rBad = calculateBikeGeometry(
  { ...px, saddleMount: { x: px.saddleMount.x, y: px.bb.y + 50 } },
  { fallbackWheelbaseMm: 1080 }
);
const invWarn = rBad.warnings.some((w) => w.includes("НИЖЕ stTop"));
console.log(`  ${invWarn ? "✓" : "✗ ПРОВАЛ"} Инвертированный saddleMount обнаружен warning'ом`);

console.log(`\n===== РЕЗЮМЕ =====`);
const fallbackSummary = `fallback: SH=${r1.metricsMm.saddleHeight}/ETT=${r1.metricsMm.ett}/Reach=${r1.metricsMm.reach}/Stack=${r1.metricsMm.stack}/WB=${r1.metricsMm.wheelbase}`;
const overrideSummary = `override SH=680: SH=${r2.metricsMm.saddleHeight}/ETT=${r2.metricsMm.ett}/Reach=${r2.metricsMm.reach}/Stack=${r2.metricsMm.stack}/WB=${r2.metricsMm.wheelbase}`;
console.log(`  ${fallbackSummary}`);
console.log(`  ${overrideSummary}`);
if (failed === 0) {
  console.log(`\n  ✅ ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ`);
} else {
  console.log(`\n  ❌ ПРОВАЛОВ: ${failed}`);
  process.exit(1);
}
