/**
 * ОТЧЁТ ДЛЯ ОТЛАДКИ (v1.6.0)
 * ===========================================================================
 * Идея пользователя: «можно как-то сделать отправку отчёта? для корректирования
 * кода». Кнопка в шаге «Анализ» собирает ВСЁ, что нужно, чтобы докрутить
 * алгоритмы по реальным данным: фото (уменьшенное до 1280px), ключевые точки
 * позы, результат анализа или текст ошибки, положение телефона по гироскопу
 * в момент спуска и контекст онбординга.
 *
 * Приватность: ничего никуда не отправляется само. Отчёт либо отдаётся в
 * системное меню «Поделиться» (пользователь сам выбирает, кому переслать),
 * либо просто скачивается файлом .json.
 */

import { APP_VERSION } from "@/lib/app-version";
import type { Point, ViewType } from "@/lib/bike-fit";

/** Гироскоп в момент спуска затвора (прокидывается из CameraCapture). */
export interface CaptureMeta {
  /** Наклон вперёд/назад, град (~90 = телефон вертикально) */
  pitch: number;
  /** Боковой крен, град */
  roll: number;
  /** Датчик был живой (на десктопе false — pitch/roll мусорные) */
  gyroSupported: boolean;
  /** Момент снимка, epoch ms */
  timestamp: number;
}

/** Данные одного ракурса для отчёта. */
export interface ReportViewInput {
  view: ViewType;
  /** ObjectURL загруженного фото (null — фото нет) */
  url: string | null;
  landmarks: Point[] | null;
  analysis: unknown;
  error: string | null;
  captureMeta?: CaptureMeta | null;
}

/** Данные калибровки шага 2 (фото велика + точки разметки) для отчёта. */
export interface BikeCalibrationInput {
  /** dataURL фото велика (уже сжат при сохранении в карточку) или null */
  photo: string | null;
  /** Точки разметки [0..1], ключи — BikeKeyPoints */
  points: Record<string, { x: number; y: number } | null> | null;
}

/** Данные калибровки шага 2 (фото велика + точки разметки) для отчёта. */
export interface BikeCalibrationInput {
  /** dataURL фото велика (уже сжат при сохранении в карточку) или null */
  photo: string | null;
  /** Точки разметки [0..1], ключи — BikeKeyPoints */
  points: Record<string, { x: number; y: number } | null> | null;
}

/** Контекст онбординга (из стора). body/bike — any-структуры, уходят в JSON как есть. */
export interface FitReportContext {
  bikeType?: string | null;
  goal?: string | null;
  complaints?: readonly string[];
  body?: unknown;
  bike?: unknown;
}

export interface FitReport {
  meta: {
    app: "BikeSnap";
    version: string;
    createdAt: string;
    userAgent: string;
    screen: string;
    viewport: string;
    orientation: "portrait" | "landscape";
    language: string;
  };
  context: FitReportContext;
  views: Array<{
    view: ViewType;
    analyzed: boolean;
    error: string | null;
    landmarksCount: number;
    landmarks: Array<{ x: number; y: number; visibility?: number }> | null;
    analysis: unknown;
    captureMeta: CaptureMeta | null;
    /** JPEG dataURL ≤1280px (или null, если фото прочитать не удалось) */
    photo: string | null;
    /** Путь к фото в репозитории (заполняется при заливке на GitHub) */
    photoFile?: string | null;
  }>;
  /**
   * Калибровка шага 2 «Велосипед»: фото велика с боку + точки разметки,
   * по которым считались SH/WB/WH (v1.14.15 — по запросу «НАДО ЧТОБЫ эти
   * действия ТОЖЕ СОХРАНЯЛИСЬ»). Отсутствует, если калибровка не проводилась.
   */
  bikeCalibration?: {
    /** JPEG dataURL фото велика (вырезается при заливке, см. photoFile) */
    photo: string | null;
    /** Путь к фото велика в репозитории */
    photoFile?: string | null;
    points: Record<string, { x: number; y: number } | null> | null;
  } | null;
}

export type ReportSendResult = "shared" | "downloaded" | "cancelled";

/** Округление до 4 знаков — точки нормализованы (0..1), точнее не нужно. */
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Фото → уменьшенный JPEG dataURL (большая сторона ≤ maxDim).
 * blob: URL того же origin — canvas не «портится». Любая ошибка → null
 * (отчёт без фото лучше, чем никакой отчёт).
 * v1.14.17: экспортирована — тот же компрессор использует персист фото
 * шага 4 (photo-analysis-store): dataURL переживает refresh, blob: — нет.
 */
export async function photoToDataUrl(url: string, maxDim = 1280): Promise<string | null> {
  try {
    if (typeof document === "undefined" || typeof Image === "undefined") return null;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("photo load timeout")), 8000);
      img.onload = () => { clearTimeout(timer); resolve(); };
      img.onerror = () => { clearTimeout(timer); reject(new Error("photo load error")); };
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) return null;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}

/**
 * Сборка отчёта: JSON-строка + имя файла. Фото читаются параллельно.
 * calibration — данные шага 2 (фото велика + точки разметки), v1.14.15.
 */
export async function buildFitReport(
  views: ReportViewInput[],
  context: FitReportContext = {},
  calibration?: BikeCalibrationInput | null,
): Promise<{ report: FitReport; json: string; filename: string }> {
  const viewsOut: FitReport["views"] = await Promise.all(
    views.map(async (v) => ({
      view: v.view,
      analyzed: !!v.analysis,
      error: v.error ?? null,
      landmarksCount: v.landmarks?.length ?? 0,
      landmarks: v.landmarks
        ? v.landmarks.map((p) => ({
            x: r4(p.x),
            y: r4(p.y),
            ...(p.visibility !== undefined ? { visibility: r4(p.visibility) } : {}),
          }))
        : null,
      analysis: v.analysis ?? null,
      captureMeta: v.captureMeta ?? null,
      photo: v.url ? await photoToDataUrl(v.url) : null,
    })),
  );

  const calibOut: FitReport["bikeCalibration"] = calibration
    ? {
        photo: calibration.photo ? await photoToDataUrl(calibration.photo) : null,
        photoFile: null,
        points: calibration.points ?? null,
      }
    : null;

  const report: FitReport = {
    meta: {
      app: "BikeSnap",
      version: APP_VERSION,
      createdAt: new Date().toISOString(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      screen:
        typeof screen !== "undefined" ? `${screen.width}x${screen.height}` : "unknown",
      viewport:
        typeof window !== "undefined"
          ? `${window.innerWidth}x${window.innerHeight}`
          : "unknown",
      orientation:
        typeof window !== "undefined" && window.innerWidth >= window.innerHeight
          ? "landscape"
          : "portrait",
      language: typeof navigator !== "undefined" ? navigator.language : "unknown",
    },
    context,
    views: viewsOut,
    ...(calibOut ? { bikeCalibration: calibOut } : {}),
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `bikesnap-report-${APP_VERSION}-${stamp}.json`;

  return { report, json: JSON.stringify(report), filename };
}

/**
 * Доставка отчёта: системное «Поделиться» (мобильные — файлом .json),
 * иначе скачивание файла. AbortError от системного меню = пользователь
 * передумал (не показываем как ошибку).
 */
export async function sendReport(json: string, filename: string): Promise<ReportSendResult> {
  const blob = new Blob([json], { type: "application/json" });
  const file = new File([blob], filename, { type: "application/json" });

  // Web Share API с файлами — iOS/Android: открывается нативное меню
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    navigator.canShare?.({ files: [file] })
  ) {
    try {
      await navigator.share({
        files: [file],
        title: "BikeSnap — отчёт для отладки",
      });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      // share не прошёл — падаем в скачивание
    }
  }

  // Фолбэк: скачать файл
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "downloaded";
}
