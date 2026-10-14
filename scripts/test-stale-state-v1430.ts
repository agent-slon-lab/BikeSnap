/**
 * Верификация v1.14.30 — «Fix Stale State Leakage» (протечка данных между
 * профилями велосипедов). Запуск: npx tsx scripts/test-stale-state-v1430.ts
 *
 * Сценарий бага (репорт пользователя): у Bike_A в черновике было
 * saddleHeight = 800 мм; при переключении на Bike_B черновик МЕРДЖИЛСЯ
 * (setBike = { ...state.bike, ...b }), поля, которых у Bike_B нет,
 * оставались от Bike_A, автосейв записывал заражённый черновик в Bike_B
 * насовсем → отчёт Bike_B считался с SH=800 + геометрией Bike_A.
 *
 * Проверки:
 *  A. loadBikeData — ПОЛНАЯ замена черновика (без merge, без мусорных ключей,
 *     NaN/garbage отфильтрованы).
 *  B. resetDraftState — жёсткий сброс сценария, атрибуты райдера живы.
 *  C. setBike — merge СОХРАНЁН (патчи формы: ввод одного поля не стирает
 *     остальные) — регресс-защита.
 *  D. photo-analysis-store.syncBikeId — смена велика стирает ВСЕ ракурсы,
 *     тот же велик — идемпотентный no-op.
 *  E. findWheelSize — синхронизация типоразмера из WH карточки.
 *  F. E2E: createBike(A, SH=800) → выбор B (пустая карточка) → автосейв →
 *     в ЗАПИСИ B нет ни одного поля от A.
 */

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
  // ---------- Динамические импорты (после полифила) ----------
  const { useBikeStore } = await import("../src/lib/bike-store");
  const { usePhotoAnalysisStore } = await import("../src/lib/photo-analysis-store");
  const {
    createBike,
    updateBike,
    getBikes,
    getActiveBikeId,
    setActiveBike,
    deleteBike,
    ACTIVE_BIKE_CHANGED_EVENT,
  } = await import("../src/lib/bike-storage");
  const { findWheelSize } = await import("../src/lib/bike-perspective");

  console.log("\n=== A. loadBikeData: полная замена без merge ===");
  const st0 = useBikeStore.getState();
  // Bike_A: «заражённый» черновик (как в баге: SH=800 от предыдущего вела)
  st0.setBike({ saddleHeight: 800, wheelbase: 1080, wheelHeight: 371, ett: 560, crank: 175 });
  // Bike_B: карточка с частично заполненными measurements (SH есть, остального нет)
  st0.loadBikeData({ saddleHeight: 745, wheelbase: 1005 });
  const d1 = useBikeStore.getState().bike;
  check("A1 SH взят из Bike_B (745)", d1.saddleHeight === 745);
  check("A2 WB взят из Bike_B (1005)", d1.wheelbase === 1005);
  check("A3 wheelHeight 371 от Bike_A НЕ протёк", d1.wheelHeight === undefined);
  check("A4 ett 560 от Bike_A НЕ протёк", d1.ett === undefined);
  check("A5 crank 175 от Bike_A НЕ протёк", d1.crank === undefined);
  check("A6 stem от Bike_A НЕ протёк", d1.stem === undefined);

  // Мусорные/нечисловые значения фильтруются, неизвестные ключи не копируются
  st0.loadBikeData({ saddleHeight: NaN, wheelbase: 990, junk: 123 } as never);
  const d2 = useBikeStore.getState().bike as Record<string, unknown>;
  check("A7 NaN отфильтрован (SH=undefined)", d2.saddleHeight === undefined);
  check("A8 валидное значение записано (WB=990)", d2.wheelbase === 990);
  check("A9 неизвестный ключ junk НЕ скопирован", !("junk" in d2));

  // Пустая карточка (создание нового велика): черновик полностью чистый
  st0.loadBikeData({});
  const d3 = useBikeStore.getState().bike;
  const allEmpty = Object.values(d3).every((v) => v === undefined);
  check("A10 loadBikeData({}) — все поля undefined", allEmpty);

  console.log("\n=== B. resetDraftState: сценарий сброшен, райдер цел ===");
  useBikeStore.setState({ body: { height: 186, inseam: 86, flexibility: 3 }, goal: "sport", complaints: ["knee_pain"] });
  useBikeStore.getState().setBike({ saddleHeight: 800, wheelbase: 1080 });
  useBikeStore.getState().resetDraftState();
  const s1 = useBikeStore.getState();
  check("B1 bike сброшен (SH=undefined)", s1.bike.saddleHeight === undefined);
  check("B2 bike сброшен (WB=undefined)", s1.bike.wheelbase === undefined);
  check("B3 wheelSizeId = 26", s1.wheelSizeId === "26");
  check("B4 тело райдера НЕ тронуто (186)", s1.body.height === 186);
  check("B5 цель райдера НЕ тронута (sport)", s1.goal === "sport");
  check("B6 жалобы НЕ тронуты", s1.complaints.includes("knee_pain"));

  console.log("\n=== C. setBike: merge сохранён (патчи формы) — регресс ===");
  useBikeStore.getState().loadBikeData({ saddleHeight: 700, wheelbase: 1030 });
  useBikeStore.getState().setBike({ crank: 172.5 });
  const d4 = useBikeStore.getState().bike;
  check("C1 патч одного поля не стёр SH (700)", d4.saddleHeight === 700);
  check("C2 патч одного поля не стёр WB (1030)", d4.wheelbase === 1030);
  check("C3 патч записан (CR=172.5)", d4.crank === 172.5);

  console.log("\n=== D. photo-analysis-store.syncBikeId ===");
  const pa = usePhotoAnalysisStore.getState();
  pa.syncBikeId("bike-A");
  pa.setViewPhoto("side", { photoData: "data:image/jpeg;base64,AAA" });
  pa.setViewResult("side", [{ x: 0.5, y: 0.5, visibility: 0.9 }], { side: "right" } as never);
  check("D1 фото side записано", usePhotoAnalysisStore.getState().views.side.photoData === "data:image/jpeg;base64,AAA");
  // Смена велика → ЖЁСТКИЙ сброс
  usePhotoAnalysisStore.getState().syncBikeId("bike-B");
  const pa1 = usePhotoAnalysisStore.getState();
  check("D2 bikeId обновлён", pa1.bikeId === "bike-B");
  check("D3 фото side стёрто", pa1.views.side.photoData === null);
  check("D4 landmarks стёрты", pa1.views.side.landmarks === null);
  check("D5 analysis стёрт", pa1.views.side.analysis === null);
  // Идемпотентность: тот же велик — данные не трогаем
  pa1.setViewPhoto("front", { photoData: "data:image/jpeg;base64,BBB" });
  usePhotoAnalysisStore.getState().syncBikeId("bike-B");
  const pa2 = usePhotoAnalysisStore.getState();
  check("D6 syncBikeId(тот же id) не стирает", pa2.views.front.photoData === "data:image/jpeg;base64,BBB");
  check("D7 bikeId не изменился", pa2.bikeId === "bike-B");
  // null (велика нет) тоже валидный ключ сброса
  usePhotoAnalysisStore.getState().syncBikeId(null);
  check("D8 syncBikeId(null) стирает ракурсы", usePhotoAnalysisStore.getState().views.front.photoData === null);

  console.log("\n=== E. findWheelSize: синхронизация типоразмера из WH ===");
  check("E1 WH=335 → 700c", findWheelSize(null, 335)?.id === "700c");
  check("E2 WH=371 → 29\"", findWheelSize(null, 371)?.id === "29");
  check("E3 WH=358 → 27.5\"", findWheelSize(null, 358)?.id === "27.5");
  check("E4 WH пусто → null (фолбэк 26 ставит вызывающий)", findWheelSize(null, undefined) === null);

  console.log("\n=== F. E2E: создание/переключение/автосейв — записи чистые ===");
  // Bike_A: полный «заражённый» профиль
  const bikeA = createBike("Bike A (800)", "road", {
    saddleHeight: 800, wheelbase: 1080, wheelHeight: 371, ett: 560, crank: 175,
  });
  check("F1 Bike A создан и активен", getActiveBikeId() === bikeA.id);
  // Черновик A (как будто пользователь работал с A)
  useBikeStore.getState().loadBikeData(bikeA.measurements);

  // Пользователь создаёт Bike_B — ПУСТУЮ карточку (путь handleCreate)
  const bikeB = createBike("Bike B (новый)", "mtb", {});
  // Порядок обработчика handleSelect/Create (v1.14.30):
  useBikeStore.getState().resetDraftState();
  useBikeStore.getState().loadBikeData(bikeB.measurements); // {}
  useBikeStore.getState().setBikeType("mtb");
  setActiveBike(bikeB.id);
  // «Автосейв» через 800 мс записывает ТЕКУЩИЙ черновик в активную запись
  const draft = useBikeStore.getState().bike;
  updateBike(bikeB.id, draft);
  const savedB = getBikes().find((b) => b.id === bikeB.id);
  check("F2 запись B существует", !!savedB);
  check("F3 в записи B НЕТ SH=800 от Bike_A", savedB?.measurements.saddleHeight === undefined);
  check("F4 в записи B НЕТ WB=1080 от Bike_A", savedB?.measurements.wheelbase === undefined);
  check("F5 в записи B НЕТ ETT=560 от Bike_A", savedB?.measurements.ett === undefined);
  check("F6 черновик после переключения чистый", draft.saddleHeight === undefined);

  // Обратное переключение A → B → A: карточка A восстанавливается ПОЛНОСТЬЮ
  useBikeStore.getState().loadBikeData(bikeA.measurements);
  const dA = useBikeStore.getState().bike;
  check("F7 возврат на A: SH=800 на месте", dA.saddleHeight === 800);
  check("F8 возврат на A: WB=1080 на месте", dA.wheelbase === 1080);
  useBikeStore.getState().loadBikeData(bikeB.measurements);
  check("F9 снова B: SH снова пусто", useBikeStore.getState().bike.saddleHeight === undefined);

  // Удаление активного велика: активный id очищается
  deleteBike(bikeB.id);
  check("F10 после удаления B активный id сброшен", getActiveBikeId() !== bikeB.id);

  console.log("\n=== G. Событие ACTIVE_BIKE_CHANGED_EVENT экспортировано ===");
  check("G1 константа события = bikesnap:active-bike-changed", ACTIVE_BIKE_CHANGED_EVENT === "bikesnap:active-bike-changed");

  console.log(`\nИТОГО: ${pass} OK / ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Тест упал:", e);
  process.exit(1);
});
