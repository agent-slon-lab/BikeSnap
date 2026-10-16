/**
 * Юнит-тест v1.14.36: Bike Match Validation — трёхступенчатый вердикт.
 * Проверяет bikeMatchVerdict() на match/mismatch/unknown и границы порога
 * 12%. Запуск: npx tsx scripts/test-bike-match.ts
 *
 * Контекст: пользователь подменил вел между Шагом 2 и Шагом 4 — «ИИ не
 * увидел». Причина: ratio = null (детектор не нашёл колёса) молча выглядел
 * как «совпадает». Вердикт обязан различать «совпадает», «расходится» и
 * «НЕ СВЕРЕНО».
 */
import { bikeMatchVerdict, isBikeMismatch, WHEEL_RATIO_MISMATCH_PCT } from "../src/lib/bike-wheel-ratio";

let ok = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    ok++;
    console.log(`  OK   ${name}`);
  } else {
    fail++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`Порог: WHEEL_RATIO_MISMATCH_PCT = ${WHEEL_RATIO_MISMATCH_PCT}`);

// === match: обе пропорции известны, расхождение ≤ 12% ===
{
  const r = bikeMatchVerdict(1.5, 1.5);
  check("1.50 vs 1.50 → match", r.verdict === "match" && r.divergencePct === 0);
}
{
  const r = bikeMatchVerdict(1.4, 1.45);
  // |1.4-1.45|/1.425 ≈ 3.5% — заметно, но в пределах нормы
  check(
    "1.40 vs 1.45 → match (~3.5%)",
    r.verdict === "match" && r.divergencePct != null && r.divergencePct > 3 && r.divergencePct < 4,
    `got ${r.verdict}, ${r.divergencePct}`
  );
}

// === mismatch: обе известны, расхождение > 12% ===
{
  const r = bikeMatchVerdict(1.4, 1.7);
  // |1.4-1.7|/1.55 ≈ 19.4% — два разных вела
  check(
    "1.40 vs 1.70 → mismatch (~19%)",
    r.verdict === "mismatch" && r.divergencePct != null && r.divergencePct > 19 && r.divergencePct < 20,
    `got ${r.verdict}, ${r.divergencePct}`
  );
}
{
  // Граница порога. Формула: 2|a-b|/(a+b) = pct (ОТНОСИТЕЛЬНО СРЕДНЕГО).
  // Для a=1.5: pct → b = a*(2+p)/(2-p), p = pct/100.
  // v1.14.41: порог 12% → 10% (ТЗ «Жесткий чек-поинт») — кейсы границы
  // обновлены: 9.9% → match, 10.1% → mismatch.
  const below = bikeMatchVerdict(1.5, (1.5 * (2 + 0.099)) / (2 - 0.099));
  check(
    "расхождение 9.9% → match (порог v1.14.41 = 10%)",
    below.verdict === "match" && Math.abs((below.divergencePct ?? 0) - 9.9) < 1e-9,
    `got ${below.verdict}, ${below.divergencePct}`
  );
  const above = bikeMatchVerdict(1.5, (1.5 * (2 + 0.101)) / (2 - 0.101));
  check(
    "расхождение 10.1% → mismatch",
    above.verdict === "mismatch" && Math.abs((above.divergencePct ?? 0) - 10.1) < 1e-9,
    `got ${above.verdict}, ${above.divergencePct}`
  );
}

// === unknown: сверка не состоялась (главный баг-сценарий) ===
{
  const r = bikeMatchVerdict(1.5, null);
  check("вел 1.50, райдер null → unknown (НЕ match!)", r.verdict === "unknown" && r.divergencePct === null);
}
{
  const r = bikeMatchVerdict(null, 1.5);
  check("вел null, райдер 1.50 → unknown", r.verdict === "unknown");
}
{
  const r = bikeMatchVerdict(null, null);
  check("оба null → unknown", r.verdict === "unknown");
}
{
  const r = bikeMatchVerdict(undefined, 1.5);
  check("undefined → unknown", r.verdict === "unknown");
}
{
  const r = bikeMatchVerdict(0, 1.5);
  check("ratio=0 (мусор) → unknown", r.verdict === "unknown");
}
{
  const r = bikeMatchVerdict(-1.4, 1.5);
  check("отрицательный ratio → unknown", r.verdict === "unknown");
}
{
  const r = bikeMatchVerdict(NaN, 1.5);
  check("NaN → unknown", r.verdict === "unknown");
}
{
  const r = bikeMatchVerdict(Infinity, 1.5);
  check("Infinity → unknown", r.verdict === "unknown");
}

// === обратно-совместимый isBikeMismatch: null НИКОГДА не mismatch ===
check("isBikeMismatch(1.5, null) = false (не пугаем зря)", isBikeMismatch(1.5, null) === false);
check("isBikeMismatch(1.4, 1.7) = true", isBikeMismatch(1.4, 1.7) === true);

// === итог ===
console.log(`\nИтого: ${ok} OK, ${fail} FAIL`);
if (fail > 0) process.exit(1);
