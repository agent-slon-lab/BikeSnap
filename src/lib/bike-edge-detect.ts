/**
 * Edge detection + snap-to-edge для точной ручной разметки.
 *
 * Подход:
 * 1. Загружаем картинку в OffscreenCanvas / hidden canvas
 * 2. Вычисляем градиент Собеля (модуль) — это карта рёбер
 * 3. При клике пользователя ищем в радиусе (например 25px в натуральных пикселях)
 *    пиксель с максимальной силой ребра. Если она выше порога — снаппим туда.
 * 4. Иначе оставляем координату как есть.
 *
 * Почему Sobel, а не Canny: Canny требует двух проходов + гистерезиса,
 * это медленнее. Для snap достаточно модуля градиента.
 */

export interface EdgeMap {
  /** Ширина изображения в пикселях */
  width: number;
  /** Высота изображения в пикселях */
  height: number;
  /** Градиент Собеля, Float32Array длиной width*height */
  data: Float32Array;
  /** Максимальное значение градиента в карте (для нормировки) */
  max: number;
}

/**
 * Вычислить карту рёбер изображения (модуль градиента Собеля).
 *
 * @param imgSrc URL или data URL картинки
 * @returns EdgeMap или null если не удалось
 */
export async function computeEdgeMap(imgSrc: string): Promise<EdgeMap | null> {
  try {
    const img = await loadImage(imgSrc);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w === 0 || h === 0) return null;

    // Чтобы не гонять Собеля на 4K-фото — уменьшаем до 1024px по длинной стороне
    const MAX_DIM = 1024;
    const scale = Math.min(1, MAX_DIM / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, cw, ch);

    const imageData = ctx.getImageData(0, 0, cw, ch);
    const pixels = imageData.data;
    const gray = new Float32Array(cw * ch);
    for (let i = 0; i < cw * ch; i++) {
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // Sobel kernels:
    // Gx = [-1 0 1; -2 0 2; -1 0 1]
    // Gy = [-1 -2 -1; 0 0 0; 1 2 1]
    const gx = new Float32Array(cw * ch);
    const gy = new Float32Array(cw * ch);
    const mag = new Float32Array(cw * ch);

    for (let y = 1; y < ch - 1; y++) {
      for (let x = 1; x < cw - 1; x++) {
        const idx = y * cw + x;
        const tl = gray[(y - 1) * cw + (x - 1)];
        const tc = gray[(y - 1) * cw + x];
        const tr = gray[(y - 1) * cw + (x + 1)];
        const ml = gray[y * cw + (x - 1)];
        const mr = gray[y * cw + (x + 1)];
        const bl = gray[(y + 1) * cw + (x - 1)];
        const bc = gray[(y + 1) * cw + x];
        const br = gray[(y + 1) * cw + (x + 1)];

        gx[idx] = -tl - 2 * ml - bl + tr + 2 * mr + br;
        gy[idx] = -tl - 2 * tc - tr + bl + 2 * bc + br;
        mag[idx] = Math.sqrt(gx[idx] * gx[idx] + gy[idx] * gy[idx]);
      }
    }

    // Слегка блюрим магнитуду (1px box blur) — чтобы рёбра были "толще"
    // и снап работал даже если клик чуть в стороне.
    const blurred = new Float32Array(cw * ch);
    for (let y = 1; y < ch - 1; y++) {
      for (let x = 1; x < cw - 1; x++) {
        const idx = y * cw + x;
        blurred[idx] =
          (mag[idx] +
            mag[idx - 1] +
            mag[idx + 1] +
            mag[idx - cw] +
            mag[idx + cw]) /
          5;
      }
    }

    let max = 0;
    for (let i = 0; i < blurred.length; i++) {
      if (blurred[i] > max) max = blurred[i];
    }

    return {
      width: cw,
      height: ch,
      data: blurred,
      max,
    };
  } catch {
    return null;
  }
}

/**
 * Найти ближайшую сильную точку ребра к заданной позиции.
 *
 * @param edgeMap карта рёбер
 * @param imgX X в натуральных пикселях исходного изображения
 * @param imgY Y в натуральных пикселях исходного изображения
 * @param realImgW реальные ширина исходного изображения
 * @param realImgH реальные высота исходного изображения
 * @param radiusPx радиус поиска в натуральных пикселях
 * @param thresholdMin минимальная относительная сила ребра (0..1 от max)
 * @returns новые координаты в натуральных пикселях исходного изображения
 */
export function snapToEdge(
  edgeMap: EdgeMap,
  imgX: number,
  imgY: number,
  realImgW: number,
  realImgH: number,
  radiusPx: number = 25,
  thresholdMin: number = 0.15
): { x: number; y: number; snapped: boolean; strength: number } {
  // Переводим в координаты карты рёбер (она может быть уменьшена)
  const scaleX = edgeMap.width / realImgW;
  const scaleY = edgeMap.height / realImgH;
  const ex = imgX * scaleX;
  const ey = imgY * scaleY;

  // Радиус в координатах карты
  const radiusMap = radiusPx * Math.min(scaleX, scaleY);
  const r = Math.max(2, Math.round(radiusMap));
  const r2 = r * r;

  const threshold = edgeMap.max * thresholdMin;

  let bestX = ex;
  let bestY = ey;
  let bestMag = 0;
  let found = false;

  const x0 = Math.max(1, Math.floor(ex - r));
  const x1 = Math.min(edgeMap.width - 1, Math.ceil(ex + r));
  const y0 = Math.max(1, Math.floor(ey - r));
  const y1 = Math.min(edgeMap.height - 1, Math.ceil(ey + r));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - ex;
      const dy = y - ey;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const m = edgeMap.data[y * edgeMap.width + x];
      if (m > threshold && m > bestMag) {
        bestMag = m;
        bestX = x;
        bestY = y;
        found = true;
      }
    }
  }

  if (!found) {
    return { x: imgX, y: imgY, snapped: false, strength: 0 };
  }

  // Переводим обратно в натуральные пиксели
  return {
    x: bestX / scaleX,
    y: bestY / scaleY,
    snapped: true,
    strength: bestMag / edgeMap.max,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
