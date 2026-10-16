/**
 * Визуальная проверка v1.14.44: рисует найденные детектором эллипсы
 * поверх фото (зелёный — найденная пара, размер = полные оси).
 * Запуск: npx tsx scripts/draw-wheel-detect.ts <in.jpg> <out.png> [...]
 */
import sharp from "sharp";
import { detectWheels, type RawFrame } from "../src/lib/wheel-detect";

async function main() {
  const args = process.argv.slice(2);
  for (let i = 0; i + 1 < args.length; i += 2) {
    const [inp, out] = [args[i], args[i + 1]];
    const img = sharp(inp);
    const meta = await img.metadata();
    const targetWidth = 480;
    const scale = Math.min(1, targetWidth / (meta.width ?? targetWidth));
    const w = Math.max(32, Math.round((meta.width ?? 0) * scale));
    const h = Math.max(32, Math.round((meta.height ?? 0) * scale));
    const { data } = await img.resize(w, h).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const frame: RawFrame = { width: w, height: h, data: new Uint8ClampedArray(data) };
    const res = detectWheels(frame);
    console.log(`${inp}: status=${res.status} wheels=${res.wheels.length} ratio=${res.wheels.length === 2 ? (((Math.hypot(res.wheels[1].cx - res.wheels[0].cx, res.wheels[1].cy - res.wheels[0].cy)) / ((res.wheels[0].a + res.wheels[1].a))).toFixed(3)) : "—"}`);
    // рисуем эллипсы прямо в raw-буфер
    for (const wh of res.wheels) {
      const N = 72;
      for (let k = 0; k < N; k++) {
        const phi = (k / N) * 2 * Math.PI;
        for (const [a, b] of [[wh.a, wh.b], [wh.a * 0.62, wh.b * 0.62]] as const) {
          const x = Math.round(wh.cx + a * Math.cos(phi));
          const y = Math.round(wh.cy + b * Math.sin(phi));
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const p = (y * w + x) * 4;
          data[p] = 0; data[p + 1] = 255; data[p + 2] = 0; data[p + 3] = 255;
        }
      }
      // центр
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [0, 0]] as const) {
        const x = Math.round(wh.cx) + dx, y = Math.round(wh.cy) + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const p = (y * w + x) * 4;
        data[p] = 255; data[p + 1] = 0; data[p + 2] = 0; data[p + 3] = 255;
      }
    }
    await sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } })
      .png()
      .toFile(out);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
