/**
 * Sanity-тест защиты масштаба (v1.11.1).
 * Кейс пользователя: knownValue = 8 мм (мусор в поле калибровки),
 * карточка: SH=800, ETT=600, WB=1110. Ожидание:
 *  - ядро ОТКЛОНЯЕТ override SH=8 (вне 400–1000);
 *  - fallback по WB=1110 → метрики здравого порядка (WB=1110, ETT~600);
 *  - в warnings строка «ОТКЛОНЁН».
 * И обратный кейс: override SH=800 → строгий масштаб, SH фото ≈ 800.
 */
import {
  calculateBikeGeometry,
  isPlausibleOverrideMm,
  type BikeKeypoints,
} from "../src/lib/bike-geometry-engine";

// Синтетическое «правильное» фото: WB=1110px, SH=800px, ETT~600px, и т.д.
// Оси горизонтальны (tilt=0), перед справа.
const pts: BikeKeypoints = {
  rearAxle: { x: 100, y: 500 },
  frontAxle: { x: 1210, y: 500 }, // WB = 1110 px
  bb: { x: 600, y: 600 },
  stTop: { x: 660, y: 300 },      // ST наклонена
  saddleMount: { x: 672, y: 232 },// BB→saddleMount = 800 px (гипотенуза: dx=72, dy=368 → 375? нет)
  htBottom: { x: 900, y: 380 },
  htTop: { x: 930, y: 280 },
};

// Уточним SH-отрезок: нужно расстояние bb→saddleMount = 800 px.
// dx=672-600=72, dy=600-232=368 → hypot=374.9 — не 800. Пересчитаем точки:
// Пусть bb=(600,700), saddleMount=(700,-?)... проще: dy=790, dx=125 → hypot≈800.
pts.bb = { x: 600, y: 700 };
pts.saddleMount = { x: 725, y: -90 }; // dy=790, dx=125 → 799.8 px — ок (верх кадра условный)
pts.stTop = { x: 690, y: 200 };       // на линии bb→saddleMount примерно

console.log("=== isPlausibleOverrideMm ===");
console.log("SH=8:", isPlausibleOverrideMm("saddleHeight", 8));       // false
console.log("SH=800:", isPlausibleOverrideMm("saddleHeight", 800));   // true
console.log("ETT=600:", isPlausibleOverrideMm("ett", 600));           // true
console.log("WB=1110:", isPlausibleOverrideMm("wheelbase", 1110));    // true
console.log("WB=27500:", isPlausibleOverrideMm("wheelbase", 27500));  // false
console.log("CR-подобный мусор SH=275:", isPlausibleOverrideMm("saddleHeight", 275)); // false

console.log("\n=== КЕЙС 1: мусорный override SH=8 (как у пользователя) ===");
const garbage = calculateBikeGeometry(pts, {
  userOverrideKey: "saddleHeight",
  userOverrideValueMm: 8,
  fallbackWheelbaseMm: 1110,
});
console.log("scaleSource:", garbage.scaleSource);
console.log("scaleMmPerPx:", garbage.scaleMmPerPx.toFixed(4));
console.log("WB:", garbage.metricsMm.wheelbase, "(ожидание 1110)");
console.log("Stack:", garbage.metricsMm.stack);
console.log("Reach:", garbage.metricsMm.reach);
console.log("SH:", garbage.metricsMm.saddleHeight, "(ожидание ~800: WB-масштаб × SH-px)");
const rejected = garbage.warnings.some((w) => w.includes("ОТКЛОНЁН"));
console.log("Warning «ОТКЛОНЁН»:", rejected ? "✓ есть" : "✗ НЕТ —guard не сработал!");

console.log("\n=== КЕЙС 2: валидный override SH=800 — строгий масштаб ===");
const strict = calculateBikeGeometry(pts, {
  userOverrideKey: "saddleHeight",
  userOverrideValueMm: 800,
  fallbackWheelbaseMm: 1110,
});
console.log("scaleSource:", strict.scaleSource);
console.log("SH:", strict.metricsMm.saddleHeight, "(строго 800)");
console.log("WB:", strict.metricsMm.wheelbase, "(ожидание ~1110, если точки согласованы)");

console.log("\n=== КЕЙС 3: мусорный override И мусорный fallback WB ===");
const bothGarbage = calculateBikeGeometry(pts, {
  userOverrideKey: "saddleHeight",
  userOverrideValueMm: 8,
  fallbackWheelbaseMm: 27500,
});
console.log("scaleSource:", bothGarbage.scaleSource, "(ожидание типовой 1080)");
console.log("WB:", bothGarbage.metricsMm.wheelbase);
