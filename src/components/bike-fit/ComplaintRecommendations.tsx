"use client";

import { useMemo } from "react";
import {
  Lightbulb,
  ArrowRight,
  AlertTriangle,
  AlertOctagon,
  Info,
  CheckCircle2,
  Clock,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useBikeStore } from "@/lib/bike-store";
import {
  getCausesForComplaints,
  groupCausesByPriority,
  type CauseWithTrigger,
  type AnalysisResults,
} from "@/lib/bike-complaints";
import type { BikeFitAnalysis, BackViewAnalysis, FrontViewAnalysis } from "@/lib/bike-fit";

const PRIORITY_INFO = {
  1: {
    label: "Сначала сделайте это",
    icon: AlertOctagon,
    color: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-50 dark:bg-rose-950/40",
    border: "border-rose-200 dark:border-rose-900",
    badge: "bg-rose-500 text-white",
  },
  2: {
    label: "Если не помогло",
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    border: "border-amber-200 dark:border-amber-900",
    badge: "bg-amber-500 text-white",
  },
  3: {
    label: "Тонкая настройка",
    icon: Info,
    color: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-50 dark:bg-sky-950/40",
    border: "border-sky-200 dark:border-sky-900",
    badge: "bg-sky-500 text-white",
  },
} as const;

function CauseCard({
  cause,
  index,
}: {
  cause: CauseWithTrigger;
  index: number;
}) {
  const info = PRIORITY_INFO[cause.priority];
  const Icon = info.icon;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3 transition-all",
        info.bg,
        info.border,
        cause.triggered && "ring-2 ring-orange-400/50"
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          info.badge
        )}
      >
        {index + 1}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={cn("font-semibold", info.color)}>{cause.title}</span>
          {cause.triggered && (
            <Badge className="bg-orange-500 text-white text-[10px] gap-1">
              <AlertTriangle className="size-2.5" />
              Подтверждено фото
            </Badge>
          )}
          {cause.boosted && (
            <Badge className="bg-sky-500 text-white text-[10px] gap-1">
              <AlertTriangle className="size-2.5" />
              Повышено кросс-валидацией
            </Badge>
          )}
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <Clock className="size-3" />
            ~{cause.adaptationDays} дн.
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {cause.description}
        </p>
        {cause.crossNote && (
          <p className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs leading-relaxed text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
            {cause.crossNote}
          </p>
        )}
        <p className="mt-2 flex items-start gap-1.5 text-sm">
          <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-orange-500" />
          <span className="font-medium">{cause.action}</span>
        </p>
      </div>
      <Icon className={cn("size-4 shrink-0 mt-1", info.color)} />
    </div>
  );
}

interface ComplaintRecommendationsProps {
  /** Результаты анализа по ракурсам (для auto-trigger причин) */
  sideAnalysis?: BikeFitAnalysis | null;
  backAnalysis?: BackViewAnalysis | null;
  frontAnalysis?: FrontViewAnalysis | null;
}

export function ComplaintRecommendations({
  sideAnalysis = null,
  backAnalysis = null,
  frontAnalysis = null,
}: ComplaintRecommendationsProps) {
  const { complaints } = useBikeStore();

  const analysis: AnalysisResults = {
    side: sideAnalysis,
    back: backAnalysis,
    front: frontAnalysis,
  };

  const causes = useMemo(
    () => getCausesForComplaints(complaints, analysis),
    [complaints, analysis]
  );

  const grouped = useMemo(
    () => groupCausesByPriority(causes),
    [causes]
  );

  const hasComplaints = complaints.length > 0 && !complaints.includes("none");

  // Количество triggered причин
  const triggeredCount = causes.filter((c) => c.triggered).length;

  return (
    <Card className="gap-3">
      <CardHeader className="px-6">
        <div className="flex items-center gap-2">
          <Lightbulb className="size-5 text-orange-500" />
          <CardTitle>Рекомендации по жалобам</CardTitle>
        </div>
        {hasComplaints ? (
          <p className="text-sm text-muted-foreground">
            Жалоб: {complaints.length}. Найдено причин: {causes.length}
            {triggeredCount > 0 && (
              <Badge className="ml-2 bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
                {triggeredCount} подтверждены фото
              </Badge>
            )}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            На шаге 1 не выбраны жалобы — профилактические рекомендации на основе
            метрик.
          </p>
        )}
      </CardHeader>
      <CardContent className="px-6">
        {!hasComplaints ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/60">
              <CheckCircle2 className="size-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-sm text-muted-foreground">
              Жалоб нет. Если все метрики в норме — продолжайте кататься в
              текущей посадке. Если хотите более тонкую настройку — вернитесь
              на шаг 1 и укажите желаемую цель (например, «Гонки»).
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {([1, 2, 3] as const).map((priority) => {
              const items = grouped[priority];
              if (items.length === 0) return null;
              const info = PRIORITY_INFO[priority];
              const Icon = info.icon;
              return (
                <div key={priority} className="space-y-2">
                  <div className={cn("flex items-center gap-1.5", info.color)}>
                    <Icon className="size-3.5" />
                    <span className="text-xs font-semibold uppercase tracking-wide">
                      {info.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({items.length})
                    </span>
                  </div>
                  <div className="space-y-2">
                    {items.map((cause) => (
                      <CauseCard
                        key={`${cause.title}-${cause.priority}`}
                        cause={cause}
                        index={causes.indexOf(cause)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
