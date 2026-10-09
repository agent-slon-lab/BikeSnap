/**
 * Санити-тест v1.14.22: анатомический стандарт углов + кросс-валидация.
 * Запуск: npx tsx scripts/test-pose-norms.ts (или npx tsx).
 */
import { analyzeRiderPose, JOINT_NORMS, kneeFlexion, isTorsoUprightForHandComplaints, type BodyKeypoints } from "../src/lib/poseMetricsEngine";
import { analyzeBikeFit, type Landmarks } from "../src/lib/bike-fit";
import { getCausesForComplaints, type AnalysisResults } from "../src/lib/bike-complaints";
import { generateCrossReferences } from "../src/lib/bike-cross-ref";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  OK  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

// ---------- Геометрия тестового райдера (бок, смотрит вправо) ----------
// Координаты нормализованы 0..1, Y вниз. Масштаб: 1 ед. = 1000 мм условно.
// Торс наклонён ~40° от горизонтали (норма 35-45): бедро (0.4,0.5), плечо впереди-выше.
const torsoLeanDeg = 40;
const torsoLen = 0.25;
const hip = { x: 0.4, y: 0.5 };
// угол от горизонтали вверх вперёд:
const shoulder = {
  x: hip.x + torsoLen * Math.cos((torsoLeanDeg * Math.PI) / 180),
  y: hip.y - torsoLen * Math.sin((torsoLeanDeg * Math.PI) / 180),
};

// Нога: бедро вниз-вперёд, колено; голень вниз; НМТ — угол в колене = kneeAnatomical
function legPoints(kneeAnatomical: number) {
  // бедро: от бедра вниз-вперёд 70° ниже горизонтали
  const thighLen = 0.17;
  const knee = {
    x: hip.x + thighLen * Math.cos((-70 * Math.PI) / 180),
    y: hip.y - thighLen * Math.sin((-70 * Math.PI) / 180),
  };
  // направление в колене НА бедро
  const angKneeToHip = Math.atan2(hip.y - knee.y, hip.x - knee.x);
  const shinLen = 0.17;
  // угол между (knee→hip) и (knee→ankle) равен анатомическому углу:
  // поворачиваем направление на бедро на ±kneeAnatomical, берём кандидата,
  // у которого лодыжка НИЖЕ колена (Y растёт вниз)
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

console.log("=== 1. Движок poseMetricsEngine ===");
{
  const ok = analyzeRiderPose(mkKeypoints(145));
  check("колено 145° → OPTIMAL", ok.kneeAngle.status === "OPTIMAL", JSON.stringify(ok.kneeAngle));
  check("норма колена 140-150", ok.kneeAngle.norm.min === 140 && ok.kneeAngle.norm.max === 150);
  check("сгиб = 35", Math.abs(kneeFlexion(145) - 35) < 0.01);

  const straight = analyzeRiderPose(mkKeypoints(176.3));
  check("колено 176.3° → TOO_HIGH (не «ошибка распознавания»)", straight.kneeAngle.status === "TOO_HIGH");
  check("совет: опустите седло", /Опустите седло/.test(straight.kneeAngle.recommendation ?? ""), straight.kneeAngle.recommendation);

  const bent = analyzeRiderPose(mkKeypoints(120));
  check("колено 120° → TOO_LOW", bent.kneeAngle.status === "TOO_LOW");
  check("совет: поднимите седло", /Поднимите седло/.test(bent.kneeAngle.recommendation ?? ""));

  // Торс: hip→shoulder под 40° → OPTIMAL; сделаю вертикальный торс 60° и горизонталь 25°
  const mkTorso = (lean: number): BodyKeypoints => {
    const sh = {
      x: hip.x + torsoLen * Math.cos((lean * Math.PI) / 180),
      y: hip.y - torsoLen * Math.sin((lean * Math.PI) / 180),
    };
    const { knee, ankle, toe } = legPoints(145);
    return { shoulder: sh, hip, knee, ankle, toe };
  };
  const upright = analyzeRiderPose(mkTorso(60));
  check("торс 60° → TOO_HIGH + «вертикально»", upright.torsoAngle.status === "TOO_HIGH" && /вертикально/i.test(upright.torsoAngle.recommendation ?? ""), upright.torsoAngle.recommendation);
  const low = analyzeRiderPose(mkTorso(25));
  check("торс 25° → TOO_LOW + «низко»", low.torsoAngle.status === "TOO_LOW" && /низко/i.test(low.torsoAngle.recommendation ?? ""), low.torsoAngle.recommendation);
  const mid = analyzeRiderPose(mkTorso(40));
  check("торс 40° → OPTIMAL", mid.torsoAngle.status === "OPTIMAL", mid.torsoAngle.recommendation);
}

console.log("=== 2. analyzeBikeFit (bike-fit.ts) на MediaPipe-точках ===");
{
  const lm: Landmarks = {};
  const set = (i: number, p: { x: number; y: number }) => { lm[i] = { ...p, visibility: 0.99 }; };
  const kp = mkKeypoints(145);
  set(11, kp.shoulder); set(13, { x: kp.shoulder.x - 0.05, y: kp.shoulder.y + 0.06 });
  set(23, kp.hip); set(25, kp.knee); set(27, kp.ankle);
  set(29, { x: kp.ankle.x - 0.02, y: kp.ankle.y + 0.01 }); // heel
  set(31, kp.toe); // foot index
  const a = analyzeBikeFit(lm);
  check("analyzeBikeFit вернул анализ", !!a);
  if (a) {
    check("колено 145° → good, норма 140-150", a.kneeAngle.status === "good" && a.kneeAngle.min === 140 && a.kneeAngle.max === 150, `value=${a.kneeAngle.value} min=${a.kneeAngle.min} max=${a.kneeAngle.max}`);
    check("flexion 35 в результате", a.kneeAngle.flexion != null && Math.abs(a.kneeAngle.flexion.value - 35) < 0.5);
    check("наклон корпуса 40 → good", a.backAngle.status === "good" && Math.abs(a.backAngle.value - 40) < 1.5, `value=${a.backAngle.value}`);
    check("голеностоп посчитан по носку", a.ankleAngle.value > 0);
  }

  // экстремально прямая нога 176°: NOT "ошибка распознавания", а "слишком прямая"
  const kp2 = mkKeypoints(176.3);
  const lm2: Landmarks = {};
  const set2 = (i: number, p: { x: number; y: number }) => { lm2[i] = { ...p, visibility: 0.99 }; };
  set2(11, kp2.shoulder); set2(13, { x: kp2.shoulder.x - 0.05, y: kp2.shoulder.y + 0.06 });
  set2(23, kp2.hip); set2(25, kp2.knee); set2(27, kp2.ankle);
  set2(29, { x: kp2.ankle.x - 0.02, y: kp2.ankle.y + 0.01 }); set2(31, kp2.toe);
  const a2 = analyzeBikeFit(lm2);
  if (a2) {
    check("колено 176.3° → bad, но совет «Опустите седло» (не ошибка распознавания)", /Опустите седло/.test(a2.kneeAngle.recommendation), a2.kneeAngle.recommendation);
  }

  // колено 145: sanity не должен ругаться
  if (a) check("145° внутри sanity 130..160", a.kneeAngle.status !== "bad" || !/Ошибка распознавания/.test(a.kneeAngle.recommendation));
}

console.log("=== 3. Кросс-валидация жалоб (онемение рук + торс >50°) ===");
{
  // райдер: торс 58.7° (почти вертикально), плечо 54.3° (bad по 70-100)
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
  const side = analyzeBikeFit(mkLm(58.7));
  check("торс ≈58.7° распознан как bad/вертикальный", !!side && side.backAngle.value > 50 && side.backAngle.status === "bad", side ? `value=${side.backAngle.value}` : "");
  const analysis: AnalysisResults = { side, back: null, front: null };
  const causes = getCausesForComplaints(["wrist_numbness"], analysis);
  const lowBar = causes.find((c) => /низкий руль/i.test(c.title) && c.priority === 1);
  check("«Слишком низкий руль» понижен (triggered=false)", !!lowBar && lowBar.triggered === false);
  check("«Слишком низкий руль» имеет кросс-заметку", !!lowBar?.crossNote);
  const saddleFwd = causes.find((c) => /завалено вперёд/i.test(c.title));
  check("«Седло завалено вперёд» повышено (boosted)", !!saddleFwd?.boosted);
  check("boosted сортируется выше неприоритетных", causes.findIndex((c) => c.boosted) < causes.findIndex((c) => /низкий руль/i.test(c.title) && c.crossNote));

  // Контроль: торс 38° (норма) — кросс-валидация НЕ срабатывает
  const sideOk = analyzeBikeFit(mkLm(38));
  const causesOk = getCausesForComplaints(["wrist_numbness"], { side: sideOk, back: null, front: null });
  const lowBarOk = causesOk.find((c) => /низкий руль/i.test(c.title) && c.priority === 1);
  check("при торсе 38° «низкий руль» не трогается", !!lowBarOk && !lowBarOk.crossNote && !lowBarOk.boosted);
}

console.log("=== 4. Склейка советов по седлу (LeMond > 20 мм) ===");
{
  const { BikeMeasurements, BodyMeasurements } = {} as any; // типы только для компиляции
  const bike = {
    saddleHeight: 780, reach: 395, stack: 560, ett: 545, wheelHeight: 670, bbHeight: 268, stemAngle: 6,
  };
  const body = { height: 178, inseam: 84, torso: 55, arm: 60 };
  const calc = { recommendedSaddleHeight: 741.7, targetReach: 400, targetStack: 555, bbDrop: 70 } as any;
  const lm: Landmarks = {};
  const kp = mkKeypoints(176.3); // нога прямая + носок опущен (угол голеностопа > 110)
  lm[11] = { ...kp.shoulder, visibility: 0.99 };
  lm[13] = { x: kp.shoulder.x - 0.08, y: kp.shoulder.y + 0.1, visibility: 0.99 };
  lm[23] = { ...hip, visibility: 0.99 };
  lm[25] = { ...kp.knee, visibility: 0.99 };
  lm[27] = { ...kp.ankle, visibility: 0.99 };
  lm[29] = { x: kp.ankle.x - 0.02, y: kp.ankle.y + 0.01, visibility: 0.99 };
  lm[31] = { ...kp.toe, visibility: 0.99 };
  const side = analyzeBikeFit(lm);
  const bikeMeas = bike as any;
  const bodyMeas = body as any;
  const res = generateCrossReferences(bikeMeas, bodyMeas, null, calc, side, []);
  const saddleRefs = res.crossReferences.filter((r) => r.category === "saddle");
  const hasLeMond = saddleRefs.some((r) => /41|38|39|40/.test(r.action));
  const hasMicro = saddleRefs.some((r) => /2-3 мм/.test(r.action));
  check("дельта LeMond ≈38 мм > 20 → совет по LeMond есть", hasLeMond, JSON.stringify(saddleRefs.map((r) => r.action)));
  check("микро-подстройка 2-3 мм СКРЫТА", !hasMicro, JSON.stringify(saddleRefs.map((r) => r.action)));

  // Контроль: дельта 10 мм — микро-подстройка видна
  const calc10 = { ...calc, recommendedSaddleHeight: 770 } as any;
  const res10 = generateCrossReferences(bikeMeas, bodyMeas, null, calc10, side, []);
  const saddle10 = res10.crossReferences.filter((r) => r.category === "saddle");
  const hasMicro10 = saddle10.some((r) => /2-3 мм/.test(r.action));
  check("дельта 10 мм ≤ 20 → микро-подстройка 2-3 мм видна", hasMicro10, JSON.stringify(saddle10.map((r) => r.action)));
}

console.log(`\nИТОГО: ${pass} OK, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
