"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Video,
  Target,
  ListChecks,
  Loader2,
  AlertCircle,
  Camera,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VideoUploader } from "@/components/bike-fit/VideoUploader";
import { VideoAnalyzer } from "@/components/bike-fit/VideoAnalyzer";
import { ResultsPanel } from "@/components/bike-fit/ResultsPanel";
import { Recommendations } from "@/components/bike-fit/Recommendations";
import { usePoseLandmarker } from "@/hooks/use-pose-landmarker";
import {
  analyzeBikeFit,
  POSE_CONNECTIONS,
  POSE_LANDMARKS,
  type BikeFitAnalysis,
  type Point,
} from "@/lib/bike-fit";
import { BIKE_TYPES } from "@/lib/bike-params";
import { useBikeStore } from "@/lib/bike-store";
import { calculateAll } from "@/lib/bike-calculations";

const HIGHLIGHT_COLORS = {
  knee: "#f97316", // orange
  hip: "#22c55e", // green
  back: "#3b82f6", // blue
  ankle: "#a855f7", // purple
  shoulder: "#ec4899", // pink
  kops: "#eab308", // yellow
} as const;

export function VideoAnalysisSection() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<BikeFitAnalysis | null>(null);
  const [landmarks, setLandmarks] = useState<Point[] | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);

  const { body, bike, bikeType, goal } = useBikeStore();

  const { loading: modelLoading, error: modelError, detect } =
    usePoseLandmarker();

  // Расчёт по введённым данным для отображения рядом с видеоанализом
  const calc = useMemo(() => {
    if (!bikeType || !goal) return null;
    return calculateAll(body, bike, { bikeType, goal });
  }, [body, bike, bikeType, goal]);

  const handleAnalyze = useCallback(
    async (video: HTMLVideoElement) => {
      if (modelLoading || modelError) {
        setDetectError(
          modelError ?? "Модель ещё загружается, подождите пару секунд..."
        );
        return;
      }

      setAnalyzing(true);
      setDetectError(null);

      try {
        await new Promise((r) => setTimeout(r, 50));
        const result = detect(video);
        if (!result || !result.landmarks || result.landmarks.length === 0) {
          setDetectError(
            "Не удалось обнаружить позу на этом кадре. Убедитесь, что велосипедист хорошо виден сбоку, и попробуйте другой кадр."
          );
          setAnalysis(null);
          setLandmarks(null);
          return;
        }

        const lms = result.landmarks[0] as Point[];
        const fit = analyzeBikeFit(lms);
        if (!fit) {
          setDetectError(
            "Ключевые точки тела определены не полностью. Попробуйте более чёткий кадр, где видны плечи, бёдра, колени и лодыжки."
          );
          setAnalysis(null);
          setLandmarks(null);
          return;
        }

        setLandmarks(lms);
        setAnalysis(fit);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setDetectError(`Ошибка анализа: ${msg}`);
        setAnalysis(null);
        setLandmarks(null);
      } finally {
        setAnalyzing(false);
      }
    },
    [modelLoading, modelError, detect]
  );

  const handleClearVideo = useCallback(() => {
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }
    setVideoUrl(null);
    setAnalysis(null);
    setLandmarks(null);
    setDetectError(null);
  }, [videoUrl]);

  const handleVideoSelected = useCallback((_file: File, url: string) => {
    setVideoUrl(url);
    setAnalysis(null);
    setLandmarks(null);
    setDetectError(null);
  }, []);

  const highlightAngles = useMemo(() => {
    if (!analysis || !landmarks) return undefined;

    const side = analysis.side;
    const S = side === "left" ? POSE_LANDMARKS.LEFT_SHOULDER : POSE_LANDMARKS.RIGHT_SHOULDER;
    const E = side === "left" ? POSE_LANDMARKS.LEFT_ELBOW : POSE_LANDMARKS.RIGHT_ELBOW;
    const H = side === "left" ? POSE_LANDMARKS.LEFT_HIP : POSE_LANDMARKS.RIGHT_HIP;
    const K = side === "left" ? POSE_LANDMARKS.LEFT_KNEE : POSE_LANDMARKS.RIGHT_KNEE;
    const A = side === "left" ? POSE_LANDMARKS.LEFT_ANKLE : POSE_LANDMARKS.RIGHT_ANKLE;
    const HE = side === "left" ? POSE_LANDMARKS.LEFT_HEEL : POSE_LANDMARKS.RIGHT_HEEL;

    // Явный тип: union цветов из литерала сужает push цвета shoulder ниже
    const angles: Array<{
      a: { x: number; y: number };
      b: { x: number; y: number };
      c: { x: number; y: number };
      color: string;
      label: string;
    }> = [
      {
        a: landmarks[H],
        b: landmarks[K],
        c: landmarks[A],
        color: HIGHLIGHT_COLORS.knee,
        label: `Колено ${analysis.kneeAngle.value.toFixed(0)}°`,
      },
      {
        a: landmarks[S],
        b: landmarks[H],
        c: landmarks[K],
        color: HIGHLIGHT_COLORS.hip,
        label: `Бедро ${analysis.hipAngle.value.toFixed(0)}°`,
      },
      {
        a: landmarks[K],
        b: landmarks[A],
        c: landmarks[HE] ?? landmarks[A],
        color: HIGHLIGHT_COLORS.ankle,
        label: `Лодыжка ${analysis.ankleAngle.value.toFixed(0)}°`,
      },
    ];

    if (landmarks[E] && (landmarks[E].visibility ?? 0) > 0.5) {
      angles.push({
        a: landmarks[E],
        b: landmarks[S],
        c: landmarks[H],
        color: HIGHLIGHT_COLORS.shoulder,
        label: `Плечо ${analysis.shoulderAngle.value.toFixed(0)}°`,
      });
    }

    return angles;
  }, [analysis, landmarks]);

  const anglesList = analysis
    ? [
        analysis.kneeAngle,
        analysis.hipAngle,
        analysis.backAngle,
        analysis.ankleAngle,
        analysis.shoulderAngle,
        analysis.kops,
      ]
    : [];

  const goodCount = anglesList.filter((a) => a.status === "good").length;
  const totalCount = anglesList.length;

  return (
    <div className="space-y-6">
      {/* Контекст-карточка с введёнными данными */}
      {bikeType && (
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
              {bike.saddleHeight && (
                <span className="text-muted-foreground">
                  SH: <span className="font-medium text-foreground">{bike.saddleHeight} мм</span>
                </span>
              )}
              {calc?.recommendedSaddleHeight && (
                <span className="text-orange-600 dark:text-orange-400">
                  Цел. SH: <span className="font-medium">{calc.recommendedSaddleHeight} мм</span>
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Если модель ещё грузится */}
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

      {/* Подсказка по съёмке */}
      {!videoUrl && (
        <Card className="bg-muted/30 border-dashed">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Camera className="size-5 shrink-0 text-orange-500 mt-0.5" />
              <div className="text-sm space-y-1">
                <p className="font-medium">Как снять видео для анализа:</p>
                <ul className="ml-4 list-disc space-y-0.5 text-muted-foreground">
                  <li>Снимайте <b>сбоку</b>, перпендикулярно велосипеду</li>
                  <li>Камера на уровне седла, на расстоянии 3–5 метров</li>
                  <li>В кадре должен быть виден весь велосипедист от головы до стоп</li>
                  <li>Желательно, чтобы педаль проворачивалась медленно (5–10 сек на оборот)</li>
                  <li>Избегайте мешающей одежды — поза должна быть различима</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!videoUrl ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Video className="size-5 text-orange-500" />
              Загрузите видео посадки
            </CardTitle>
            <CardDescription>
              Перетащите файл с записью езды сбоку или нажмите на зону загрузки
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VideoUploader
              onVideoSelected={handleVideoSelected}
              currentVideoUrl={videoUrl}
              onClear={handleClearVideo}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Видео + рекомендации */}
          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Video className="size-5 text-orange-500" />
                      Видеоанализ позы
                    </CardTitle>
                    <CardDescription>
                      Выберите кадр в НМТ (нижней мёртвой точке педали)
                    </CardDescription>
                  </div>
                  {analysis && (
                    <Badge className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                      {goodCount}/{totalCount} в норме
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <VideoAnalyzer
                  videoUrl={videoUrl}
                  onAnalyze={handleAnalyze}
                  analyzing={analyzing}
                  hasResults={!!analysis}
                  landmarksToDraw={landmarks}
                  connections={POSE_CONNECTIONS}
                  highlightAngles={highlightAngles}
                />
              </CardContent>
            </Card>

            <div className="lg:col-span-2">
              {analysis ? (
                <Recommendations analysis={analysis} />
              ) : (
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ListChecks className="size-5 text-orange-500" />
                      Рекомендации
                    </CardTitle>
                    <CardDescription>
                      Появятся после анализа позы
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                        <Target className="size-6 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Нажмите «Анализировать позу» на выбранном кадре,
                        чтобы получить рекомендации по посадке
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Ошибка детекции */}
          {detectError && (
            <Card className="border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20">
              <CardContent className="py-4">
                <div className="flex items-start gap-2 text-sm text-rose-700 dark:text-rose-400">
                  <AlertCircle className="size-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">
                      Не получилось проанализировать кадр
                    </p>
                    <p className="mt-1 text-xs">{detectError}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Результаты анализа */}
          {analysis && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="size-5 text-orange-500" />
                  Детальные метрики
                </CardTitle>
                <CardDescription>
                  Углы суставов с цветовой индикацией относительно нормы
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Видео-анализ всегда снимается сбоку — viewType фиксирован */}
                <ResultsPanel viewType="side" sideAnalysis={analysis} backAnalysis={null} frontAnalysis={null} />
              </CardContent>
            </Card>
          )}

          {/* Кнопка смены видео */}
          <div className="flex justify-center">
            <VideoUploader
              onVideoSelected={handleVideoSelected}
              currentVideoUrl={videoUrl}
              onClear={handleClearVideo}
            />
          </div>
        </div>
      )}
    </div>
  );
}
