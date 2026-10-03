"use client";

/**
 * CAMERA CAPTURE — живой видоискатель с помощником ракурса и авто-спуском
 * =======================================================================
 *
 * Идея пользователя: пока наводишь камеру, программа находит колёса велосипеда,
 * дорисовывает их поверх картинки и подсказывает, куда встать. Колесо, снятое
 * строго сбоку — идеальный круг; под углом — овал. Пользователь смещается,
 * пока нарисованные овалы не станут кругами — это и есть правильный ракурс.
 *
 * v1.4.0 (камера-движок):
 *  - детекция вынесена в Web Worker (src/workers/wheel-detect.worker.ts) —
 *    Main Thread не фризится; при недоступности воркера — фолбэк на main thread;
 *  - спуск через captureSafeFrame: кадр высокого разрешения ограничивается
 *    до 2048px по большой стороне (iOS Safari не сбрасывает Canvas-контекст);
 *  - АВТО-СПУСК: круглость пары ≥ 90% без завала по Pitch удерживается 0.6 с →
 *    обратный отсчёт 2..1 (по 0.7 с, v1.14.10; было 1.5 с + 3..2..1 — 4.5 с
 *    неподвижности нереально держать) → снимок; любое нарушение условий
 *    сбрасывает счёт;
 *  - ПРЕДУПРЕЖДЕНИЕ PITCH: телефон завален вперёд/назад (beta за пределами
 *    вертикали ±8°) → подсказка «плоскость экрана — вертикально» (v1.7.0:
 *    формулировка ориентационно-нейтральная, корректна и в ландшафте).
 *    Показывается только при живых данных гироскопа (на десктопе молчим).
 *
 * v1.5.0 (ландшафт):
 *  - на телефоне модалка всегда fullscreen (в обеих ориентациях) — дефолтный
 *    sm:max-w-lg у DialogContent больше не сужает видоискатель;
 *  - телефон набок (landscape + высота ≤ 500px, флаг useMediaFlag): панель
 *    управления переезжает вправо вертикальным столбцом, превью занимает всю
 *    ширину; перестройка — мгновенная, по matchMedia, прямо в открытом
 *    видоискателе;
 *  - на десктопе (ширина ≥ 640px И высота ≥ 501px) — прежнее «оконное» модальное
 *    окно 46rem × 92dvh.
 *
 * v1.7.0 (детектор v2):
 *  - под капотом — новый градиентный детектор (src/lib/wheel-detect.ts):
 *    лучевое голосование с аспект-проходами; интерфейс WheelDetectResult
 *    не изменился, Pitch-подсказка переформулирована ориентационно-нейтрально
 *    (в ландшафте «телефон вертикально» читается как «положи набок»).
 *
 * Оверлей (v1.8.0 «статичный трафарет» — идея пользователя):
 *  - на экране ВСЕГДА статичный трафарет: линия земли + два круга колёс;
 *    пользователь сам подгоняет велик под него — дрожащие найденные эллипсы
 *    больше не рисуются в принципе;
 *  - трафарет вращается вместе с гироскоп-горизонтом (земля остаётся уровнем);
 *  - живая детекция под трафаретом гоняет только: светофор
 *    красный/жёлтый/зелёный в углу видоискателя, подсказки (через защёлку
 *    с выдержкой — читаются спокойно) и авто-спуск.
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
import { cn } from "@/lib/utils";
import {
  detectWheels,
  type WheelDetectResult,
  type WheelDetectStatus,
} from "@/lib/wheel-detect";
import { captureSafeFrame } from "@/lib/camera-utils";
import type { CaptureMeta } from "@/lib/fit-report";
import { useDeviceOrientation } from "@/hooks/use-device-orientation";
import {
  useMediaFlag,
  PHONE_LANDSCAPE_QUERY,
  DESKTOP_DIALOG_QUERY,
} from "@/hooks/use-media-flag";

interface CameraCaptureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Вызывается с JPEG-файлом после нажатия кнопки спуска или авто-спуска.
   *  meta — гироскоп в момент спуска (для отчёта об отладке, v1.6.0). */
  onCapture: (file: File, meta?: CaptureMeta) => void;
  /** Название ракурса для заголовка (например, «Фото — вид сбоку») */
  label?: string;
}

/** Ширина кадра, который скармливаем детектору (производительность) */
const PROC_WIDTH = 320;
/** Период обработки кадров, мс */
const PROC_INTERVAL_MS = 280;
/** Сглаживание круглости (EMA) — меньше = плавнее, но инертнее.
 *  Сглаживается только ЧИСЛО (светофор/условия спуска) — рисунка
 *  найденных эллипсов больше нет, так что дрожать нечему. */
const ROUNDNESS_SMOOTH_ALPHA = 0.35;
/** Новый текст подсказки должен продержаться столько, чтобы сменить текущий —
 *  иначе мерцание кадров детектора мгновенно перелистывает тексты. */
const HINT_STABLE_MS = 1200;
/** Текущая подсказка висит минимум столько — иначе её не успеть прочитать. */
const HINT_MIN_DISPLAY_MS = 2600;
/** Стартовая подсказка (совпадает с детекторной «none») */
const HINT_START = "Наведите камеру на велосипед — оба колеса должны быть полностью в кадре";
/** Трафарет: радиус круга колеса, доля меньшей стороны кадра на экране */
const TEMPLATE_WHEEL_R = 0.14;
/** Трафарет: расстояние между центрами колёс в радиусах (база/диаметр ≈ 1.5) */
const TEMPLATE_WHEEL_GAP_R = 3.0;
/** Трафарет: высота линии земли, доля высоты кадра */
const TEMPLATE_GROUND_Y = 0.78;

/** Порог круглости для АВТО-спуска — строгое «идеально» (планка ok-статуса 0.88) */
const AUTO_ROUNDNESS = 0.9;
/** Сколько нужно удерживать идеальный ракурс до запуска отсчёта, мс.
 *  v1.14.10: 1500 → 600 — 4.5 с неподвижности (удержание + отсчёт 3 с)
 *  нереально держать без дрожи; теперь суммарно ~2 с. */
const AUTO_HOLD_MS = 600;
/** Период тика менеджера авто-спуска, мс */
const AUTO_TICK_MS = 100;
/** Отсчёт перед снимком: 2 шага по 700 мс (было 3 шага по 1000 мс) */
const AUTO_COUNTDOWN_STEPS = 2;
const AUTO_COUNTDOWN_STEP_MS = 700;
/** Допуск Pitch вокруг вертикали (телефон вертикально ≈ beta 90°) */
const PITCH_TOLERANCE_DEG = 8;

interface OverlayState {
  status: WheelDetectStatus;
  /** круглость пары, сглаженная EMA — светофор не мигает */
  roundness: number;
}

export function CameraCapture({ open, onOpenChange, onCapture, label }: CameraCaptureProps) {
  // Телефон лежит набок / десктопное окно — реактивные флаги (перестройка
  // на лету при повороте устройства)
  const phoneLandscape = useMediaFlag(PHONE_LANDSCAPE_QUERY);
  const desktopDialog = useMediaFlag(DESKTOP_DIALOG_QUERY);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const procCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const roundSmoothRef = useRef(0);
  const busyRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [hintText, setHintText] = useState(HINT_START);
  const [videoReady, setVideoReady] = useState(false);
  const [shot, setShot] = useState(false);

  // Защёлка подсказок: показанный текст / кандидат / время показа
  const hintMachineRef = useRef({
    shown: HINT_START,
    shownAt: 0,
    candidate: "",
    candidateSince: 0,
  });

  // Гироскоп активен только пока видоискатель открыт (переоткрытие модалки
  // пересоздаёт подписку; iOS помнит выданное разрешение для origin)
  const {
    roll: gyroRoll,
    pitch: gyroPitch,
    supported: gyroSupported,
    requestPermission,
  } = useDeviceOrientation(open);
  // Roll/Pitch в refs: capture() читает актуальные значения без пересоздания
  // колбэка (в его зависимостях нет gyro-состояния)
  const gyroRollRef = useRef(0);
  gyroRollRef.current = gyroSupported ? gyroRoll : 0;
  const gyroPitchRef = useRef(0);
  gyroPitchRef.current = gyroSupported ? gyroPitch : 0;

  // iOS 13+: запрос разрешения из жеста уже выполнен в PhotoUploader (клик по
  // кнопке). Здесь дублируем мягко: если данные не текут и API умеет
  // requestPermission — попробуем ещё раз (безопасно, origin помнит grant).
  useEffect(() => {
    if (!open || gyroSupported) return;
    void requestPermission().catch(() => false);
  }, [open, gyroSupported, requestPermission]);

  // ============================================================
  // WEB WORKER ДЕТЕКЦИИ (с фолбэком на main thread)
  // ============================================================

  const workerRef = useRef<Worker | null>(null);
  const workerBrokenRef = useRef(false);

  useEffect(() => {
    if (!open || workerBrokenRef.current) return;

    let w: Worker | null = null;
    try {
      w = new Worker(
        new URL("../../workers/wheel-detect.worker.ts", import.meta.url),
        { type: "module" },
      );
      w.onmessage = (e: MessageEvent<WheelDetectResult>) => {
        busyRef.current = false;
        applyResult(e.data);
      };
      w.onerror = () => {
        // Воркер не запустился (старый браузер/политика CSP) — молча переходим
        // на main thread: детектор лёгкий, UX не пострадает
        workerBrokenRef.current = true;
        busyRef.current = false;
        w?.terminate();
        if (workerRef.current === w) workerRef.current = null;
      };
      workerRef.current = w;
    } catch {
      workerBrokenRef.current = true;
    }

    return () => {
      w?.terminate();
      if (workerRef.current === w) workerRef.current = null;
    };
  }, [open]);

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
    roundSmoothRef.current = 0;
    hintMachineRef.current = {
      shown: HINT_START,
      shownAt: performance.now(),
      candidate: "",
      candidateSince: 0,
    };
    setHintText(HINT_START);
    busyRef.current = false;

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
  // ЦИКЛ ДЕТЕКЦИИ (кадр готовим в main thread, считаем в воркере)
  // ============================================================

  const applyResult = useCallback((result: WheelDetectResult) => {
    // Круглость — EMA: светофор и условия авто-спуска без дрожания.
    // При потере детекции roundness = 0 прокидывается сразу — свет гаснет без задержки.
    const prev = roundSmoothRef.current;
    roundSmoothRef.current =
      result.roundness > 0 && prev > 0
        ? ROUNDNESS_SMOOTH_ALPHA * result.roundness + (1 - ROUNDNESS_SMOOTH_ALPHA) * prev
        : result.roundness;

    // Защёлка подсказок: новый текст обязан продержаться HINT_STABLE_MS,
    // а текущий — провисеть минимум HINT_MIN_DISPLAY_MS. Мерцание статусов
    // детектора больше не перелистывает подсказки быстрее, чем их читают.
    const h = hintMachineRef.current;
    const now = performance.now();
    if (result.hint !== h.shown) {
      if (result.hint === h.candidate) {
        if (now - h.candidateSince >= HINT_STABLE_MS && now - h.shownAt >= HINT_MIN_DISPLAY_MS) {
          h.shown = result.hint;
          h.shownAt = now;
          h.candidate = "";
          setHintText(h.shown);
        }
      } else {
        h.candidate = result.hint;
        h.candidateSince = now;
      }
    } else {
      h.candidate = "";
    }

    setOverlay({ status: result.status, roundness: roundSmoothRef.current });
  }, []);

  useEffect(() => {
    if (!open || !videoReady) return;

    const grabFrame = (): ImageData | null => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return null;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return null;

      if (!procCanvasRef.current) procCanvasRef.current = document.createElement("canvas");
      const proc = procCanvasRef.current;
      const pw = PROC_WIDTH;
      const ph = Math.max(32, Math.round((PROC_WIDTH * vh) / vw));
      if (proc.width !== pw || proc.height !== ph) {
        proc.width = pw;
        proc.height = ph;
      }
      const pctx = proc.getContext("2d", { willReadFrequently: true });
      if (!pctx) return null;
      pctx.drawImage(video, 0, 0, pw, ph);
      return pctx.getImageData(0, 0, pw, ph);
    };

    const processFrame = () => {
      if (busyRef.current) return;
      const frame = grabFrame();
      if (!frame) return;

      if (workerRef.current) {
        busyRef.current = true;
        workerRef.current.postMessage({ imageData: frame });
      } else {
        // Фолбэк: считаем в main thread (детектор ~1-2 мс на кадре 320px)
        applyResult(detectWheels(frame));
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
  }, [open, videoReady, applyResult]);

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

    // --- СТАТИЧНЫЙ ТРАФАРЕТ: земля + два круга колёс (v1.8.0) ---
    // Рисуется всегда, дрожать не может в принципе. Вращается вместе с
    // гироскоп-горизонтом: при наклоне телефона реальная земля в мире
    // остаётся уровнем — трафарет должен повторять то, что видит камера.
    const roll = gyroRollRef.current;
    const useGyro = gyroSupported && Math.abs(roll) <= 45;
    const R = TEMPLATE_WHEEL_R * Math.min(dispW, dispH);
    const half = (TEMPLATE_WHEEL_GAP_R * R) / 2; // ± до центров колёс от центра кадра
    const groundY = dispH * (TEMPLATE_GROUND_Y - 0.5); // в системе с центром в (0,0)

    ctx.save();
    ctx.translate(offX + dispW / 2, offY + dispH / 2);
    if (useGyro) ctx.rotate((-roll * Math.PI) / 180);

    // Линия земли
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 9]);
    ctx.beginPath();
    ctx.moveTo(-dispW / 2 + 8, groundY);
    ctx.lineTo(dispW / 2 - 8, groundY);
    ctx.stroke();

    // Круги колёс — стоят на земле
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([9, 7]);
    for (const wx of [-half, half]) {
      ctx.beginPath();
      ctx.arc(wx, groundY - R, R, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Метка горизонта — над правым концом земли (стабильна, датчик точный)
    if (useGyro) {
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.fillStyle = "rgba(34, 211, 238, 0.9)";
      const txt = `Горизонт ${Math.abs(roll) < 1 ? "ровно" : `${Math.abs(roll).toFixed(0)}°`}`;
      ctx.fillText(txt, half + R + 10, groundY - 6);
    }
    ctx.restore();
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
  // СЪЁМКА (безопасный кадр ≤2048px)
  // ============================================================

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || shot) return;
    setShot(true);
    captureSafeFrame(video)
      .then((blob) => {
        const file = new File([blob], `bike-${Date.now()}.jpg`, { type: "image/jpeg" });
        // Гироскоп в момент спуска — уйдёт в отчёт для отладки
        onCapture(file, {
          pitch: gyroPitchRef.current,
          roll: gyroRollRef.current,
          gyroSupported,
          timestamp: Date.now(),
        });
        onOpenChange(false);
      })
      .catch(() => undefined)
      .finally(() => setShot(false));
  }, [onCapture, onOpenChange, shot]);

  const captureRef = useRef(capture);
  captureRef.current = capture;

  const flipCamera = useCallback(() => {
    setFacing((f) => (f === "environment" ? "user" : "environment"));
  }, []);

  // ============================================================
  // АВТО-СПУСК: удержание идеального ракурса 0.6с → отсчёт 2..1 (по 0.7с) → снимок
  // ============================================================

  // Завал телефона вперёд/назад (Pitch) — только при живых данных датчика:
  // на десктопе supported=false и предупреждение никогда не блокирует спуск
  const pitchWarning =
    gyroSupported && Math.abs(gyroPitch - 90) > PITCH_TOLERANCE_DEG;

  const status: WheelDetectStatus = overlay?.status ?? "none";
  const roundness = overlay?.roundness ?? 0;

  // Светофор ракурса (v1.8.0): зелёный — оба колеса круглые, можно фотать;
  // жёлтый — велик виден, но ракурс не тот / одно колесо; красный — не находим ничего.
  const light: "red" | "amber" | "green" =
    status === "ok" ? "green" : status === "none" ? "red" : "amber";
  const lightColor =
    light === "green" ? "#34d399" : light === "amber" ? "#fbbf24" : "#fb7185";

  const isOptimal =
    status === "ok" && roundness >= AUTO_ROUNDNESS && !pitchWarning && !error;

  const [countdown, setCountdown] = useState<number | null>(null);
  const holdStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;

    const tick = () => {
      if (!isOptimal) {
        // Условие нарушено — полный сброс удержания и отсчёта
        holdStartRef.current = null;
        setCountdown((c) => (c === null ? c : null));
        return;
      }
      const now = performance.now();
      if (holdStartRef.current === null) {
        holdStartRef.current = now;
        setCountdown((c) => (c === null ? c : null));
        return;
      }
      const heldMs = now - holdStartRef.current;
      if (heldMs < AUTO_HOLD_MS) {
        // Удержание ещё не набрано — статус «Удерживайте…»
        setCountdown((c) => (c === null ? c : null));
        return;
      }
      const countdownMs = heldMs - AUTO_HOLD_MS; // отсчёт 2 шага по 0.7с: 2..1
      const value =
        AUTO_COUNTDOWN_STEPS - Math.floor(countdownMs / AUTO_COUNTDOWN_STEP_MS);
      if (value <= 0) {
        holdStartRef.current = null;
        setCountdown(null);
        captureRef.current(); // авто-клик
        return;
      }
      setCountdown((c) => (c === value ? c : value));
    };

    const t = setInterval(tick, AUTO_TICK_MS);
    return () => clearInterval(t);
  }, [open, isOptimal]);

  const pillText = pitchWarning
    ? "Не наклоняйте телефон вперёд/назад: плоскость экрана — вертикально, на уровне осей колёс"
    : countdown !== null
      ? `Снимок через ${countdown}…`
      : isOptimal
        ? "Ракурс идеален! Удерживайте — снимем автоматически"
        : hintText;

  const pillTone: "ok" | "warn" | "muted" = pitchWarning
    ? "warn"
    : countdown !== null || isOptimal
      ? "ok"
      : "muted";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // База — телефон, обе ориентации: строго fullscreen
          // (sm:max-w-[94vw] глушит дефолтный sm:max-w-lg из ui/dialog)
          "h-[100dvh] max-h-none w-screen max-w-none overflow-hidden rounded-none border-none bg-black p-0 gap-0 sm:max-w-[94vw]",
          // Десктоп — оконный режим
          desktopDialog &&
            "h-[92dvh] w-[46rem] max-w-[94vw] rounded-2xl",
          // Телефон набок — гарантируем fullscreen даже на широких экранах
          phoneLandscape && "sm:w-screen sm:max-w-none",
        )}
      >
        <DialogTitle className="sr-only">
          Камера — помощник ракурса{label ? `: ${label}` : ""}
        </DialogTitle>

        <div className={cn("flex h-full bg-black", phoneLandscape ? "flex-row" : "flex-col")}>
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

            {/* Светофор ракурса: красный — плохо, жёлтый — почти, зелёный — можно фотать */}
            {!error && (
              <div className="pointer-events-none absolute right-3 top-3">
                <div
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full border-2 bg-black/45 shadow-lg backdrop-blur transition-colors",
                    light === "green" && "animate-pulse",
                  )}
                  style={{ borderColor: lightColor }}
                >
                  <span
                    className="size-4 rounded-full transition-colors"
                    style={{ backgroundColor: lightColor }}
                  />
                </div>
              </div>
            )}

            {/* Статус-плашка */}
            {!error && (
              <div className={cn(
                "pointer-events-none absolute left-1/2 top-3 w-[74%] -translate-x-1/2",
                phoneLandscape ? "max-w-sm" : "max-w-md",
              )}>
                <div
                  className={
                    "flex items-center gap-2 rounded-xl px-3 py-2 text-center text-xs font-semibold backdrop-blur " +
                    (pillTone === "ok"
                      ? "bg-emerald-500/85 text-white"
                      : pillTone === "warn"
                        ? "bg-amber-500/85 text-black"
                        : "bg-black/65 text-white")
                  }
                >
                  <PillIcon tone={pillTone} />
                  <span>{pillText}</span>
                </div>
              </div>
            )}

            {/* Оверлей обратного отсчёта */}
            {countdown !== null && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
                <span className="text-7xl font-bold text-white drop-shadow-lg">
                  {countdown}
                </span>
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

          {/* Панель управления: портрет — снизу горизонтально,
              ландшафт — справа вертикальным столбцом (с safe-area под «челку») */}
          <div
            className={cn(
              "flex items-center justify-center gap-8 bg-black pb-[max(1rem,env(safe-area-inset-bottom))] pt-4",
              phoneLandscape &&
                "h-full flex-col gap-7 pb-4 pl-4 pr-[max(1rem,env(safe-area-inset-right))]",
            )}
          >
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
                (pillTone === "ok" ? "ring-4 ring-emerald-400/60" : "")
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

function PillIcon({ tone }: { tone: "ok" | "warn" | "muted" }) {
  if (tone === "ok") return <CheckCircle2 className="size-4 shrink-0" />;
  if (tone === "warn") return <MoveHorizontal className="size-4 shrink-0" />;
  return <AlertCircle className="size-4 shrink-0" />;
}
