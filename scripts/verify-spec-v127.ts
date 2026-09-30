/**
 * Верификация acceptance criteria из ТЗ пользователя (v1.2.7).
 *
 * Спека требует:
 * 1. Ручная высота седла (680 мм) совпадает с итоговым saddleHeight
 *    БЕЗ погрешности (старая ошибка +26 мм устранена).
 * 2. ETT считается проекционно (пересечение горизонтали htTop с осью
 *    подседельной трубы) и совпадает с фактической геометрией
 *    (старая ошибка +33 мм устранена).
 * 3. Авто-выравнивание горизонта ДО расчётов: наклон кадра не влияет
 *    на метрики (Isolated Rotation First).
 *
 * Метод: строим синтетическую раму с ТОЧНО известной геометрией,
 * затем проверяем, что ядро восстанавливает её из пиксельных точек.
 *
 * Синтетическая геометрия (мм, canvas y↓, перед справа):
 *   WB=1080, rear center 420, BB drop 70, SH=680 (bb→saddleMount),
 *   STA=73.5°, ST(труба)=500, Reach=400, Stack=560, HTA=72°, HT len=140.
 *   Истинный ETT (проекция) = Reach + Stack/tan(STA) = 565.9 мм.
 */
import {
  calculateBikeGeometry,
  rotatePoint,
  type BikeKeypoints,
  type Point2D,
} from "../src/lib/bike-geometry-engine";

const RAD = Math.PI / 180;

// ---- Построение синтетической рамы ----
const STA = 73.5 * RAD;
const HTA = 72 * RAD;
const WB = 1080, REAR_CENTER = 420, BB_DROP = 70, SH = 680, ST_LEN = 500;
const REACH = 400, STACK = 560, HT_LEN = 140;

const rearAxle: Point2D = { x: 0, y: 0 };
const frontAxle: Point2D = { x: WB, y: 0 };
const bb: Point2D = {
  x: Math.sqrt(REAR_CENTER * REAR_CENTER - BB_DROP * BB_DROP),
  y: BB_DROP,
};
// Направление подседельной трубы из BB вверх-назад (canvas y↓)
const stDir = (len: number): Point2D => ({
  x: bb.x - len * Math.cos(STA),
  y: bb.y - len * Math.sin(STA),
});
const saddleMount = stDir(SH);      // зажим рельсов — на 680 мм по оси
const stTop = stDir(ST_LEN);        // верх трубы — на 500 мм по той же оси
const htTop: Point2D = { x: bb.x + REACH, y: bb.y - STACK };
const htBottom: Point2D = {
  x: htTop.x + HT_LEN * Math.cos(HTA),
  y: htTop.y + HT_LEN * Math.sin(HTA),
};

const base: BikeKeypoints = { rearAxle, frontAxle, bb, stTop, saddleMount, htBottom, htTop };

// Истинный ETT: пересечение горизонтали htTop с осью подседельной трубы
const trueETT = REACH + STACK / Math.tan(STA);

let failed = 0;
function check(name: string, got: number, want: number, tol: number) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failed++;
  console.log(
    `  ${ok ? "✓" : "✗ ПРОВАЛ"} ${name.padEnd(46)} = ${got.toFixed(1)}  (ожидалось ${want} ±${tol})`
  );
}
function checkStr(name: string, cond: boolean, detail: string) {
  if (!cond) failed++;
  console.log(`  ${cond ? "✓" : "✗ ПРОВАЛ"} ${name}${detail ? " — " + detail : ""}`);
}

// ============================================================
console.log(`\n===== КРИТЕРИЙ 1: ручной SH=680 → saddleHeight ровно 680 =====`);
const r1 = calculateBikeGeometry(base, {
  userOverrideKey: "saddleHeight",
  userOverrideValueMm: SH,
  fallbackWheelbaseMm: WB,
});
console.log(`  scaleSource: ${r1.scaleSource}`);
checkStr("источник масштаба = ручной ввод (СТРОГО)", r1.scaleSource.startsWith("USER_OVERRIDE"), r1.scaleSource);
check("saddleHeight (без +26 мм погрешности)", r1.metricsMm.saddleHeight, 680, 0.5);
check("wheelbase", r1.metricsMm.wheelbase, 1080, 1);
check("stack", r1.metricsMm.stack, 560, 1);
check("reach", r1.metricsMm.reach, 400, 1);
check("STA по трубе bb→stTop", r1.anglesDeg.seatTubeAngle, 73.5, 0.3);
check("HTA по htTop→htBottom", r1.anglesDeg.headTubeAngle, 72.0, 0.3);
checkStr("нет ложных предупреждений на эталонной разметке", r1.warnings.length === 0, r1.warnings.join(" | "));

// ============================================================
console.log(`\n===== КРИТЕРИЙ 2: ETT проекционно (горизонталь htTop ∩ ось ST) =====`);
console.log(`  Истинный ETT = Reach + Stack/tan(STA) = ${trueETT.toFixed(1)} мм`);
check("ETT совпадает с проекционным", r1.metricsMm.ett, Math.round(trueETT), 1);
// Независимая проверка из выходных метрик (тождество проекции)
const ettIdentity = r1.metricsMm.reach + r1.metricsMm.stack / Math.tan(r1.anglesDeg.seatTubeAngle * RAD);
check("тождество ETT = Reach + Stack/tan(STA)", ettIdentity, Math.round(trueETT), 1.5);

// ============================================================
console.log(`\n===== КРИТЕРИЙ 3: авто-выравнивание — наклон кадра не влияет =====`);
// «Снимок с завалом горизонта на 5°»: вращаем ВСЕ точки вокруг задней оси
const tiltRot = (p: Point2D): Point2D => rotatePoint(p, rearAxle, -5 * RAD);
const tilted: BikeKeypoints = {
  rearAxle: tiltRot(base.rearAxle),
  frontAxle: tiltRot(base.frontAxle),
  bb: tiltRot(base.bb),
  stTop: tiltRot(base.stTop),
  saddleMount: tiltRot(base.saddleMount),
  htBottom: tiltRot(base.htBottom),
  htTop: tiltRot(base.htTop),
};
const r2 = calculateBikeGeometry(tilted, {
  userOverrideKey: "saddleHeight",
  userOverrideValueMm: SH,
  fallbackWheelbaseMm: WB,
});
console.log(`  frameTilt распознан: ${r2.anglesDeg.frameTilt}°`);
check("|frameTilt| = 5°", Math.abs(r2.anglesDeg.frameTilt), 5, 0.1);
check("saddleHeight не изменилась", r2.metricsMm.saddleHeight, 680, 0.5);
check("wheelbase не изменился", r2.metricsMm.wheelbase, 1080, 1);
check("stack не изменился", r2.metricsMm.stack, 560, 1);
check("reach не изменился", r2.metricsMm.reach, 400, 1);
check("ETT не изменился", r2.metricsMm.ett, Math.round(trueETT), 1);

// ============================================================
console.log(`\n===== БОНУС: фото «смотрит влево» (зеркало) → те же метрики =====`);
const mirror = (p: Point2D): Point2D => ({ x: -p.x, y: p.y });
const mirrored: BikeKeypoints = {
  rearAxle: mirror(base.rearAxle),
  frontAxle: mirror(base.frontAxle),
  bb: mirror(base.bb),
  stTop: mirror(base.stTop),
  saddleMount: mirror(base.saddleMount),
  htBottom: mirror(base.htBottom),
  htTop: mirror(base.htTop),
};
const r3 = calculateBikeGeometry(mirrored, {
  userOverrideKey: "saddleHeight",
  userOverrideValueMm: SH,
  fallbackWheelbaseMm: WB,
});
check("saddleHeight", r3.metricsMm.saddleHeight, 680, 0.5);
check("stack", r3.metricsMm.stack, 560, 1);
check("reach", r3.metricsMm.reach, 400, 1);
check("ETT", r3.metricsMm.ett, Math.round(trueETT), 1);

// ============================================================
console.log(`\n===== FALLBACK: нет ручного ввода → масштаб по колёсной базе =====`);
const r4 = calculateBikeGeometry(base, { fallbackWheelbaseMm: WB });
checkStr("источник = FALLBACK_AUTO", r4.scaleSource.startsWith("FALLBACK_AUTO"), r4.scaleSource);
check("wheelbase = fallback 1080", r4.metricsMm.wheelbase, 1080, 0.5);
const r5 = calculateBikeGeometry(base, {});
checkStr("без fallbackWheelbaseMm — дефолт 1080", r5.scaleSource.includes("1080"), r5.scaleSource);

// ============================================================
console.log(`\n${failed === 0 ? "✅ ВСЕ КРИТЕРИИ СПЕКИ ВЫПОЛНЕНЫ" : `❌ ПРОВАЛОВ: ${failed}`}\n`);
if (failed > 0) process.exit(1);
