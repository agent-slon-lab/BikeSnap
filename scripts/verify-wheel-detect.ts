/**
 * Проверка детектора колёс на синтетических кадрах.
 * Запуск: bun scripts/verify-wheel-detect.ts
 *
 * Кейсы:
 *  1. Два круглых колеса (строго сбоку)      → ok, roundness ≥ 0.85
 *  2. Два овала (съёмка под углом, b/a=0.78) → tilted, roundness ≈ 0.78 ± 0.1
 *  3. Пустой фон (нет велосипеда)            → none
 *  4. Одно колесо в кадре                    → partial
 */
import { detectWheels, type RawFrame, type WheelDetectResult } from "../src/lib/wheel-detect";

let failures = 0;

function check(name: string, cond: boolean, detail: string) {
  if (cond) {
    console.log(`  ✓ ${name} — ${detail}`);
  } else {
    failures++;
    console.error(`  ✗ ${name} — ${detail}`);
  }
}

/** Рисует кольцо-«колесо» на кадре */
function drawWheel(
  frame: RawFrame,
  cx: number,
  cy: number,
  a: number,
  b: number,
  opts: { bg?: number; tire?: number; spokes?: number } = {},
) {
  const { bg = 205, tire = 45, spokes = 175 } = opts;
  const { width: W, height: H, data } = frame;
  const innerK = 0.62;
  for (let y = Math.max(0, Math.floor(cy - b - 2)); y <= Math.min(H - 1, Math.ceil(cy + b + 2)); y++) {
    for (let x = Math.max(0, Math.floor(cx - a - 2)); x <= Math.min(W - 1, Math.ceil(cx + a + 2)); x++) {
      const nx = (x - cx) / a;
      const ny = (y - cy) / b;
      const t = Math.sqrt(nx * nx + ny * ny);
      let v = bg;
      if (t <= 1 && t >= innerK) v = tire;
      else if (t < innerK) v = spokes;
      const p = (y * W + x) * 4;
      data[p] = v; data[p + 1] = v; data[p + 2] = v; data[p + 3] = 255;
    }
  }
}

function makeFrame(W: number, H: number, bg = 205): RawFrame {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = bg; data[i * 4 + 1] = bg; data[i * 4 + 2] = bg; data[i * 4 + 3] = 255;
  }
  return { width: W, height: H, data };
}

function run(frame: RawFrame): WheelDetectResult {
  return detectWheels(frame);
}

// ============================================================
console.log("=== Wheel Detector v1 — синтетические кадры ===\n");

// --- Кейс 1: два круглых колеса ---
{
  const f = makeFrame(320, 200);
  drawWheel(f, 90, 105, 45, 45);
  drawWheel(f, 235, 105, 45, 45);
  const r = run(f);
  console.log("Кейс 1: два круглых колеса (ракурс строго сбоку)");
  check("status = ok", r.status === "ok", `status=${r.status}`);
  check("найдено 2 колеса", r.wheels.length === 2, `wheels=${r.wheels.length}`);
  check(
    "roundness ≥ 0.85",
    r.wheels.length === 2 && Math.min(...r.wheels.map((w) => w.roundness)) >= 0.85,
    `roundness=${r.wheels.map((w) => w.roundness.toFixed(2)).join("/")}`,
  );
  check(
    "оси почти горизонтальны",
    Math.abs(r.axleTiltDeg) < 3,
    `axleTilt=${r.axleTiltDeg.toFixed(1)}°`,
  );
  console.log("");
}

// --- Кейс 2: два овала (съёмка под углом ~39°: cos 39° ≈ 0.78) ---
{
  const f = makeFrame(320, 200);
  drawWheel(f, 80, 105, 45, 45 * 0.78);
  drawWheel(f, 235, 105, 45, 45 * 0.78);
  const r = run(f);
  console.log("Кейс 2: два овала (b/a = 0.78 — ракурс под углом)");
  check("status = tilted", r.status === "tilted", `status=${r.status}`);
  check("найдено 2 колеса", r.wheels.length === 2, `wheels=${r.wheels.length}`);
  check(
    "roundness ≈ 0.78 ± 0.12",
    r.wheels.length === 2 && Math.abs(Math.min(...r.wheels.map((w) => w.roundness)) - 0.78) <= 0.12,
    `roundness=${r.wheels.map((w) => w.roundness.toFixed(2)).join("/")}`,
  );
  console.log("");
}

// --- Кейс 3: пустой фон ---
{
  const f = makeFrame(320, 200);
  const r = run(f);
  console.log("Кейс 3: пустой фон");
  check("status = none", r.status === "none", `status=${r.status}`);
  console.log("");
}

// --- Кейс 4: одно колесо ---
{
  const f = makeFrame(320, 200);
  drawWheel(f, 160, 105, 45, 45);
  const r = run(f);
  console.log("Кейс 4: одно колесо в кадре");
  check("status = partial", r.status === "partial", `status=${r.status}`);
  check("найдено 1 колесо", r.wheels.length === 1, `wheels=${r.wheels.length}`);
  console.log("");
}

// --- Кейс 5: наклонённый велосипед (оси под 5°) — колесо остаётся кругом ---
{
  const f = makeFrame(320, 220);
  drawWheel(f, 85, 100, 45, 45);
  drawWheel(f, 238, 114, 45, 45); // вторая ось ниже на 14px
  const r = run(f);
  console.log("Кейс 5: завал горизонта (вторая ось ниже на 14px)");
  check("status = ok (круглость не страдает от наклона)", r.status === "ok", `status=${r.status}`);
  check(
    "axleTilt ≈ 5° ± 2",
    Math.abs(r.axleTiltDeg - 5) < 2,
    `axleTilt=${r.axleTiltDeg.toFixed(1)}°`,
  );
  console.log("");
}

if (failures > 0) {
  console.error(`\nПРОВАЛЕНО: ${failures} проверок`);
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ЗЕЛЁНЫЕ");
