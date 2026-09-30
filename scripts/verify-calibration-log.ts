/**
 * Верификация лога ручной разметки от 09:56.
 * Прогоняем реальный код BikeSnap с точками пользователя и сверяем
 * каждую цифру из лога с вычислениями.
 */
import { calculateAutoFitCalibration } from "../src/lib/bike-calibration-helper";
import { computeParamsFromPhoto, detectPerspective } from "../src/lib/bike-photo-scale";
import { calculateDualScale } from "../src/lib/bike-dual-scale";

// Точки из лога (нормализованные 0..1)
const pts = {
  bb: { x: 0.5621, y: 0.6810 },
  stTop: { x: 0.6393, y: 0.3473 },
  saddleMount: { x: 0.6795, y: 0.1864 },
  htTop: { x: 0.3250, y: 0.2445 },
  htBottom: { x: 0.2992, y: 0.3517 },
  htTopCap: { x: 0.3451, y: 0.1775 },
  rearAxle: { x: 0.7835, y: 0.6599 },
  frontAxle: { x: 0.1885, y: 0.6867 },
  rearWheelTop: { x: 0.7891, y: 0.4098 },
  frontWheelTop: { x: 0.1874, y: 0.4218 },
};

// Ввод пользователя
const SH = 680, ETT = 580, WB = 1080;

// Подбираем imgSize (W, H) из двух уравнений лога:
//   1) scale(WB) = WB / pxDist(axles) = 0.3923 мм/пикс
//   2) SH_photo = scale * pxDist(bb, saddleMount) = 706 мм
function solveImgSize() {
  let best = { W: 4620, H: 3469, err: Infinity };
  for (let W = 3800; W <= 5400; W += 2) {
    for (let H = Math.round(W * 0.7); H <= Math.round(W * 0.8); H += 2) {
      const dWB = Math.hypot((0.7835 - 0.1885) * W, (0.6599 - 0.6867) * H);
      const dSH = Math.hypot((0.6795 - 0.5621) * W, (0.1864 - 0.6810) * H);
      const scale = WB / dWB;
      const shPhoto = scale * dSH;
      const err = Math.abs(scale - 0.3923) / 0.3923 + Math.abs(shPhoto - 706) / 706;
      if (err < best.err) best = { W, H, err };
    }
  }
  return best;
}

const { W, H, err } = solveImgSize();
const imgSize = { width: W, height: H };
console.log(`\n=== Подобранный imgSize: ${W}x${H} (ошибка подбора ${(err * 100).toFixed(3)}%) ===\n`);

// 1. Авто-калибровка (как в runCalibration)
const auto = calculateAutoFitCalibration(
  {
    bb: pts.bb,
    saddle: pts.saddleMount,
    rearAxle: pts.rearAxle,
    frontAxle: pts.frontAxle,
    stTop: pts.stTop,
    htTop: pts.htTop,
  },
  { shMm: SH, ettMm: ETT, wbMm: WB },
  imgSize
);
console.log(`Авто-калибровка:`);
console.log(`  Primary: ${auto.primaryParam} (лог: WB)`);
console.log(`  scale = ${auto.scalePxToMm.toFixed(4)} мм/пикс (лог: 0.3923)`);
console.log(`  tilt = ${auto.tiltAngleRad.toFixed(4)} рад = ${(auto.tiltAngleRad * 180 / Math.PI).toFixed(2)}° (лог: 3.0966 рад = 177.42°)`);
console.log(`  warning: ${auto.validationWarning ?? "нет (лог: валидация пройдена)"}`);

// Отклонения кандидатов (как их видит валидация)
const dWB = Math.hypot((0.7835 - 0.1885) * W, (0.6599 - 0.6867) * H);
const dSH = Math.hypot((0.6795 - 0.5621) * W, (0.1864 - 0.6810) * H);
const dETT = Math.abs((0.3250 - 0.6393) * W);
console.log(`\n  Масштабы кандидатов (мм/пикс):`);
console.log(`    WB:  ${WB} / ${dWB.toFixed(0)}px = ${(WB / dWB).toFixed(4)}  [primary]`);
console.log(`    SH:  ${SH} / ${dSH.toFixed(0)}px = ${(SH / dSH).toFixed(4)}  (откл. ${(((SH / dSH) / (WB / dWB) - 1) * 100).toFixed(1)}%)`);
console.log(`    ETT: ${ETT} / ${dETT.toFixed(0)}px = ${(ETT / dETT).toFixed(4)}  (откл. ${(((ETT / dETT) / (WB / dWB) - 1) * 100).toFixed(1)}%)`);

// 2. Параметры из фото (рабочий масштаб = авто WB, мм/пикс)
const finalScale = auto.scalePxToMm;
const params = computeParamsFromPhoto(pts as any, finalScale, "saddleHeight", imgSize);
console.log(`\nПараметры из фото (scale=${finalScale.toFixed(4)} мм/пикс):`);
const expected: Record<string, number | null> = {
  saddleHeight: 706, ett: 613, reach: 430, stack: 594, wheelbase: 1079,
  setback: 5, bbDrop: 29, seatTubeLength: 476, rearCenter: 403, frontCenter: 678,
  headTubeLength: 153, forkLength: 499, forkOffset: 53, sta: 72.9, hta: 72.3,
};
for (const [k, v] of Object.entries(expected)) {
  const got = (params as any)[k];
  const ok = v != null && got != null && Math.abs(got - v) <= (v > 100 ? 2 : 1) ? "✓" : "✗ РАСХОЖДЕНИЕ";
  console.log(`  ${k.padEnd(16)} = ${got}  (лог: ${v})  ${ok}`);
}
console.log(`  stackReachRatio  = ${params.stackReachRatio}  (лог: 1.38)`);

// 3. Прямой ETT (ST→HT горизонталь, без формулы) — для анализа расхождения
const ettDirect = Math.abs((0.3250 - 0.6393) * W) * finalScale;
console.log(`\nАнализ ETT:`);
console.log(`  ETT по формуле Reach+Stack/tan(STA) = ${params.ett} мм`);
console.log(`  ETT прямой (горизонталь ST→HT)      = ${ettDirect.toFixed(0)} мм`);
console.log(`  Введён пользователем                = ${ETT} мм`);
console.log(`  → формула добавляет ${(params.ett! - ettDirect).toFixed(0)} мм (слагаемое Stack/tan(STA) = ${(594 / Math.tan(72.9 * Math.PI / 180)).toFixed(0)} мм)`);

// 4. Перспектива
const persp = detectPerspective(pts as any);
console.log(`\nПерспектива (detectPerspective):`);
console.log(`  deltaY = ${persp?.deltaY.toFixed(4)} (лог: 0.0268) — по ОСЯМ, не по верхам колёс`);
console.log(`  angle = ${persp?.angleDeg.toFixed(2)}° (лог: 2.58°), severity = ${persp?.severity}`);
const perspWheels = (pts.frontWheelTop.y - pts.rearWheelTop.y);
console.log(`  deltaY по ВЕРХАМ КОЛЁС = ${perspWheels.toFixed(4)} → ${((Math.atan2(perspWheels, Math.abs(0.1874 - 0.7891)) * 180) / Math.PI).toFixed(2)}° (сигнал другой!)`);

// 5. Dual scale: с WH из ввода (нет) и с фолбэком 26" (334 мм)
console.log(`\nDual scale:`);
console.log(`  WH из формы = null → dual scale ПРОПУЩЕН (точки верха колёс размечены зря)`);
const ds = calculateDualScale(pts as any, 334, imgSize); // фолбэк: 26" MTB
if (ds) {
  console.log(`  С фолбэком 26" (R=334 мм):`);
  console.log(`    scaleRear = ${ds.scaleRear.toFixed(4)}, scaleFront = ${ds.scaleFront.toFixed(4)}, avg = ${ds.scaleAvg.toFixed(4)} мм/пикс`);
  console.log(`    severity = ${(ds.perspectiveSeverity * 100).toFixed(1)}% → ${ds.description}`);
  console.log(`    → сравни с рабочим масштабом ${finalScale.toFixed(4)}: разница ${((ds.scaleAvg / finalScale - 1) * 100).toFixed(1)}%`);
}
