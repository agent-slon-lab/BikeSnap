/**
 * Диагностика v1.14.44: почему детектор колёс не работает на РЕАЛЬНЫХ фото.
 * Гипотеза: растровый скан краевых пикселей (сверху вниз, потолок 3000)
 * съедается текстурой верха кадра — до колёс в нижней половине бюджет
 * не доживает. Проверяем: где реально лежат выбранные края + стадии.
 * Запуск: npx tsx scripts/debug-wheel-real.ts <photo.jpg> [...]
 */
import sharp from "sharp";
import { detectWheels, type RawFrame } from "../src/lib/wheel-detect";

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

/** Точная реплика выбора краёв из wheel-detect.ts (растровый скан, потолок) */
function edgeDistribution(frame: RawFrame, edgeFraction = 0.1, maxEdges = 3000) {
  const { width: W, height: H, data } = frame;
  const total = W * H;
  const gray = new Uint8Array(total);
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  }
  const mag = new Float32Array(total);
  for (let y = 1; y < H - 1; y++) {
    const row = y * W;
    for (let x = 1; x < W - 1; x++) {
      const i = row + x;
      const tl = gray[i - W - 1], t = gray[i - W], tr = gray[i - W + 1];
      const l = gray[i - 1], r = gray[i + 1];
      const bl = gray[i + W - 1], b = gray[i + W], br = gray[i + W + 1];
      const sx = tr + 2 * r + br - (tl + 2 * l + bl);
      const sy = bl + 2 * b + br - (tl + 2 * t + tr);
      mag[i] = Math.sqrt(sx * sx + sy * sy);
    }
  }
  const minWH = Math.min(W, H);
  void minWH;
  // перцентиль 0.9 (как EDGE_FRACTION=0.1 при total>30000)
  const bins = 512;
  const hist = new Int32Array(bins);
  let maxM = 0;
  for (let i = 0; i < total; i++) if (mag[i] > maxM) maxM = mag[i];
  const scale = (bins - 1) / maxM;
  for (let i = 0; i < total; i++) hist[Math.round(mag[i] * scale)]++;
  const target = total * (1 - edgeFraction);
  let cum = 0;
  let edgeT = 12;
  for (let b = 0; b < bins; b++) {
    cum += hist[b];
    if (cum >= target) { edgeT = Math.max(12, b / scale); break; }
  }
  // растровый отбор, как в детекторе
  const selectedY = new Uint16Array(maxEdges);
  let count = 0;
  let exhaustedRow = -1;
  for (let y = 1; y < H - 1 && count < maxEdges; y++) {
    const row = y * W;
    for (let x = 1; x < W - 1 && count < maxEdges; x++) {
      if (mag[row + x] >= edgeT) { selectedY[count++] = y; }
    }
    if (count >= maxEdges && exhaustedRow < 0) exhaustedRow = y;
  }
  // пояса по 10%
  const bandCounts = new Array(10).fill(0);
  for (let k = 0; k < count; k++) {
    bandCounts[Math.min(9, Math.floor((selectedY[k] / H) * 10))]++;
  }
  const candidates = count >= maxEdges
    ? count // все, что набралось до потолка (могли быть и другие)
    : count;
  // сколько ВСЕГО пикселей выше порога (сколько реально конкурентів)
  let totalAbove = 0;
  for (let i = 0; i < total; i++) if (mag[i] >= edgeT) totalAbove++;
  return { edgeT, selected: count, totalAbove, exhaustedRow, bandCounts, H };
}

async function main() {
  for (const f of process.argv.slice(2)) {
    const frame = await toRawFrame(f);
    console.log(`\n=== ${f} (${frame.width}x${frame.height}) ===`);
    const dist = edgeDistribution(frame);
    console.log(`edgeT=${dist.edgeT.toFixed(1)} выбрано(до потолка)=${dist.selected} всего выше порога=${dist.totalAbove} скан упёрся в строку=${dist.exhaustedRow}`);
    console.log("распределение выбранных краёв по 10 поясам кадра (сверху вниз):");
    const bar = (n: number) => "#".repeat(Math.min(50, Math.round((n / Math.max(1, dist.selected)) * 100)));
    dist.bandCounts.forEach((n, i) => {
      console.log(`  ${i * 10}-${i * 10 + 10}%: ${String(n).padStart(5)}  ${bar(n)}`);
    });
    let call = 0;
    detectWheels(frame, (info) => {
      call++;
      if (call === 1) {
        console.log(`детектор: edgeT=${info.edgeT.toFixed(1)} edges=${info.edgeCount}`);
        if (info.pool.length) {
          console.log("pool (все кандидаты голосования):");
          for (const p of info.pool) {
            console.log(`  c=(${p.cx.toFixed(0)},${p.cy.toFixed(0)}) votes=${p.votes.toFixed(0)}`);
          }
        }
      }
      if (info.failed?.length) {
        console.log("failed (отбракованы с причиной):");
        for (const f of info.failed) {
          console.log(`  c=(${f.cx.toFixed(0)},${f.cy.toFixed(0)}) votes=${f.votes} — ${f.reason}`);
        }
      }
      if (info.refined.length) {
        console.log("refined:");
        for (const r of info.refined) {
          console.log(
            `  c=(${r.cx.toFixed(0)},${r.cy.toFixed(0)}) rx=${r.rx.toFixed(1)} ry=${r.ry.toFixed(1)} cov=${r.coverage.toFixed(2)} ring=${r.ring.toFixed(2)} sym=${r.sym.toFixed(2)} score=${r.score.toFixed(2)}`,
          );
        }
      }
      if (call >= 2) {
        console.log("accepted:", info.accepted.map((a) => `(${a.cx},${a.cy}) rx=${a.rx.toFixed(1)} ry=${a.ry.toFixed(1)} s=${a.score.toFixed(2)}`).join(" | ") || "—");
      }
    });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
