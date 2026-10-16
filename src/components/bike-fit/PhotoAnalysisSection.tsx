"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Camera, AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2, Sparkles, Image as ImageIcon, RotateCcw, Undo2, Repeat } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { PhotoUploader } from "@/components/bike-fit/PhotoUploader";
import { PhotoAnalyzer } from "@/components/bike-fit/PhotoAnalyzer";
import { ResultsPanel } from "@/components/bike-fit/ResultsPanel";
import { Recommendations } from "@/components/bike-fit/Recommendations";
import { ComplaintRecommendations } from "@/components/bike-fit/ComplaintRecommendations";
import { CrossRefRecommendations } from "@/components/bike-fit/CrossRefRecommendations";
import { CompareView } from "@/components/bike-fit/CompareView";
import { usePoseLandmarker } from "@/hooks/use-pose-landmarker";
import {
  analyzeBikeFit,
  analyzeBackView,
  analyzeFrontView,
  applyCrossMetricLogic,
  applySaddleHeightContext,
  getBestLegSide,
  getCleanRiderKeypoints,
  getPoseVisibilityScore,
  PERSON_MIN_SCORE,
  VIEW_LABELS,
  FOOTWEAR_WARNING,
  POSE_LANDMARKS,
  type Point,
  type ViewType,
  type BikeFitAnalysis,
  type BackViewAnalysis,
  type FrontViewAnalysis,
} from "@/lib/bike-fit";
import {
  bikeMatchVerdict,
  computeWheelFrameMeta,
  computeWheelRatioFromFrame,
  downscaleToRawFrame,
} from "@/lib/bike-wheel-ratio";
import {
  validateBikeMatch,
  extractRiderPoseSignals,
  estimateTriangleSamplePoint,
  type Rgb,
} from "@/lib/bike-match-validator";
import {
  sampleMedianColorFromImageElement,
  sampleMedianColorFromFrame,
} from "@/lib/frame-color-sample";
import { getBikes, getActiveRider } from "@/lib/bike-storage";
import { fingerprintDataUrl } from "@/lib/photo-fingerprint";
import { calculateAll } from "@/lib/bike-calculations";
import { BIKE_TYPES } from "@/lib/bike-params";
import { useBikeStore } from "@/lib/bike-store";
import { AiConsultCard } from "@/components/bike-fit/AiConsultCard";
import { cn } from "@/lib/utils";
import { useMediaFlag, PHONE_LANDSCAPE_QUERY } from "@/hooks/use-media-flag";
import { DebugReportCard } from "@/components/bike-fit/DebugReportCard";
import { ReFitFeedbackModal } from "@/components/bike-fit/ReFitFeedbackModal";
import { ComparisonReport } from "@/components/bike-fit/ComparisonReport";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { CaptureMeta, ReportViewInput } from "@/lib/fit-report";
import { photoToDataUrl } from "@/lib/fit-report";
import { usePhotoAnalysisStore } from "@/lib/photo-analysis-store";
import { useActiveBikeId } from "@/hooks/use-active-bike-id";

interface ViewPhotoState {
  url: string | null;
  landmarks: Point[] | null;
  analyzing: boolean;
  error: string | null;
  /** Гироскоп в момент спуска (только для кадров из камеры, v1.6.0) */
  captureMeta: CaptureMeta | null;
}

// Цвета линий симметрии для overlay
const SYMMETRY_COLORS = {
  shoulder: "#10b981", // emerald
  hip: "#3b82f6", // blue
  knee: "#a855f7", // purple
  foot: "#ec4899", // pink
  head: "#eab308", // yellow
};

/** Анализатор по ракурсу — чистые функции из bike-fit (модульный уровень,
 *  чтобы analyzePhoto не зависел от их идентичности). */
const ANALYZERS: Record<
  ViewType,
  (lm: Point[]) => BikeFitAnalysis | BackViewAnalysis | FrontViewAnalysis | null
> = {
  side: analyzeBikeFit,
  back: analyzeBackView,
  front: analyzeFrontView,
};

export function PhotoAnalysisSection() {
  const { bikeType, body, bike, goal } = useBikeStore();
  // v1.14.42: жалобы для AI-разбора (тот же источник, что и goal)
  const complaints = useBikeStore((s) => s.complaints);
  // v1.14.31 (ТЗ п. A.1): proof of ownership — черновик обязан доказать, что
  // SH принадлежит активному велу, иначе LeMond-контекст запрещён.
  const bikeId = useBikeStore((s) => s.bikeId);
  // Телефон набок: фото слева, рекомендации/метрики справа (две колонки)
  const phoneLandscape = useMediaFlag(PHONE_LANDSCAPE_QUERY);

  // === v1.14.17: фото/landmarks/анализ ПЕРСИСТЯТСЯ (photo-analysis-store).
  // Раньше всё жило в useState — refresh, закрытие вкладки и даже переход
  // на другой шаг стирали фото, и пользователь «постоянно гружил файл».
  const views = usePhotoAnalysisStore((s) => s.views);
  const setViewPhotoStore = usePhotoAnalysisStore((s) => s.setViewPhoto);
  const setViewPhotoData = usePhotoAnalysisStore((s) => s.setViewPhotoData);
  const setViewResultStore = usePhotoAnalysisStore((s) => s.setViewResult);
  const clearViewStore = usePhotoAnalysisStore((s) => s.clearView);

  // v1.14.30 (Stale State, ТЗ п. A.2 «Проверка перед расчетом»): фото и
  // анализы принадлежат КОНКРЕТНОМУ велику. При смене активного вела
  // syncBikeId жёстко стирает все ракурсы — углы Bike_A физически не могут
  // попасть в отчёт Bike_B (и в отчёт отладки). Без этой привязки старый
  // кадр с SH=800 одного вела анализировался контекстом другого.
  const activeBikeId = useActiveBikeId();
  const syncBikeId = usePhotoAnalysisStore((s) => s.syncBikeId);
  // useLayoutEffect (не useEffect): очистка протухших ракурсов происходит
  // ДО отрисовки — кадр/анализ прежнего вела не мелькает ни на один кадр.
  // Компонент рендерится только после клиентского маунта (заглушка в
  // page.tsx), поэтому SSR-предупреждения useLayoutEffect не возникает.
  useLayoutEffect(() => {
    syncBikeId(activeBikeId);
  }, [activeBikeId, syncBikeId]);

  // === v1.14.34 (ТЗ п. 5.4): Bike Match Validation ===
  // Пропорция wheelbase/диаметр по авто-детектору колёс на боковом фото
  // райдера (Шаг 1) сравнивается с пропорцией по фото вела (Шаг 2,
  // photoCalib.wheelRatio из карточки). Расхождение > 12% — предупреждение
  // «возможно, загружены фото двух разных велосипедов».
  const riderPhotoWheelRatio = usePhotoAnalysisStore((s) => s.riderPhotoWheelRatio);
  const setRiderPhotoWheelRatio = usePhotoAnalysisStore((s) => s.setRiderPhotoWheelRatio);
  // v1.14.36: честный статус сверки — "notFound" больше не маскируется под «совпадает»
  const riderWheelCheck = usePhotoAnalysisStore((s) => s.riderWheelCheck);
  const setRiderWheelCheck = usePhotoAnalysisStore((s) => s.setRiderWheelCheck);
  // v1.14.43 (multi-factor bike match): метаданные колёс + цвет рамы
  // бокового фото (для факторов F2 «цвет» и F3 «масштаб посадки»)
  const riderWheelMeta = usePhotoAnalysisStore((s) => s.riderWheelMeta);
  const setRiderWheelMeta = usePhotoAnalysisStore((s) => s.setRiderWheelMeta);
  // v1.14.37: реестр происхождения фото + активный конфликт (фото уже было
  // под другим велом) — детерминированная ловушка подмены
  const registerViewPhoto = usePhotoAnalysisStore((s) => s.registerViewPhoto);
  const provenanceConflict = usePhotoAnalysisStore((s) => s.provenanceConflict);
  const bikePhotoWheelRatio = useMemo(() => {
    if (!activeBikeId) return null;
    const card = getBikes().find((b) => b.id === activeBikeId);
    const r = card?.photoCalib?.wheelRatio;
    return typeof r === "number" && Number.isFinite(r) && r > 0 ? r : null;
  }, [activeBikeId, views.side.photoData]); // пересчёт и при смене фото вела
  const matchResult = bikeMatchVerdict(bikePhotoWheelRatio, riderPhotoWheelRatio);
  // Сверка не состоялась, хотя базу для сравнения знаем (вел размечен):
  // детектор не нашёл оба колеса на фото райдера — честно показываем «не сверено»
  const bikeMatchUnknown =
    matchResult.verdict === "unknown" && bikePhotoWheelRatio != null && riderWheelCheck === "notFound";

  // === v1.14.43 (ТЗ «Защита от дурака»): multi-factor валидатор ===
  // 4 независимых фактора: F1 пропорции колёс (был единственным), F2 цвет
  // рамы (семпл подседельной трубы вела vs зона верхней трубы на фото
  // райдера), F3 масштаб посадки (таз/седло над осями, норм. на радиус),
  // F4 хват (кисти vs плечи vs заявленный тип вела). Вердикт "block" —
  // 2+ провала ИЛИ F1 (хард-блок v1.14.41 сохранён).
  const riderPoseSignals = useMemo(
    () => extractRiderPoseSignals(views.side.landmarks),
    [views.side.landmarks]
  );

  // Сигналы карточки вела: разметка (keyPointsData) + заявленный тип
  const bikeCardData = useMemo(() => {
    if (!activeBikeId) return null;
    const card = getBikes().find((b) => b.id === activeBikeId);
    if (!card) return null;
    let kp: Record<string, { x: number | null; y: number | null } | undefined> | null = null;
    if (card.keyPointsData) {
      try {
        kp = JSON.parse(card.keyPointsData);
      } catch {
        kp = null;
      }
    }
    return { photoData: card.photoData ?? null, type: card.type ?? null, kp };
  }, [activeBikeId, views.side.photoData, bikePhotoWheelRatio]); // пересчёт при смене разметки вела

  const numPt = (p?: { x: number | null; y: number | null } | null) =>
    p && p.x != null && p.y != null && Number.isFinite(p.x) && Number.isFinite(p.y)
      ? { x: p.x, y: p.y }
      : null;

  // Медианный цвет рамы с фото ВЕЛА: середина подседельной трубы
  // (BB→saddleMount — там нет шатунов и ног), фоллбэк — окно вокруг BB
  // (объявлен ДО bikeCardSignals — он входит в его сигналы)
  const [bikeBbColor, setBikeBbColor] = useState<Rgb | null>(null);
  useEffect(() => {
    setBikeBbColor(null);
    const kp = bikeCardData?.kp ?? null;
    const photoUrl = bikeCardData?.photoData ?? null;
    if (!kp || !photoUrl) return;
    const bb = numPt(kp.bb);
    const saddle = numPt(kp.saddleMount);
    let nx: number | null = null;
    let ny: number | null = null;
    if (bb && saddle) {
      nx = (bb.x + saddle.x) / 2;
      ny = (bb.y + saddle.y) / 2;
    } else if (bb) {
      nx = bb.x;
      ny = bb.y;
    }
    if (nx == null || ny == null) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setBikeBbColor(sampleMedianColorFromImageElement(img, nx!, ny!, 0.03));
    };
    img.onerror = () => {
      if (!cancelled) setBikeBbColor(null);
    };
    img.src = photoUrl;
    return () => {
      cancelled = true;
    };
  }, [bikeCardData]);

  const bikeCardSignals = useMemo(() => {
    const kp = bikeCardData?.kp ?? null;
    const rearAxle = numPt(kp?.rearAxle);
    const frontAxle = numPt(kp?.frontAxle);
    const rearTop = numPt(kp?.rearWheelTop);
    const frontTop = numPt(kp?.frontWheelTop);
    const saddle = numPt(kp?.saddleMount);
    let axleMidYn: number | null = null;
    let radiusNormY: number | null = null;
    if (rearAxle && frontAxle) {
      axleMidYn = (rearAxle.y + frontAxle.y) / 2;
      const radii: number[] = [];
      if (rearTop) radii.push(Math.abs(rearAxle.y - rearTop.y));
      if (frontTop) radii.push(Math.abs(frontAxle.y - frontTop.y));
      if (radii.length > 0) {
        const avg = radii.reduce((s, r) => s + r, 0) / radii.length;
        radiusNormY = avg > 0.005 ? avg : null;
      }
    }
    return {
      wheelRatio: bikePhotoWheelRatio,
      bbColorRgb: bikeBbColor,
      saddleYn: saddle?.y ?? null,
      axleMidYn,
      radiusNormY,
      bikeType: bikeCardData?.type ?? null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bikePhotoWheelRatio, bikeBbColor, bikeCardData]);

  const multiMatch = useMemo(
    () =>
      validateBikeMatch({
        wheelRatio: riderPhotoWheelRatio,
        wheelMeta: riderWheelMeta,
        pose: riderPoseSignals,
        bike: bikeCardSignals,
      }),
    [riderPhotoWheelRatio, riderWheelMeta, riderPoseSignals, bikeCardSignals]
 );

  // === v1.14.41 (ТЗ «Жесткий чек-поинт совпадения велосипедов»): хард-блок ===
  // v1.14.43: блок по вердикту multi-factor валидатора (2+ фактора провалились
  // ИЛИ F1 пропорции — старый хард-блок). Разблокировка — только явным
  // «Это тот же велосипед — продолжить»; override сбрасывается при
  // смене фото и при смене вела — новый прогон снова под гейтом.
  const [bikeMatchModalOpen, setBikeMatchModalOpen] = useState(false);
  const [bikeMatchOverride, setBikeMatchOverride] = useState(false);
  const bikeMatchBlocking = multiMatch.verdict === "block" && !bikeMatchOverride;

  useEffect(() => {
    setBikeMatchOverride(false);
  }, [views.side.photoData, activeBikeId]);

  // Модалка открывается при каждом обнаружении несоответствия (в т.ч. на новом
  // анализе — views.side.analysis меняется) и на старых анализах из кэша
  useEffect(() => {
    if (multiMatch.verdict === "block" && !bikeMatchOverride) setBikeMatchModalOpen(true);
  }, [multiMatch.verdict, bikeMatchOverride, views.side.analysis]);

  // v1.14.41: сторона для ОТРИСОВКИ скелета, когда анализ провалился —
  // раньше activeSide = null и обе ноги рисовались (фантомная «паутина»
  // дальней ноги возвращалась в UI именно в этом случае)
  const sideDrawSide = useMemo(
    () => (views.side.landmarks ? getBestLegSide(views.side.landmarks) : null),
    [views.side.landmarks]
  );

  // === v1.14.34 (ТЗ п. 6): Re-fit Loop — архив прошлого прогона + анкета ===
  const previousRun = usePhotoAnalysisStore((s) => s.previousRun);
  const refitMeta = usePhotoAnalysisStore((s) => s.refitMeta);
  const startRefit = usePhotoAnalysisStore((s) => s.startRefit);
  const cancelRefit = usePhotoAnalysisStore((s) => s.cancelRefit);
  const [refitModalOpen, setRefitModalOpen] = useState(false);
  // v1.14.34 (ТЗ п. 5.2): модалка «Человек не найден на фото» (score < 0.5)
  const [personModalOpen, setPersonModalOpen] = useState(false);

  // Транзиентное UI-состояние (не персистится): анимация анализа + ошибки
  const [ui, setUi] = useState<
    Record<ViewType, { analyzing: boolean; error: string | null }>
  >({
    side: { analyzing: false, error: null },
    back: { analyzing: false, error: null },
    front: { analyzing: false, error: null },
  });

  const setUiState = useCallback(
    (
      view: ViewType,
      patch: Partial<{ analyzing: boolean; error: string | null }>
    ) => {
      setUi((prev) => ({ ...prev, [view]: { ...prev[view], ...patch } }));
    },
    []
  );

  // Состояние ракурса — сборка персиста + транзиента (для ViewSection и отчёта)
  const sideState: ViewPhotoState = {
    url: views.side.photoData,
    landmarks: views.side.landmarks,
    analyzing: ui.side.analyzing,
    error: ui.side.error,
    captureMeta: views.side.captureMeta,
  };
  const backState: ViewPhotoState = {
    url: views.back.photoData,
    landmarks: views.back.landmarks,
    analyzing: ui.back.analyzing,
    error: ui.back.error,
    captureMeta: views.back.captureMeta,
  };
  const frontState: ViewPhotoState = {
    url: views.front.photoData,
    landmarks: views.front.landmarks,
    analyzing: ui.front.analyzing,
    error: ui.front.error,
    captureMeta: views.front.captureMeta,
  };

  // Результаты анализа — из персист-стора (каст union → конкретный тип).
  // v1.14.28: поверх сохранённого анализа применяем кросс-валидацию советов
  // (корпус vs плечо/бедро) и контекст высоты седла (угол колена vs LeMond).
  // Патч работает и для старых анализов из localStorage — тексты чинятся
  // сразу, без пересъёмки фото. Стор не мутируем — возвращаем копию.
  const calc = useMemo(
    () => (bikeType && goal ? calculateAll(body, bike, { bikeType, goal }) : null),
    [body, bike, bikeType, goal]
  );

  // === v1.14.42: данные для AI-разбора посадки (только числа, без фото) ===
  const aiInput = useMemo(
    () =>
      bikeType
        ? {
            riderName: getActiveRider()?.name,
            body,
            bikeName: activeBikeId
              ? getBikes().find((b) => b.id === activeBikeId)?.name
              : undefined,
            bikeType,
            measurements: bike,
            goal,
            complaints,
            saddleHeightMm:
              typeof bike.saddleHeight === "number" &&
              Number.isFinite(bike.saddleHeight)
                ? bike.saddleHeight
                : null,
          }
        : null,
    [body, bike, bikeType, goal, complaints, activeBikeId]
  );
  const sideAnalysis = useMemo(() => {
    const raw = views.side.analysis as BikeFitAnalysis | null;
    if (!raw) return null;
    // v1.14.31 (ТЗ п. A.1 «if (calibration.bikeId !== currentBike.id) return»):
    // чужая/недоказанная калибровка SH (Bike_A против активного Bike_B) в
    // LeMond-сравнение не попадает — анализ возвращается без SH-контекста.
    return applySaddleHeightContext(
      applyCrossMetricLogic(raw),
      bike.saddleHeight ?? null,
      calc?.recommendedSaddleHeight ?? null,
      { calibBikeId: bikeId, currentBikeId: activeBikeId }
    );
  }, [views.side.analysis, bike.saddleHeight, calc, bikeId, activeBikeId]);
  const backAnalysis = views.back.analysis as BackViewAnalysis | null;
  const frontAnalysis = views.front.analysis as FrontViewAnalysis | null;

  const { loading: modelLoading, error: modelError, detect } = usePoseLandmarker();

  // Общий обработчик анализа для любого ракурса
  const analyzePhoto = useCallback(
    async (view: ViewType, img: HTMLImageElement) => {
      if (modelLoading || modelError) {
        setUiState(view, {
          error:
            modelError ?? "Модель ещё загружается, подождите пару секунд...",
        });
        return;
      }

      setUiState(view, { analyzing: true, error: null });

      try {
        await new Promise((r) => setTimeout(r, 50));
        const result = detect(img);
        if (!result || !result.landmarks || result.landmarks.length === 0) {
          setUiState(view, {
            analyzing: false,
            // v1.14.34 (ТЗ п. 5.2): детектор вообще никого не нашёл —
            // модалка «Человек не найден» + блок расчёта.
            error:
              "Человек не найден на фото. Загрузите снимок верхом на велосипеде.",
          });
          setPersonModalOpen(true);
          setViewResultStore(view, undefined, null);
          return;
        }
        const lms = result.landmarks[0] as Point[];
        // v1.14.34 (ТЗ п. 5.2): poseLandmarksScore < 0.5 — человека нет,
        // переход к расчёту ЗАБЛОКИРОВАН + модалка (по ТЗ).
        const personScore = getPoseVisibilityScore(lms);
        if (personScore < PERSON_MIN_SCORE) {
          setUiState(view, {
            analyzing: false,
            error:
              "Человек не найден на фото. Загрузите снимок верхом на велосипеде.",
          });
          setPersonModalOpen(true);
          setViewResultStore(view, lms, null);
          return;
        }
        // v1.14.32 (ТЗ п. A): ранняя проверка надёжности ближней ноги —
        // если видимость hip/knee/ankle ниже порога, показываем
        // СПЕЦИФИЧНУЮ ошибку распознавания вместо общей «точки не
        // определены». Анализ по фантомным точкам не запускается.
        if (view === "side") {
          const clean = getCleanRiderKeypoints(lms);
          if (clean.error || !clean.keypoints) {
            setUiState(view, { analyzing: false, error: clean.error });
            setViewResultStore(view, lms, null);
            return;
          }
        }
        const analysis = ANALYZERS[view](lms);
        if (!analysis) {
          setUiState(view, {
            analyzing: false,
            error:
              "Ключевые точки тела определены не полностью. Попробуйте фото, где видны плечи, бёдра, колени и стопы.",
          });
          setViewResultStore(view, lms, null);
          return;
        }
        setViewResultStore(view, lms, analysis);
        setUiState(view, { analyzing: false, error: null });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setUiState(view, {
          analyzing: false,
          error: `Ошибка анализа: ${msg}`,
        });
        setViewResultStore(view, undefined, null);
      }
    },
    [modelLoading, modelError, detect, setUiState, setViewResultStore, setPersonModalOpen]
  );

  // Контекст-карточка с введёнными данными
  const contextCard = bikeType && (
    <Card className="bg-muted/30 border-dashed">
      <CardContent className="py-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium">
            {BIKE_TYPES[bikeType].emoji} {BIKE_TYPES[bikeType].label}
          </span>
          {body.height > 0 && (
            <span className="text-muted-foreground">
              Рост: <span className="font-medium text-foreground">{body.height} см</span>
            </span>
          )}
          {body.inseam > 0 && (
            <span className="text-muted-foreground">
              Inseam: <span className="font-medium text-foreground">{body.inseam} см</span>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );

  // Подсветка линий симметрии для back/front
  const getOverlayLines = useCallback(
    (view: ViewType): Array<{ a: Point; b: Point; color: string; label?: string; dashed?: boolean }> => {
      if (view === "side" && views.side.landmarks) {
        const lm = views.side.landmarks;
        const side = sideAnalysis?.side ?? "right";
        const S = side === "left" ? POSE_LANDMARKS.LEFT_SHOULDER : POSE_LANDMARKS.RIGHT_SHOULDER;
        const H = side === "left" ? POSE_LANDMARKS.LEFT_HIP : POSE_LANDMARKS.RIGHT_HIP;
        const K = side === "left" ? POSE_LANDMARKS.LEFT_KNEE : POSE_LANDMARKS.RIGHT_KNEE;
        const A = side === "left" ? POSE_LANDMARKS.LEFT_ANKLE : POSE_LANDMARKS.RIGHT_ANKLE;
        if (lm[S] && lm[H] && lm[K] && lm[A]) {
          // v1.14.28: подписи переименованы ПО СЕГМЕНТАМ. Раньше «Бедро»
          // висело на линии плечо→бедро (это корпус) — пользователь читал
          // «подпись бедро на корпусе». Теперь: бедро→колено — «Бедро»
          // (угол бедра), колено→лодыжка — «Колено» (угол колена),
          // плечо→бедро — «Корпус» (наклон корпуса). Цвет линии = статус
          // метрики: красный/жёлтый/зелёный честно показывают, где проблема.
          const hex = (s?: "good" | "warning" | "bad") =>
            s === "bad" ? "#ef4444" : s === "warning" ? "#eab308" : "#22c55e";
          return [
            {
              a: lm[H],
              b: lm[K],
              color: hex(sideAnalysis?.hipAngle.status),
              label: `Бедро ${sideAnalysis?.hipAngle.value.toFixed(0) ?? ""}°`,
            },
            {
              a: lm[K],
              b: lm[A],
              color: hex(sideAnalysis?.kneeAngle.status),
              label: `Колено ${sideAnalysis?.kneeAngle.value.toFixed(0) ?? ""}°`,
            },
            {
              a: lm[S],
              b: lm[H],
              color: hex(sideAnalysis?.backAngle.status),
              label: `Корпус ${sideAnalysis?.backAngle.value.toFixed(0) ?? ""}°`,
            },
          ];
        }
      }
      if (view === "back" && views.back.landmarks) {
        const lm = views.back.landmarks;
        return [
          { a: lm[POSE_LANDMARKS.LEFT_SHOULDER], b: lm[POSE_LANDMARKS.RIGHT_SHOULDER], color: SYMMETRY_COLORS.shoulder, label: "Плечи" },
          { a: lm[POSE_LANDMARKS.LEFT_HIP], b: lm[POSE_LANDMARKS.RIGHT_HIP], color: SYMMETRY_COLORS.hip, label: "Таз" },
        ];
      }
      if (view === "front" && views.front.landmarks) {
        const lm = views.front.landmarks;
        return [
          { a: lm[POSE_LANDMARKS.LEFT_SHOULDER], b: lm[POSE_LANDMARKS.RIGHT_SHOULDER], color: SYMMETRY_COLORS.shoulder, label: "Плечи" },
          { a: lm[POSE_LANDMARKS.LEFT_WRIST], b: lm[POSE_LANDMARKS.RIGHT_WRIST], color: "#f97316", label: "Хват", dashed: true },
        ];
      }
      return [];
    },
    [views.side.landmarks, views.back.landmarks, views.front.landmarks, sideAnalysis]
  );

  // Подсчёт общей статистики
  const totalAnalyses = useMemo(
    () => [views.side.analysis, views.back.analysis, views.front.analysis].filter(Boolean).length,
    [views.side.analysis, views.back.analysis, views.front.analysis]
  );

  const handlePhotoSelected = useCallback(
    (view: ViewType, file: File, url: string, meta?: CaptureMeta) => {
      void file; // тип/размер проверен в PhotoUploader
      setUiState(view, { analyzing: false, error: null });
      // Мгновенный показ — blob: URL; параллельно сжимаем в JPEG dataURL
      // ≤1280px: персистим ТОЛЬКО dataURL (blob: умирает при перезагрузке).
      setViewPhotoStore(view, { photoData: url, captureMeta: meta ?? null });
      // v1.14.37 (race fix): стор законно заменяет blob на dataURL после
      // сжатия — прежний guard «cur !== url» отбрасывал результат детекции
      // колёс, если она просыпалась позже сжатия (реальные отчёты v1.14.36:
      // riderWheelCheck = "pending" навсегда). Следим за АКТУАЛЬНЫМ значением
      // в замыкании: guard срабатывает только при РЕАЛЬНОЙ замене фото.
      let latestPhotoData: string | null = url;
      void photoToDataUrl(url).then((data) => {
        // Пока сжимали, фото могли заменить/удалить — тогда молча выходим
        const cur = usePhotoAnalysisStore.getState().views[view].photoData;
        if (cur !== latestPhotoData) return;
        if (data) {
          setViewPhotoData(view, data);
          latestPhotoData = data;
          URL.revokeObjectURL(url);
          // v1.14.37: регистрация происхождения фото за активным велом —
          // фингерпринт по СЖАТОМУ dataURL (стабилен между сессиями).
          // То же фото под другим велом → provenanceConflict (красная плашка).
          const bikeId = activeBikeId;
          const card = bikeId ? getBikes().find((b) => b.id === bikeId) : null;
          registerViewPhoto(view, fingerprintDataUrl(data), bikeId, card?.name ?? null);
        }
        // Если сжать не удалось — остаётся blob: до конца сессии,
        // при гидрации персист его отбросит (sanitize в store)
      });

      // v1.14.34 (ТЗ п. 5.4): Bike Match Validation на боковом фото —
      // авто-детектор колёс считает пропорцию wheelbase/диаметр (Шаг 1).
      if (view === "side") {
        const img = new Image();
        img.onload = () => {
          const cur = usePhotoAnalysisStore.getState().views.side.photoData;
          // фото заменили (ни blob-оригинал, ни его dataURL больше не в сторе)
          if (cur !== latestPhotoData) return;
          try {
            const frame = downscaleToRawFrame(img);
            const meta = frame ? computeWheelFrameMeta(frame) : null;
            setRiderPhotoWheelRatio(meta ? meta.ratio : null);
            // v1.14.36: честный статус — детектор не нашёл оба колеса ≠ «совпадает»
            setRiderWheelCheck(meta != null ? "ok" : "notFound");
            // v1.14.43: метаданные колёс + семпл цвета рамы (факторы F2/F3)
            if (meta) {
              const sp = estimateTriangleSamplePoint(
                meta.axleMidXn,
                meta.axleMidYn,
                meta.radiusNormY
              );
              const color =
                sp && frame
                  ? sampleMedianColorFromFrame(frame, sp.nx, sp.ny, sp.halfNorm)
                  : null;
              setRiderWheelMeta({
                axleMidXn: meta.axleMidXn,
                axleMidYn: meta.axleMidYn,
                radiusNormY: meta.radiusNormY,
                frameColorRgb: color,
              });
            } else {
              setRiderWheelMeta(null);
            }
          } catch {
            setRiderPhotoWheelRatio(null);
            setRiderWheelCheck("notFound");
            setRiderWheelMeta(null);
          }
        };
        img.onerror = () => {
          const cur = usePhotoAnalysisStore.getState().views.side.photoData;
          if (cur !== latestPhotoData) return; // битое фото уже заменили
          setRiderPhotoWheelRatio(null);
          setRiderWheelCheck("notFound");
          setRiderWheelMeta(null);
        };
        img.src = url;
      }
    },
    [setUiState, setViewPhotoStore, setViewPhotoData, setRiderPhotoWheelRatio, setRiderWheelCheck, setRiderWheelMeta, registerViewPhoto, activeBikeId]
  );

  // v1.14.37 (Mount Detection): детекция колёс обязана работать и для
  // фото, загруженных В ПРОШЛЫХ сессиях (persist) — handlePhotoSelected
  // для них не вызывается, статус оставался "pending" навсегда (отчёты
  // v1.14.36: riderWheelCheck = "pending" в обоих). Пока фото есть, а
  // сверка "pending" — досматриваем её; после первой попытки статус
  // уходит в "ok"/"notFound" и эффект больше не срабатывает.
  const sidePhotoData = usePhotoAnalysisStore((s) => s.views.side.photoData);
  useEffect(() => {
    if (!sidePhotoData) return;
    const st = usePhotoAnalysisStore.getState();
    if (st.riderWheelCheck !== "pending") return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      // фото могли заменить, пока декодировалось
      if (usePhotoAnalysisStore.getState().views.side.photoData !== sidePhotoData) return;
      try {
        const frame = downscaleToRawFrame(img);
        const meta = frame ? computeWheelFrameMeta(frame) : null;
        setRiderPhotoWheelRatio(meta ? meta.ratio : null);
        setRiderWheelCheck(meta != null ? "ok" : "notFound");
        // v1.14.43: метаданные колёс + семпл цвета рамы (факторы F2/F3)
        if (meta) {
          const sp = estimateTriangleSamplePoint(
            meta.axleMidXn,
            meta.axleMidYn,
            meta.radiusNormY
          );
          const color =
            sp && frame
              ? sampleMedianColorFromFrame(frame, sp.nx, sp.ny, sp.halfNorm)
              : null;
          setRiderWheelMeta({
            axleMidXn: meta.axleMidXn,
            axleMidYn: meta.axleMidYn,
            radiusNormY: meta.radiusNormY,
            frameColorRgb: color,
          });
        } else {
          setRiderWheelMeta(null);
        }
      } catch {
        setRiderPhotoWheelRatio(null);
        setRiderWheelCheck("notFound");
        setRiderWheelMeta(null);
      }
    };
    // onerror (битое/мёртвое фото) — оставляем "pending": фото всё равно
    // не анализируется, врать «notFound» про живой кадр не хотим
    img.src = sidePhotoData;
    return () => {
      cancelled = true;
    };
  }, [sidePhotoData, setRiderPhotoWheelRatio, setRiderWheelCheck, setRiderWheelMeta]);

  const handleClear = useCallback(
    (view: ViewType) => {
      clearViewStore(view);
      setUiState(view, { analyzing: false, error: null });
    },
    [clearViewStore, setUiState]
  );

  return (
    <div className="space-y-6">
      {/* Контекст */}
      {contextCard}

      {/* Загрузка модели */}
      {modelLoading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/30 px-4 py-3 text-sm text-orange-700 dark:text-orange-400">
          <Loader2 className="size-4 animate-spin" />
          Загружаем AI-модель MediaPipe Pose...
        </div>
      )}
      {modelError && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Не удалось загрузить модель</p>
            <p className="mt-1 text-xs">{modelError}</p>
          </div>
        </div>
      )}

      {/* Подсказка */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <Camera className="size-5 shrink-0 text-orange-500 mt-0.5" />
            <div className="text-sm space-y-2">
              <p className="font-medium">Как фотографировать для анализа позы:</p>
              <p className="text-xs text-muted-foreground">
                ⚠️ Все 3 фото — <b>С ЧЕЛОВЕКОМ НА ВЕЛОСИПЕДЕ</b>, в рабочей посадке. Это не фото велосипеда!
              </p>
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                ⚠️ {FOOTWEAR_WARNING}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                {(Object.keys(VIEW_LABELS) as ViewType[]).map((v) => (
                  <div key={v} className="rounded-md bg-background p-2 border">
                    <p className="font-medium text-xs flex items-center gap-1">
                      <span>{VIEW_LABELS[v].emoji}</span>
                      {VIEW_LABELS[v].ru}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                      {VIEW_LABELS[v].description}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Можно загрузить от 1 до 3 фото. Чем больше ракурсов — тем точнее анализ.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Статистика */}
      {totalAnalyses > 0 && (
        <Card className="bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900">
          <CardContent className="py-3">
            <div className="flex items-center gap-3 text-sm">
              <Sparkles className="size-5 text-emerald-600 dark:text-emerald-400" />
              <span className="font-medium text-emerald-700 dark:text-emerald-400">
                Проанализировано ракурсов: {totalAnalyses} / 3
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === v1.14.37: Photo Provenance — фото уже использовалось с другим велом ===
          Детерминированная ловушка подмены: фингерпринт фото уже зарегистрирован
          за другой карточкой вела. Работает даже когда детектор колёс слеп
          и пропорции велов совпадают. */}
      {provenanceConflict && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">
              Это фото уже использовалось с другим велом
            </p>
            <p className="mt-1 text-xs">
              Ракурс «{provenanceConflict.view === "side" ? "сбоку" : provenanceConflict.view === "back" ? "сзади" : "спереди"}» уже загружался для велосипеда
              {" "}
              «{provenanceConflict.previous.bikeName ?? "без имени"}»
              {new Date(provenanceConflict.previous.at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) && ` (${new Date(provenanceConflict.previous.at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })})`}
              , а сейчас активна другая карточка. Похоже, фото подменено между шагами — сравнение с рамой и рекомендации будут НЕВЕРНЫМИ. Верните фото правильному велу или переснимите кадр.
            </p>
          </div>
        </div>
      )}

      {/* === v1.14.43 (ТЗ «Защита от дурака»): multi-factor Bike Match —
          сводка по 4 факторам (пропорции/цвет/масштаб посадки/хват).
          v1.14.34/41: старые состояния (совпадает/расходится/не сверено)
          сохранены как подмножество фактора F1 === */}
      {multiMatch.verdict === "block" && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Обнаружено несоответствие велосипедов!</p>
            <p className="mt-1 text-xs">
              Параметры на фото с человеком (Шаг 1) сильно отличаются от велосипеда, калиброванного на Шаге 2.
              Блокированы: рекомендации «геометрия ↔ поза» и таблица «Было ➔ Стало» — на чужой раме они бессмысленны.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {multiMatch.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => setBikeMatchOverride(true)}
            >
              Это тот же велосипед — продолжить (на свой страх и риск)
            </Button>
          </div>
        </div>
      )}
      {multiMatch.verdict === "warn" && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Подозрение на разные велосипеды</p>
            <p className="mt-1 text-xs">
              Один из признаков не сошёлся (блокировка — при двух и более либо при расхождении пропорций): сравнение с рамой не заблокировано, но проверьте фото глазами.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {multiMatch.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {bikeMatchUnknown && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">
              Не удалось автоматически сверить велосипеды
            </p>
            <p className="mt-1 text-xs">
              На фото с райдером не удалось распознать оба колеса (часто мешает нога или ракурс), поэтому автопроверка «тот ли это велосипед, что размечен на Шаге 2» не выполнялась.
              {bikePhotoWheelRatio != null && ` Пропорция размеченного вела: ${bikePhotoWheelRatio.toFixed(2)}.`}
              {" "}
              Если вы меняли велосипед после Шага 2 — вернитесь и переснимите фото с райдером: сравнение с рамой другого вела даст неверные рекомендации.
            </p>
          </div>
        </div>
      )}
      {/* v1.14.44: честная плашка «сверка неактивна» — когда вердикт unknown
          и причина в КАРТОЧКЕ ВЕЛА (нет фото/разметки/типа), а не в детекторе
          колёс (тот случай покрыт bikeMatchUnknown выше). Без неё пустая
          карточка выглядела как «защита молча не работает». */}
      {multiMatch.verdict === "unknown" && !bikeMatchUnknown && views.side.photoData && (
        <div className="flex items-start gap-2 rounded-lg border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-4 py-3 text-sm text-sky-700 dark:text-sky-400">
          <Info className="size-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Сверка велосипедов неактивна</p>
            <p className="mt-1 text-xs">
              В карточке выбранного вела не хватает данных для сверки с фото райдера. Что отсутствует:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {bikePhotoWheelRatio == null && <li>разметка колёс на фото вела (Шаг 2 — оси и верха колёс)</li>}
              {bikeCardSignals.bbColorRgb == null && bikePhotoWheelRatio == null && <li>фото вела или разметка каретки (для сверки цвета рамы)</li>}
              {bikeCardSignals.bikeType == null && <li>тип велосипеда (выберите его в карточке вела)</li>}
              {!activeBikeId && <li>выбранная карточка вела (откройте Шаг 2 и нажмите на карточку)</li>}
            </ul>
            <p className="mt-2 text-xs">
              Заполните разметку на Шаге 2 — и автопроверка «тот ли велосипед на фото» включится автоматически.
            </p>
          </div>
        </div>
      )}
      {multiMatch.verdict === "ok" && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
          <span className="text-xs">
            Велосипеды сверены по {multiMatch.evaluatedCount} признак(ам): {Object.values(multiMatch.factors)
              .filter((f) => f.verdict === "pass")
              .map((f) => f.detail)
              .join("; ")}.
          </span>
        </div>
      )}

      {/* === v1.14.34 (ТЗ п. 6): Re-fit Loop — статус повторного замера === */}
      {refitMeta && !sideAnalysis && (
        <Card className="border-orange-300 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-start gap-3">
              <RotateCcw className="size-5 shrink-0 text-orange-500 mt-0.5" />
              <div className="space-y-1 text-sm">
                <p className="font-medium">
                  Повторный замер #{previousRun ? "2" : "?"} запущен
                </p>
                <p className="text-xs text-muted-foreground">
                  Загрузите новое фото — вид сбоку, в рабочей посадке.
                  Геометрия рамы (Шаг 2) сохранена: после анализа появится
                  таблица «Было ➔ Стало».
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={cancelRefit}
                title="Вернуть фото и анализ прошлого замера"
              >
                <Undo2 className="size-4" />
                Отменить повторный замер
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Табы ракурсов */}
      <Tabs defaultValue="side" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          {(Object.keys(VIEW_LABELS) as ViewType[]).map((v) => {
            const hasResult =
              (v === "side" && sideAnalysis) ||
              (v === "back" && backAnalysis) ||
              (v === "front" && frontAnalysis);
            return (
              <TabsTrigger key={v} value={v} className="gap-1.5">
                <span>{VIEW_LABELS[v].emoji}</span>
                <span className="hidden sm:inline">{VIEW_LABELS[v].short}</span>
                {hasResult && (
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                )}
              </TabsTrigger>
            );
          })}
          <TabsTrigger value="compare" className="gap-1.5">
            <span>🔄</span>
            <span className="hidden sm:inline">Сравнение</span>
          </TabsTrigger>
        </TabsList>

        {/* === Вид сбоку === */}
        <TabsContent
          value="side"
          className={cn(
            "space-y-4",
            phoneLandscape && sideAnalysis && "grid grid-cols-2 items-start gap-4 space-y-0",
          )}
        >
          <ViewSection
            view="side"
            state={sideState}
            analysis={sideAnalysis}
            activeSide={sideAnalysis?.side ?? sideDrawSide}
            onPhotoSelected={handlePhotoSelected}
            onClear={handleClear}
            onAnalyze={(img) =>
              analyzePhoto("side", img)
            }
            overlayLines={getOverlayLines("side")}
          />
          {sideAnalysis && (
            <>
              {/* v1.14.32 (ТЗ п. B.2): предупреждения о качестве кадра —
                  неудачное распознавание стопы и т.п. */}
              {!!sideAnalysis.warnings?.length && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Замечания по качеству кадра</p>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {sideAnalysis.warnings.map((w, i) => (
                        <li key={i} className="list-inside list-disc">
                          {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              <Recommendations analysis={sideAnalysis} />
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ImageIcon className="size-5 text-orange-500" />
                    Метрики — вид сбоку
                  </CardTitle>
                  <CardDescription>
                    Углы суставов с цветовой индикацией относительно нормы
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResultsPanel
                    viewType="side"
                    sideAnalysis={sideAnalysis}
                    backAnalysis={null}
                    frontAnalysis={null}
                  />
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* === Вид сзади === */}
        <TabsContent
          value="back"
          className={cn(
            "space-y-4",
            phoneLandscape && backAnalysis && "grid grid-cols-2 items-start gap-4 space-y-0",
          )}
        >
          <ViewSection
            view="back"
            state={backState}
            analysis={backAnalysis}
            onPhotoSelected={handlePhotoSelected}
            onClear={handleClear}
            onAnalyze={(img) =>
              analyzePhoto("back", img)
            }
            overlayLines={getOverlayLines("back")}
          />
          {backAnalysis && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="size-5 text-orange-500" />
                  Метрики — вид сзади
                </CardTitle>
                <CardDescription>
                  Симметрия тела: плечи, таз, колени, голова, стопы
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResultsPanel
                  viewType="back"
                  sideAnalysis={null}
                  backAnalysis={backAnalysis}
                  frontAnalysis={null}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* === Вид спереди === */}
        <TabsContent
          value="front"
          className={cn(
            "space-y-4",
            phoneLandscape && frontAnalysis && "grid grid-cols-2 items-start gap-4 space-y-0",
          )}
        >
          <ViewSection
            view="front"
            state={frontState}
            analysis={frontAnalysis}
            onPhotoSelected={handlePhotoSelected}
            onClear={handleClear}
            onAnalyze={(img) =>
              analyzePhoto("front", img)
            }
            overlayLines={getOverlayLines("front")}
          />
          {frontAnalysis && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="size-5 text-orange-500" />
                  Метрики — вид спереди
                </CardTitle>
                <CardDescription>
                  Ширина хвата руля, симметрия плеч/локтей/коленей
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResultsPanel
                  viewType="front"
                  sideAnalysis={null}
                  backAnalysis={null}
                  frontAnalysis={frontAnalysis}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* === Сравнение до/после === */}
        <TabsContent value="compare" className="space-y-4">
          <CompareView
            detectFn={detect}
            modelLoading={modelLoading}
            modelError={modelError}
          />
        </TabsContent>
      </Tabs>

      {/* === v1.14.34 (ТЗ п. 6.3): сравнение «Было ➔ Стало» — отчёт второго прогона.
          v1.14.41: при неразрешённом mismatch пропорций — заблокировано === */}
      {refitMeta &&
        !bikeMatchBlocking &&
        previousRun?.views.side?.analysis &&
        // снапшот хранит union — сравнивать можно только side-анализы
        "kneeAngle" in previousRun.views.side.analysis &&
        sideAnalysis && (
          <ComparisonReport
            before={previousRun.views.side.analysis}
            after={sideAnalysis}
            meta={refitMeta}
          />
        )}

      {/* === Умные рекомендации по жалобам === */}
      {(sideAnalysis || backAnalysis || frontAnalysis) && (
        <ComplaintRecommendations
          sideAnalysis={sideAnalysis}
          backAnalysis={backAnalysis}
          frontAnalysis={frontAnalysis}
        />
      )}

      {/* === v1.14.42: AI-разбор посадки (Google Gemini, BYO-ключ).
          Отправляются только числа — углы/размеры/жалобы, без фото === */}
      <AiConsultCard input={aiInput} analysis={sideAnalysis} />

      {/* === Отчёт для отладки (v1.6.0): появляется как только есть фото —
          и при успехе анализа, и при ошибке (ошибки ценнее для отладки) === */}
      {(sideState.url || backState.url || frontState.url) && (
        <DebugReportCard
          views={[
            {
              view: "side",
              url: sideState.url,
              landmarks: sideState.landmarks,
              analysis: sideAnalysis,
              error: sideState.error,
              captureMeta: sideState.captureMeta,
            },
            {
              view: "back",
              url: backState.url,
              landmarks: backState.landmarks,
              analysis: backAnalysis,
              error: backState.error,
              captureMeta: backState.captureMeta,
            },
            {
              view: "front",
              url: frontState.url,
              landmarks: frontState.landmarks,
              analysis: frontAnalysis,
              error: frontState.error,
              captureMeta: frontState.captureMeta,
            },
          ] as ReportViewInput[]}
        />
      )}

      {/* === Комплексные рекомендации: геометрия ↔ поза.
          v1.14.41: при неразрешённом mismatch пропорций — заблокированы
          (используют геометрию рамы, которая может оказаться чужой) === */}
      {sideAnalysis && !bikeMatchBlocking && (
        <CrossRefRecommendations sideAnalysis={sideAnalysis} />
      )}

      {/* === v1.14.34 (ТЗ п. 6.1): кнопка повторного замера — геометрия рамы (Шаг 2) НЕ сбрасывается === */}
      {(sideAnalysis || totalAnalyses > 0) && (
        <Card className="border-dashed">
          <CardContent className="py-4">
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground">
                  Изменили посадку? Проверьте результат
                </p>
                <p className="mt-0.5 text-xs">
                  {refitMeta && previousRun
                    ? "Сделайте ещё один замер — таблица «Было ➔ Стало» обновится"
                    : "Архивируем текущий прогон и снимаем новое фото — покажем, что изменилось"}
                </p>
              </div>
              <Button
                onClick={() => setRefitModalOpen(true)}
                className="shrink-0 bg-orange-500 hover:bg-orange-600"
              >
                <Repeat className="size-4" />
                Измерить новую посадку
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === v1.14.34 (ТЗ п. 5.2): модалка «Человек не найден на фото» === */}
      <Dialog open={personModalOpen} onOpenChange={setPersonModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="size-5 text-rose-500" />
              Человек не найден на фото
            </DialogTitle>
            <DialogDescription className="text-left">
              Загрузите снимок верхом на велосипеде: человек в кадре должен
              быть целиком — плечи, бёдра, колени и стопы. Расчёт заблокирован:
              без фигуры райдера углы посадки не определяются.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => setPersonModalOpen(false)}
              className="bg-orange-500 hover:bg-orange-600"
            >
              Понятно, заменю фото
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* === v1.14.43 (ТЗ «Защита от дурака»): модалка несоответствия
          велов — список проваленных факторов (v1.14.41: была только
          пропорция) === */}
      <Dialog open={bikeMatchModalOpen} onOpenChange={setBikeMatchModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-5 text-amber-500" />
              Обнаружено несоответствие велосипедов!
            </DialogTitle>
            <DialogDescription className="text-left">
              <p>
                Параметры рамы на фото с человеком (Шаг 1) сильно отличаются от
                велосипеда, калиброванного на Шаге 2 (разные пропорции/цвет
                рамы). Убедитесь, что вы загрузили один и тот же велосипед.
              </p>
              {multiMatch.reasons.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  {multiMatch.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Автоматическое сравнение с рамой и рекомендации «геометрия ↔
                поза» заблокированы до подтверждения.
              </p>
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button size="sm" variant="outline" onClick={() => setBikeMatchModalOpen(false)}>
              📷 Переснять фото с этим же велосипедом
            </Button>
            <Button
              size="sm"
              className="bg-orange-500 hover:bg-orange-600"
              onClick={() => {
                setBikeMatchOverride(true);
                setBikeMatchModalOpen(false);
              }}
            >
              Всё равно продолжить (на свой страх и риск)
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* === v1.14.34 (ТЗ п. 6.2): мини-анкета перед повторным замером === */}
      <ReFitFeedbackModal
        open={refitModalOpen}
        onOpenChange={setRefitModalOpen}
        onConfirm={startRefit}
      />
    </div>
  );
}

// ============================================================
// Вспомогательный компонент секции ракурса
// ============================================================

interface ViewSectionProps {
  view: ViewType;
  state: ViewPhotoState;
  analysis: unknown;
  /** Ближняя сторона для фильтра скелета (только боковой вид, v1.14.32) */
  activeSide?: "left" | "right" | null;
  onPhotoSelected: (view: ViewType, file: File, url: string, meta?: CaptureMeta) => void;
  onClear: (view: ViewType) => void;
  onAnalyze: (img: HTMLImageElement) => void;
  overlayLines?: Array<{ a: Point; b: Point; color: string; label?: string; dashed?: boolean }>;
}

function ViewSection({
  view,
  state,
  analysis,
  activeSide,
  onPhotoSelected,
  onClear,
  onAnalyze,
  overlayLines,
}: ViewSectionProps) {
  return (
    <>
      {!state.url ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span>{VIEW_LABELS[view].emoji}</span>
              Фото — {VIEW_LABELS[view].ru}
            </CardTitle>
            <CardDescription>{VIEW_LABELS[view].description}</CardDescription>
          </CardHeader>
          <CardContent>
            <PhotoUploader
              onPhotoSelected={(file, url, meta) => onPhotoSelected(view, file, url, meta)}
              currentPhotoUrl={state.url}
              onClear={() => onClear(view)}
              label={`Загрузите фото — ${VIEW_LABELS[view].short}`}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <span>{VIEW_LABELS[view].emoji}</span>
                Фото — {VIEW_LABELS[view].ru}
              </CardTitle>
              {!!analysis && (
                <Badge className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                  ✓ Готово
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <PhotoAnalyzer
              photoUrl={state.url}
              viewType={view}
              onAnalyze={onAnalyze}
              analyzing={state.analyzing}
              hasResults={!!analysis}
              landmarks={state.landmarks}
              overlayLines={overlayLines}
              activeSide={view === "side" ? (activeSide ?? null) : null}
            />
            {state.error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Не получилось проанализировать фото</p>
                  <p className="mt-1 text-xs">{state.error}</p>
                </div>
              </div>
            )}
            <div className="flex justify-center">
              <PhotoUploader
                onPhotoSelected={(file, url, meta) => onPhotoSelected(view, file, url, meta)}
                currentPhotoUrl={state.url}
                onClear={() => onClear(view)}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
