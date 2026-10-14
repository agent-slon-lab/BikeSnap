/**
 * Верификация v1.14.29 — «Refactoring Spec & Enhanced Debug Telemetry»
 * (Issue #6). Запуск: bun run scripts/verify-v1429.ts
 *
 * A. Модуль расчёта позы:
 *   1. Нормы — анатомический стандарт 180° (колено 140–150, бедро 95–105,
 *      корпус 35–45, голеностоп 90–110).
 *   2. Тексты наклона корпуса: >45° «слишком ВЕРТИКАЛЬНО (комфортная
 *      посадка)… опустите вынос»; <35° «слишком ГОРИЗОНТАЛЬНО… поднимите
 *      вынос» — БЕЗ инверсии, значение угла в тексте.
 *   3. Иерархия советов по седлу: дельта LeMond > 15 мм — только крупная
 *      правка, микро-советы «2–3 мм» подавлены.
 * B. Телеметрия отчёта: extractPoseKeypoints (5 суставов, лево/право),
 *    normalizeScaleKind (USER_SADDLE_HEIGHT / FALLBACK_WB / …).
 */
import {
  analyzeRiderPose,
  JOINT_NORMS,
  SADDLE_HIERARCHY_THRESHOLD_MM,
  POSE_ENGINE_VERSION,
  type BodyKeypoints,
} from "../src/lib/poseMetricsEngine";
import { analyzeBikeFit, extractPoseKeypoints, type Landmarks } from "../src/lib/bike-fit";
import { generateCrossReferences } from "../src/lib/bike-cross-ref";
import { normalizeScaleKind } from "../src/lib/fit-report";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  OK  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

// ---------- Геометрия тестового райдера (бок, смотрит вправо) ----------
const hip = { x: 0.4, y: 0.5 };
const torsoLen = 0.25;
const torsoLeanDeg = 40;
const shoulder = {
  x: hip.x + torsoLen * Math.cos((torsoLeanDeg * Math.PI) / 180),
  y: hip.y - torsoLen * Math.sin((torsoLeanDeg * Math.PI) / 180),
};

function legPoints(kneeAnatomical: number) {
  const thighLen = 0.17;
  const knee = {
    x: hip.x + thighLen * Math.cos((-70 * Math.PI) / 180),
    y: hip.y - thighLen * Math.sin((-70 * Math.PI) / 180),
  };
  const angKneeToHip = Math.atan2(hip.y - knee.y, hip.x - knee.x);
  const shinLen = 0.17;
  const phi = (kneeAnatomical * Math.PI) / 180;
  const cand1 = {
    x: knee.x + shinLen * Math.cos(angKneeToHip + phi),
    y: knee.y + shinLen * Math.sin(angKneeToHip + phi),
  };
  const cand2 = {
    x: knee.x + shinLen * Math.cos(angKneeToHip - phi),
    y: knee.y + shinLen * Math.sin(angKneeToHip - phi),
  };
  const ankle = cand1.y > cand2.y ? cand1 : cand2;
  const toe = { x: ankle.x + 0.045, y: ankle.y + 0.04 };
  return { knee, ankle, toe };
}

const mkKeypoints = (kneeDeg: number): BodyKeypoints => {
  const { knee, ankle, toe } = legPoints(kneeDeg);
  return { shoulder, hip, knee, ankle, toe };
};

console.log("=== A1. Нормы — анатомический стандарт (180° = выпрямлен) ===");
{
  check("колено 140–150", JOINT_NORMS.knee.min === 140 && JOINT_NORMS.knee.max === 150);
  check("бедро 95–105", JOINT_NORMS.hip.min === 95 && JOINT_NORMS.hip.max === 105);
  check("корпус 35–45", JOINT_NORMS.torso.min === 35 && JOINT_NORMS.torso.max === 45);
  check("голеностоп 90–110", JOINT_NORMS.ankle.min === 90 && JOINT_NORMS.ankle.max === 110);
  check("порог иерархии = 15 мм", SADDLE_HIERARCHY_THRESHOLD_MM === 15);
  check("версия движка экспортируется", /^pose-engine@\d/.test(POSE_ENGINE_VERSION), POSE_ENGINE_VERSION);
}

console.log("=== A2. Тексты наклона корпуса (без инверсии, по ТЗ Issue #6) ===");
{
  const mkTorso = (lean: number): BodyKeypoints => {
    const sh = {
      x: hip.x + torsoLen * Math.cos((lean * Math.PI) / 180),
      y: hip.y - torsoLen * Math.sin((lean * Math.PI) / 180),
    };
    const { knee, ankle, toe } = legPoints(145);
    return { shoulder: sh, hip, knee, ankle, toe };
  };

  const upright = analyzeRiderPose(mkTorso(60));
  check("торс 60° → TOO_HIGH", upright.torsoAngle.status === "TOO_HIGH");
  check("текст: «слишком ВЕРТИКАЛЬНО (комфортная посадка)»", /ВЕРТИКАЛЬНО \(комфортная посадка\)/.test(upright.torsoAngle.recommendation ?? ""), upright.torsoAngle.recommendation);
  check("текст: «Для аэродинамики опустите вынос»", /аэродинамики опустите вынос/.test(upright.torsoAngle.recommendation ?? ""));
  check("текст содержит значение угла (60)", /60°/.test(upright.torsoAngle.recommendation ?? ""));
  check("текст НЕ про «горизонтально»", !/горизонтально/i.test(upright.torsoAngle.recommendation ?? ""));

  const low = analyzeRiderPose(mkTorso(25));
  check("торс 25° → TOO_LOW", low.torsoAngle.status === "TOO_LOW");
  check("текст: «слишком ГОРИЗОНТАЛЬНО»", /ГОРИЗОНТАЛЬНО/.test(low.torsoAngle.recommendation ?? ""), low.torsoAngle.recommendation);
  check("текст: «Для снятия нагрузки с поясницы поднимите вынос»", /поясницы поднимите вынос/.test(low.torsoAngle.recommendation ?? ""));
  check("текст НЕ про «вертикально»", !/вертикально/i.test(low.torsoAngle.recommendation ?? ""));

  const straight = analyzeRiderPose(mkKeypoints(176.3));
  check("колено 176.3°: «избыточно выпрямлена (…при норме 140–150°)»", /избыточно выпрямлена \(176\.3° при норме 140–150°\)/.test(straight.kneeAngle.recommendation ?? ""), straight.kneeAngle.recommendation);
  check("колено 176.3°: совет «Опустите седло»", /Опустите седло/.test(straight.kneeAngle.recommendation ?? ""));
  const bent = analyzeRiderPose(mkKeypoints(120));
  check("колено 120°: «слишком согнуто (…при норме 140–150°)» + «Поднимите седло»", /слишком согнуто \(120° при норме 140–150°\)/.test(bent.kneeAngle.recommendation ?? "") && /Поднимите седло/.test(bent.kneeAngle.recommendation ?? ""), bent.kneeAngle.recommendation);
}

console.log("=== A2b. Те же тексты в боевом analyzeBikeFit ===");
{
  const mkLm = (lean: number): Landmarks => {
    const sh = {
      x: hip.x + torsoLen * Math.cos((lean * Math.PI) / 180),
      y: hip.y - torsoLen * Math.sin((lean * Math.PI) / 180),
    };
    const { knee, ankle, toe } = legPoints(145);
    const lm: Landmarks = {};
    lm[11] = { ...sh, visibility: 0.99 };
    lm[13] = { x: sh.x - 0.08, y: sh.y + 0.1, visibility: 0.99 };
    lm[23] = { ...hip, visibility: 0.99 };
    lm[25] = { ...knee, visibility: 0.99 };
    lm[27] = { ...ankle, visibility: 0.99 };
    lm[29] = { x: ankle.x - 0.02, y: ankle.y + 0.01, visibility: 0.99 };
    lm[31] = { ...toe, visibility: 0.99 };
    return lm;
  };
  const up = analyzeBikeFit(mkLm(60));
  check("боевой: торс 60° → «ВЕРТИКАЛЬНО (комфортная посадка) — 60.0°. Для аэродинамики опустите вынос.»", !!up && /ВЕРТИКАЛЬНО \(комфортная посадка\) — 60\.0°\. Для аэродинамики опустите вынос\./.test(up.backAngle.recommendation), up?.backAngle.recommendation);
  const low = analyzeBikeFit(mkLm(25));
  check("боевой: торс 25° → «ГОРИЗОНТАЛЬНО … Для снятия нагрузки с поясницы поднимите вынос.»", !!low && /ГОРИЗОНТАЛЬНО \(агрессивная посадка\) — 25\.0°\. Для снятия нагрузки с поясницы поднимите вынос\./.test(low.backAngle.recommendation), low?.backAngle.recommendation);
}

// ---------- Фикстура анализа для cross-ref ----------
// STATUS_COLORS приватен в bike-fit.ts — дублируем форму для теста
const STATUS_COLORS = {
  good: { text: "t", bg: "b", border: "bo", ring: "r" },
  warning: { text: "t", bg: "b", border: "bo", ring: "r" },
  bad: { text: "t", bg: "b", border: "bo", ring: "r" },
} as const;
const ar = (value: number, min: number, max: number, status: "good" | "warning" | "bad", rec = "") => ({
  value, min, max, status, label: "", description: "",
  color: STATUS_COLORS[status],
  recommendation: rec,
});
const mkAnalysis = (kneeValue: number, ankleValue: number, kneeStatus: "good" | "warning" | "bad", ankleStatus: "good" | "warning" | "bad") => ({
  kneeAngle: {
    ...ar(kneeValue, 140, 150, kneeStatus, "тест"),
    flexion: { value: 180 - kneeValue, min: 30, max: 40, label: "сгиб" },
  },
  hipAngle: ar(100, 95, 105, "good"),
  backAngle: ar(40, 35, 45, "good"),
  ankleAngle: ar(ankleValue, 90, 110, ankleStatus, "тест"),
  shoulderAngle: ar(85, 70, 100, "good"),
  kops: { ...ar(2, 0, 10, "good"), signedValue: 2 },
  side: "right" as const,
});

const body = { height: 186, inseam: 86 } as any;
const mkBike = (sh: number) => ({ saddleHeight: sh, reach: 400, stack: 590, ett: 555 } as any);
const mkCalc = (targetSH: number) => ({ recommendedSaddleHeight: targetSH, targetReach: 400, targetStack: 590 } as any);

console.log("=== A3. Иерархия советов по седлу (порог 15 мм, Issue #6) ===");
{
  // A3-1: дельта 79 мм (SH=680, цель 759), колено В НОРМЕ, голеностоп bad:
  // должна быть ТОЛЬКО крупная правка «Поднимите седло на 79 мм», микро «2–3 мм» — скрыта.
  const r1 = generateCrossReferences(mkBike(680), body, null, mkCalc(759), mkAnalysis(145, 115, "good", "bad"), []);
  const acts1 = r1.crossReferences.map((r) => r.action);
  const big1 = r1.crossReferences.find((r) => r.category === "saddle" && /79 мм/.test(r.action));
  check("дельта 79 мм: крупная карточка «Поднимите седло на 79 мм» есть", !!big1, JSON.stringify(acts1));
  check("дельта 79 мм: карточка помечена как расхождение данных (conflict)", !!big1?.conflict);
  check("дельта 79 мм: в finding есть SH=680 и целевая 759", !!big1 && /SH=680/.test(big1.finding) && /759/.test(big1.finding));
  check("дельта 79 мм: микро «2-3 мм» СКРЫТА", !acts1.some((a) => /2-3 мм/.test(a)), JSON.stringify(acts1));

  // A3-2: дельта 16 мм (> порога) — микро скрыта, крупная есть
  const r2 = generateCrossReferences(mkBike(743), body, null, mkCalc(759), mkAnalysis(145, 115, "good", "bad"), []);
  const acts2 = r2.crossReferences.map((r) => r.action);
  check("дельта 16 мм > 15: микро «2-3 мм» скрыта", !acts2.some((a) => /2-3 мм/.test(a)), JSON.stringify(acts2));
  check("дельта 16 мм: крупная карточка «на 16 мм» есть", r2.crossReferences.some((r) => /16 мм/.test(r.action) && r.category === "saddle"), JSON.stringify(acts2));

  // A3-3: дельта 14 мм (≤ порога) — микро «2-3 мм» видна, крупной нет
  const r3 = generateCrossReferences(mkBike(745), body, null, mkCalc(759), mkAnalysis(145, 115, "good", "bad"), []);
  const acts3 = r3.crossReferences.map((r) => r.action);
  check("дельта 14 мм ≤ 15: микро «2-3 мм» видна", acts3.some((a) => /2-3 мм/.test(a)), JSON.stringify(acts3));
  check("дельта 14 мм: крупной карточки «на 14 мм» нет", !r3.crossReferences.some((r) => /на 14 мм/.test(r.action)), JSON.stringify(acts3));

  // A3-4: регресс v1.14.28 — противоречие (колено bad + седло ниже целевой):
  // конфликт-карточка, НЕТ «Опустите/Поднимите на 79», НЕТ дубля 1b.
  const r4 = generateCrossReferences(mkBike(680), body, null, mkCalc(759), mkAnalysis(166.7, 115, "bad", "bad"), []);
  const acts4 = r4.crossReferences.map((r) => r.action);
  const conflict4 = r4.crossReferences.find((r) => r.conflict && /ниже целевой/i.test(r.finding));
  check("противоречие: конфликт-карточка «седло НИЖЕ целевой» есть", !!conflict4, JSON.stringify(acts4));
  check("противоречие: НЕТ слепой «на 79 мм»", !acts4.some((a) => /на 79 мм/.test(a)), JSON.stringify(acts4));
  const saddleCount4 = r4.crossReferences.filter((r) => r.category === "saddle" && r.priority === 1).length;
  check("противоречие: ровно одна приоритет-1 карточка по седлу", saddleCount4 === 1, JSON.stringify(acts4));

  // A3-5: дельта 79 мм, колено СЛИШКОМ ПРЯМОЕ и согласовано (SH ВЫШЕ целевой):
  // обычная карточка секции 1 «Опустите седло на N», 1b не дублируется.
  const r5 = generateCrossReferences(mkBike(830), body, null, mkCalc(759), mkAnalysis(166.7, 115, "bad", "bad"), []);
  const acts5 = r5.crossReferences.map((r) => r.action);
  check("согласовано: «Опустите седло на 71 мм» есть", acts5.some((a) => /Опустите седло на 71 мм/.test(a)), JSON.stringify(acts5));
  check("согласовано: нет дубля «расходится с расчётной»", !r5.crossReferences.some((r) => /расходится с расчётной/.test(r.finding)), JSON.stringify(acts5));
}

console.log("=== B1. extractPoseKeypoints (сырые 2D-точки суставов) ===");
{
  const lmFull: Landmarks = {};
  const set = (i: number, x: number, y: number) => { lmFull[i] = { x, y, visibility: 0.99 }; };
  set(11, 0.50, 0.30); // L shoulder
  set(23, 0.50, 0.50); // L hip
  set(25, 0.52, 0.65); // L knee
  set(27, 0.53, 0.80); // L ankle
  set(31, 0.58, 0.81); // L toe
  const kpLeft = extractPoseKeypoints(lmFull as never);
  check("левая сторона: 5 суставов", !!kpLeft && Object.keys(kpLeft).length === 5);
  check("левая: shoulder = (0.5, 0.3)", !!kpLeft && Math.abs(kpLeft.shoulder.x - 0.5) < 1e-9 && Math.abs(kpLeft.shoulder.y - 0.3) < 1e-9);
  check("левая: toe = L foot index", !!kpLeft && Math.abs(kpLeft.toe.x - 0.58) < 1e-9);

  // только правая сторона видна — фолбэк
  const lmRight: Landmarks = {};
  const setR = (i: number, x: number, y: number) => { lmRight[i] = { x, y, visibility: 0.99 }; };
  setR(12, 0.48, 0.30); setR(24, 0.48, 0.50); setR(26, 0.46, 0.65); setR(28, 0.45, 0.80); setR(32, 0.40, 0.81);
  const kpRight = extractPoseKeypoints(lmRight as never);
  check("правая сторона (фолбэк без side): 5 суставов right", !!kpRight && Math.abs(kpRight.shoulder.x - 0.48) < 1e-9);

  // side="right" приоритетен, лево невидимо — right; side="left" при невидимом лево — фолбэк right
  const kpForced = extractPoseKeypoints(lmRight as never, "left");
  check("side=left при невидимом лево → фолбэк right", !!kpForced && Math.abs(kpForced.shoulder.x - 0.48) < 1e-9);

  // ни одна сторона не видна → null
  const lmBad: Landmarks = {};
  lmBad[11] = { x: 0.1, y: 0.1, visibility: 0.2 };
  check("не видно ни одной стороны → null", extractPoseKeypoints(lmBad as never) === null);
  check("null/пустой landmarks → null", extractPoseKeypoints(null) === null && extractPoseKeypoints([]) === null);
}

console.log("=== B2. normalizeScaleKind (флаги калибровки для telemetry) ===");
{
  check("USER_OVERRIDE saddleHeight → USER_SADDLE_HEIGHT", normalizeScaleKind("USER_OVERRIDE (saddleHeight = 680mm) — СТРОГО (консенсус подтверждает: 3/4)") === "USER_SADDLE_HEIGHT");
  check("USER_OVERRIDE wheelbase → USER_OVERRIDE", normalizeScaleKind("USER_OVERRIDE (wheelbase = 1000mm) — СТРОГО") === "USER_OVERRIDE");
  check("CONSENSUS → CONSENSUS", normalizeScaleKind("CONSENSUS (медиана 3 измерений: ett, wb, wh)") === "CONSENSUS");
  check("FALLBACK_AUTO → FALLBACK_WB", normalizeScaleKind("FALLBACK_AUTO (Wheelbase = 1005mm)") === "FALLBACK_WB");
  check("null/пусто → null", normalizeScaleKind(null) === null && normalizeScaleKind("") === null);
  check("неизвестное → UNKNOWN", normalizeScaleKind("что-то иное") === "UNKNOWN");
}

console.log(`\nИТОГО: ${pass} OK, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
