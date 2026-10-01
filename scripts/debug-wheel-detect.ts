/** Отладка детектора: почему кейсы 2/5/7/8 не находятся */
import {
  detectWheels,
  type RawFrame,
} from "../src/lib/wheel-detect";

function drawWheel(
  frame: RawFrame, cx: number, cy: number, a: number, b: number,
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

function debugRun(name: string, f: RawFrame) {
  console.log(`\n=== ${name} (${f.width}x${f.height}) ===`);
  let call = 0;
  detectWheels(f, (info) => {
    call++;
    if (info.pool.length) {
      console.log(`edgeT=${info.edgeT.toFixed(1)} edges=${info.edgeCount}`);
      console.log("pool (top 12):");
      for (const p of info.pool.slice(0, 12)) {
        console.log(`  c=(${p.cx},${p.cy}) votes=${p.votes.toFixed(0)}`);
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

// Кейс 1 (проходит) — для эталона
{
  const f = makeFrame(320, 200);
  drawWheel(f, 90, 105, 45, 45);
  drawWheel(f, 235, 105, 45, 45);
  debugRun("Кейс 1: два круга r=45", f);
}

// Кейс 5 (падает) — круги со сдвигом по Y
{
  const f = makeFrame(320, 220);
  drawWheel(f, 85, 100, 45, 45);
  drawWheel(f, 238, 114, 45, 45);
  debugRun("Кейс 5: два круга, вторая ось ниже на 14px", f);
}

// Кейс 2 (падает) — эллипсы 0.78
{
  const f = makeFrame(320, 200);
  drawWheel(f, 80, 105, 45 * 0.78, 45);
  drawWheel(f, 235, 105, 45 * 0.78, 45);
  debugRun("Кейс 2: эллипсы rx/ry=0.78", f);
}

// Кейс 8 (падает) — эллипсы 0.6
{
  const f = makeFrame(320, 200);
  drawWheel(f, 80, 105, 45 * 0.6, 45);
  drawWheel(f, 235, 105, 45 * 0.6, 45);
  debugRun("Кейс 8: эллипсы rx/ry=0.6", f);
}
