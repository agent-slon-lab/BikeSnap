/**
 * Юнит-тест v1.14.37: Photo Provenance — ловушка подмены фото между велами.
 * Проверяет fingerprintDataUrl (детерминизм, различимость, формат) и
 * pickProvenanceConflict (все ветки). Запуск: npx tsx scripts/test-photo-provenance.ts
 */
import { fingerprintDataUrl, pickProvenanceConflict, type PhotoProvenanceEntry } from "../src/lib/photo-fingerprint";

let ok = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { ok++; console.log(`  OK   ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const entry = (bikeId: string | null, at: number): PhotoProvenanceEntry => ({
  bikeId, bikeName: bikeId ?? null, view: "side", at,
});

console.log("fingerprintDataUrl:");
const a = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKgA/9k=";
const b = a.replace("/9j/", "/9i/"); // один байт разницы
check("детерминизм: same → same", fingerprintDataUrl(a) === fingerprintDataUrl(a));
check("различимость: разные строки → разные хеши", fingerprintDataUrl(a) !== fingerprintDataUrl(b));
check("формат: 16 hex-символов (пара хешей)", /^[0-9a-f]{16}$/.test(fingerprintDataUrl(a)));
check("пустая строка не падает", /^[0-9a-f]{16}$/.test(fingerprintDataUrl("")));
const big = a.repeat(2000); // ~200KB как реальный dataURL
check("большая строка (~200KB) быстро и стабильно", fingerprintDataUrl(big) === fingerprintDataUrl(big));

console.log("pickProvenanceConflict:");
check("пустой реестр → null", pickProvenanceConflict(undefined, "A") === null);
check("нет записей → null", pickProvenanceConflict([], "A") === null);
check("тот же вел → null", pickProvenanceConflict([entry("A", 1), entry("A", 2)], "A") === null);
{
  const c = pickProvenanceConflict([entry("A", 1), entry("B", 5)], "A");
  check("другой вел → конфликт (свежая запись)", c?.bikeId === "B" && c?.at === 5, JSON.stringify(c));
}
{
  const c = pickProvenanceConflict([entry("B", 3), entry("A", 7), entry("B", 9)], "A");
  check("конфликтная запись среди своих", c?.bikeId === "B" && c?.at === 9, JSON.stringify(c));
}
check("null vs вел → конфликт", pickProvenanceConflict([entry(null, 1)], "A")?.bikeId === null);
check("вел vs null → конфликт", pickProvenanceConflict([entry("A", 1)], null)?.bikeId === "A");
check("оба null → конфликта нет", pickProvenanceConflict([entry(null, 1)], null) === null);

console.log(`\nИтого: ${ok} OK, ${fail} FAIL`);
if (fail > 0) process.exit(1);
