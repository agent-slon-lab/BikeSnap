/**
 * Верификация v1.14.31 — «Multi-Bike State Isolation» (ТЗ п. A.1 «Жёсткая
 * привязка калибровки»). Запуск: npx tsx scripts/test-calib-ownership-v1431.ts
 *
 * ТЗ: «В объекте калибровки обязательно передавать bikeId. Перед расчётом
 * разницы по LeMond проверять совпадение:
 *   if (calibration.bikeId !== currentBike.id) return;»
 *
 * Сценарий бага: райдер 186/86 (LeMond 759 мм) снял Bike_A (SH=800),
 * создал Bike_B — чужая SH=800 осталась в контексте отчёта Bike_B →
 * «Опустите седло на 41 мм» на новом веле.
 *
 * Проверки:
 *  A. isCalibrationOwnershipValid — строгий матч/промах/недоказанность.
 *  B. applySaddleHeightContext — чужая калибровка не попадает в LeMond-текст.
 *  C. generateCrossReferences — SH-секции (LeMond-дельта, SH↔колено,
 *     SH↔голеностоп) запрещены при чужой калибровке.
 *  D. bike-store.bikeId — установка только через loadBikeData(m, id);
 *     без id обнуляется; setBike-патчи не ломают принадлежность.
 *  E. E2E: чужая SH=800 в контексте Bike_B блокируется гвардом в точке
 *     расчёта (главный регресс баг-репорта).
 */

// Модуль-изоляция: без экспорта файл считается глобальным скриптом и
// коллидит глобсами с test-stale-state-v1430.ts в tsc --noEmit.
export {};

// Типы — только для TS (import type стирается при компиляции и НЕ выполняет
// модули: рантайм-импорты остаются динамическими, ПОСЛЕ polyfill localStorage)
import type { BikeFitAnalysis } from "../src/lib/bike-fit";
import type {
  BodyMeasurements,
  BikeMeasurements,
} from "../src/lib/bike-calculations";

// ---------- 0. Полифил localStorage ДО импортов сторов ----------
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => void mem.clear(),
  key: (i: number) => Array.from(mem.keys())[i] ?? null,
  get length() {
    return mem.size;
  },
};

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  OK  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

async function main() {
  const { isCalibrationOwnershipValid } = await import(
    "../src/lib/poseMetricsEngine"
  );
  const bikeFit = await import("../src/lib/bike-fit");
  const applySaddleHeightContext = bikeFit.applySaddleHeightContext;
  const { generateCrossReferences } = await import("../src/lib/bike-cross-ref");
  const { useBikeStore } = await import("../src/lib/bike-store");
  const { createBike, getBikes, setActiveBike } = await import(
    "../src/lib/bike-storage"
  );
  const { calculateAll } = await import("../src/lib/bike-calculations");

  // ---------- Фикстуры (данные из баг-репорта) ----------
  const STATUS_COLORS = {
    good: { text: "", bg: "", border: "", ring: "" },
    warning: { text: "", bg: "", border: "", ring: "" },
    bad: { text: "", bg: "", border: "", ring: "" },
  } as const;
  const base = { label: "", description: "", color: STATUS_COLORS.bad };
  const rawAnalysis: BikeFitAnalysis = {
    side: "left",
    kneeAngle: {
      ...base,
      value: 166.7,
      min: 140,
      max: 150,
      status: "bad",
      flexion: { value: 13.3, min: 30, max: 40, label: "сгиб" },
      recommendation: "Нога слишком прямая (167°).",
    },
    hipAngle: { ...base, value: 150.8, min: 95, max: 105, status: "bad", recommendation: "—" },
    backAngle: { ...base, value: 76.3, min: 35, max: 45, status: "bad", recommendation: "—" },
    ankleAngle: { ...base, value: 130.9, min: 90, max: 110, status: "bad", recommendation: "—" },
    shoulderAngle: { ...base, value: 41.5, min: 65, max: 90, status: "bad", recommendation: "—" },
    kops: { ...base, value: 0.5, min: -1, max: 1, status: "good", recommendation: "—" },
  };
  const cloneAnalysis = (): BikeFitAnalysis => JSON.parse(JSON.stringify(rawAnalysis));

  const body: BodyMeasurements = { height: 186, inseam: 86 };
  const goal = { goal: "sport" as const, bikeType: "road" as const };

  // ---------- A. isCalibrationOwnershipValid ----------
  console.log("\n=== A. isCalibrationOwnershipValid ===");
  check("A1 undefined → true (обратная совместимость вызовов без проверки)",
    isCalibrationOwnershipValid(undefined) === true);
  check("A2 {A,A} → true (владение доказано)",
    isCalibrationOwnershipValid({ calibBikeId: "bike_A", currentBikeId: "bike_A" }) === true);
  check("A3 {A,B} → false (чужая калибровка — ТЗ: if != return)",
    isCalibrationOwnershipValid({ calibBikeId: "bike_A", currentBikeId: "bike_B" }) === false);
  check("A4 {null,B} → false (принадлежность не доказана)",
    isCalibrationOwnershipValid({ calibBikeId: null, currentBikeId: "bike_B" }) === false);
  check("A5 {A,null} → false (активный вел неизвестен)",
    isCalibrationOwnershipValid({ calibBikeId: "bike_A", currentBikeId: null }) === false);

  // ---------- B. applySaddleHeightContext: ownership-гвард ----------
  console.log("\n=== B. applySaddleHeightContext: чужая SH запрещена ===");
  // baseline: knee 166.7 (прямая), SH 680 < 759 → противоречие честно фиксируется
  const calc = calculateAll(body, { saddleHeight: 680 } as BikeMeasurements, goal);
  const targetSH = calc.recommendedSaddleHeight; // 759
  check("B0 fixture: LeMond цель = 759 мм", targetSH === 759, `получено ${targetSH}`);

  const b1 = cloneAnalysis();
  const patched = applySaddleHeightContext(b1, 680, 759);
  check("B1 без ownership — контекст применяется (старое поведение)",
    patched.kneeAngle.recommendation.includes("Противоречие данных"));

  const b2 = cloneAnalysis();
  const untouched = applySaddleHeightContext(b2, 680, 759, {
    calibBikeId: "bike_A", currentBikeId: "bike_B",
  });
  check("B2 чужая калибровка {A,B} — LeMond-контекст НЕ применён",
    !untouched.kneeAngle.recommendation.includes("Противоречие данных"));
  check("B3 чужая калибровка — исходный текст колена сохранён",
    untouched.kneeAngle.recommendation === b2.kneeAngle.recommendation);

  const b3 = cloneAnalysis();
  const own = applySaddleHeightContext(b3, 680, 759, {
    calibBikeId: "bike_B", currentBikeId: "bike_B",
  });
  check("B4 своя калибровка {B,B} — контекст применён как раньше",
    own.kneeAngle.recommendation.includes("Противоречие данных"));

  const b4 = cloneAnalysis();
  const noProof = applySaddleHeightContext(b4, 680, 759, {
    calibBikeId: null, currentBikeId: "bike_B",
  });
  check("B5 недоказанная принадлежность {null,B} — контекст запрещён",
    !noProof.kneeAngle.recommendation.includes("Противоречие данных"));

  // ---------- C. generateCrossReferences: SH-секции ----------
  console.log("\n=== C. generateCrossReferences: SH-секции под гвардом ===");
  const bikeFixture: BikeMeasurements = {
    saddleHeight: 680,
    reach: 339,
    stack: 648,
    ett: 560,
    wheelHeight: 670,
  };
  // C-baseline: дельта 79 мм > 15 → крупная карточка, микро-советы подавлены
  const r1 = generateCrossReferences(bikeFixture, body, goal, calc, rawAnalysis, []);
  const saddleRefs1 = r1.crossReferences.filter((r) => r.category === "saddle");
  check("C1 baseline: SH-карточки присутствуют (своя калибровка)",
    saddleRefs1.length > 0);

  // C-mismatch: ownership {A,B} → все SH-секции запрещены
  const r2 = generateCrossReferences(
    bikeFixture, body, goal, calc, rawAnalysis, [],
    { calibBikeId: "bike_A", currentBikeId: "bike_B" },
  );
  const saddleRefs2 = r2.crossReferences.filter((r) => r.category === "saddle");
  check("C2 чужая калибровка: НЕТ ни одной saddle-карточки (SH вне закона)",
    saddleRefs2.length === 0,
    `найдено ${saddleRefs2.length}: ${saddleRefs2.map((r) => r.finding).join(" | ")}`);
  check("C3 чужая калибровка: нет упоминаний SH в actions/connections",
    !r2.crossReferences.some((r) => /SH=\d/.test(r.connection + r.action + r.finding)));

  // C-own: ownership {B,B} — поведение как baseline
  const r3 = generateCrossReferences(
    bikeFixture, body, goal, calc, rawAnalysis, [],
    { calibBikeId: "bike_B", currentBikeId: "bike_B" },
  );
  check("C4 своя калибровка {B,B} — saddle-карточки на месте",
    r3.crossReferences.filter((r) => r.category === "saddle").length === saddleRefs1.length);

  // C-ankle: SH близко к цели (дельта ≤ 15) → секция 7 (голеностоп) живёт;
  // при чужой калибровке «седло слишком высоко» из чужого SH запрещено.
  const bikeNearTarget: BikeMeasurements = { ...bikeFixture, saddleHeight: 750 };
  const calcNear = calculateAll(body, bikeNearTarget, goal);
  const r4 = generateCrossReferences(
    bikeNearTarget, body, goal, calcNear, rawAnalysis, [],
    { calibBikeId: "bike_B", currentBikeId: "bike_B" },
  );
  const ankleCard = r4.crossReferences.find((r) => /голеностопа/.test(r.finding));
  check("C5 своя калибровка: микро-совет по голеностопу присутствует",
    !!ankleCard);
  const r5 = generateCrossReferences(
    bikeNearTarget, body, goal, calcNear, rawAnalysis, [],
    { calibBikeId: "bike_A", currentBikeId: "bike_B" },
  );
  check("C6 чужая калибровка: микро-совет по голеностопу (SH!) подавлен",
    !r5.crossReferences.some((r) => /голеностопа/.test(r.finding) && r.category === "saddle"));

  // ---------- D. bike-store.bikeId ----------
  console.log("\n=== D. bike-store: bikeId — proof of ownership ===");
  useBikeStore.getState().resetDraftState();
  const st0 = useBikeStore.getState();
  check("D1 стартовый черновик: bikeId = null", st0.bikeId === null);

  useBikeStore.getState().loadBikeData({ saddleHeight: 800, wheelbase: 980 }, "bike_A");
  const st1 = useBikeStore.getState();
  check("D2 loadBikeData(m, id) устанавливает bikeId", st1.bikeId === "bike_A");
  check("D3 loadBikeData с id переносит значения (SH=800)",
    st1.bike.saddleHeight === 800);

  useBikeStore.getState().setBike({ saddleHeight: 810 });
  check("D4 setBike-патч формы НЕ меняет принадлежность",
    useBikeStore.getState().bikeId === "bike_A");

  useBikeStore.getState().loadBikeData({ saddleHeight: 700 });
  check("D5 loadBikeData БЕЗ id обнуляет bikeId (консервативно)",
    useBikeStore.getState().bikeId === null);
  check("D6 loadBikeData без id — значения заменены полностью",
    useBikeStore.getState().bike.saddleHeight === 700 &&
    useBikeStore.getState().bike.wheelbase === undefined);

  useBikeStore.getState().loadBikeData({ saddleHeight: 800 }, "bike_A");
  useBikeStore.getState().resetDraftState();
  check("D7 resetDraftState стирает и bikeId, и параметры",
    useBikeStore.getState().bikeId === null &&
    useBikeStore.getState().bike.saddleHeight === undefined);

  useBikeStore.getState().loadBikeData({ saddleHeight: 800 }, "bike_A");
  useBikeStore.getState().reset();
  check("D8 полный reset стирает bikeId",
    useBikeStore.getState().bikeId === null);

  // ---------- E. E2E: сценарий баг-репорта под гвардом ----------
  console.log("\n=== E. E2E: SH=800 от Bike_A не участвует в отчёте Bike_B ===");
  // Два вела одного райдера (LeMond 759 у обоих)
  const cardA = createBike("Bike_A", "road", { saddleHeight: 800, wheelbase: 985, wheelHeight: 670 });
  const cardB = createBike("Bike_B", "road", {});
  setActiveBike(cardA.id);
  useBikeStore.getState().resetDraftState();
  useBikeStore.getState().loadBikeData(
    getBikes().find((b) => b.id === cardA.id)!.measurements, cardA.id
  );
  check("E1 черновик Bike_A: SH=800, bikeId=A",
    useBikeStore.getState().bike.saddleHeight === 800 &&
    useBikeStore.getState().bikeId === cardA.id);

  // Смена на Bike_B: resetDraftState + полная загрузка пустой карточки
  setActiveBike(cardB.id);
  useBikeStore.getState().resetDraftState();
  useBikeStore.getState().loadBikeData(
    getBikes().find((b) => b.id === cardB.id)!.measurements, cardB.id
  );
  check("E2 черновик Bike_B: SH отсутствует (800 стёрта), bikeId=B",
    useBikeStore.getState().bike.saddleHeight === undefined &&
    useBikeStore.getState().bikeId === cardB.id);

  // Гипотетическая утечка: черновик НЕ переключился (cross-tab race) —
  // остался Bike_A (SH=800, bikeId=A), а отчёт строится для активного B.
  useBikeStore.getState().loadBikeData({ saddleHeight: 800, wheelbase: 985 }, cardA.id); // симуляция «черновик от A»
  const leakedAnalysis = cloneAnalysis();
  const guarded = applySaddleHeightContext(
    leakedAnalysis,
    useBikeStore.getState().bike.saddleHeight ?? null, // 800 (чужая!)
    759,                                               // LeMond райдера
    { calibBikeId: useBikeStore.getState().bikeId, currentBikeId: cardB.id },
  );
  check("E3 чужая SH=800 НЕ даёт совета «Опустите седло на 41 мм»",
    !JSON.stringify(guarded).includes("Опустите седло на 41") &&
    !JSON.stringify(guarded).includes("Поднимите седло на 41"));
  check("E4 чужая SH=800 НЕ даёт и «Противоречие данных» (контекст вне закона)",
    !guarded.kneeAngle.recommendation.includes("Противоречие данных"));

  const xrLeak = generateCrossReferences(
    useBikeStore.getState().bike, body, goal, calc, leakedAnalysis, [],
    { calibBikeId: useBikeStore.getState().bikeId, currentBikeId: cardB.id },
  );
  check("E5 кросс-рекомендации: нет ни одной saddle-карточки от чужого SH",
    !xrLeak.crossReferences.some((r) => r.category === "saddle"));

  // ---------- Итог ----------
  console.log(`\n=== ИТОГ: ${pass} OK, ${fail} FAIL ===`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("CRASH:", e);
  process.exit(1);
});
