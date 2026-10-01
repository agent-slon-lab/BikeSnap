/**
 * WEB WORKER — вынос детектора колёс из основного потока
 * ======================================================
 *
 * Проблема: цикл детекции (полутон → Отсу → BFS → эллипсы) на кадре 320px
 * занимает единицы миллисекунд, но на слабых телефонах при каждом кадре
 * дёргает Main Thread — вместе с отрисовкой видео и React это даёт фризы UI.
 *
 * Решение: Main Thread только уменьшает кадр до 320px (drawImage + getImageData)
 * и отправляет ImageData сюда; всю математику считает воркер.
 *
 * Обмен: { imageData: ImageData } → WheelDetectResult (структурная копия,
 * ImageData клонируется автоматически, передавать ArrayBuffer не требуется).
 */

import { detectWheels } from "../lib/wheel-detect";

/** self в worker-контексте типизирован как Window (lib.dom) — сужаем до обмена сообщениями */
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<{ imageData: ImageData | null }>) => void) | null;
  postMessage: (msg: unknown) => void;
};

ctx.onmessage = (e: MessageEvent<{ imageData: ImageData | null }>) => {
  const imageData = e.data?.imageData;
  if (!imageData) return;

  // ImageData структурно совместим с RawFrame { width, height, data }
  const result = detectWheels(imageData);

  ctx.postMessage(result);
};
