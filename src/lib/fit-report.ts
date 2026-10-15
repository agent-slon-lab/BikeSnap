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
import { POSE_ENGINE_VERSION } from "@/lib/poseMetricsEngine";
import { extractPoseKeypoints, type Point, type ViewType, type PoseKeypoints } from "@/lib/bike-fit";

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
  /**
   * Телеметрия масштаба ядра (v1.14.29, Issue #6): источник масштаба,
   * мм/пиксель, наклон оси колёс — из карточки велика (photoCalib).
   */
  scale?: {
    scaleMmPerPx: number;
    scaleSource: string;
    frameTiltDeg: number;
    /** v1.14.34 (ТЗ п. 5.4): пропорция wheelbase/диаметр по разметке фото вела */
    wheelRatio?: number | null;
  } | null;
  /**
   * v1.14.35: скор авто-проверки «на фото вела обнаружен человек» (0..1),
   * из карточки велика (photoPersonScore). null/undefined — проверка не шла
   * (модель не успела загрузиться, фото без вердикта). Диагностика жалоб
   * «ИИ не понял моё фото»: в отчёте видно точный вердикт нейросети.
   */
  personScore?: number | null;
}

/** Контекст онбординга (из стора). body/bike — any-структуры, уходят в JSON как есть. */
export interface FitReportContext {
  bikeType?: string | null;
  goal?: string | null;
  complaints?: readonly string[];
  body?: unknown;
  bike?: unknown;
  /**
   * v1.14.30 (Stale State): какой велик был активен в момент отчёта.
   * Раньше параметры Bike_A (SH=800) смешивались с углами фото Bike_B —
   * по id/имени в отчёте сразу видно, тот ли велик анализировался.
   */
  activeBikeId?: string | null;
  activeBikeName?: string | null;
}

/** Живые датчики устройства в момент отправки отчёта (v1.14.29) */
export interface DeviceOrientationSnapshot {
  roll: number;
  pitch: number;
  supported: boolean;
}

/**
 * Телеметрия отчёта отладки (v1.14.29, Issue #6 «Расширение логов
 * и отчёта отладки»): сырые точки суставов, флаги калибровки масштаба,
 * датчики устройства, версии движка и среды.
 */
export interface FitReportTelemetry {
  appVersion: string;
  /** Версия движка метрик позы (poseMetricsEngine) */
  engineVersion: string;
  userAgent: string;
  viewportSize: string;
  screen: string;
  language: string;
  /** Датчики устройства в момент отправки отчёта */
  device: {
    deviceRoll: number | null;
    devicePitch: number | null;
    isOrientationSupported: boolean;
  };
  /** Флаги калибровки масштаба фото велика (шаг 2) */
  calibration: {
    /** Сырая строка источника из ядра (USER_OVERRIDE… / CONSENSUS… / FALLBACK_AUTO…) */
    scaleSource: string | null;
    /** Нормализованный вид источника (спека Issue #6) */
    scaleKind:
      | "USER_SADDLE_HEIGHT"
      | "USER_OVERRIDE"
      | "CONSENSUS"
      | "FALLBACK_WB"
      | "UNKNOWN"
      | null;
    scaleMmPerPx: number | null;
    frameTiltDeg: number | null;
  };
  /** Сырые 2D-точки суставов по ракурсам: нормализованные + пиксели */
  poseKeypoints: Record<
    string,
    {
      side: "left" | "right" | null;
      normalized: Record<string, { x: number; y: number } | null>;
      /** px по размеру приложенного фото (null — фото не прочиталось) */
      pixels: Record<string, { x: number; y: number } | null> | null;
      photoSize: { width: number; height: number } | null;
    }
    | null
  >;
}

/** Нормализованный вид источника масштаба (спека Issue #6: USER_SADDLE_HEIGHT / FALLBACK_WB и т.д.) */
export function normalizeScaleKind(src: string | null | undefined): FitReportTelemetry["calibration"]["scaleKind"] {
  if (!src) return null;
  if (src.startsWith("USER_OVERRIDE")) {
    return src.includes("saddleHeight") ? "USER_SADDLE_HEIGHT" : "USER_OVERRIDE";
  }
  if (src.startsWith("CONSENSUS")) return "CONSENSUS";
  if (src.startsWith("FALLBACK")) return "FALLBACK_WB";
  return "UNKNOWN";
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
    /** Телеметрия масштаба (v1.14.29) */
    scale?: {
      scaleMmPerPx: number;
      scaleSource: string;
      frameTiltDeg: number;
    } | null;
  } | null;
  /**
   * Телеметрия для отладки (v1.14.29, Issue #6): сырые точки суставов,
   * флаги калибровки, датчики устройства, версии. Собирается всегда.
   */
  telemetry?: FitReportTelemetry;
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

/** Размеры изображения по URL (для пересчёта норм. точек в пиксели). */
async function imageSizeOf(url: string): Promise<{ width: number; height: number } | null> {
  try {
    if (typeof document === "undefined" || typeof Image === "undefined") return null;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("image load timeout")), 8000);
      img.onload = () => { clearTimeout(timer); resolve(); };
      img.onerror = () => { clearTimeout(timer); reject(new Error("image load error")); };
      img.src = url;
    });
    return img.naturalWidth && img.naturalHeight
      ? { width: img.naturalWidth, height: img.naturalHeight }
      : null;
  } catch {
    return null;
  }
}

/** Норм. точки суставов → пиксели по размеру фото. */
function keypointsToPixels(
  kp: PoseKeypoints,
  size: { width: number; height: number }
): Record<string, { x: number; y: number } | null> {
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    shoulder: { x: r1(kp.shoulder.x * size.width), y: r1(kp.shoulder.y * size.height) },
    hip: { x: r1(kp.hip.x * size.width), y: r1(kp.hip.y * size.height) },
    knee: { x: r1(kp.knee.x * size.width), y: r1(kp.knee.y * size.height) },
    ankle: { x: r1(kp.ankle.x * size.width), y: r1(kp.ankle.y * size.height) },
    toe: { x: r1(kp.toe.x * size.width), y: r1(kp.toe.y * size.height) },
  };
}

/**
 * Сборка отчёта: JSON-строка + имя файла. Фото читаются параллельно.
 * calibration — данные шага 2 (фото велика + точки разметки), v1.14.15.
 * device — живые датчики в момент отправки (v1.14.29, Issue #6).
 */
export async function buildFitReport(
  views: ReportViewInput[],
  context: FitReportContext = {},
  calibration?: BikeCalibrationInput | null,
  device?: DeviceOrientationSnapshot | null,
): Promise<{ report: FitReport; json: string; filename: string }> {
  // v1.14.29: сырые точки суставов по ракурсам — заполняются ниже
  const poseKeypoints: FitReportTelemetry["poseKeypoints"] = {};
  const viewsOut: FitReport["views"] = await Promise.all(
    views.map(async (v) => {
      const photo = v.url ? await photoToDataUrl(v.url) : null;
      // v1.14.29: сырые точки суставов (нормализованные + пиксели приложенного фото)
      const analysisSide = (v.analysis as { side?: "left" | "right" } | null)?.side ?? null;
      const kp = extractPoseKeypoints(v.landmarks, analysisSide);
      let poseEntry: FitReportTelemetry["poseKeypoints"][string] = null;
      if (kp) {
        const size = photo ? await imageSizeOf(photo) : null;
        poseEntry = {
          side: analysisSide,
          normalized: {
            shoulder: { x: r4(kp.shoulder.x), y: r4(kp.shoulder.y) },
            hip: { x: r4(kp.hip.x), y: r4(kp.hip.y) },
            knee: { x: r4(kp.knee.x), y: r4(kp.knee.y) },
            ankle: { x: r4(kp.ankle.x), y: r4(kp.ankle.y) },
            toe: { x: r4(kp.toe.x), y: r4(kp.toe.y) },
          },
          pixels: size ? keypointsToPixels(kp, size) : null,
          photoSize: size,
        };
      }
      poseKeypoints[v.view] = poseEntry;

      return {
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
        photo,
      };
    }),
  );

  const calibOut: FitReport["bikeCalibration"] = calibration
    ? {
        photo: calibration.photo ? await photoToDataUrl(calibration.photo) : null,
        photoFile: null,
        points: calibration.points ?? null,
        ...(calibration.scale ? { scale: calibration.scale } : {}),
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
    telemetry: {
      appVersion: APP_VERSION,
      engineVersion: POSE_ENGINE_VERSION,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      viewportSize:
        typeof window !== "undefined"
          ? `${window.innerWidth}x${window.innerHeight}`
          : "unknown",
      screen: typeof screen !== "undefined" ? `${screen.width}x${screen.height}` : "unknown",
      language: typeof navigator !== "undefined" ? navigator.language : "unknown",
      device: {
        // Живые датчики в момент отправки; на десктопе supported=false —
        // пишем null, чтобы не путать мусорные нули с реальными данными
        deviceRoll: device?.supported ? Math.round(device.roll * 10) / 10 : null,
        devicePitch: device?.supported ? Math.round(device.pitch * 10) / 10 : null,
        isOrientationSupported: !!device?.supported,
      },
      calibration: {
        scaleSource: calibration?.scale?.scaleSource ?? null,
        scaleKind: normalizeScaleKind(calibration?.scale?.scaleSource),
        scaleMmPerPx: calibration?.scale?.scaleMmPerPx ?? null,
        frameTiltDeg: calibration?.scale?.frameTiltDeg ?? null,
      },
      poseKeypoints,
    },
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
