/**
 * Микро-эксперимент: детектор на КРОПЕ переднего колеса bike-фото 04-33-42.
 * Если на кропе колесо находится — проблема в глобальной конкуренции краёв;
 * если нет — в локальной структуре (шnip, ротор, спицы).
 */
import sharp from "sharp";
import { detectWheels, type RawFrame } from "../src/lib/wheel-detect";

async function main() {
  const src = "user-reports/2026-10-14/bikesnap-report-v1.14.28-2026-10-14T04-33-42-photo-bike-side.jpg";
  // Кропы в координатах 480x360 (левое верхнее и размер), затем УЖЕ на кропе детектор
  const crops: Array<[string, number, number, number, number]> = [
    ["переднее колесо целиком", 0, 130, 200, 210],
    ["заднее колесо целиком", 260, 130, 200, 210],
    ["весь кадр (контроль)", 0, 0, 480, 360],
  ];
  const base = sharp(src).resize(480, 360);
  const { data } = await base.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const [name, left, top, width, height] of crops) {
    const frame: RawFrame = { width, height, data: new Uint8ClampedArray(width * height * 4) };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const s = ((top + y) * 480 + (left + x)) * 4;
        const d = (y * width + x) * 4;
        frame.data[d] = data[s]; frame.data[d + 1] = data[s + 1];
        frame.data[d + 2] = data[s + 2]; frame.data[d + 3] = 255;
      }
    }
    const res = detectWheels(frame);
    console.log(`${name}: status=${res.status} wheels=${res.wheels.map((w) => `(${w.cx.toFixed(0)},${w.cy.toFixed(0)}) a=${w.a.toFixed(0)} rO=${w.rOuter.toFixed(0)} s=${w.score.toFixed(2)}`).join(" | ") || "—"}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
