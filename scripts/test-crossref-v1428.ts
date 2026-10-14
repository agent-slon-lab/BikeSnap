/**
 * Тест v1.14.28: кросс-валидация советов на данных из жалобы пользователя
 * (SH=680, целевая 759, колено 166.7°, спина 76.3°, плечо 41.5°, бедро 150.8°,
 * Reach 339 vs 411, Stack 648 vs 595).
 *
 * Проверяем:
 * 1. applyCrossMetricLogic переписывает советы плеча и бедра при вертикальном корпусе.
 * 2. applySaddleHeightContext ставит честный текст противоречия на колено.
 * 3. generateCrossReferences: НЕТ карточки «Опустите седло на 79», ЕСТЬ
 *    конфликт-карточка «седло НИЖЕ целевой»; карточка «Опустите руль»
 *    заменена конфликтной; карточка Reach сохранена.
 */
import {
  generateCrossReferences,
} from "../src/lib/bike-cross-ref";
import {
  applyCrossMetricLogic,
  applySaddleHeightContext,
  type BikeFitAnalysis,
} from "../src/lib/bike-fit";
import { calculateAll, type BodyMeasurements, type BikeMeasurements } from "../src/lib/bike-calculations";

// STATUS_COLORS приватен в bike-fit.ts — дублируем форму для теста
const STATUS_COLORS = {
  good: { text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40", border: "border-emerald-200 dark:border-emerald-900", ring: "ring-emerald-500/30" },
  warning: { text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/40", border: "border-amber-200 dark:border-amber-900", ring: "ring-amber-500/30" },
  bad: { text: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-950/40", border: "border-rose-200 dark:border-rose-900", ring: "ring-rose-500/30" },
} as const;

const body: BodyMeasurements = { height: 186, inseam: 86 };
const bike: BikeMeasurements = {
  saddleHeight: 680,
  reach: 339,
  stack: 648,
  ett: 560,
};

const goal = { goal: "comfort" as const, bikeType: "mtb" as const };

const base = {
  label: "",
  description: "",
  color: STATUS_COLORS.bad,
};

const rawAnalysis: BikeFitAnalysis = {
  kneeAngle: {
    ...base,
    value: 166.7,
    min: 140,
    max: 150,
    status: "bad",
    flexion: { value: 13.3, min: 30, max: 40, label: "сгиб" },
    recommendation: "Нога слишком прямая (167°). Опустите седло, чтобы угол в НМТ составлял 140–150°.",
  },
  hipAngle: {
    ...base,
    value: 150.8,
    min: 95,
    max: 105,
    status: "bad",
    recommendation: "Угол бедра слишком открыт — посадка избыточно растянута; сократите дистанцию седло–руль.",
  },
  backAngle: {
    ...base,
    value: 76.3,
    min: 35,
    max: 45,
    status: "bad",
    recommendation: "Спина стоит слишком вертикально — посадка высокая/комфортная.",
  },
  ankleAngle: {
    ...base,
    value: 130.9,
    min: 90,
    max: 110,
    status: "bad",
    recommendation: "Носок слишком опущен вниз.",
  },
  shoulderAngle: {
    ...base,
    value: 41.5,
    min: 70,
    max: 100,
    status: "bad",
    recommendation: "Руки слишком опущены — поднимите руль или используйте более короткий вынос.",
  },
  kops: {
    ...base,
    value: 0.5,
    min: 0,
    max: 3,
    status: "good",
    unit: "у.е.",
    signedValue: 0.5,
    recommendation: "Отличное положение колена над осью педали.",
  },
  side: "left",
};

let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failed++;
}

// --- 1. Кросс-логика метрик ---
const crossed = applyCrossMetricLogic(rawAnalysis);
check(
  "плечо: «поднимать руль нельзя» вместо «поднимите руль»",
  crossed.shoulderAngle.recommendation.includes("поднимать руль нельзя") &&
    !crossed.shoulderAngle.recommendation.includes("поднимите руль"),
);
check(
  "бедро: «посадка НЕ растянута» вместо «сократите дистанцию»",
  crossed.hipAngle.recommendation.includes("НЕ растянута") &&
    !crossed.hipAngle.recommendation.includes("сократите дистанцию"),
);
check("корпус: рекомендация не тронута", crossed.backAngle === rawAnalysis.backAngle);

// Идемпотентность
const twice = applyCrossMetricLogic(crossed);
check("идемпотентность applyCrossMetricLogic", twice.shoulderAngle.recommendation === crossed.shoulderAngle.recommendation);

// --- 2. Контекст высоты седла ---
const calc = calculateAll(body, bike, goal);
const targetSH = calc.recommendedSaddleHeight;
console.log(`   calc.recommendedSaddleHeight = ${targetSH} (ожидалось 759)`);
const patched = applySaddleHeightContext(crossed, bike.saddleHeight ?? null, targetSH);
check("колено: честный текст противоречия", patched.kneeAngle.recommendation.includes("Противоречие данных"));
check(
  "колено: указано «ниже целевых 759 мм на 79 мм»",
  patched.kneeAngle.recommendation.includes(`ниже целевых ${targetSH} мм`) &&
    patched.kneeAngle.recommendation.includes("79 мм"),
);
check("исходный анализ не мутирован", rawAnalysis.kneeAngle.recommendation.includes("Опустите седло"));

// --- 3. Комплексные рекомендации ---
const result = generateCrossReferences(bike, body, goal, calc, patched, []);
console.log("\n   Все карточки:");
for (const r of result.crossReferences) {
  console.log(`   [${r.priority}]${r.conflict ? " ⚠️CONFLICT" : ""} ${r.category}: ${r.finding}`);
  console.log(`        Связь: ${r.connection}`);
  console.log(`        → ${r.action}`);
}

const saddleCards = result.crossReferences.filter((r) => r.category === "saddle");
const shConflict = saddleCards.find((r) => r.conflict && r.finding.includes("НИЖЕ целевой"));
check("SH: есть конфликт-карточка «седло НИЖЕ целевой на 79 мм»", !!shConflict);
check(
  "SH: НЕТ абсурдного «Опустите седло на 79»",
  !result.crossReferences.some((r) => /Опустите седло на 79/.test(r.action)),
);
check(
  "SH: в конфликт-карточке нет ложного «выше нормы»",
  !shConflict || !shConflict.connection.includes("выше нормы"),
);

const barConflict = result.crossReferences.find(
  (r) => r.category === "handlebar" && r.conflict,
);
check(
  "руль: «Опустите руль» заменён конфликтной карточкой",
  !!barConflict && barConflict.finding.includes("поднимите руль"),
);
check(
  "руль: нет прямого приказа «Опустите руль:»",
  !result.crossReferences.some((r) => r.category === "handlebar" && /^Опустите руль/.test(r.action)),
);
check(
  "рама: карточка «Увеличьте Reach» на месте",
  result.crossReferences.some((r) => r.action.includes("Увеличьте Reach")),
);

// Знаковый KOPS: колено ПОЗАДИ оси (signedValue < 0) → «назад», а не «вперёд»
const kopsBehind: BikeFitAnalysis = {
  ...patched,
  kops: { ...patched.kops, value: 5, status: "bad", signedValue: -5 },
};
const res2 = generateCrossReferences(bike, body, goal, calc, kopsBehind, []);
const kopsCard = res2.crossReferences.find((r) => r.finding.startsWith("KOPS:"));
check(
  "KOPS: колено позади оси → направление «назад»",
  !!kopsCard && kopsCard.finding.includes("назад"),
);

console.log(failed === 0 ? "\n🎉 ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" : `\n💥 ПРОВАЛЕНО: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
