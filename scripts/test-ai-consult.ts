/**
 * ТЕСТ: AI-разбор посадки (v1.14.42)
 * ===================================
 * buildAiConsultPrompt — чистая функция: проверяем, что в промпт попадают
 * углы, антропометрия, геометрия вела, жалобы и приватные правила, а
 * requestAiConsult без ключа падает ДО сети (fetch не вызывается).
 *
 * Запуск: npx tsx scripts/test-ai-consult.ts
 */

import {
  buildAiConsultPrompt,
  requestAiConsult,
  AiConsultError,
  AI_MODELS,
  DEFAULT_AI_MODEL,
  type AiConsultInput,
} from "../src/lib/ai-consult";
import type { AngleResult, BikeFitAnalysis } from "../src/lib/bike-fit";

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

/** Мок AngleResult (makeResult не экспортирован — собираем руками) */
function angle(
  label: string,
  value: number,
  min: number,
  max: number,
  status: AngleResult["status"],
  extra?: Partial<AngleResult>
): AngleResult {
  return {
    value,
    min,
    max,
    status,
    label,
    description: "тест",
    recommendation: "тест",
    color: { text: "", bg: "", border: "", ring: "" },
    ...extra,
  };
}

const analysis: BikeFitAnalysis = {
  kneeAngle: angle("Колено", 143.2, 140, 150, "good", {
    flexion: { value: 36.8, min: 30, max: 40, label: "Сгиб колена" },
  }),
  hipAngle: angle("Бедро", 68.1, 60, 75, "good"),
  backAngle: angle("Корпус", 30.2, 35, 45, "bad"),
  ankleAngle: angle("Голеностоп", 105, 95, 110, "good"),
  shoulderAngle: angle("Плечо", 88.5, 80, 90, "warning"),
  kops: angle("KOPS", 8, -10, 10, "good", {
    unit: "мм",
    signedValue: -8,
  }),
  side: "right",
  warnings: ["Не удалось четко определить стопу"],
};

const input: AiConsultInput = {
  riderName: "Слава",
  body: { height: 178, inseam: 84, flexibility: 3 },
  bikeName: "Test Bike",
  bikeType: "road",
  measurements: { saddleHeight: 720, setback: 30, ett: 560, reach: 395 },
  analysis,
  goal: "sport",
  complaints: ["knee_pain", "none"],
  saddleHeightMm: 720,
};

console.log("\n=== 1. buildAiConsultPrompt: состав user-промпта ===");
{
  const p = buildAiConsultPrompt(input);
  ok("рост попал", p.user.includes("178"), "");
  ok("inseam попал", p.user.includes("84"));
  ok("гибкость попала", p.user.includes("3/5"));
  ok("цель попал (по-русски)", p.user.includes("спорт"));
  ok("имя вела попало", p.user.includes("Test Bike"));
  ok("тип вела по-русски", p.user.includes("Шоссейный") || p.user.includes("шоссейный"), p.user.split("\n").find((l) => l.includes("## Велосипед")) ?? "—");
  ok("высота седла попала", p.user.includes("720"));
  ok("reach попал", p.user.includes("395"));
  ok("угол колена попал", p.user.includes("Колено: 143.2°"));
  ok("сгиб колена попал", p.user.includes("сгиб 36.8°"));
  ok("KOPS со знаком", p.user.includes("знаковое значение -8мм"));
  ok("пояснение знака KOPS", p.user.includes("колено впереди оси педали"));
  ok("плохой статус подписан", p.user.includes("вне нормы"));
  ok("warning подписан", p.user.includes("на границе нормы"));
  ok("жалоба по-русски", p.user.includes("Боль в колене"));
  ok("фильтр «Жалоб нет»", !p.user.includes("Жалоб нет"));
  ok("сторона нога правая", p.user.includes("правая нога"));
  ok("warning кадра попал", p.user.includes("Не удалось четко определить стопу"));
  ok("имя райдера НЕ в промпте (приватность)", !p.user.includes("Слава"));

  // Не указанные измерения не выдумываются
  const p2 = buildAiConsultPrompt({ ...input, measurements: {} });
  ok("пустая геометрия честно помечена", p2.user.includes("не введена"));
  ok("нет выдуманного reach", !p2.user.includes("reach:"));
}

console.log("\n=== 2. system-промпт: роль и правила ===");
{
  const p = buildAiConsultPrompt(input);
  ok("роль байкфиттера", p.user.length > 0 && p.system.includes("bike fitting"));
  ok("запрет выдумывать измерения", p.system.includes("НЕ выдумывай"));
  ok("запрет медицинских диагнозов", p.system.includes("диагноз"));
  ok("памятка безопасности", p.system.includes("1-2 параметров"));
  ok("маркдаун", p.system.includes("markdown"));
  ok("русский язык", p.system.includes("по-русски"));
}

console.log("\n=== 3. requestAiConsult: защита до сети ===");
async function testNoKey(): Promise<void> {
  try {
    await requestAiConsult(buildAiConsultPrompt(input), {
      apiKey: "   ",
      model: DEFAULT_AI_MODEL,
    });
    ok("пустой ключ → ошибка", false, "ошибки не было");
  } catch (e) {
    ok(
      "пустой ключ → AiConsultError",
      e instanceof AiConsultError && e.message.includes("ключ"),
      e instanceof Error ? e.message : String(e)
    );
  }
}

console.log("\n=== 4. Список моделей ===");
{
  ok("дефолт = gemini-2.0-flash", DEFAULT_AI_MODEL === "gemini-2.0-flash");
  ok(
    "id уникальны",
    new Set(AI_MODELS.map((m) => m.id)).size === AI_MODELS.length
  );
  ok("у всех моделей есть лейбл и подсказка", AI_MODELS.every((m) => m.label && m.hint));
}

void testNoKey().then(() => {
  console.log(`\nИтог: ${pass} OK / ${failCount} FAIL`);
  process.exit(failCount > 0 ? 1 : 0);
});
