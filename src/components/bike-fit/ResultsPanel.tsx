"use client";

import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  AngleResult,
  BikeFitAnalysis,
  BackViewAnalysis,
  FrontViewAnalysis,
  SymmetryResult,
  ViewType,
} from "@/lib/bike-fit";

const STATUS_ICONS = {
  good: CheckCircle2,
  warning: AlertTriangle,
  bad: XCircle,
} as const;

/**
 * Карточка угла (для вида сбоку) — с диапазоном нормы в градусах
 */
function AngleCard({ result }: { result: AngleResult }) {
  const Icon = STATUS_ICONS[result.status];
  return (
    <Card
      className={cn(
        "gap-3 py-4 transition-colors ring-1",
        result.color.bg,
        result.color.border,
        result.color.ring
      )}
    >
      <CardHeader className="px-4">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-tight">
            {result.label}
          </CardTitle>
          <Icon className={cn("size-4 shrink-0", result.color.text)} />
        </div>
      </CardHeader>
      <CardContent className="px-4">
        <div className="flex items-baseline gap-2">
          <span className={cn("text-3xl font-bold tabular-nums", result.color.text)}>
            {result.value.toFixed(1)}°
          </span>
          <span className="text-xs text-muted-foreground">
            норма {result.min}–{result.max}°
          </span>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {result.description}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Карточка симметрии (для вида сзади/спереди) — с отклонением от идеала
 */
function SymmetryCard({ result }: { result: SymmetryResult }) {
  const Icon = STATUS_ICONS[result.status];
  // Для симметрии: чем меньше отклонение, тем лучше
  const percentage = Math.max(0, Math.min(100, (1 - result.deviation / result.max) * 100));
  return (
    <Card
      className={cn(
        "gap-3 py-4 transition-colors ring-1",
        result.color.bg,
        result.color.border,
        result.color.ring
      )}
    >
      <CardHeader className="px-4">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-tight">
            {result.label}
          </CardTitle>
          <Icon className={cn("size-4 shrink-0", result.color.text)} />
        </div>
      </CardHeader>
      <CardContent className="px-4">
        <div className="flex items-baseline gap-2">
          <span className={cn("text-3xl font-bold tabular-nums", result.color.text)}>
            {result.deviation.toFixed(1)}
          </span>
          <span className="text-xs text-muted-foreground">
            макс. {result.max}
          </span>
        </div>
        {/* Полоса симметрии — от 0 (плохо) до 100% (идеально) */}
        <div className="mt-3">
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "absolute h-full rounded-full transition-all",
                result.status === "good" && "bg-emerald-500",
                result.status === "warning" && "bg-amber-500",
                result.status === "bad" && "bg-rose-500"
              )}
              style={{ width: `${percentage}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>0 (асимметрия)</span>
            <span>идеально →</span>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {result.description}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Карточка ширины хвата руля (для вида спереди) — особый формат с ratio
 */
function GripWidthCard({ result }: { result: AngleResult }) {
  const Icon = STATUS_ICONS[result.status];
  return (
    <Card
      className={cn(
        "gap-3 py-4 transition-colors ring-1",
        result.color.bg,
        result.color.border,
        result.color.ring
      )}
    >
      <CardHeader className="px-4">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-tight">
            {result.label}
          </CardTitle>
          <Icon className={cn("size-4 shrink-0", result.color.text)} />
        </div>
      </CardHeader>
      <CardContent className="px-4">
        <div className="flex items-baseline gap-2">
          <span className={cn("text-3xl font-bold tabular-nums", result.color.text)}>
            ×{result.value.toFixed(2)}
          </span>
          <span className="text-xs text-muted-foreground">
            ширины плеч
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          норма {result.min}–{result.max}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {result.description}
        </p>
      </CardContent>
    </Card>
  );
}

interface SideResultsProps {
  analysis: BikeFitAnalysis;
}

export function SideResults({ analysis }: SideResultsProps) {
  const angles = [
    analysis.kneeAngle,
    analysis.hipAngle,
    analysis.backAngle,
    analysis.ankleAngle,
    analysis.shoulderAngle,
    analysis.kops,
  ];
  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-base font-semibold">Углы суставов</h4>
        <p className="text-xs text-muted-foreground">
          Сторона тела: {analysis.side === "left" ? "левая" : "правая"}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {angles.map((a, i) => (
          <AngleCard key={i} result={a} />
        ))}
      </div>
    </div>
  );
}

interface BackResultsProps {
  analysis: BackViewAnalysis;
}

export function BackResults({ analysis }: BackResultsProps) {
  const items = [
    analysis.shoulderTilt,
    analysis.hipTilt,
    analysis.kneeHeightSymmetry,
    analysis.kneeDeviation,
    analysis.headTilt,
    analysis.footSymmetry,
  ];
  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-base font-semibold">Симметрия тела</h4>
        <p className="text-xs text-muted-foreground">
          Отклонения от идеальной симметрии (в условных единицах)
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => (
          <SymmetryCard key={i} result={item} />
        ))}
      </div>
    </div>
  );
}

interface FrontResultsProps {
  analysis: FrontViewAnalysis;
}

export function FrontResults({ analysis }: FrontResultsProps) {
  const items: Array<{ kind: "angle" | "symmetry" | "grip"; result: AngleResult | SymmetryResult }> = [
    { kind: "grip", result: analysis.gripWidth },
    { kind: "symmetry", result: analysis.shoulderTilt },
    { kind: "symmetry", result: analysis.elbowPosition },
    { kind: "symmetry", result: analysis.headTilt },
    { kind: "symmetry", result: analysis.kneeSymmetry },
    { kind: "symmetry", result: analysis.elbowAngleSymmetry },
  ];
  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-base font-semibold">Симметрия и хват</h4>
        <p className="text-xs text-muted-foreground">
          Ширина хвата руля и симметрия тела
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) =>
          item.kind === "grip" ? (
            <GripWidthCard key={i} result={item.result as AngleResult} />
          ) : item.kind === "symmetry" ? (
            <SymmetryCard key={i} result={item.result as SymmetryResult} />
          ) : (
            <AngleCard key={i} result={item.result as AngleResult} />
          )
        )}
      </div>
    </div>
  );
}

interface ResultsPanelProps {
  viewType: ViewType;
  sideAnalysis: BikeFitAnalysis | null;
  backAnalysis: BackViewAnalysis | null;
  frontAnalysis: FrontViewAnalysis | null;
}

export function ResultsPanel({
  viewType,
  sideAnalysis,
  backAnalysis,
  frontAnalysis,
}: ResultsPanelProps) {
  if (viewType === "side" && sideAnalysis) {
    return <SideResults analysis={sideAnalysis} />;
  }
  if (viewType === "back" && backAnalysis) {
    return <BackResults analysis={backAnalysis} />;
  }
  if (viewType === "front" && frontAnalysis) {
    return <FrontResults analysis={frontAnalysis} />;
  }
  return null;
}
