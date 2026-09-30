/**
 * Верификация ПОДСКАЗОК v2 (bike-point-suggestions) на точках из реального
 * лога ручной разметки 10:58 (MTB, SH=680 primary, imgSize 1200x900).
 *
 * Регрессия, которую ловим (баг из UI 30.09):
 *   - «Stack = 1 мм — слишком низко» при реальном Stack = 579 мм
 *     (смешение единиц: мм/пиксель подавался в функцию, ждущую мм/норм.ед.);
 *   - цель «(0.195, −401.883)» — отрицательный Y вне фото;
 *   - подсказка stTop двигала ПРАВИЛЬНО стоящую точку (требовала «35% пути»).
 *
 * imgSize 1200×900 восстановлен по dual scale лога:
 *   front R 232.2 px / 0.2576 норм → H=900;  scale 1.4408 мм/px → W=1200.
 */
import {
  calculateBikeGeometry,
  makeAlignedTransform,
  makeInverseAlignedTransform,
  type BikeKeypoints,
} from "../src/lib/bike-geometry-engine";
import {
  suggestPointCorrections,
  applySuggestion,
} from "../src/lib/bike-point-suggestions";

const IMG = { width: 1200, height: 900 };

// Точки из лога 10:58 (нормализованные 0..1, перспектива применена)
const ptsNorm = {
  bb: { x: 0.5610, y: 0.6824 },
  stTop: { x: 0.6381, y: 0.3488 },
  saddleMount: { x: 0.6840, y: 0.1849 },
  htTop: { x: 0.3261, y: 0.2460 },
  htBottom: { x: 0.2959, y: 0.3503 },
  rearAxle: { x: 0.7869, y: 0.6599 },
  frontAxle: { x: 0.1952, y: 0.6838 },
};

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}${detail ? " — " + detail : ""}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

function approx(a: number, b: number, tol: number) {
  return Math.abs(a - b) <= tol;
}

function toEnginePts(p: typeof ptsNorm): BikeKeypoints {
  return {
    bb: { x: p.bb.x * IMG.width, y: p.bb.y * IMG.height },
    stTop: { x: p.stTop.x * IMG.width, y: p.stTop.y * IMG.height },
    saddleMount: { x: p.saddleMount.x * IMG.width, y: p.saddleMount.y * IMG.height },
    htTop: { x: p.htTop.x * IMG.width, y: p.htTop.y * IMG.height },
    htBottom: { x: p.htBottom.x * IMG.width, y: p.htBottom.y * IMG.height },
    rearAxle: { x: p.rearAxle.x * IMG.width, y: p.rearAxle.y * IMG.height },
    frontAxle: { x: p.frontAxle.x * IMG.width, y: p.frontAxle.y * IMG.height },
  };
}

function runEngine(p: typeof ptsNorm) {
  return calculateBikeGeometry(toEnginePts(p), {
    userOverrideKey: "saddleHeight",
    userOverrideValueMm: 680,
    fallbackWheelbaseMm: 1080,
  });
}

const clone = (p: typeof ptsNorm) => JSON.parse(JSON.stringify(p));

// ============================================================
console.log("\n[1] Восстановление лога 10:58: движок на реальных точках");
// ============================================================
const engine = runEngine(ptsNorm);
check("scale ≈ 1.4408 мм/пикс (из лога)", approx(engine.scaleMmPerPx, 1.4408, 0.01),
  `получено ${engine.scaleMmPerPx.toFixed(4)}`);
check("Stack ≈ 579 мм (из лога)", approx(engine.metricsMm.stack, 579, 3),
  `получено ${engine.metricsMm.stack}`);
check("Reach ≈ 389 мм (из лога)", approx(engine.metricsMm.reach, 389, 3),
  `получено ${engine.metricsMm.reach}`);
check("WB ≈ 1023 мм (из лога)", approx(engine.metricsMm.wheelbase, 1023, 3),
  `получено ${engine.metricsMm.wheelbase}`);
check("SH ровно 680 (СТРОГО)", engine.metricsMm.saddleHeight === 680,
  `получено ${engine.metricsMm.saddleHeight}`);

// ============================================================
console.log("\n[2] Регрессия: на ПРАВИЛЬНОЙ разметке подсказок быть не должно");
// ============================================================
const sug = suggestPointCorrections(ptsNorm, { imgSize: IMG, engine }, "mtb");
for (const s of sug) {
  console.log(`    — ${s.pointKey}: ${s.problem.slice(0, 90)}`);
}
check("подсказок 0 (раньше было 2 ложных)", sug.length === 0,
  `получено ${sug.length}`);
check("нет ложного «Stack = 1 мм» (htTop)", !sug.some((s) => s.pointKey === "htTop"));
check("нет вредной подсказки stTop", !sug.some((s) => s.pointKey === "stTop"));

// ============================================================
console.log("\n[3] htTop поставлен СЛИШКОМ ВЫСОКО (на руль): y 0.246 → 0.10");
// ============================================================
{
  const p = clone(ptsNorm);
  p.htTop = { x: 0.34, y: 0.10 };
  const e = runEngine(p);
  const s = suggestPointCorrections(p, { imgSize: IMG, engine: e }, "mtb");
  const ht = s.filter((x) => x.pointKey === "htTop");
  check("подсказка htTop выдана", ht.length === 1, `получено ${ht.length}`);
  if (ht.length === 1) {
    console.log(`    Stack=${e.metricsMm.stack} → цель y=${ht[0].suggested.y.toFixed(3)}`);
    check("Stack в проблеме адекватный (>670)", e.metricsMm.stack > 670,
      `${e.metricsMm.stack}`);
    check("цель внутри фото [0.01..0.99]",
      ht[0].suggested.x >= 0.01 && ht[0].suggested.x <= 0.99 &&
      ht[0].suggested.y >= 0.01 && ht[0].suggested.y <= 0.99,
      `(${ht[0].suggested.x.toFixed(3)}, ${ht[0].suggested.y.toFixed(3)})`);
    check("distance в мм, не в норм.ед.", ht[0].distance > 100,
      `${ht[0].distance} мм`);
    // Применяем и пересчитываем: Stack должен вернуться в диапазон
    const fixed = applySuggestion(p, ht[0]);
    const e2 = runEngine(fixed as typeof ptsNorm);
    check("после применения Stack ≈ 640 (max диапазона)", approx(e2.metricsMm.stack, 640, 10),
      `получено ${e2.metricsMm.stack}`);
    const s2 = suggestPointCorrections(fixed as any, { imgSize: IMG, engine: e2 }, "mtb");
    check("повторный вызов: htTop-подсказок больше нет",
      !s2.some((x) => x.pointKey === "htTop"));
  }
}

// ============================================================
console.log("\n[4] htTop поставлен СЛИШКОМ НИЗКО: y 0.246 → 0.55");
// ============================================================
{
  const p = clone(ptsNorm);
  p.htTop = { x: 0.33, y: 0.55 };
  const e = runEngine(p);
  const s = suggestPointCorrections(p, { imgSize: IMG, engine: e }, "mtb");
  const ht = s.filter((x) => x.pointKey === "htTop");
  check("подсказка htTop выдана", ht.length === 1);
  if (ht.length === 1) {
    check("текст «слишком низко»", ht[0].problem.includes("низко"));
    const fixed = applySuggestion(p, ht[0]);
    const e2 = runEngine(fixed as typeof ptsNorm);
    check("после применения Stack ≈ 580 (min диапазона)", approx(e2.metricsMm.stack, 580, 10),
      `получено ${e2.metricsMm.stack}`);
  }
}

// ============================================================
console.log("\n[5] stTop сдвинут В СТОРОНУ от оси подседельной (+0.10 по X)");
// ============================================================
{
  const p = clone(ptsNorm);
  p.stTop = { x: p.stTop.x + 0.10, y: p.stTop.y };
  const e = runEngine(p);
  const stLenBefore = e.extendedMm.seatTubeLength;
  const s = suggestPointCorrections(p, { imgSize: IMG, engine: e }, "mtb");
  const st = s.filter((x) => x.pointKey === "stTop");
  check("подсказка stTop выдана", st.length === 1, `получено ${st.length}`);
  if (st.length === 1) {
    console.log(`    отклонение ${st[0].distance} мм, цель (${st[0].suggested.x.toFixed(3)}, ${st[0].suggested.y.toFixed(3)})`);
    check("отклонение адекватное (>25 мм)", st[0].distance > 25, `${st[0].distance} мм`);
    // Применяем: ST length должен СОХРАНИТЬСЯ (двигаем поперёк, не вдоль)
    const fixed = applySuggestion(p, st[0]);
    const e2 = runEngine(fixed as typeof ptsNorm);
    check("длина подседельной сохранилась (±3 мм)",
      approx(e2.extendedMm.seatTubeLength, stLenBefore, 3),
      `${stLenBefore} → ${e2.extendedMm.seatTubeLength}`);
  }
}

// ============================================================
console.log("\n[6] htBottom сдвинут вниз (длина рулевой нереальная): y 0.350 → 0.60");
// ============================================================
{
  const p = clone(ptsNorm);
  p.htBottom = { x: 0.30, y: 0.60 };
  const e = runEngine(p);
  const s = suggestPointCorrections(p, { imgSize: IMG, engine: e }, "mtb");
  const ht = s.filter((x) => x.pointKey === "htTop");
  check("подсказка htTop (по длине рулевой) выдана", ht.length === 1,
    `получено ${ht.length}`);
  if (ht.length === 1) {
    check("текст про длину рулевой", ht[0].problem.includes("рулевой трубы"));
    const fixed = applySuggestion(p, ht[0]);
    const e2 = runEngine(fixed as typeof ptsNorm);
    check("после применения HT length ≈ 120 мм", approx(e2.extendedMm.headTubeLength, 120, 6),
      `получено ${e2.extendedMm.headTubeLength}`);
  }
}

// ============================================================
console.log("\n[7] Оси колёс сильно разнесены по Y (перспектива)");
// ============================================================
{
  const p = clone(ptsNorm);
  p.frontAxle = { x: p.frontAxle.x, y: 0.72 };
  const e = runEngine(p);
  const s = suggestPointCorrections(p, { imgSize: IMG, engine: e }, "mtb");
  const fa = s.filter((x) => x.pointKey === "frontAxle");
  check("подсказка frontAxle выдана", fa.length === 1, `получено ${fa.length}`);
  if (fa.length === 1) {
    check("цель = Y задней оси (0.6599)", approx(fa[0].suggested.y, 0.6599, 0.002),
      `${fa[0].suggested.y.toFixed(4)}`);
  }
}

// ============================================================
console.log("\n[8] Round-trip преобразований: aligned → inverse = identity");
// ============================================================
{
  // Исходные точки пользователя: rearAxle.x=0.787 > frontAxle.x=0.195 —
  // фото «смотрит влево» → facingRight=false (как в логе 10:58)
  check("исходное фото: facingRight=false (смотрит влево)", engine.frame.facingRight === false);

  const fwd = makeAlignedTransform(engine.frame);
  const inv = makeInverseAlignedTransform(engine.frame);
  const p0 = { x: 0.4123 * IMG.width, y: 0.7777 * IMG.height };
  const back = inv(fwd(p0));
  check("facingLeft: обратное преобразование возвращает точку",
    approx(back.x, p0.x, 1e-6) && approx(back.y, p0.y, 1e-6));

  // Зеркальное фото (x' = 1 − x): велосипед станет «смотрит вправо»
  const mirrored = clone(ptsNorm);
  for (const k of Object.keys(mirrored) as (keyof typeof mirrored)[]) {
    mirrored[k] = { x: 1 - mirrored[k].x, y: mirrored[k].y };
  }
  const eM = runEngine(mirrored);
  check("зеркало: facingRight=true", eM.frame.facingRight === true);
  check("зеркало: метрики совпадают (инвариантность)",
    approx(eM.metricsMm.stack, engine.metricsMm.stack, 2) &&
    approx(eM.metricsMm.reach, engine.metricsMm.reach, 2) &&
    approx(eM.metricsMm.wheelbase, engine.metricsMm.wheelbase, 2),
    `Stack ${eM.metricsMm.stack}/${engine.metricsMm.stack}, Reach ${eM.metricsMm.reach}/${engine.metricsMm.reach}`);
  const fwdM = makeAlignedTransform(eM.frame);
  const invM = makeInverseAlignedTransform(eM.frame);
  const backM = invM(fwdM(p0));
  check("facingRight: обратное преобразование возвращает точку",
    approx(backM.x, p0.x, 1e-6) && approx(backM.y, p0.y, 1e-6));

  // Подсказки на зеркальном фото: те же, что на прямом (x зеркалится)
  const sM = suggestPointCorrections(mirrored, { imgSize: IMG, engine: eM }, "mtb");
  check("зеркало: подсказок тоже 0", sM.length === 0, `получено ${sM.length}`);
}

// ============================================================
console.log(`\n=== ИТОГ: ${passed} пройдено, ${failed} провалено ===`);
process.exit(failed > 0 ? 1 : 0);
