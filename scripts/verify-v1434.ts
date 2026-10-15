/**
 * Верификация v1.14.34 — «Комплексное ТЗ: Architecture, Geometry Engine &
 * Pose Validation Refactoring». Запуск: npx tsx scripts/verify-v1434.ts
 *
 * Разделы ТЗ, покрытые проверками:
 *  A. П. 2.3 — ось ETT: горизонталь htTop → линия bb→saddleMount
 *     (saddleMount намеренно смещён вбок — ETT обязан «поехать» за линией
 *     седла, а не за осью трубы; при коллинеарном saddleMount ETT совпадает
 *     со старым определением).
 *  B. П. 2.1/2.2 — регресс ядра: поворот-до-расчётов, строгий override
 *     (дублируется verify-engine-v2.ts — здесь быстрые инварианты).
 *  C. П. 5.2/5.3 — getPoseVisibilityScore: пороги 0.5 (человек не найден)
 *     и 0.7 (человек на фото вела).
 *  D. П. 5.4 — bike-wheel-ratio: ratio по разметке, сравнение 12%,
 *     авто-детектор (проверяется math-обёртка + константы).
 *  E. П. 6 — Re-fit loop: startRefit архивирует прогон и чистит ракурсы,
 *     cancelRefit возвращает, syncBikeId стирает артефакты Re-fit,
 *     обновление photoCalib.wheelRatio в карточке вела.
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

function approx(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

async function main() {
  // ---------- Раздел A/B: ядро геометрии ----------
  const engine = await import("../src/lib/bike-geometry-engine");
  const { calculateBikeGeometry } = engine;
  type BikeKeypoints = import("../src/lib/bike-geometry-engine").BikeKeypoints;

  console.log("\n=== A. ТЗ п. 2.3: ETT по линии bb→saddleMount ===");

  // Синтетический вел «смотрит вправо», оси горизонтальны (tilt=0):
  const W = 2000, H = 1500;
  const base: BikeKeypoints = {
    rearAxle: { x: 300, y: 1000 },
    frontAxle: { x: 1700, y: 1000 },
    bb: { x: 700, y: 1080 },
    stTop: { x: 640, y: 520 },
    saddleMount: { x: 630, y: 460 },
    htTop: { x: 1420, y: 560 },
    htBottom: { x: 1460, y: 680 },
  };

  // Кейс A1: saddleMount строго на продолжении оси bb→stTop
  // → новая ось (bb→saddleMount) и старая (bb→stTop) — одна прямая,
  //   ETT должен совпасть с классическим определением.
  const dirX = base.stTop.x - base.bb.x; // −60
  const dirY = base.stTop.y - base.bb.y; // −560
  const t = (base.saddleMount.y - base.bb.y) / dirY; // (460−1080)/(−560)
  const smOnAxisX = base.bb.x + dirX * t;
  const collinear: BikeKeypoints = {
    ...base,
    saddleMount: { x: smOnAxisX, y: base.saddleMount.y },
  };
  const rColl = calculateBikeGeometry(collinear, { fallbackWheelbaseMm: 1400 });
  // Классический расчёт: пересечение горизонтали htTop с линией bb→stTop
  const backPerUp = Math.abs(dirX / dirY);
  const expectedEttColl =
    Math.abs(
      (base.htTop.x - (base.bb.x - backPerUp * (base.bb.y - base.htTop.y)))
    ) *
    (1400 / (base.frontAxle.x - base.rearAxle.x));
  check(
    "A1 коллинеарный saddleMount: ETT = классике",
    approx(rColl.metricsMm.ett, expectedEttColl, 2),
    `got ${rColl.metricsMm.ett}, want ≈${expectedEttColl.toFixed(1)}`
  );

  // Кейс A2: saddleMount смещён НАЗАД на 40px — линия седла наклонена
  // сильнее → точка пересечения горизонтали с линией седла уходит назад
  // → ETT по ТЗ УВЕЛИЧИВАЕТСЯ (ручной расчёт A2 это же даёт).
  const shifted: BikeKeypoints = {
    ...base,
    saddleMount: { x: collinear.saddleMount.x - 40, y: collinear.saddleMount.y },
  };
  const rShift = calculateBikeGeometry(shifted, { fallbackWheelbaseMm: 1400 });
  const rotBB = rShift.rotated.bb;
  const rotSM = rShift.rotated.saddleMount;
  const rotHT = rShift.rotated.htTop;
  // Ручной расчёт ETT в выровненной системе (масштаб fallback: WB=1400)
  const wbPx = Math.abs(
    rShift.rotated.frontAxle.x - rShift.rotated.rearAxle.x
  );
  const scale = 1400 / wbPx;
  const backPerUpSm = Math.abs(rotSM.x - rotBB.x) / Math.abs(rotBB.y - rotSM.y);
  const expectedEttShift =
    Math.abs(rotHT.x - (rotBB.x - backPerUpSm * (rotBB.y - rotHT.y))) * scale;
  check(
    "A2 смещённый saddleMount: ETT = линии bb→saddleMount",
    approx(rShift.metricsMm.ett, expectedEttShift, 2),
    `got ${rShift.metricsMm.ett}, want ≈${expectedEttShift.toFixed(1)}`
  );
  check(
    "A2 ETT увеличился при наклоне седла назад",
    rShift.metricsMm.ett > rColl.metricsMm.ett,
    `shift ${rShift.metricsMm.ett} vs collinear ${rColl.metricsMm.ett}`
  );

  // Кейс A3: калибровка по ETT и метрика ETT — одно определение
  const rEttCalib = calculateBikeGeometry(shifted, {
    userOverrideKey: "ett",
    userOverrideValueMm: 500,
  });
  check(
    "A3 override ETT → метрика ровно 500",
    approx(rEttCalib.metricsMm.ett, 500, 0.5),
    `got ${rEttCalib.metricsMm.ett}`
  );

  // Кейс A4: поворот-до-расчётов (п. 2.1) — наклон кадра не меняет ETT/Stack
  const tiltRad = 4 * (Math.PI / 180);
  const rot = (p: { x: number; y: number }) => {
    const dx = p.x - base.rearAxle.x;
    const dy = p.y - base.rearAxle.y;
    const c = Math.cos(-tiltRad);
    const s = Math.sin(-tiltRad);
    return {
      x: base.rearAxle.x + dx * c - dy * s,
      y: base.rearAxle.y + dx * s + dy * c,
    };
  };
  const tilted: BikeKeypoints = {
    rearAxle: rot(collinear.rearAxle),
    frontAxle: rot(collinear.frontAxle),
    bb: rot(collinear.bb),
    stTop: rot(collinear.stTop),
    saddleMount: rot(collinear.saddleMount),
    htTop: rot(collinear.htTop),
    htBottom: rot(collinear.htBottom),
  };
  const rTilt = calculateBikeGeometry(tilted, { fallbackWheelbaseMm: 1400 });
  check(
    "A4 поворот кадра 4°: ETT инвариантен",
    approx(rTilt.metricsMm.ett, rColl.metricsMm.ett, 2),
    `${rTilt.metricsMm.ett} vs ${rColl.metricsMm.ett}`
  );
  check(
    "A4 Stack инвариантен",
    approx(rTilt.metricsMm.stack, rColl.metricsMm.stack, 2)
  );

  // ---------- Раздел C: person score ----------
  const {
    getPoseVisibilityScore,
    PERSON_MIN_SCORE,
    PERSON_BIKE_PHOTO_MAX_SCORE,
    getCleanRiderKeypoints,
  } = await import("../src/lib/bike-fit");

  console.log("\n=== C. ТЗ п. 5.2/5.3: person score ===");
  check("C1 порог человека = 0.5", PERSON_MIN_SCORE === 0.5);
  check("C2 порог фото вела = 0.7", PERSON_BIKE_PHOTO_MAX_SCORE === 0.7);

  const mkLm = (vis: number[]) =>
    vis.map((v) => ({ x: 0.5, y: 0.5, visibility: v }));
  // Полный «живой» человек: 8 ядерных суставов видимы
  const alive = mkLm(Array.from({ length: 33 }, () => 0.9));
  const aliveScore = getPoseVisibilityScore(alive as never);
  check(
    "C3 живой райдер: score 0.9 ≥ 0.5",
    approx(aliveScore, 0.9, 1e-9) && aliveScore >= PERSON_MIN_SCORE
  );
  // «Пустое» фото: MediaPipe призрак с visibility ~0.3
  const ghost = mkLm(Array.from({ length: 33 }, () => 0.3));
  const ghostScore = getPoseVisibilityScore(ghost as never);
  check(
    "C4 призрак: score 0.3 < 0.5 → блок",
    ghostScore < PERSON_MIN_SCORE
  );
  // Фото вела: человек частично «нашёлся» (score 0.75) → предупреждение
  const bikeWithHuman = mkLm(Array.from({ length: 33 }, () => 0.75));
  const bikeHumanScore = getPoseVisibilityScore(bikeWithHuman as never);
  check(
    "C5 score 0.75 > 0.7 → предупреждение на Шаге 2",
    bikeHumanScore > PERSON_BIKE_PHOTO_MAX_SCORE
  );
  // Отсутствующие точки считаются 0
  const partial = mkLm(Array.from({ length: 33 }, () => 0));
  (partial as Array<{ visibility?: number }>)[23].visibility = 0.9; // левое бедро
  check(
    "C6 одна точка из 8: score = 0.1125",
    approx(getPoseVisibilityScore(partial as never), 0.9 / 8, 1e-9)
  );
  check(
    "C7 null/[] → score 0",
    getPoseVisibilityScore(null) === 0 && getPoseVisibilityScore([]) === 0
  );
  // Регресс v1.14.32: выбор стороны по средней visibility ног
  const lmSide = mkLm(Array.from({ length: 33 }, () => 0.8));
  (lmSide as Array<{ visibility?: number }>)[24].visibility = 0.1; // RIGHT_HIP
  (lmSide as Array<{ visibility?: number }>)[26].visibility = 0.1; // RIGHT_KNEE
  (lmSide as Array<{ visibility?: number }>)[28].visibility = 0.1; // RIGHT_ANKLE
  const clean = getCleanRiderKeypoints(lmSide as never);
  check(
    "C8 ближняя нога = LEFT (средняя visibility выше)",
    clean.side === "left" && clean.keypoints != null
  );

  // ---------- Раздел D: wheel ratio ----------
  const {
    computeWheelRatioFromKeypoints,
    wheelRatioDivergencePct,
    isBikeMismatch,
    WHEEL_RATIO_MISMATCH_PCT,
    downscaleToRawFrame,
  } = await import("../src/lib/bike-wheel-ratio");

  console.log("\n=== D. ТЗ п. 5.4: Bike Match Validation ===");
  check("D1 порог расхождения = 12%", WHEEL_RATIO_MISMATCH_PCT === 12);

  // Разметка: WB 1000px, радиусы 350px → ratio = 1000/700 ≈ 1.4286
  const ratio = computeWheelRatioFromKeypoints({
    rearAxle: { x: 0.2, y: 0.7 },
    frontAxle: { x: 0.7, y: 0.7 },
    rearWheelTop: { x: 0.2, y: 0.7 - 350 / H },
    frontWheelTop: { x: 0.7, y: 0.7 - 350 / H },
    imgWidth: W,
    imgHeight: H,
  });
  check(
    "D2 ratio по разметке = 1000/700",
    ratio != null && approx(ratio, 1000 / 700, 1e-6),
    `got ${ratio}`
  );
  // Только один верх колеса — работает (средний радиус = один радиус)
  const ratioOne = computeWheelRatioFromKeypoints({
    rearAxle: { x: 0.2, y: 0.7 },
    frontAxle: { x: 0.7, y: 0.7 },
    rearWheelTop: { x: 0.2, y: 0.7 - 350 / H },
    imgWidth: W,
    imgHeight: H,
  });
  check(
    "D3 один верх колеса: ratio считается",
    ratioOne != null && approx(ratioOne!, 1000 / 700, 1e-6)
  );
  // Ни одного верха — null
  const ratioNone = computeWheelRatioFromKeypoints({
    rearAxle: { x: 0.2, y: 0.7 },
    frontAxle: { x: 0.7, y: 0.7 },
    imgWidth: W,
    imgHeight: H,
  });
  check("D4 нет верхов колёс: null", ratioNone == null);
  // Расхождение: 1.43 vs 1.60 ≈ 11.2% (< порога), 1.43 vs 1.70 ≈ 17.3% (> порога)
  const d1 = wheelRatioDivergencePct(1000 / 700, 1.6);
  const d2 = wheelRatioDivergencePct(1000 / 700, 1.7);
  check(
    "D5 расхождение 1.43↔1.60 < 12%",
    d1 != null && d1 < 12,
    `got ${d1?.toFixed(1)}%`
  );
  check(
    "D6 расхождение 1.43↔1.70 > 12%",
    d2 != null && d2 > 12,
    `got ${d2?.toFixed(1)}%`
  );
  check(
    "D7 isBikeMismatch согласован с порогом",
    !isBikeMismatch(1000 / 700, 1.6) && isBikeMismatch(1000 / 700, 1.7)
  );
  check(
    "D8 null пропорции → mismatch false",
    !isBikeMismatch(null, 1.5) && !isBikeMismatch(1.5, undefined)
  );
  check(
    "D9 downscale не-канвас-картинки в node → null (нет document)",
    (() => {
      try {
        return downscaleToRawFrame({} as never) == null;
      } catch {
        return false;
      }
    })()
  );

  // ---------- Раздел E: Re-fit loop ----------
  const paMod = await import("../src/lib/photo-analysis-store");
  const { usePhotoAnalysisStore } = paMod;
  type RefitMeta = import("../src/lib/photo-analysis-store").RefitMeta;
  const { updateBikePhotoScale, createBike, deleteBike, getBikes } =
    await import("../src/lib/bike-storage");

  console.log("\n=== E. ТЗ п. 6: Re-fit Loop ===");
  const pa = usePhotoAnalysisStore.getState();

  const meta: RefitMeta = {
    saddleChanged: true,
    saddleDeltaMm: -10,
    movedSaddleOrStem: false,
    noChanges: false,
    comfort: "better",
    startedAt: Date.now(),
  };

  // E1: прогон #1 — фото/анализ side
  pa.setViewPhoto("side", { photoData: "data:image/jpeg;base64,AAA" });
  pa.setViewResult("side", [{ x: 0.5, y: 0.5, visibility: 0.9 }], {
    kneeAngle: { value: 176.3, min: 140, max: 150, status: "bad", label: "Колено", description: "", recommendation: "" },
  } as never);
  pa.setViewPhoto("back", { photoData: "data:image/jpeg;base64,BBB" });
  pa.setRiderPhotoWheelRatio(1.43);

  // E2: startRefit — архив + очистка
  pa.startRefit(meta);
  const s2 = usePhotoAnalysisStore.getState();
  check(
    "E2 startRefit: views очищены",
    s2.views.side.photoData == null && s2.views.back.photoData == null
  );
  check(
    "E2 снапшот хранит анализ прогона #1",
    s2.previousRun?.views.side?.analysis != null &&
      (s2.previousRun.views.side.analysis as { kneeAngle?: { value: number } }).kneeAngle?.value === 176.3
  );
  check("E2 refitMeta сохранён", s2.refitMeta?.saddleDeltaMm === -10);
  check(
    "E2 riderPhotoWheelRatio сброшен",
    s2.riderPhotoWheelRatio == null
  );

  // E3: прогон #2 записывается отдельно, архив не трогается
  s2.setViewPhoto("side", { photoData: "data:image/jpeg;base64,CCC" });
  s2.setViewResult("side", [{ x: 0.4, y: 0.6, visibility: 0.9 }], {
    kneeAngle: { value: 146.2, min: 140, max: 150, status: "good", label: "Колено", description: "", recommendation: "" },
  } as never);
  const s3 = usePhotoAnalysisStore.getState();
  check(
    "E3 прогон #2 жив, архив цел",
    (s3.views.side.analysis as { kneeAngle?: { value: number } }).kneeAngle?.value === 146.2 &&
      (s3.previousRun?.views.side?.analysis as { kneeAngle?: { value: number } })?.kneeAngle?.value === 176.3
  );

  // E4: cancelRefit — возврат архива
  s3.cancelRefit();
  const s4 = usePhotoAnalysisStore.getState();
  check(
    "E4 cancelRefit: прогон #1 возвращён",
    (s4.views.side.analysis as { kneeAngle?: { value: number } }).kneeAngle?.value === 176.3 &&
      s4.views.side.photoData === "data:image/jpeg;base64,AAA"
  );
  check(
    "E4 cancelRefit: previousRun/refitMeta стёрты",
    s4.previousRun == null && s4.refitMeta == null
  );

  // E5: syncBikeId стирает артефакты Re-fit при смене велика
  s4.setViewPhoto("side", { photoData: "data:image/jpeg;base64,DDD" });
  s4.setRiderPhotoWheelRatio(1.5);
  const meta2: RefitMeta = { ...meta, startedAt: Date.now() };
  usePhotoAnalysisStore.setState({ previousRun: s4.previousRun ?? undefined as never });
  // корректный путь: startRefit создаёт previousRun, затем syncBikeId
  const s4b = usePhotoAnalysisStore.getState();
  s4b.startRefit(meta2);
  const s5 = usePhotoAnalysisStore.getState();
  s5.syncBikeId("bike_other");
  const s6 = usePhotoAnalysisStore.getState();
  check(
    "E5 syncBikeId(чужой): артефакты Re-fit стёрты",
    s6.previousRun == null &&
      s6.refitMeta == null &&
      s6.riderPhotoWheelRatio == null &&
      s6.views.side.photoData == null
  );
  // идемпотентность (регресс v1.14.30)
  const viewsBefore = s6.views;
  s6.syncBikeId("bike_other");
  check(
    "E6 syncBikeId(тот же id): no-op",
    usePhotoAnalysisStore.getState().views === viewsBefore
  );

  // E7: photoCalib.wheelRatio в карточке вела
  const bike = createBike("Verify34", "road", {});
  updateBikePhotoScale(bike.id, {
    scaleMmPerPx: 0.4,
    scaleSource: "USER_OVERRIDE (saddleHeight = 680mm)",
    frameTiltDeg: -1.2,
    wheelRatio: 1.4286,
  });
  const card = getBikes().find((b) => b.id === bike.id);
  check(
    "E7 photoCalib.wheelRatio сохранён",
    card?.photoCalib?.wheelRatio != null &&
      approx(card.photoCalib.wheelRatio, 1.429, 0.001)
  );
  // сброс null удаляет всё фото-поле
  updateBikePhotoScale(bike.id, null);
  const card2 = getBikes().find((b) => b.id === bike.id);
  check("E8 updateBikePhotoScale(null): photoCalib удалён", card2?.photoCalib == null);
  deleteBike(bike.id);

  console.log(`\n========== РЕЗЮМЕ ==========`);
  console.log(`  OK: ${pass}  FAIL: ${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("CRASH:", e);
  process.exit(1);
});
