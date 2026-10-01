/**
 * КАМЕРА-УТИЛИТЫ — безопасный захват кадра для мобильных (iOS Safari / Android)
 * =============================================================================
 *
 * Проблема, которую решаем: кадр с камеры высокого разрешения (телефоны отдают
 * до 3840×2160 и выше), нарисованный в canvas 1:1, на мобильных устройствах
 * приводит к сбросу контекста Canvas/WebGL (жёсткий лимит GPU-текстур) и
 * всплескам памяти вплоть до крэша вкладки в iOS Safari.
 *
 * Решение: захватываем кадр ВИДЕОПОТОКА с ограничением максимальной стороны
 * (по умолчанию 2048px) — безопасно для всех мобильных GPU и более чем
 * достаточно для геометрической разметки.
 *
 * Про EXIF-ориентацию честно: живой кадр из getUserMedia (MediaStream) — это
 * сырые видеоданные БЕЗ EXIF; браузер уже отдаёт их в правильной ориентации
 * (imageOrientation: 'from-image' применяется к <video> автоматически).
 * EXIF-повороты актуальны только для файлов из галереи — тот путь обрабатывается
 * на этапе загрузки (createImageBitmap / <img> тоже нормализуют). Поэтому здесь
 * единственный источник «перевёрнутого» кадра — screen.orientation, что не
 * влияет на захват (мы берём кадр как есть из видеопотока).
 */

/** Максимальная сторона кадра — безопасный лимит для мобильных Canvas/GPU */
export const MAX_CAPTURE_DIMENSION = 2048;

/**
 * Безопасный захват изображения с видеопотока с ограничением разрешения.
 *
 * @param videoElement активный <video> с текущим потоком
 * @param maxDimension предел большей стороны (px)
 * @returns JPEG-блоб, готовый к оборачиванию в File
 */
export async function captureSafeFrame(
  videoElement: HTMLVideoElement,
  maxDimension: number = MAX_CAPTURE_DIMENSION,
): Promise<Blob> {
  let width = videoElement.videoWidth;
  let height = videoElement.videoHeight;

  if (!width || !height) {
    throw new Error("Video stream is not ready");
  }

  // Ограничиваем максимальное разрешение, чтобы iOS Safari не сбрасывал
  // контекст Canvas (сохраняем пропорции)
  if (width > maxDimension || height > maxDimension) {
    if (width > height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Failed to get 2D context");

  ctx.drawImage(videoElement, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas toBlob conversion failed"));
      },
      "image/jpeg",
      0.92,
    );
  });
}
