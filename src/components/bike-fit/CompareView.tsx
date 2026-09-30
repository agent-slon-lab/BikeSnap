"use client";

import { useCallback, useState } from "react";
import {
  GitCompareArrows,
  ArrowDown,
  ArrowUp,
  ArrowRight,
  Minus,
  TrendingUp,
  AlertCircle,
  Loader2,
  ScanLine,
  Sparkles,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PhotoUploader } from "@/components/bike-fit/PhotoUploader";
import { PhotoAnalyzer } from "@/components/bike-fit/PhotoAnalyzer";
import { usePoseLandmarker } from "@/hooks/use-pose-landmarker";
import {
  analyzeBikeFit,
  POSE_LANDMARKS,
  type Point,
  type BikeFitAnalysis,
  type BackViewAnalysis,
  type FrontViewAnalysis,
  type ViewType,
} from "@/lib/bike-fit";

interface BeforeAfterState {
  url: string | null;
  landmarks: Point[] | null;
  analyzing: boolean;
  error: string | null;
}

interface BeforeAfterResult {
  side: BikeFitAnalysis | null;
  back: BackViewAnalysis | null;
  front: FrontViewAnalysis | null;
}

const INITIAL_STATE: BeforeAfterState = {
  url: null,
  landmarks: null,
  analyzing: false,
  error: null,
};

const INITIAL_RESULT: BeforeAfterResult = {
  side: null,
  back: null,
  front: null,
};

interface MetricDelta {
  label: string;
  before: number | null;
  after: number | null;
  delta: number | null; // after - before
  /** «улучшение» = отрицательная дельта (если меньше = лучше) или положительная (если больше = лучше) */
  betterWhen: "lower" | "higher" | "closerToTarget";
  target?: [number, number];
  unit: string;
  view: ViewType;
}

/**
 * Извлечь все метрики в плоский список для сравнения
 */
function extractMetrics(result: BeforeAfterResult): Array<{
  key: string;
  label: string;
  value: number;
  status: "good" | "warning" | "bad";
  target: [number, number];
  unit: string;
  view: ViewType;
}> {
  const metrics: Array<{
    key: string;
    label: string;
    value: number;
    status: "good" | "warning" | "bad";
    target: [number, number];
    unit: string;
    view: ViewType;
  }> = [];

  if (result.side) {
    const s = result.side;
    metrics.push({ key: "kneeAngle", label: "Угол колена", value: s.kneeAngle.value, status: s.kneeAngle.status, target: [s.kneeAngle.min, s.kneeAngle.max], unit: "°", view: "side" });
    metrics.push({ key: "hipAngle", label: "Угол бедра", value: s.hipAngle.value, status: s.hipAngle.status, target: [s.hipAngle.min, s.hipAngle.max], unit: "°", view: "side" });
    metrics.push({ key: "backAngle", label: "Наклон корпуса", value: s.backAngle.value, status: s.backAngle.status, target: [s.backAngle.min, s.backAngle.max], unit: "°", view: "side" });
    metrics.push({ key: "ankleAngle", label: "Угол голеностопа", value: s.ankleAngle.value, status: s.ankleAngle.status, target: [s.ankleAngle.min, s.ankleAngle.max], unit: "°", view: "side" });
    metrics.push({ key: "shoulderAngle", label: "Угол плеча", value: s.shoulderAngle.value, status: s.shoulderAngle.status, target: [s.shoulderAngle.min, s.shoulderAngle.max], unit: "°", view: "side" });
    metrics.push({ key: "kops", label: "KOPS", value: s.kops.value, status: s.kops.status, target: [s.kops.min, s.kops.max], unit: "", view: "side" });
  }
  if (result.back) {
    const b = result.back;
    metrics.push({ key: "shoulderTilt", label: "Наклон плеч", value: b.shoulderTilt.value, status: b.shoulderTilt.status, target: [b.shoulderTilt.min, b.shoulderTilt.max], unit: "", view: "back" });
    metrics.push({ key: "hipTilt", label: "Наклон таза", value: b.hipTilt.value, status: b.hipTilt.status, target: [b.hipTilt.min, b.hipTilt.max], unit: "", view: "back" });
    metrics.push({ key: "kneeHeightSymmetry", label: "Симметрия коленей", value: b.kneeHeightSymmetry.value, status: b.kneeHeightSymmetry.status, target: [b.kneeHeightSymmetry.min, b.kneeHeightSymmetry.max], unit: "", view: "back" });
    metrics.push({ key: "kneeDeviation", label: "Отклонение коленей", value: b.kneeDeviation.value, status: b.kneeDeviation.status, target: [b.kneeDeviation.min, b.kneeDeviation.max], unit: "", view: "back" });
  }
  if (result.front) {
    const f = result.front;
    metrics.push({ key: "gripWidth", label: "Ширина хвата", value: f.gripWidth.value, status: f.gripWidth.status, target: [f.gripWidth.min, f.gripWidth.max], unit: "×плеч", view: "front" });
    metrics.push({ key: "elbowSym", label: "Симметрия локтей", value: f.elbowAngleSymmetry.value, status: f.elbowAngleSymmetry.status, target: [f.elbowAngleSymmetry.min, f.elbowAngleSymmetry.max], unit: "", view: "front" });
  }
  return metrics;
}

/**
 * Вычислить дельту между «до» и «после»
 */
function computeDeltas(
  before: BeforeAfterResult,
  after: BeforeAfterResult
): MetricDelta[] {
  const beforeMetrics = extractMetrics(before);
  const afterMetrics = extractMetrics(after);

  // Если метрика есть только в одном из результатов — пропускаем
  const allKeys = new Set([
    ...beforeMetrics.map((m) => m.key),
    ...afterMetrics.map((m) => m.key),
  ]);

  const deltas: MetricDelta[] = [];
  for (const key of allKeys) {
    const b = beforeMetrics.find((m) => m.key === key);
    const a = afterMetrics.find((m) => m.key === key);
    if (!b || !a) continue;
    const beforeVal = b.value;
    const afterVal = a.value;
    const delta = afterVal - beforeVal;
    deltas.push({
      label: a.label,
      before: beforeVal,
      after: afterVal,
      delta,
      betterWhen: "closerToTarget",
      target: a.target,
      unit: a.unit,
      view: a.view,
    });
  }
  return deltas;
}

/**
 * Оценить, улучшилось ли значение (стало ближе к норме)
 */
function evaluateDelta(delta: MetricDelta): "improved" | "worsened" | "same" {
  if (delta.delta == null || delta.target == null) return "same";
  const [min, max] = delta.target;
  if (Math.abs(delta.delta) < 0.1) return "same";

  const beforeInTarget = delta.before != null && delta.before >= min && delta.before <= max;
  const afterInTarget = delta.after != null && delta.after >= min && delta.after <= max;

  if (!beforeInTarget && afterInTarget) return "improved";
  if (beforeInTarget && !afterInTarget) return "worsened";

  // Если оба в норме или оба вне — оцениваем близость к центру диапазона
  const center = (min + max) / 2;
  const beforeDist = delta.before != null ? Math.abs(delta.before - center) : 999;
  const afterDist = delta.after != null ? Math.abs(delta.after - center) : 999;
  if (afterDist < beforeDist) return "improved";
  if (afterDist > beforeDist) return "worsened";
  return "same";
}

interface CompareViewProps {
  /** Разделяемый landmarker */
  detectFn: (img: HTMLImageElement) => ReturnType<ReturnType<typeof usePoseLandmarker>["detect"]>;
  modelLoading: boolean;
  modelError: string | null;
}

export function CompareView({ detectFn, modelLoading, modelError }: CompareViewProps) {
  const [viewType, setViewType] = useState<ViewType>("side");
  const [beforeState, setBeforeState] = useState<BeforeAfterState>(INITIAL_STATE);
  const [afterState, setAfterState] = useState<BeforeAfterState>(INITIAL_STATE);
  const [beforeResult, setBeforeResult] = useState<BeforeAfterResult>(INITIAL_RESULT);
  const [afterResult, setAfterResult] = useState<BeforeAfterResult>(INITIAL_RESULT);

  const analyzeOne = useCallback(
    async (
      img: HTMLImageElement,
      state: BeforeAfterState,
      setState: (s: BeforeAfterState) => void,
      setResult: (r: BeforeAfterResult) => void
    ) => {
      if (modelLoading || modelError) {
        setState({
          ...state,
          error: modelError ?? "Модель ещё загружается, подождите...",
        });
        return;
      }
      setState({ ...state, analyzing: true, error: null });
      try {
        await new Promise((r) => setTimeout(r, 50));
        const result = detectFn(img);
        if (!result || !result.landmarks || result.landmarks.length === 0) {
          setState({
            ...state,
            analyzing: false,
            error: "Не удалось обнаружить позу на фото. Убедитесь, что велосипедист полностью виден.",
          });
          return;
        }
        const lms = result.landmarks[0] as Point[];
        let analysis: BeforeAfterResult = INITIAL_RESULT;
        if (viewType === "side") {
          const side = analyzeBikeFit(lms);
          analysis = { side, back: null, front: null };
        }
        // Для back/front пока просто сохраняем landmarks (анализ можно добавить)
        setState({
          ...state,
          analyzing: false,
          landmarks: lms,
          error: null,
        });
        setResult(analysis);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState({
          ...state,
          analyzing: false,
          error: `Ошибка анализа: ${msg}`,
        });
      }
    },
    [modelLoading, modelError, detectFn, viewType]
  );

  const deltas = computeDeltas(beforeResult, afterResult);
  const improvedCount = deltas.filter((d) => evaluateDelta(d) === "improved").length;
  const worsenedCount = deltas.filter((d) => evaluateDelta(d) === "worsened").length;
  const hasComparison = beforeResult.side && afterResult.side;

  return (
    <div className="space-y-6">
      <Card className="border-orange-200 dark:border-orange-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompareArrows className="size-5 text-orange-500" />
            Сравнение до и после настройки
          </CardTitle>
          <CardDescription>
            Загрузите 2 фото одного ракурса: до и после изменения посадки.
            Система автоматически вычислит дельту углов и покажет, что улучшилось.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Выбор ракурса */}
          <div className="mb-4 flex items-center gap-2">
            <span className="text-sm font-medium">Ракурс:</span>
            <div className="flex gap-1">
              {(["side", "back", "front"] as ViewType[]).map((v) => (
                <Button
                  key={v}
                  size="sm"
                  variant={viewType === v ? "default" : "outline"}
                  onClick={() => setViewType(v)}
                  className={viewType === v ? "bg-orange-500 hover:bg-orange-600" : ""}
                >
                  {v === "side" ? "Сбоку" : v === "back" ? "Сзади" : "Спереди"}
                </Button>
              ))}
            </div>
            <span className="ml-2 text-xs text-muted-foreground">
              (сейчас работает полный анализ только для «Сбоку»)
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* ДО */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                  ДО
                </Badge>
                <span className="text-sm text-muted-foreground">исходная посадка</span>
              </div>
              {!beforeState.url ? (
                <PhotoUploader
                  onPhotoSelected={(_f, url) => {
                    if (beforeState.url) URL.revokeObjectURL(beforeState.url);
                    setBeforeState({ ...INITIAL_STATE, url });
                    setBeforeResult(INITIAL_RESULT);
                  }}
                  currentPhotoUrl={beforeState.url}
                  onClear={() => {
                    if (beforeState.url) URL.revokeObjectURL(beforeState.url);
                    setBeforeState(INITIAL_STATE);
                    setBeforeResult(INITIAL_RESULT);
                  }}
                  label="Фото ДО"
                />
              ) : (
                <Card>
                  <CardContent className="py-4 space-y-3">
                    <PhotoAnalyzer
                      photoUrl={beforeState.url}
                      viewType={viewType}
                      onAnalyze={(img) =>
                        analyzeOne(img, beforeState, setBeforeState, setBeforeResult)
                      }
                      analyzing={beforeState.analyzing}
                      hasResults={!!beforeResult.side}
                      landmarks={beforeState.landmarks}
                    />
                    {beforeState.error && (
                      <div className="flex items-start gap-2 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
                        <AlertCircle className="size-4 mt-0.5 shrink-0" />
                        <span>{beforeState.error}</span>
                      </div>
                    )}
                    <div className="flex justify-center">
                      <PhotoUploader
                        onPhotoSelected={(_f, url) => {
                          if (beforeState.url) URL.revokeObjectURL(beforeState.url);
                          setBeforeState({ ...INITIAL_STATE, url });
                          setBeforeResult(INITIAL_RESULT);
                        }}
                        currentPhotoUrl={beforeState.url}
                        onClear={() => {
                          if (beforeState.url) URL.revokeObjectURL(beforeState.url);
                          setBeforeState(INITIAL_STATE);
                          setBeforeResult(INITIAL_RESULT);
                        }}
                      />
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* ПОСЛЕ */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                  ПОСЛЕ
                </Badge>
                <span className="text-sm text-muted-foreground">после настройки</span>
              </div>
              {!afterState.url ? (
                <PhotoUploader
                  onPhotoSelected={(_f, url) => {
                    if (afterState.url) URL.revokeObjectURL(afterState.url);
                    setAfterState({ ...INITIAL_STATE, url });
                    setAfterResult(INITIAL_RESULT);
                  }}
                  currentPhotoUrl={afterState.url}
                  onClear={() => {
                    if (afterState.url) URL.revokeObjectURL(afterState.url);
                    setAfterState(INITIAL_STATE);
                    setAfterResult(INITIAL_RESULT);
                  }}
                  label="Фото ПОСЛЕ"
                />
              ) : (
                <Card>
                  <CardContent className="py-4 space-y-3">
                    <PhotoAnalyzer
                      photoUrl={afterState.url}
                      viewType={viewType}
                      onAnalyze={(img) =>
                        analyzeOne(img, afterState, setAfterState, setAfterResult)
                      }
                      analyzing={afterState.analyzing}
                      hasResults={!!afterResult.side}
                      landmarks={afterState.landmarks}
                    />
                    {afterState.error && (
                      <div className="flex items-start gap-2 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
                        <AlertCircle className="size-4 mt-0.5 shrink-0" />
                        <span>{afterState.error}</span>
                      </div>
                    )}
                    <div className="flex justify-center">
                      <PhotoUploader
                        onPhotoSelected={(_f, url) => {
                          if (afterState.url) URL.revokeObjectURL(afterState.url);
                          setAfterState({ ...INITIAL_STATE, url });
                          setAfterResult(INITIAL_RESULT);
                        }}
                        currentPhotoUrl={afterState.url}
                        onClear={() => {
                          if (afterState.url) URL.revokeObjectURL(afterState.url);
                          setAfterState(INITIAL_STATE);
                          setAfterResult(INITIAL_RESULT);
                        }}
                      />
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* === Результаты сравнения === */}
      {hasComparison && (
        <Card className="border-emerald-200 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="size-5 text-emerald-600 dark:text-emerald-400" />
                  Дельта метрик
                </CardTitle>
                <CardDescription>
                  Сравнение «до» → «после» по всем метрикам
                </CardDescription>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <ArrowUp className="size-4" /> {improvedCount} лучше
                </span>
                <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400">
                  <ArrowDown className="size-4" /> {worsenedCount} хуже
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {deltas.map((delta, i) => {
                const evaluation = evaluateDelta(delta);
                const Icon =
                  evaluation === "improved"
                    ? ArrowUp
                    : evaluation === "worsened"
                      ? ArrowDown
                      : Minus;
                const colorClass =
                  evaluation === "improved"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : evaluation === "worsened"
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-muted-foreground";
                const sign = delta.delta != null && delta.delta > 0 ? "+" : "";
                return (
                  <div
                    key={i}
                    className={cn(
                      "rounded-lg border p-3",
                      evaluation === "improved"
                        ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30"
                        : evaluation === "worsened"
                          ? "border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/30"
                          : "border-border bg-muted/30"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">{delta.label}</span>
                      <Icon className={cn("size-4 shrink-0", colorClass)} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground uppercase">до</p>
                        <p className="text-sm font-bold tabular-nums">
                          {delta.before != null ? delta.before.toFixed(1) : "—"}
                          <span className="text-[10px] text-muted-foreground ml-0.5">
                            {delta.unit}
                          </span>
                        </p>
                      </div>
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground uppercase">после</p>
                        <p className="text-sm font-bold tabular-nums">
                          {delta.after != null ? delta.after.toFixed(1) : "—"}
                          <span className="text-[10px] text-muted-foreground ml-0.5">
                            {delta.unit}
                          </span>
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-muted-foreground uppercase">Δ</p>
                        <p className={cn("text-sm font-bold tabular-nums", colorClass)}>
                          {delta.delta != null
                            ? `${sign}${delta.delta.toFixed(1)}`
                            : "—"}
                        </p>
                      </div>
                    </div>
                    {delta.target && (
                      <p className="mt-1.5 text-[10px] text-muted-foreground">
                        норма {delta.target[0]}–{delta.target[1]}{delta.unit}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {!hasComparison && (beforeResult.side || afterResult.side) && (
        <Card className="border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
              <Sparkles className="size-4 shrink-0" />
              <p>
                Загрузите и проанализируйте оба фото (до и после), чтобы увидеть
                дельту метрик.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
