/**
 * Верификация v1.14.5: перспективный градиент масштаба (ядро v2.2).
 *
 * Интеграция идеи dual-scale (bike-dual-scale.ts / bike-perspective.ts)
 * в живое ядро: локальный масштаб линейно интерполируется по X между
 * осями колёс и нормируется на ЯКОРЬ — отрезок-источник рабочего масштаба.
 *
 * Кейсы:
 *  A) SH-override + перспектива ~8% (радиусы колёс 222.6/241.6 px):
 *     - градиент применён, сила ≈8%;
 *     - SH = 690 мм ТОЧНО (калибровка точна в точке калибровки);
 *     - соотношение локальных масштабов осей = соотношению сырых колёсных;
 *     - на передней оси масштаб меньше, на задней больше (перед ближе);
 *     - WB/Reach/Stack сдвинулись относительно скалярного расчёта.
 *  B) Колёса одинаковые (перспективы нет): градиент НЕ применён,
 *     метрики идентичны скалярному поведению v2.1.
 *  C) Колесо-выброс (плохая точка верха): градиент НЕ применён (защита),
 *     выброс отчитан консенсусом.
 *  D) Консенсус-медиана без override: якорь = медианный кандидат (WB),
 *     WB = введённое значение ТОЧНО.
 *  E) Обратная совместимость computeExtendedBikeParams со скаляром.
 */
import {
  calculateBikeGeometry,
  computeExtendedBikeParams,
  type BikeKeypoints,
  type CalibrationConfig,
  type AuxScaleCandidate,
} from "../src/lib/bike-geometry-engine";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures++;
    console.error(`  ✗ FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const close = (a: number, b: number, tolPct = 0.5) =>
  Math.abs(a - b) <= (Math.abs(b) * tolPct) / 100;

// ============================================================
// Общая геометрия сцены: оси горизонтальны, перед справа.
// WBpx = 709.6 px; радиусы: зад 222.6 px, пер 241.6 px (перед ближе).
// WH радиус = 334 мм → колёсные кандидаты: 1.3824 (пер) / 1.5004 (зад) мм/px.
// SH = 690 мм override; STA 70.5°; bb на (700, 568).
// ============================================================
const WH_MM = 334;
const R_REAR_PX = 222.6;
const R_FRONT_PX = 241.6;
const WB_PX = 709.6;
const SH_OVERRIDE = 690;
// Проекция saddleMount на ось ST (STA 70.5°): shPx = 690 / 1.4628 ≈ 471.7 px
const SH_PX = 471.7;
const STA = (70.5 * Math.PI) / 180;
// Велик «лицом вправо» → подседельная наклонена НАЗАД: верх трубы левее BB
const ST_DIR = { x: -Math.cos(STA), y: -Math.sin(STA) };

function scene(rFrontPx: number, rRearPx: number): BikeKeypoints {
  const rearAxle = { x: 300, y: 520 };
  const frontAxle = { x: 300 + WB_PX, y: 520 };
  const bb = { x: 700, y: 568 };
  const stTop = {
    x: bb.x + 420 * ST_DIR.x,
    y: bb.y + 420 * ST_DIR.y,
  };
  const saddleMount = {
    x: bb.x + SH_PX * ST_DIR.x,
    y: bb.y + SH_PX * ST_DIR.y,
  };
  const htTop = { x: 968, y: 163 };
  const htBottom = { x: 940, y: 262 };
  return {
    rearAxle,
    frontAxle,
    bb,
    stTop,
    saddleMount,
    htTop,
    htBottom,
    rearWheelTop: { x: rearAxle.x, y: rearAxle.y - rRearPx },
    frontWheelTop: { x: frontAxle.x, y: frontAxle.y - rFrontPx },
  } as BikeKeypoints;
}

function wheelCandidates(): AuxScaleCandidate[] {
  return [
    {
      key: "wheelRear",
      label: "радиус заднего колеса",
      valueMm: WH_MM,
      px: R_REAR_PX,
      suspectPoints: "точки rearWheelTop/rearAxle",
    },
    {
      key: "wheelFront",
      label: "радиус переднего колеса",
      valueMm: WH_MM,
      px: R_FRONT_PX,
      suspectPoints: "точки frontWheelTop/frontAxle",
    },
  ];
}

const sF = WH_MM / R_FRONT_PX; // 1.3824 мм/px у передней оси
const sR = WH_MM / R_REAR_PX; // 1.5004 мм/px у задней оси
const severityPct = (Math.abs(sF - sR) / ((sF + sR) / 2)) * 100; // ≈8.1%

// ============================================================
console.log("\n=== КЕЙС A: SH-override + перспектива ~8% ===");
{
  const config: CalibrationConfig = {
    userOverrideKey: "saddleHeight",
    userOverrideValueMm: SH_OVERRIDE,
    auxScaleCandidates: wheelCandidates(),
  };
  const r = calculateBikeGeometry(scene(R_FRONT_PX, R_REAR_PX), config);

  check("градиент применён (perspective != null)", r.perspective !== null);
  check(
    "сила перспективы ≈ 8.1%",
    r.perspective !== null && close(r.perspective.severityPct, severityPct, 2),
    r.perspective?.severityPct.toFixed(2) + "%"
  );
  check(
    "SH = 690 мм ТОЧНО (якорь на калибровке)",
    r.metricsMm.saddleHeight === SH_OVERRIDE,
    `SH = ${r.metricsMm.saddleHeight}`
  );
  check(
    "якорь — калибровка SH",
    r.perspective?.anchor.includes("SH") ?? false,
    r.perspective?.anchor
  );
  if (r.perspective) {
    const ratioAxles = r.perspective.scaleFrontAxle / r.perspective.scaleRearAxle;
    const ratioWheels = sF / sR;
    check(
      "форма градиента сохранена (отношение осей = отношение колёс)",
      Math.abs(ratioAxles / ratioWheels - 1) < 1e-9,
      `${ratioAxles.toFixed(5)} vs ${ratioWheels.toFixed(5)}`
    );
    check(
      "перед ближе: масштаб на передней оси МЕНЬШЕ",
      r.perspective.scaleFrontAxle < r.perspective.scaleRearAxle,
      `${r.perspective.scaleFrontAxle.toFixed(4)} < ${r.perspective.scaleRearAxle.toFixed(4)}`
    );
  }
  check(
    "warning 📐 присутствует",
    r.warnings.some((w) => w.includes("📐 Перспективная компенсация"))
  );
  // Скалярный (v2.1) WB был бы pxWB × scaleMmPerPx. С градиентом якорь (SH)
  // стоит ЗАДНЕЕ середины базы (t≈0.55 от передней оси) → масштаб в середине
  // базы НИЖЕ якорного → WB чуть меньше скалярного.
  const scaleMmPerPx = SH_OVERRIDE / SH_PX;
  const scalarWb = WB_PX * scaleMmPerPx;
  check(
    "WB сдвинулся относительно скалярного v2.1 (вниз, якорь сзади середины)",
    r.metricsMm.wheelbase < scalarWb && scalarWb - r.metricsMm.wheelbase > 2,
    `WB ${r.metricsMm.wheelbase} мм против скалярных ${scalarWb.toFixed(1)} мм`
  );
  check("физических нарушений нет", r.physicsViolations.length === 0);
  check(
    "Reach/Stack/ETT правдоподобны",
    close(r.metricsMm.reach, 392, 8) && close(r.metricsMm.stack, 593, 8) && r.metricsMm.ett > 300,
    `Reach ${r.metricsMm.reach}, Stack ${r.metricsMm.stack}, ETT ${r.metricsMm.ett}`
  );
}

// ============================================================
console.log("\n=== КЕЙС B: колёса одинаковые — перспективы нет ===");
{
  const config: CalibrationConfig = {
    userOverrideKey: "saddleHeight",
    userOverrideValueMm: SH_OVERRIDE,
    auxScaleCandidates: wheelCandidates().map((c) => ({
      ...c,
      px: c.key === "wheelFront" ? R_REAR_PX : R_REAR_PX, // одинаковые радиусы
    })),
  };
  const r = calculateBikeGeometry(scene(R_REAR_PX, R_REAR_PX), config);
  check("градиент НЕ применён", r.perspective === null);
  const scalarWb = WB_PX * (SH_OVERRIDE / SH_PX);
  check(
    "WB идентичен скалярному v2.1",
    close(r.metricsMm.wheelbase, scalarWb, 0.01),
    `${r.metricsMm.wheelbase} ≈ ${scalarWb.toFixed(1)}`
  );
  check(
    "SH = 690 ТОЧНО",
    r.metricsMm.saddleHeight === SH_OVERRIDE,
    `SH = ${r.metricsMm.saddleHeight}`
  );
}

// ============================================================
console.log("\n=== КЕЙС C: колесо-выброс — защита от кривой точки верха ===");
{
  const cands = wheelCandidates();
  cands[1] = { ...cands[1], px: 180 }; // «переднее» раздуто: масштаб 1.8556 (+27%)
  const config: CalibrationConfig = {
    userOverrideKey: "saddleHeight",
    userOverrideValueMm: SH_OVERRIDE,
    auxScaleCandidates: cands,
  };
  const r = calculateBikeGeometry(scene(WH_MM / 180, R_REAR_PX), config);
  check("градиент НЕ применён (выброс не участвует)", r.perspective === null);
  check(
    "выброс отчитан в warnings",
    r.warnings.some((w) => w.includes("радиус переднего колеса"))
  );
  check(
    "SH = 690 ТОЧНО (скалярное поведение)",
    r.metricsMm.saddleHeight === SH_OVERRIDE
  );
}

// ============================================================
console.log("\n=== КЕЙС D: консенсус-медиана без override — якорь = WB ===");
{
  const config: CalibrationConfig = {
    extraMeasurements: { wheelbase: 1040 },
    auxScaleCandidates: wheelCandidates(),
  };
  const r = calculateBikeGeometry(scene(R_FRONT_PX, R_REAR_PX), config);
  check(
    "источник — CONSENSUS",
    r.scaleSource.startsWith("CONSENSUS"),
    r.scaleSource
  );
  check("градиент применён", r.perspective !== null);
  check(
    "якорь — WB-кандидат (медиана)",
    r.perspective?.anchor.includes("колёсная база") ?? false,
    r.perspective?.anchor
  );
  check(
    "WB = введённые 1040 мм ТОЧНО",
    r.metricsMm.wheelbase === 1040,
    `WB = ${r.metricsMm.wheelbase}`
  );
}

// ============================================================
console.log("\n=== КЕЙС E: обратная совместимость computeExtendedBikeParams ===");
{
  const rot = scene(R_FRONT_PX, R_REAR_PX);
  const scalar = computeExtendedBikeParams(rot, 1.4628);
  const fn = computeExtendedBikeParams(rot, () => 1.4628);
  check(
    "скаляр и функция дают идентичный результат",
    JSON.stringify(scalar) === JSON.stringify(fn)
  );
  check(
    "setback положителен (седло позади BB)",
    scalar.setback > 0,
    `setback = ${scalar.setback} мм`
  );
}

// ============================================================
console.log(
  failures === 0
    ? "\n✅ ВСЕ ПРОВЕРКИ v1.14.5 ПРОЙДЕНЫ\n"
    : `\n❌ ПРОВАЛЕНО ПРОВЕРОК: ${failures}\n`
);
process.exit(failures === 0 ? 0 : 1);
