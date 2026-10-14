/**
 * verify-v1432.ts — проверка Bugfix Spec: MediaPipe Occlusion, Side
 * Selection & Ankle Alignment (v1.14.32).
 *
 * Покрывает:
 *  1. getCleanRiderKeypoints: выбор ближней ноги по средней visibility
 *  2. Отказ при низкой надёжности hip/knee/ankle (< 0.5)
 *  3. isCrossLegConnection / legConnectionSide
 *  4. Санитарная проверка стопы (ankle.y < toe.y) → warnings + warning-статус
 *  5. Ненадёжный toe + pedalAxis → упрощённый вектор Колено→Лодыжка→Ось
 *  6. Ненадёжный toe без pedalAxis → стопа не оценивается, предупреждение
 */
import {
  getCleanRiderKeypoints,
  isCrossLegConnection,
  legConnectionSide,
  analyzeBikeFit,
  FOOT_SANITY_WARNING,
  POSE_LANDMARKS,
  type Point,
} from "../src/lib/bike-fit";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const P = (x: number, y: number, v = 0.95): Point => ({ x, y, visibility: v });

/** Ближняя (левая) нога — высокая видимость; дальняя (правая) — фантомы */
function lmNearLeft(overrides?: {
  toeY?: number; toeVis?: number; ankleY?: number; heelVis?: number;
}): Point[] {
  const o = overrides ?? {};
  const lm: Point[] = new Array(33).fill(undefined);
  lm[POSE_LANDMARKS.LEFT_SHOULDER] = P(0.45, 0.30);
  lm[POSE_LANDMARKS.RIGHT_SHOULDER] = P(0.47, 0.31, 0.4);
  lm[POSE_LANDMARKS.LEFT_HIP] = P(0.50, 0.55);
  lm[POSE_LANDMARKS.RIGHT_HIP] = P(0.52, 0.56, 0.3);
  lm[POSE_LANDMARKS.LEFT_KNEE] = P(0.52, 0.70);
  lm[POSE_LANDMARKS.RIGHT_KNEE] = P(0.60, 0.71, 0.35);
  lm[POSE_LANDMARKS.LEFT_ANKLE] = P(0.54, o.ankleY ?? 0.85, 0.9);
  lm[POSE_LANDMARKS.RIGHT_ANKLE] = P(0.65, 0.86, 0.3);
  lm[POSE_LANDMARKS.LEFT_FOOT_INDEX] = P(0.58, o.toeY ?? 0.90, o.toeVis ?? 0.8);
  lm[POSE_LANDMARKS.RIGHT_FOOT_INDEX] = P(0.70, 0.91, 0.25);
  lm[POSE_LANDMARKS.LEFT_HEEL] = P(0.535, 0.87, o.heelVis ?? 0.7);
  return lm;
}

console.log("\n=== 1. Выбор ближней ноги по средней visibility ===");
{
  const clean = getCleanRiderKeypoints(lmNearLeft());
  check("сторона = left (ближняя)", clean.side === "left");
  check("keypoints не null", !!clean.keypoints);
  check("ошибки нет", clean.error === null);
  check("toe принадлежит левой стороне", clean.keypoints?.toe === undefined ? false : true);
}

console.log("\n=== 2. Отказ при низкой надёжности ноги ===");
{
  // Обе стороны слабые → ошибка
  const weak: Point[] = new Array(33).fill(undefined);
  weak[POSE_LANDMARKS.LEFT_HIP] = P(0.5, 0.55, 0.3);
  weak[POSE_LANDMARKS.LEFT_KNEE] = P(0.52, 0.7, 0.3);
  weak[POSE_LANDMARKS.LEFT_ANKLE] = P(0.54, 0.85, 0.3);
  weak[POSE_LANDMARKS.LEFT_SHOULDER] = P(0.45, 0.3);
  weak[POSE_LANDMARKS.RIGHT_HIP] = P(0.52, 0.56, 0.3);
  weak[POSE_LANDMARKS.RIGHT_KNEE] = P(0.6, 0.71, 0.3);
  weak[POSE_LANDMARKS.RIGHT_ANKLE] = P(0.65, 0.86, 0.3);
  const clean = getCleanRiderKeypoints(weak);
  check("keypoints = null при слабой видимости", clean.keypoints === null);
  check("ошибка содержит «Низкая точность»", !!clean.error && clean.error.includes("Низкая точность"));
  const none = getCleanRiderKeypoints([]);
  check("пустой ввод → ошибка", none.keypoints === null && none.error !== null);
}

console.log("\n=== 3. Запрет перекрёстных линий ===");
{
  check("LEFT_HIP→RIGHT_KNEE запрещена", isCrossLegConnection(23, 26));
  check("RIGHT_HIP→LEFT_ANKLE запрещена", isCrossLegConnection(24, 27));
  check("плечи [11,12] разрешены", !isCrossLegConnection(11, 12));
  check("бёдра [23,24] разрешены (линия таза)", !isCrossLegConnection(23, 24));
  check("левое бедро→правое колено [23,26] запрещено", isCrossLegConnection(23, 26));
  check("левая голень→правая голень [25,28] запрещена", isCrossLegConnection(25, 28));
  check("левая голень→левой лодыжке [25,27] разрешена", !isCrossLegConnection(25, 27));
  check("legConnectionSide([23,25]) = left", legConnectionSide(23, 25) === "left");
  check("legConnectionSide([24,26]) = right", legConnectionSide(24, 26) === "right");
  check("legConnectionSide([11,12]) = null (не нога)", legConnectionSide(11, 12) === null);
}

console.log("\n=== 4. Санитарная проверка стопы (лодыжка НИЖЕ носка) ===");
{
  // ankle.y = 0.95 НИЖЕ toe.y = 0.90 → фантомные точки (сланцы)
  const analysis = analyzeBikeFit(lmNearLeft({ ankleY: 0.95, toeY: 0.90 }));
  check("анализ не null", !!analysis);
  check("warnings содержит FOOT_SANITY_WARNING", !!analysis?.warnings?.includes(FOOT_SANITY_WARNING));
  check("голеностоп не «зелёная норма»", analysis?.ankleAngle.status === "warning");
  check("рекомендация голеностопа = предупреждение обуви", analysis?.ankleAngle.recommendation === FOOT_SANITY_WARNING);
  // knee/hip при этом считаются (нога не сбрасывается целиком)
  check("колено всё же посчитано", !!analysis && analysis.kneeAngle.value > 0);
}

console.log("\n=== 5. Ненадёжные toe и heel + pedalAxis → вектор к оси педали ===");
{
  // toe 0.4 и heel 0.3 — оба ниже порога 0.65 → MediaPipe-стопа отвергнута
  const lm = lmNearLeft({ toeVis: 0.4, heelVis: 0.3 });
  const bb: Point = { x: 0.56, y: 0.88, visibility: 1 };
  const withAxis = analyzeBikeFit(lm, { pedalAxis: bb });
  const withoutAxis = analyzeBikeFit(lm);
  check("с осью педали предупреждения нет", !(withAxis?.warnings ?? []).includes(FOOT_SANITY_WARNING));
  check("без оси — предупреждение есть", (withoutAxis?.warnings ?? []).includes(FOOT_SANITY_WARNING));
  // Угол по оси педали должен считаться не по нейтральному 90
  check("угол по оси педали ≠ нейтраль 90", withAxis != null && withAxis.ankleAngle.value !== 90,
    `value=${withAxis?.ankleAngle.value}`);
  check("без оси — нейтральное 90", withoutAxis?.ankleAngle.value === 90);
  check("без оси — статус warning", withoutAxis?.ankleAngle.status === "warning");
}

console.log("\n=== 5b. Ненадёжный toe, но надёжный heel → fallback на пятку ===");
{
  const lm = lmNearLeft({ toeVis: 0.4 }); // heel 0.7 — надёжен
  const analysis = analyzeBikeFit(lm);
  check("предупреждения нет (heel fallback)", (analysis?.warnings ?? []).length === 0);
  check("угол посчитан по пятке, не нейтраль", analysis != null && analysis.ankleAngle.value !== 90);
}

console.log("\n=== 6. Нормальный кадр: предупреждений нет ===");
{
  const analysis = analyzeBikeFit(lmNearLeft());
  check("warnings пуст", (analysis?.warnings ?? []).length === 0);
  check("колено в норме диапазона", analysis != null && analysis.kneeAngle.value > 130);
  check("голеностоп посчитан по MediaPipe", analysis != null && analysis.ankleAngle.value !== 90);
  check("сторона left", analysis?.side === "left");
}

console.log(`\n=== ИТОГО: ${passed} ✅ / ${failed} ❌ ===`);
if (failed > 0) process.exit(1);
