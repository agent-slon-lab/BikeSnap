/**
 * ТЕСТ: Фильтр ближней ноги v2 + жёсткий чек-поинт велов (v1.14.41)
 * ==================================================================
 * Сценарий из отчётов #10/#11: MediaPipe даёт ФАНТОМНОЙ дальней ноге
 * высокий confidence на бедре/колене/лодыжке (колено 167°, бедро 151°),
 * и она выигрывает у ближней по «средней видимости из 3 точек» (v1.14.32).
 * v2 считает СУММАРНЫЙ балл по 5 суставам (пятка/носок дальней ноги
 * глючают) + проверяет анатомическую целостность цепочки.
 *
 * Запуск: npx tsx scripts/test-leg-selection.ts
 */

import {
  getCleanRiderKeypoints,
  getBestLegSide,
  legVisibilityScore,
  analyzeBikeFit,
  POSE_LANDMARKS,
  type Point,
} from "../src/lib/bike-fit";
import {
  wheelRatioDivergencePct,
  isBikeMismatch,
  bikeMatchVerdict,
  WHEEL_RATIO_MISMATCH_PCT,
} from "../src/lib/bike-wheel-ratio";

let pass = 0;
let failCount = 0;
const ok = (name: string, cond: boolean, extra?: string) => {
  if (cond) {
    pass++;
    console.log(`  OK   ${name}`);
  } else {
    failCount++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

const lm = (x: number, y: number, visibility: number): Point => ({ x, y, visibility });

/** Пустой каркас из 33 точек (visibility 0) */
function skeleton(): Point[] {
  return Array.from({ length: 33 }, () => lm(0, 0, 0));
}

interface LegSpec {
  hip: [number, number, number];
  knee: [number, number, number];
  ankle: [number, number, number];
  heel?: [number, number, number];
  foot?: [number, number, number];
}

function applyLeg(arr: Point[], side: "left" | "right", leg: LegSpec): void {
  const L = side === "left";
  arr[L ? POSE_LANDMARKS.LEFT_HIP : POSE_LANDMARKS.RIGHT_HIP] = lm(...leg.hip);
  arr[L ? POSE_LANDMARKS.LEFT_KNEE : POSE_LANDMARKS.RIGHT_KNEE] = lm(...leg.knee);
  arr[L ? POSE_LANDMARKS.LEFT_ANKLE : POSE_LANDMARKS.RIGHT_ANKLE] = lm(...leg.ankle);
  arr[L ? POSE_LANDMARKS.LEFT_HEEL : POSE_LANDMARKS.RIGHT_HEEL] = lm(
    ...(leg.heel ?? [leg.ankle[0], leg.ankle[1] + 0.01, leg.ankle[2]])
  );
  arr[L ? POSE_LANDMARKS.LEFT_FOOT_INDEX : POSE_LANDMARKS.RIGHT_FOOT_INDEX] = lm(
    ...(leg.foot ?? [leg.ankle[0] - 0.02, leg.ankle[1] + 0.02, leg.ankle[2]])
  );
}

function applyShoulders(arr: Point[], vis: number): void {
  arr[POSE_LANDMARKS.LEFT_SHOULDER] = lm(0.34, 0.35, vis);
  arr[POSE_LANDMARKS.RIGHT_SHOULDER] = lm(0.36, 0.35, vis);
}

console.log("\n=== 1. legVisibilityScore: сумма по 5 суставам ===");
{
  const arr = skeleton();
  applyLeg(arr, "right", {
    hip: [0.5, 0.5, 0.9],
    knee: [0.44, 0.66, 0.9],
    ankle: [0.47, 0.82, 0.9],
    heel: [0.46, 0.84, 0.3],
    foot: [0.42, 0.85, 0.2],
  });
  const s = legVisibilityScore(arr, "right");
  ok("сумма = 0.9*3 + 0.3 + 0.2 = 3.2", Math.abs(s - 3.2) < 1e-9, `получено ${s}`);
  ok("пустая сторона = 0", legVisibilityScore(arr, "left") === 0);
  ok("null-landmarks = 0", legVisibilityScore(null, "left") === 0);
}

console.log("\n=== 2. Сценарий #10/#11: фантом дальней ноги с ВЫСОКИМ visibility ===");
{
  const arr = skeleton();
  // Дальняя (left): бедро/колено/лодыжка с confidence 0.9, пятка/носок глючат (0.05)
  applyLeg(arr, "left", {
    hip: [0.5, 0.5, 0.9],
    knee: [0.44, 0.62, 0.9],
    ankle: [0.385, 0.735, 0.9],
    heel: [0.38, 0.745, 0.05],
    foot: [0.37, 0.75, 0.05],
  }); // сумма 2.8; цепочка почти прямая (колено ~175° — «наложенный» фантом)
  // Ближняя (right): все 5 суставов уверенно видны
  applyLeg(arr, "right", {
    hip: [0.51, 0.5, 0.7],
    knee: [0.42, 0.66, 0.72],
    ankle: [0.47, 0.82, 0.7],
    heel: [0.46, 0.84, 0.62],
    foot: [0.42, 0.85, 0.55],
  }); // сумма 3.29
  applyShoulders(arr, 0.8);

  const res = getCleanRiderKeypoints(arr);
  ok(
    "выбрана БЛИЖНЯЯ (right), а не фантомная дальняя (left)",
    res.side === "right" && res.keypoints != null,
    `side=${res.side}, error=${res.error ?? "—"}`
  );
  ok(
    "sideScores объясняют выбор: right > left",
    res.sideScores?.right === 3.29 && res.sideScores?.left === 2.8,
    JSON.stringify(res.sideScores)
  );
  ok("getBestLegSide согласован", getBestLegSide(arr) === "right");

  // Старый алгоритм (среднее из 3) выбрал бы left (0.9 vs 0.707):
  // проверяем, что именно v2 переломил исход #10/#11
  const avg = (ids: number[]) =>
    ids.reduce((s, i) => s + (arr[i]?.visibility ?? 0), 0) / 3;
  const oldLeft = avg([
    POSE_LANDMARKS.LEFT_HIP,
    POSE_LANDMARKS.LEFT_KNEE,
    POSE_LANDMARKS.LEFT_ANKLE,
  ]);
  const oldRight = avg([
    POSE_LANDMARKS.RIGHT_HIP,
    POSE_LANDMARKS.RIGHT_KNEE,
    POSE_LANDMARKS.RIGHT_ANKLE,
  ]);
  ok(
    "старой логикой (среднее из 3) действительно выигрывал фантом (регрессия воспроизведена)",
    oldLeft > oldRight,
    `left=${oldLeft.toFixed(3)}, right=${oldRight.toFixed(3)}`
  );
}

console.log("\n=== 3. Сквозной analyzeBikeFit на синтетике #10/#11 ===");
{
  const arr = skeleton();
  applyLeg(arr, "left", {
    hip: [0.5, 0.5, 0.9],
    knee: [0.44, 0.62, 0.9],
    ankle: [0.385, 0.735, 0.9],
    heel: [0.38, 0.745, 0.05],
    foot: [0.37, 0.75, 0.05],
  });
  applyLeg(arr, "right", {
    hip: [0.51, 0.5, 0.7],
    knee: [0.42, 0.66, 0.72],
    ankle: [0.47, 0.82, 0.7],
    heel: [0.46, 0.84, 0.62],
    foot: [0.42, 0.85, 0.55],
  });
  applyShoulders(arr, 0.8);
  const analysis = analyzeBikeFit(arr);
  ok("анализ построен", analysis != null);
  if (analysis) {
    ok("сторона анализа = right", analysis.side === "right", `side=${analysis.side}`);
    ok(
      "колено — живое значение ближней ноги (130–150°), а не фантом 167–180°",
      analysis.kneeAngle.value > 130 && analysis.kneeAngle.value < 150,
      `knee=${analysis.kneeAngle.value}`
    );
    ok(
      "бедро в разумных пределах (не фантомные 151°)",
      analysis.hipAngle.value > 90 && analysis.hipAngle.value < 130,
      `hip=${analysis.hipAngle.value}`
    );
  }
}

console.log("\n=== 4. Геометрическая санитария цепочки ===");
{
  // Колено приклеено к бедру: thigh ≈ 0.005 при shin ≈ 0.3
  const arr = skeleton();
  applyLeg(arr, "left", {
    hip: [0.5, 0.5, 0.95],
    knee: [0.5, 0.505, 0.95],
    ankle: [0.5, 0.8, 0.95],
    heel: [0.5, 0.81, 0.9],
    foot: [0.48, 0.82, 0.9],
  });
  applyShoulders(arr, 0.9);
  const res = getCleanRiderKeypoints(arr);
  ok(
    "дегенеративная цепочка отсечена (скелет «сшит» из разных ног)",
    res.keypoints == null && res.error != null && res.error.includes("искажениями"),
    `error=${res.error ?? "—"}`
  );

  // Нога схлопнулась в точку (thigh + shin < 0.08)
  const arr2 = skeleton();
  applyLeg(arr2, "left", {
    hip: [0.5, 0.5, 0.95],
    knee: [0.502, 0.504, 0.95],
    ankle: [0.503, 0.506, 0.95],
    heel: [0.504, 0.507, 0.9],
    foot: [0.505, 0.508, 0.9],
  });
  applyShoulders(arr2, 0.9);
  const res2 = getCleanRiderKeypoints(arr2);
  ok(
    "схлопнутая нога отсечена",
    res2.keypoints == null && res2.error != null,
    `error=${res2.error ?? "—"}`
  );

  // Живая цепочка (thigh/shin ≈ 0.79) проходит
  const arr3 = skeleton();
  applyLeg(arr3, "left", {
    hip: [0.5, 0.5, 0.95],
    knee: [0.44, 0.66, 0.95],
    ankle: [0.47, 0.82, 0.95],
  });
  applyShoulders(arr3, 0.9);
  const res3 = getCleanRiderKeypoints(arr3);
  ok(
    "живая посадка проходит санитарию",
    res3.keypoints != null && res3.error == null,
    `error=${res3.error ?? "—"}`
  );
}

console.log("\n=== 5. Надёжность и тай-брейк ===");
{
  // Обе ноги ниже LEG_MIN_VISIBILITY
  const arr = skeleton();
  applyLeg(arr, "left", {
    hip: [0.5, 0.5, 0.45],
    knee: [0.44, 0.66, 0.45],
    ankle: [0.47, 0.82, 0.45],
  });
  applyLeg(arr, "right", {
    hip: [0.51, 0.5, 0.44],
    knee: [0.42, 0.66, 0.44],
    ankle: [0.47, 0.82, 0.44],
  });
  applyShoulders(arr, 0.9);
  const res = getCleanRiderKeypoints(arr);
  ok(
    "обе стороны ненадёжны → ошибка «Низкая точность»",
    res.keypoints == null && (res.error ?? "").includes("Низкая точность"),
    `error=${res.error ?? "—"}`
  );

  // Равный суммарный балл → левая (документированный тай-брейк)
  const arr2 = skeleton();
  const same: LegSpec = {
    hip: [0.5, 0.5, 0.8],
    knee: [0.44, 0.66, 0.8],
    ankle: [0.47, 0.82, 0.8],
  };
  applyLeg(arr2, "left", same);
  applyLeg(arr2, "right", same);
  applyShoulders(arr2, 0.8);
  const res2 = getCleanRiderKeypoints(arr2);
  ok("равный балл → left", res2.side === "left", `side=${res2.side}`);
}

console.log("\n=== 6. Жёсткий чек-поинт велов: порог 10% ===");
{
  ok("константа = 10", WHEEL_RATIO_MISMATCH_PCT === 10, `=${WHEEL_RATIO_MISMATCH_PCT}`);
  ok("9% — не mismatch", isBikeMismatch(1.4, 1.526) === false);
  ok("11% — mismatch", isBikeMismatch(1.4, 1.554) === true);
  const d9 = wheelRatioDivergencePct(1.4, 1.526);
  const d11 = wheelRatioDivergencePct(1.4, 1.554);
  ok(
    "расхождение считается от среднего",
    Math.abs((d9 ?? 0) - 8.61) < 0.02 && Math.abs((d11 ?? 0) - 10.43) < 0.02,
    `d9=${d9?.toFixed(2)}, d11=${d11?.toFixed(2)}`
  );
  ok("верdict 9% = match", bikeMatchVerdict(1.4, 1.526).verdict === "match");
  ok("верdict 11% = mismatch", bikeMatchVerdict(1.4, 1.554).verdict === "mismatch");
  ok("верdict без данных = unknown", bikeMatchVerdict(1.4, null).verdict === "unknown");
}

console.log(`\nИтог: ${pass} OK / ${failCount} FAIL`);
process.exit(failCount > 0 ? 1 : 0);
