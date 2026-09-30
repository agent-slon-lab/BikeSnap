"use client";

import { useMemo } from "react";
import {
  Bike,
  Wrench,
  Hand,
  Zap,
  Frame,
  User,
  AlertCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useBikeStore } from "@/lib/bike-store";
import { calculateAll } from "@/lib/bike-calculations";
import { generateCrossReferences, type CrossReference } from "@/lib/bike-cross-ref";
import type { BikeFitAnalysis } from "@/lib/bike-fit";

interface CrossRefRecommendationsProps {
  sideAnalysis: BikeFitAnalysis | null;
}

const CATEGORY_ICONS = {
  saddle: Wrench,
  stem: Wrench,
  handlebar: Hand,
  cleats: Zap,
  frame: Frame,
  posture: User,
} as const;

const CATEGORY_LABELS = {
  saddle: "Седло",
  stem: "Вынос",
  handlebar: "Руль",
  cleats: "Шипы",
  frame: "Рама",
  posture: "Поза",
} as const;

const PRIORITY_STYLES = {
  1: { border: "border-rose-200 dark:border-rose-900", bg: "bg-rose-50/50 dark:bg-rose-950/20", text: "text-rose-600 dark:text-rose-400", badge: "Срочно" },
  2: { border: "border-amber-200 dark:border-amber-900", bg: "bg-amber-50/50 dark:bg-amber-950/20", text: "text-amber-600 dark:text-amber-400", badge: "Важно" },
  3: { border: "border-sky-200 dark:border-sky-900", bg: "bg-sky-50/50 dark:bg-sky-950/20", text: "text-sky-600 dark:text-sky-400", badge: "Желательно" },
} as const;

export function CrossRefRecommendations({ sideAnalysis }: CrossRefRecommendationsProps) {
  const { bike, body, bikeType, goal, complaints } = useBikeStore();

  const crossRefs = useMemo(() => {
    if (!sideAnalysis || !bikeType || !goal) return null;

    const calc = calculateAll(body, bike, { bikeType, goal });
    const result = generateCrossReferences(
      bike,
      body,
      { bikeType, goal },
      calc,
      sideAnalysis,
      complaints,
    );

    return result;
  }, [bike, body, bikeType, goal, complaints, sideAnalysis]);

  if (!crossRefs || crossRefs.crossReferences.length === 0) return null;

  return (
    <Card className="border-purple-200 dark:border-purple-900">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bike className="size-5 text-purple-500" />
              Комплексные рекомендации
            </CardTitle>
            <CardDescription>
              Связь геометрии рамы и позы велосипедиста
            </CardDescription>
          </div>
          <Badge variant="outline" className="bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400">
            {crossRefs.crossReferences.length} рекомендаций
          </Badge>
        </div>
        {/* Сводка по категориям */}
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.entries(crossRefs.summary).map(([cat, count]) => {
            if (count === 0) return null;
            const Icon = CATEGORY_ICONS[cat as keyof typeof CATEGORY_ICONS];
            return (
              <Badge key={cat} variant="outline" className="text-xs gap-1">
                <Icon className="size-3" />
                {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS]}: {count}
              </Badge>
            );
          })}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {crossRefs.crossReferences.map((ref, i) => {
          const Icon = CATEGORY_ICONS[ref.category];
          const style = PRIORITY_STYLES[ref.priority];
          return (
            <div
              key={i}
              className={cn(
                "rounded-lg border p-3 space-y-2",
                style.border,
                style.bg,
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Icon className={cn("size-4 shrink-0", style.text)} />
                  <span className={cn("text-sm font-semibold", style.text)}>
                    {ref.finding}
                  </span>
                </div>
                <Badge variant="outline" className={cn("text-[10px] shrink-0", style.text)}>
                  {style.badge}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground ml-6">
                <span className="font-medium">Связь:</span> {ref.connection}
              </p>
              <p className="text-sm ml-6 flex items-start gap-1.5">
                <span className={cn("font-bold", style.text)}>→</span>
                <span className="font-medium">{ref.action}</span>
              </p>
              <div className="flex flex-wrap gap-1 ml-6">
                {ref.sources.map((src, j) => (
                  <Badge key={j} variant="outline" className="text-[10px] py-0 px-1.5">
                    {src}
                  </Badge>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
