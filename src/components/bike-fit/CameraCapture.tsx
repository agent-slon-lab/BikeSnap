"use client";

/**
 * CAMERA CAPTURE — живой видоискатель с помощником ракурса («дорисуй колёса в объективе»)
 * =======================================================================================
 *
 * Идея пользователя: пока наводишь камеру, программа находит колёса велосипеда,
 * дорисовывает их поверх картинки и подсказывает, куда встать. Колесо, снятое
 * строго сбоку — идеальный круг; под углом — овал. Пользователь смещается,
 * пока нарисованные овалы не станут кругами — это и есть правильный ракурс.
 *
 * Оверлей:
 *  - эллипсы колёс с процентом круглости (зелёный ≥ 88% — снимай);
 *  - линия осей между колёсами + её завал к горизонту (то же выравнивание,
 *    которое потом молча сделает ядро);
 *  - линия горизонта по гироскопу (если датчик доступен).
 *
 * Детектор — src/lib/wheel-detect.ts (чистый TS, ~1-2 мс на кадр 320px).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, RefreshCw, VideoOff, CheckCircle2, MoveHorizontal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { detectWheels, type DetectedEllipse, type WheelDetectStatus } from "@/lib/wheel-detect";
import { useDeviceOrientation } from "@/hooks/use-device-orientation";

interface CameraCaptureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Вызывается с JPEG-файлом после нажатия кнопки спуска */
  onCapture: (file: File) => void;
  /** Название ракурса для заголовка (например, «Фото — вид сбоку») */
  label?: string;
}

/** Ширина кадра, который скармливаем детектору (производительность) */
const PROC_WIDTH = 320;
/** Период обработки кадров, мс */
const PROC_INTERVAL_MS = 280;
/** Коэффициент сглаживания детекций (EMA) — меньше = плавнее, но инертнее */
const SMOOTH_ALPHA = 0.45;

interface OverlayState {
  status: WheelDetectStatus;
  wheels: DetectedEllipse[];
  roundness: number;
  axleTiltDeg: number;
  hint: string;
}

export function CameraCapture({ open, onOpenChange, onCapture, label }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const procCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const smoothRef = useRef<DetectedEllipse[]>([]);
  const busyRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [shot, setShot] = useState(false);

  const { roll: gyroRoll, supported: gyroSupported } = useDeviceOrientation();
  const gyroRollRef = useRef(0);
  gyroRollRef.current = gyroSupported ? gyroRoll : 0;

  // ============================================================
  // ЖИЗНЕННЫЙ ЦИКЛ КАМЕРЫ
  // ============================================================

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setError(null);
    setOverlay(null);
    setVideoReady(false);
    setShot(false);
    smoothRef.current = [];

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Браузер не поддерживает доступ к камере");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setVideoReady(true);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")
            ? "Доступ к камере запрещён. Разрешите камеру в настройках браузера или выберите фото из галереи."
            : `Камера недоступна: ${msg}. Выберите фото из галереи — зона загрузки осталась на странице.`,
        );
      }
    };
    void start();

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [open, facing]);

  // ============================================================
  // ЦИКЛ ДЕТЕКЦИИ
  // ============================================================

  useEffect(() => {
    if (!open || !videoReady) return;

    const processFrame = () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || busyRef.current) return;
      busyRef.current = true;
      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return;

        if (!procCanvasRef.current) procCanvasRef.current = document.createElement("canvas");
        const proc = procCanvasRef.current;
        const pw = PROC_WIDTH;
        const ph = Math.max(32, Math.round((PROC_WIDTH * vh) / vw));
        if (proc.width !== pw || proc.height !== ph) {
          proc.width = pw;
          proc.height = ph;
        }
        const pctx = proc.getContext("2d", { willReadFrequently: true });
        if (!pctx) return;
        pctx.drawImage(video, 0, 0, pw, ph);
        const frame = pctx.getImageData(0, 0, pw, ph);

        const result = detectWheels(frame);
        const smoothed = smoothDetections(result.wheels, smoothRef.current);
        smoothRef.current = smoothed;
        setOverlay({
          status: result.status,
          wheels: smoothed,
          roundness: result.roundness,
          axleTiltDeg: result.axleTiltDeg,
          hint: result.hint,
        });
      } finally {
        busyRef.current = false;
      }
    };

    processFrame();
    timerRef.current = setInterval(processFrame, PROC_INTERVAL_MS);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [open, videoReady]);

  // ============================================================
  // ОТРИСОВКА ОВЕРЛЕЯ
  // ============================================================

  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!vw || !vh || !cw || !ch) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // Видео вписано в контейнер (object-contain) — считаем его реальный прямоугольник
    const scale = Math.min(cw / vw, ch / vh);
    const dispW = vw * scale;
    const dispH = vh * scale;
    const offX = (cw - dispW) / 2;
    const offY = (ch - dispH) / 2;
    const sx = dispW / PROC_WIDTH; // координаты детектора (px) → экранные

    // --- Горизонт по гироскопу (второстепенный ориентир) ---
    const roll = gyroRollRef.current;
    if (gyroSupported && Math.abs(roll) <= 45) {
      ctx.save();
      ctx.translate(offX + dispW / 2, offY + dispH / 2);
      ctx.rotate((-roll * Math.PI) / 180);
      ctx.strokeStyle = "rgba(34, 211, 238, 0.75)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(-dispW, 0);
      ctx.lineTo(dispW, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.fillStyle = "rgba(34, 211, 238, 1)";
      const txt = `Горизонт ${Math.abs(roll) < 1 ? "ровно" : `${Math.abs(roll).toFixed(0)}°`}`;
      ctx.fillText(txt, dispW / 2 - 80, -6);
      ctx.restore();
    }

    // --- Колёса ---
    const wheels = overlay?.wheels ?? [];
    const status = overlay?.status ?? "none";
    wheels.forEach((w, i) => {
      const x = offX + w.cx * sx;
      const y = offY + w.cy * sx;
      const a = w.a * sx;
      const b = w.b * sx;
      const color = wheelColor(w.roundness, status);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(w.theta);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.setLineDash([9, 6]);
      ctx.beginPath();
      ctx.ellipse(0, 0, a, b, 0, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
      // центр
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();

      // подпись круглости
      const pct = Math.round(w.roundness * 100);
      const label = i === 0 && wheels.length === 2 ? `${pct}% · ${Math.abs(overlay?.axleTiltDeg ?? 0).toFixed(1)}°` : `${pct}%`;
      ctx.font = "700 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText(label, x, y - b - 8);
      ctx.fillStyle = color;
      ctx.fillText(label, x, y - b - 8);
      ctx.textAlign = "start";
    });

    // --- Линия осей между колёсами ---
    if (wheels.length === 2) {
      const [w1, w2] = wheels;
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(offX + w1.cx * sx, offY + w1.cy * sx);
      ctx.lineTo(offX + w2.cx * sx, offY + w2.cy * sx);
      ctx.stroke();
      ctx.restore();
    }
  }, [overlay, gyroSupported]);

  // Перерисовка при каждой детекции / повороте гироскопа
  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  // Перерисовка при ресайзе окна
  useEffect(() => {
    if (!open) return;
    const onResize = () => drawOverlay();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, drawOverlay]);

  // ============================================================
  // СЪЁМКА
  // ============================================================

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || shot) return;
    setShot(true);
    try {
      const c = document.createElement("canvas");
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      c.toBlob(
        (blob) => {
          setShot(false);
          if (!blob) return;
          const file = new File([blob], `bike-${Date.now()}.jpg`, { type: "image/jpeg" });
          onCapture(file);
          onOpenChange(false);
        },
        "image/jpeg",
        0.92,
      );
    } catch {
      setShot(false);
    }
  }, [onCapture, onOpenChange, shot]);

  const flipCamera = useCallback(() => {
    setFacing((f) => (f === "environment" ? "user" : "environment"));
  }, []);

  const status = overlay?.status ?? "none";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[100dvh] max-h-none w-screen max-w-none overflow-hidden rounded-none border-none bg-black p-0 gap-0 sm:h-[92dvh] sm:w-[46rem] sm:max-w-[94vw] sm:rounded-2xl">
        <DialogTitle className="sr-only">
          Камера — помощник ракурса{label ? `: ${label}` : ""}
        </DialogTitle>

        <div className="flex h-full flex-col bg-black">
          {/* Область превью */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-contain"
              playsInline
              muted
              autoPlay
            />
            <canvas
              ref={overlayRef}
              className="pointer-events-none absolute inset-0 h-full w-full"
            />

            {/* Статус-плашка */}
            {!error && (
              <div className="pointer-events-none absolute left-1/2 top-3 w-[92%] max-w-md -translate-x-1/2">
                <div
                  className={
                    "flex items-center gap-2 rounded-xl px-3 py-2 text-center text-xs font-semibold backdrop-blur " +
                    statusPillClass(status)
                  }
                >
                  <StatusIcon status={status} />
                  <span>{overlay?.hint ?? "Наведите камеру на велосипед — оба колеса должны быть полностью в кадре"}</span>
                </div>
              </div>
            )}

            {/* Ошибка камеры */}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <div className="max-w-sm rounded-2xl border border-rose-500/30 bg-rose-950/60 p-5 text-center backdrop-blur">
                  <VideoOff className="mx-auto mb-3 size-8 text-rose-400" />
                  <p className="text-sm leading-relaxed text-rose-100">{error}</p>
                  <Button
                    variant="secondary"
                    className="mt-4"
                    onClick={() => onOpenChange(false)}
                  >
                    Понятно
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Панель управления */}
          <div className="flex items-center justify-center gap-8 bg-black pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={flipCamera}
              disabled={!!error}
              className="size-11 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
              title="Переключить камеру"
            >
              <RefreshCw className="size-5" />
            </Button>

            <button
              type="button"
              onClick={capture}
              disabled={!!error || shot}
              aria-label="Сделать снимок"
              className={
                "size-16 rounded-full border-4 border-white bg-white/90 shadow-lg transition-all active:scale-90 disabled:opacity-40 " +
                (status === "ok" ? "ring-4 ring-emerald-400/60" : "")
              }
            />

            {/* Спейсер для симметрии */}
            <div className="size-11" aria-hidden />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// ВСПОМОГАТЕЛЬНОЕ
// ============================================================

/** Экспоненциальное сглаживание детекций между кадрами (устраняет дрожание) */
function smoothDetections(next: DetectedEllipse[], prev: DetectedEllipse[]): DetectedEllipse[] {
  return next.map((n) => {
    const p = prev.find(
      (q) => Math.hypot(q.cx - n.cx, q.cy - n.cy) < PROC_WIDTH * 0.14,
    );
    if (!p) return n;
    const lerp = (a: number, b: number) => SMOOTH_ALPHA * b + (1 - SMOOTH_ALPHA) * a;
    return {
      ...n,
      cx: lerp(p.cx, n.cx),
      cy: lerp(p.cy, n.cy),
      a: lerp(p.a, n.a),
      b: lerp(p.b, n.b),
      theta: lerp(p.theta, n.theta),
    };
  });
}

function wheelColor(roundness: number, status: WheelDetectStatus): string {
  if (status === "ok" && roundness >= 0.88) return "#34d399"; // emerald-400
  if (roundness >= 0.65) return "#fbbf24"; // amber-400
  return "#fb7185"; // rose-400
}

function statusPillClass(status: WheelDetectStatus): string {
  switch (status) {
    case "ok":
      return "bg-emerald-500/85 text-white";
    case "tilted":
      return "bg-amber-500/85 text-black";
    case "partial":
      return "bg-black/65 text-white";
    default:
      return "bg-black/65 text-white";
  }
}

function StatusIcon({ status }: { status: WheelDetectStatus }) {
  if (status === "ok") return <CheckCircle2 className="size-4 shrink-0" />;
  if (status === "tilted") return <MoveHorizontal className="size-4 shrink-0" />;
  return <AlertCircle className="size-4 shrink-0" />;
}
