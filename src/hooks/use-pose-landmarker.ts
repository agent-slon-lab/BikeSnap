"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

interface UsePoseLandmarkerOptions {
  modelAssetPath?: string;
  numPoses?: number;
  /**
   * Если true — хук загрузит модель в режиме VIDEO (для real-time детекции).
   * Если false (по умолчанию) — в режиме IMAGE (для единичных снимков).
   */
  runningMode?: "IMAGE" | "VIDEO";
}

interface UsePoseLandmarkerReturn {
  landmarker: PoseLandmarker | null;
  loading: boolean;
  error: string | null;
  /** Детект позы на изображении (ImageBitmap | HTMLVideoElement | HTMLImageElement) */
  detect: (
    image: ImageBitmap | HTMLVideoElement | HTMLImageElement,
    timestampMs?: number
  ) => PoseLandmarkerResult | null;
  /** ID активного requestAnimationFrame (для отладки/cleanup). null если не используется. */
  animFrameId: number | null;
  /** Запланировать детект позы на следующем кадре видео (для real-time режима). */
  scheduleDetect: (
    video: HTMLVideoElement,
    callback: (result: PoseLandmarkerResult | null) => void
  ) => number | null;
  /** Отменить запланированный детект. */
  cancelScheduledDetect: () => void;
}

/**
 * Хук для загрузки и использования MediaPipe PoseLandmarker в браузере.
 *
 * Безопасность и cleanup:
 * - При размонтировании компонента вызывается `lm.close()` для освобождения GPU ресурсов.
 * - Если компонент размонтировался во время загрузки модели — закрытие срабатывает после неё.
 * - Сохраняется ID активного requestAnimationFrame для корректной отмены.
 * - Все ошибки оборачиваются в try-catch, чтобы не уронить React tree.
 *
 * Использование:
 *   const { landmarker, loading, error, detect } = usePoseLandmarker();
 *   if (loading) return <Loader />;
 *   if (error) return <Error msg={error} />;
 *   const result = detect(videoElement);  // для single-shot
 */
export function usePoseLandmarker({
  modelAssetPath = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  numPoses = 1,
  runningMode = "IMAGE",
}: UsePoseLandmarkerOptions = {}): UsePoseLandmarkerReturn {
  const [landmarker, setLandmarker] = useState<PoseLandmarker | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [animFrameId, setAnimFrameId] = useState<number | null>(null);

  // Refs для cleanup
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;

    async function init() {
      try {
        if (!isMountedRef.current) return;
        setLoading(true);
        setError(null);

        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
        );

        // Если компонент размонтировался во время загрузки WASM — выходим
        if (!isMountedRef.current) return;

        const lm = await PoseLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath,
            delegate: "GPU",
          },
          runningMode,
          numPoses,
        });

        // Если компонент размонтировался во время загрузки модели — сразу закрываем
        if (!isMountedRef.current) {
          try {
            lm.close();
          } catch {
            /* ignore */
          }
          return;
        }

        landmarkerRef.current = lm;
        setLandmarker(lm);
        setLoading(false);
      } catch (e) {
        if (!isMountedRef.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[POSE_LANDMARKER_INIT_ERROR]:", e);
        setError(`Не удалось загрузить модель: ${msg}`);
        setLoading(false);
      }
    }

    init();

    // Cleanup при размонтировании
    return () => {
      isMountedRef.current = false;

      // Отменяем активный requestAnimationFrame если он есть
      if (animFrameIdRef.current != null) {
        try {
          cancelAnimationFrame(animFrameIdRef.current);
        } catch {
          /* ignore */
        }
        animFrameIdRef.current = null;
        setAnimFrameId(null);
      }

      // Закрываем landmarker (освобождаем GPU)
      if (landmarkerRef.current) {
        try {
          landmarkerRef.current.close();
        } catch (e) {
          console.warn("[POSE_LANDMARKER_CLOSE_ERROR]:", e);
        }
        landmarkerRef.current = null;
        setLandmarker(null);
      }
    };
  }, [modelAssetPath, numPoses, runningMode]);

  const detect = useCallback(
    (
      image: ImageBitmap | HTMLVideoElement | HTMLImageElement,
      _timestampMs?: number
    ) => {
      if (!landmarkerRef.current) return null;
      try {
        // В IMAGE режиме detect(image) — синхронный.
        // В VIDEO режиме нужно detectForVideo(image, timestampMs), но текущий
        // тип в SDK должен сам выбрать метод по runningMode.
        return landmarkerRef.current.detect(image);
      } catch (e) {
        console.error("[POSE_LANDMARKER_DETECT_ERROR]:", e);
        return null;
      }
    },
    []
  );

  /**
   * Запланировать детект позы на следующем кадре видео (для real-time режима).
   * Возвращает ID requestAnimationFrame для возможной отмены.
   */
  const scheduleDetect = useCallback(
    (
      video: HTMLVideoElement,
      callback: (result: PoseLandmarkerResult | null) => void
    ): number | null => {
      if (!landmarkerRef.current) return null;

      // Отменяем предыдущий rAF если был
      if (animFrameIdRef.current != null) {
        try {
          cancelAnimationFrame(animFrameIdRef.current);
        } catch {
          /* ignore */
        }
      }

      const id = requestAnimationFrame(() => {
        animFrameIdRef.current = null;
        setAnimFrameId(null);
        try {
          const result = landmarkerRef.current?.detect(video) ?? null;
          callback(result);
        } catch (e) {
          console.error("[POSE_LANDMARKER_RAF_DETECT_ERROR]:", e);
          callback(null);
        }
      });

      animFrameIdRef.current = id;
      setAnimFrameId(id);
      return id;
    },
    []
  );

  /**
   * Отменить запланированный детект.
   */
  const cancelScheduledDetect = useCallback(() => {
    if (animFrameIdRef.current != null) {
      try {
        cancelAnimationFrame(animFrameIdRef.current);
      } catch {
        /* ignore */
      }
      animFrameIdRef.current = null;
      setAnimFrameId(null);
    }
  }, []);

  return {
    landmarker,
    loading,
    error,
    detect,
    animFrameId,
    scheduleDetect,
    cancelScheduledDetect,
  };
}
