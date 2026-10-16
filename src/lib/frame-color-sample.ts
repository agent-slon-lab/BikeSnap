/**
 * Семпл цвета рамы (v1.14.43, multi-factor bike match — Factor C).
 * DOM-обёртки над чистой medianRgbFromPixels (bike-match-validator.ts):
 *  - sampleMedianColorFromImageElement — фото вела (Шаг 2): окно вырезается
 *    из оригинального разрешения (качество семпла максимальное);
 *  - sampleMedianColorFromFrame — боковое фото райдера (Шаг 1): берём
 *    уже готовый уменьшенный кадр детектора колёс (без второго canvas).
 *
 * Все координаты окна — нормализованные 0..1 (nx, ny — центр,
 * halfNorm — ПОЛУразмер по каждой оси). Выход за границы кадра клампится.
 */

import { medianRgbFromPixels, type Rgb } from "./bike-match-validator";
import type { RawFrame } from "./wheel-detect";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Медианный RGB окна нормализованного изображения (HTMLImageElement).
 * Возвращает null на битом изображении или отказе canvas.
 */
export function sampleMedianColorFromImageElement(
  img: HTMLImageElement,
  nx: number,
  ny: number,
  halfNorm: number
): Rgb | null {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  if (
    !Number.isFinite(nx) ||
    !Number.isFinite(ny) ||
    !Number.isFinite(halfNorm) ||
    halfNorm <= 0
  ) {
    return null;
  }
  const halfW = Math.max(2, Math.round(halfNorm * w));
  const halfH = Math.max(2, Math.round(halfNorm * h));
  const cx = clamp(Math.round(nx * w), halfW, w - halfW);
  const cy = clamp(Math.round(ny * h), halfH, h - halfH);
  const sw = Math.min(2 * halfW, w);
  const sh = Math.min(2 * halfH, h);
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(img, cx - halfW, cy - halfH, sw, sh, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh);
    return medianRgbFromPixels(data.data);
  } catch {
    return null;
  }
}

/**
 * Медианный RGB окна из готового кадра детектора (ImageData ~480px).
 * Используется на Шаге 1: кадр уже снят в img.onload для детекции колёс.
 */
export function sampleMedianColorFromFrame(
  frame: RawFrame,
  nx: number,
  ny: number,
  halfNorm: number
): Rgb | null {
  const w = frame.width;
  const h = frame.height;
  if (!w || !h) return null;
  if (
    !Number.isFinite(nx) ||
    !Number.isFinite(ny) ||
    !Number.isFinite(halfNorm) ||
    halfNorm <= 0
  ) {
    return null;
  }
  const halfW = Math.max(1, Math.round(halfNorm * w));
  const halfH = Math.max(1, Math.round(halfNorm * h));
  const x0 = clamp(Math.round(nx * w) - halfW, 0, w - 1);
  const y0 = clamp(Math.round(ny * h) - halfH, 0, h - 1);
  const x1 = clamp(Math.round(nx * w) + halfW, 1, w);
  const y1 = clamp(Math.round(ny * h) + halfH, 1, h);
  const sw = x1 - x0;
  const sh = y1 - y0;
  if (sw < 2 || sh < 2) return null;
  const rowBytes = w * 4;
  const out = new Uint8ClampedArray(sw * sh * 4);
  for (let row = 0; row < sh; row++) {
    const srcStart = (y0 + row) * rowBytes + x0 * 4;
    out.set(
      frame.data.subarray(srcStart, srcStart + sw * 4),
      row * sw * 4
    );
  }
  return medianRgbFromPixels(out);
}
