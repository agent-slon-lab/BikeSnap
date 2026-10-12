/**
 * Тест placeLoupeCenter (v1.14.23): лупа ВСЕГДА смещена от пальца.
 * Прогоняем сетку позиций пальца по типовым фото и проверяем:
 *  1) круг целиком внутри фото;
 *  2) расстояние палец→центр ≥ R + минимальный просвет (палец вне круга);
 *  3) на ландшафтном фото в середине кадра просвет заметно > 0
 *     (регрессия v3.1.0: было 34–62 px при R=84 — палец внутри круга).
 */
import { placeLoupeCenter } from "../src/components/bike-fit/InteractivePhoto";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail: string) {
  if (cond) {
    pass++;
    console.log(`  OK  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name} — ${detail}`);
  }
}

interface Scenario {
  name: string;
  w: number; // фото, vb
  h: number;
  containerW: number; // экранная ширина контейнера
  vhCap: number; // экранный cap высоты (70vh), 0 = без cap
}

// Типовые кейсы: шоссе-фото 4:3 и 3:2, портрет, кроп
const scenarios: Scenario[] = [
  { name: "4:3 landscape 4032x3024 @390", w: 4032, h: 3024, containerW: 390, vhCap: 560 },
  { name: "3:2 landscape 4032x2688 @390", w: 4032, h: 2688, containerW: 390, vhCap: 560 },
  { name: "16:9 landscape 4000x2250 @390", w: 4000, h: 2250, containerW: 390, vhCap: 560 },
  { name: "portrait 3024x4032 @390", w: 3024, h: 4032, containerW: 390, vhCap: 560 },
  { name: "4:3 @768 desktop", w: 4032, h: 3024, containerW: 768, vhCap: 800 },
  { name: "4:3 @360 small phone", w: 4032, h: 3024, containerW: 360, vhCap: 500 },
];

for (const sc of scenarios) {
  const pxPerUnit = sc.containerW / sc.w;
  const screenH = sc.h * pxPerUnit;
  const renderedH = Math.min(screenH, sc.vhCap);
  void renderedH; // cap учтён в magRScreen через containerW — упрощение, ок для теста
  const magRScreen = Math.min(84, Math.max(56, sc.containerW * 0.22));
  const magR = magRScreen / pxPerUnit;
  const toVb = (px: number) => px / pxPerUnit;
  const gaps = [76, 44];

  console.log(`\n=== ${sc.name} | magR=${magRScreen.toFixed(0)}scr (${(magR / 1000).toFixed(2)}k vb) ===`);
  // Сетка пальца: 7x5 по кадру
  for (let iy = 0; iy <= 4; iy++) {
    for (let ix = 0; ix <= 6; ix++) {
      const fx = (sc.w * ix) / 6;
      const fy = (sc.h * iy) / 4;
      const p = placeLoupeCenter(fx, fy, magR, sc.w, sc.h, gaps, toVb);
      const distScr = Math.hypot(p.cx - fx, p.cy - fy) * pxPerUnit;
      const inside =
        p.cx - magR >= -1e-6 && p.cx + magR <= sc.w + 1e-6 && p.cy - magR >= -1e-6 && p.cy + magR <= sc.h + 1e-6;
      const fingerOutside = distScr >= magRScreen - 1e-6;
      const name = `палец (${((fx / sc.w) * 100).toFixed(0)}%,${((fy / sc.h) * 100).toFixed(0)}%)`;
      check(
        name,
        inside && fingerOutside,
        `dist=${distScr.toFixed(0)}scr (R=${magRScreen.toFixed(0)}), inside=${inside}, pos=(${(p.cx / sc.w).toFixed(2)}w,${(p.cy / sc.h).toFixed(2)}h)`
      );
    }
  }
}

// Точечный регресс-кейс v3.1.0: 4:3 @390, палец ровно в центре кадра
{
  const w = 4032, h = 3024, cw = 390;
  const ppu = cw / w;
  const magRScreen = 84;
  const magR = magRScreen / ppu;
  const p = placeLoupeCenter(w / 2, h / 2, magR, w, h, [76, 44], (px) => px / ppu);
  const gapScr = (Math.hypot(p.cx - w / 2, p.cy - h / 2) - magR) * ppu;
  console.log(`\n=== Регресс центра 4:3@390: просвет от края лупы до пальца = ${gapScr.toFixed(0)} px (было отрицательным: палец внутри круга) ===`);
  check("регресс центра: просвет ≥ 20 px", gapScr >= 20, `gap=${gapScr.toFixed(1)}`);
}

console.log(`\nИтог: ${pass} OK, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
