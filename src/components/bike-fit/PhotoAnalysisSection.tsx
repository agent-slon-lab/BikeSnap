"use client";

import { useCallback, useMemo, useState } from "react";
import { Camera, AlertCircle, Loader2, Sparkles, Image as ImageIcon } from "lucide-react";
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
  VIEW_LABELS,
  POSE_LANDMARKS,
  type Point,
  type ViewType,
  type BikeFitAnalysis,
  type BackViewAnalysis,
  type FrontViewAnalysis,
} from "@/lib/bike-fit";
import { BIKE_TYPES } from "@/lib/bike-params";
import { useBikeStore } from "@/lib/bike-store";
import { cn } from "@/lib/utils";
import { useMediaFlag, PHONE_LANDSCAPE_QUERY } from "@/hooks/use-media-flag";

interface ViewPhotoState {
  url: string | null;
  landmarks: Point[] | null;
  analyzing: boolean;
  error: string | null;
}

const INITIAL_STATE: ViewPhotoState = {
  url: null,
  landmarks: null,
  analyzing: false,
  error: null,
};

// Цвета линий симметрии для overlay
const SYMMETRY_COLORS = {
  shoulder: "#10b981", // emerald
  hip: "#3b82f6", // blue
  knee: "#a855f7", // purple
  foot: "#ec4899", // pink
  head: "#eab308", // yellow
};

export function PhotoAnalysisSection() {
  const { bikeType, body } = useBikeStore();
  // Телефон набок: фото слева, рекомендации/метрики справа (две колонки)
  const phoneLandscape = useMediaFlag(PHONE_LANDSCAPE_QUERY);

  // Состояние для каждого ракурса
  const [sideState, setSideState] = useState<ViewPhotoState>(INITIAL_STATE);
  const [backState, setBackState] = useState<ViewPhotoState>(INITIAL_STATE);
  const [frontState, setFrontState] = useState<ViewPhotoState>(INITIAL_STATE);

  // Результаты анализа (после кнопки "Анализировать")
  const [sideAnalysis, setSideAnalysis] = useState<BikeFitAnalysis | null>(null);
  const [backAnalysis, setBackAnalysis] = useState<BackViewAnalysis | null>(null);
  const [frontAnalysis, setFrontAnalysis] = useState<FrontViewAnalysis | null>(null);

  const { loading: modelLoading, error: modelError, detect } = usePoseLandmarker();

  // Сохранение результата анализа в правильный state
  // (объявлено до analyzePhoto, чтобы корректно вошло в зависимости)
  const saveResult = useCallback(
    (
      view: ViewType,
      analysis: BikeFitAnalysis | BackViewAnalysis | FrontViewAnalysis | null
    ) => {
      if (view === "side") setSideAnalysis(analysis as BikeFitAnalysis | null);
      else if (view === "back")
        setBackAnalysis(analysis as BackViewAnalysis | null);
      else if (view === "front")
        setFrontAnalysis(analysis as FrontViewAnalysis | null);
    },
    []
  );

  // Общий обработчик анализа для любого ракурса
  const analyzePhoto = useCallback(
    async (
      view: ViewType,
      img: HTMLImageElement,
      state: ViewPhotoState,
      setState: (s: ViewPhotoState) => void,
      onResult: (
        landmarks: Point[]
      ) => BikeFitAnalysis | BackViewAnalysis | FrontViewAnalysis | null
    ) => {
      if (modelLoading || modelError) {
        setState({
          ...state,
          error:
            modelError ?? "Модель ещё загружается, подождите пару секунд...",
        });
        return;
      }

      setState({ ...state, analyzing: true, error: null });

      try {
        await new Promise((r) => setTimeout(r, 50));
        const result = detect(img);
        if (!result || !result.landmarks || result.landmarks.length === 0) {
          setState({
            ...state,
            analyzing: false,
            error:
              "Не удалось обнаружить позу на фото. Убедитесь, что велосипедист полностью виден в кадре, попробуйте более чёткое фото.",
          });
          saveResult(view, null);
          return;
        }
        const lms = result.landmarks[0] as Point[];
        const analysis = onResult(lms);
        if (!analysis) {
          setState({
            ...state,
            analyzing: false,
            landmarks: lms,
            error:
              "Ключевые точки тела определены не полностью. Попробуйте фото, где видны плечи, бёдра, колени и стопы.",
          });
          saveResult(view, null);
          return;
        }
        setState({
          ...state,
          analyzing: false,
          landmarks: lms,
          error: null,
        });
        saveResult(view, analysis);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState({
          ...state,
          analyzing: false,
          error: `Ошибка анализа: ${msg}`,
        });
        saveResult(view, null);
      }
    },
    [modelLoading, modelError, detect, saveResult]
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
      if (view === "side" && sideState.landmarks) {
        const lm = sideState.landmarks;
        const side = sideAnalysis?.side ?? "right";
        const S = side === "left" ? POSE_LANDMARKS.LEFT_SHOULDER : POSE_LANDMARKS.RIGHT_SHOULDER;
        const H = side === "left" ? POSE_LANDMARKS.LEFT_HIP : POSE_LANDMARKS.RIGHT_HIP;
        const K = side === "left" ? POSE_LANDMARKS.LEFT_KNEE : POSE_LANDMARKS.RIGHT_KNEE;
        const A = side === "left" ? POSE_LANDMARKS.LEFT_ANKLE : POSE_LANDMARKS.RIGHT_ANKLE;
        if (lm[S] && lm[H] && lm[K] && lm[A]) {
          return [
            {
              a: lm[H],
              b: lm[K],
              color: "#f97316",
              label: `Колено ${sideAnalysis?.kneeAngle.value.toFixed(0) ?? ""}°`,
            },
            {
              a: lm[S],
              b: lm[H],
              color: "#22c55e",
              label: `Бедро ${sideAnalysis?.hipAngle.value.toFixed(0) ?? ""}°`,
            },
          ];
        }
      }
      if (view === "back" && backState.landmarks) {
        const lm = backState.landmarks;
        return [
          { a: lm[POSE_LANDMARKS.LEFT_SHOULDER], b: lm[POSE_LANDMARKS.RIGHT_SHOULDER], color: SYMMETRY_COLORS.shoulder, label: "Плечи" },
          { a: lm[POSE_LANDMARKS.LEFT_HIP], b: lm[POSE_LANDMARKS.RIGHT_HIP], color: SYMMETRY_COLORS.hip, label: "Таз" },
        ];
      }
      if (view === "front" && frontState.landmarks) {
        const lm = frontState.landmarks;
        return [
          { a: lm[POSE_LANDMARKS.LEFT_SHOULDER], b: lm[POSE_LANDMARKS.RIGHT_SHOULDER], color: SYMMETRY_COLORS.shoulder, label: "Плечи" },
          { a: lm[POSE_LANDMARKS.LEFT_WRIST], b: lm[POSE_LANDMARKS.RIGHT_WRIST], color: "#f97316", label: "Хват", dashed: true },
        ];
      }
      return [];
    },
    [sideState.landmarks, backState.landmarks, frontState.landmarks, sideAnalysis]
  );

  // Подсчёт общей статистики
  const totalAnalyses = useMemo(
    () => [sideAnalysis, backAnalysis, frontAnalysis].filter(Boolean).length,
    [sideAnalysis, backAnalysis, frontAnalysis]
  );

  const handlePhotoSelected = useCallback(
    (view: ViewType, file: File, url: string) => {
      if (view === "side") {
        if (sideState.url) URL.revokeObjectURL(sideState.url);
        setSideState({ ...INITIAL_STATE, url });
        setSideAnalysis(null);
      } else if (view === "back") {
        if (backState.url) URL.revokeObjectURL(backState.url);
        setBackState({ ...INITIAL_STATE, url });
        setBackAnalysis(null);
      } else {
        if (frontState.url) URL.revokeObjectURL(frontState.url);
        setFrontState({ ...INITIAL_STATE, url });
        setFrontAnalysis(null);
      }
    },
    [sideState.url, backState.url, frontState.url]
  );

  const handleClear = useCallback((view: ViewType) => {
    if (view === "side") {
      if (sideState.url) URL.revokeObjectURL(sideState.url);
      setSideState(INITIAL_STATE);
      setSideAnalysis(null);
    } else if (view === "back") {
      if (backState.url) URL.revokeObjectURL(backState.url);
      setBackState(INITIAL_STATE);
      setBackAnalysis(null);
    } else {
      if (frontState.url) URL.revokeObjectURL(frontState.url);
      setFrontState(INITIAL_STATE);
      setFrontAnalysis(null);
    }
  }, [sideState.url, backState.url, frontState.url]);

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
            onPhotoSelected={handlePhotoSelected}
            onClear={handleClear}
            onAnalyze={(img) =>
              analyzePhoto("side", img, sideState, setSideState, (lm) =>
                analyzeBikeFit(lm)
              )
            }
            overlayLines={getOverlayLines("side")}
          />
          {sideAnalysis && (
            <>
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
              analyzePhoto("back", img, backState, setBackState, (lm) =>
                analyzeBackView(lm)
              )
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
              analyzePhoto("front", img, frontState, setFrontState, (lm) =>
                analyzeFrontView(lm)
              )
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

      {/* === Умные рекомендации по жалобам === */}
      {(sideAnalysis || backAnalysis || frontAnalysis) && (
        <ComplaintRecommendations
          sideAnalysis={sideAnalysis}
          backAnalysis={backAnalysis}
          frontAnalysis={frontAnalysis}
        />
      )}

      {/* === Комплексные рекомендации: геометрия ↔ поза === */}
      {sideAnalysis && (
        <CrossRefRecommendations sideAnalysis={sideAnalysis} />
      )}
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
  onPhotoSelected: (view: ViewType, file: File, url: string) => void;
  onClear: (view: ViewType) => void;
  onAnalyze: (img: HTMLImageElement) => void;
  overlayLines?: Array<{ a: Point; b: Point; color: string; label?: string; dashed?: boolean }>;
}

function ViewSection({
  view,
  state,
  analysis,
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
              onPhotoSelected={(file, url) => onPhotoSelected(view, file, url)}
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
                onPhotoSelected={(file, url) => onPhotoSelected(view, file, url)}
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
