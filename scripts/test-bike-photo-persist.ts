/**
 * Тест персистенции фото велика (v1.14.24).
 * Баг: в bikefit-bikes просачивался blob: URL (умирает при F5) →
 * после перезагрузки «фото не грузится, чёрный экран».
 * Проверяем: guard в updateBikePhoto, самолечение в getBikes,
 * живучесть при ошибке квоты.
 */

// --- мок localStorage (узел без DOM) ---
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if ((globalThis as { __quotaFail?: boolean }).__quotaFail) {
      throw new Error("QuotaExceededError (test)");
    }
    store.set(k, v);
  },
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

import {
  createBike,
  getBikes,
  updateBikePhoto,
} from "../src/lib/bike-storage";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  OK  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

// 1. Обычное сохранение dataURL — остаётся
const bike = createBike("Тест", "road", {} as never);
const DATA_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";
const POINTS = JSON.stringify({ bb: { x: 0.5, y: 0.6 } });
updateBikePhoto(bike.id, DATA_URL, POINTS);
let rec = getBikes().find((b) => b.id === bike.id);
check("dataURL сохраняется как есть", rec?.photoData === DATA_URL);
check("точки сохраняются", rec?.keyPointsData === POINTS);

// 2. Guard: blob: в updateBikePhoto не персистится, точки остаются
const BLOB = "blob:http://localhost/2b4e-dead";
updateBikePhoto(bike.id, BLOB, POINTS);
rec = getBikes().find((b) => b.id === bike.id);
check("blob: НЕ попадает в storage", !rec?.photoData, `photoData=${rec?.photoData?.slice(0, 30)}`);
check("точки при blob-вызове сохраняются", rec?.keyPointsData === POINTS);

// 3. Самолечение: запись, испорченная старой версией, чистится при чтении
const corrupted = [
  {
    id: "old-bike",
    name: "Битый",
    type: "road",
    measurements: {},
    photoData: BLOB, // мёртвый blob от старой версии
    keyPointsData: POINTS,
    createdAt: 1,
    updatedAt: 2,
  },
];
store.set("bikefit-bikes", JSON.stringify(corrupted));
const healed = getBikes();
const oldRec = healed.find((b) => b.id === "old-bike");
check("испорченная запись самолечится (photoData удалён)", !oldRec?.photoData);
check("точки испорченной записи сохранены", oldRec?.keyPointsData === POINTS);
const rawAfter = JSON.parse(store.get("bikefit-bikes") ?? "[]") as Array<{ id: string; photoData?: string }>;
check("лечение записано обратно в storage", !rawAfter.find((b) => b.id === "old-bike")?.photoData);

// 4. dataURL-записи самолечение не трогает (в смеси с битой)
const mixed = [
  { id: "good-bike", name: "Good", type: "road", measurements: {}, photoData: DATA_URL, createdAt: 1, updatedAt: 2 },
  { id: "bad-bike", name: "Bad", type: "road", measurements: {}, photoData: BLOB, createdAt: 1, updatedAt: 2 },
];
store.set("bikefit-bikes", JSON.stringify(mixed));
const healed2 = getBikes();
check("валидный dataURL при лечении не тронут", healed2.find((b) => b.id === "good-bike")?.photoData === DATA_URL);
check("битый сосед вылечен", !healed2.find((b) => b.id === "bad-bike")?.photoData);

// 5. Ошибка квоты не роняет поток
(globalThis as { __quotaFail?: boolean }).__quotaFail = true;
let threw = false;
try {
  updateBikePhoto(bike.id, DATA_URL, POINTS);
} catch {
  threw = true;
}
(globalThis as { __quotaFail?: boolean }).__quotaFail = false;
check("QuotaExceededError не выбрасывается наружу", !threw);

console.log(`\nИтог: ${pass} OK, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
