/**
 * Стенд v1.14.37: прогон авто-детектора колёс на РЕАЛЬНЫХ фото райдера
 * из user-reports (подмена вела). Цель — увидеть, что детектор посчитал бы,
 * если бы гонка/маунт-баги не мешали, и какой вердикт получил бы свап.
 * Запуск: npx tsx scripts/test-wheel-detect-reports.ts <photo1> <photo2> ...
 */
import sharp from "sharp";
import { detectWheels, type RawFrame } from "../src/lib/wheel-detect";
import { computeWheelRatioFromFrame } from "../src/lib/bike-wheel-ratio";

async function toRawFrame(path: string): Promise<RawFrame> {
  const img = sharp(path);
  const meta = await img.metadata();
  const targetWidth = 480;
  const scale = Math.min(1, targetWidth / (meta.width ?? targetWidth));
  const w = Math.max(32, Math.round((meta.width ?? 0) * scale));
  const h = Math.max(32, Math.round((meta.height ?? 0) * scale));
  const { data } = await img.resize(w, h).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: w, height: h, data: new Uint8ClampedArray(data) };
}

const files = process.argv.slice(2);

async function main() {
  for (const f of files) {
    const frame = await toRawFrame(f);
    const result = detectWheels(frame);
    const ratio = computeWheelRatioFromFrame(frame);
    const wheels = result.wheels.map((wh) => ({
      cx: Math.round(wh.cx), cy: Math.round(wh.cy),
      a: Math.round(wh.a), b: Math.round(wh.b),
      d: Math.round(2 * wh.a),
    }));
    console.log(`\n${f}`);
    console.log(`  wheels: ${result.wheels.length}`, JSON.stringify(wheels));
    console.log(`  status: ${result.status ?? "?"}`);
    console.log(`  ratio (wb/d): ${ratio?.toFixed(3) ?? "null"}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
