"use client";

import { Lightbulb, ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { BikeFitAnalysis } from "@/lib/bike-fit";

interface RecommendationsProps {
  analysis: BikeFitAnalysis | null;
}

const PRIORITY_ORDER: Record<BikeFitAnalysis["kneeAngle"]["status"], number> = {
  bad: 0,
  warning: 1,
  good: 2,
};

export function Recommendations({ analysis }: RecommendationsProps) {
  if (!analysis) return null;

  // Собираем все метрики с отклонениями и сортируем по приоритету
  const items = [
    analysis.kneeAngle,
    analysis.hipAngle,
    analysis.backAngle,
    analysis.ankleAngle,
    analysis.shoulderAngle,
    analysis.kops,
  ]
    .filter((a) => a.status !== "good")
    .sort((a, b) => PRIORITY_ORDER[a.status] - PRIORITY_ORDER[b.status]);

  const allGood = items.length === 0;

  return (
    <Card className="gap-3">
      <CardHeader className="px-6">
        <div className="flex items-center gap-2">
          <Lightbulb className="size-5 text-orange-500" />
          <CardTitle>Рекомендации</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-6">
        {allGood ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/60">
              <Lightbulb className="size-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="font-medium text-emerald-700 dark:text-emerald-400">
                Отличная посадка!
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Все ключевые углы в пределах нормы. Можно продолжать
                тренироваться в текущей конфигурации.
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3",
                  item.color.bg,
                  item.color.border
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    item.status === "bad"
                      ? "bg-rose-500 text-white"
                      : "bg-amber-400 text-white"
                  )}
                >
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
                    <span className={cn("font-semibold", item.color.text)}>
                      {item.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      текущее {item.value.toFixed(1)}° · норма {item.min}–{item.max}°
                    </span>
                  </div>
                  <p className="mt-1 flex items-start gap-1.5 text-sm">
                    <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span>{item.recommendation}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
