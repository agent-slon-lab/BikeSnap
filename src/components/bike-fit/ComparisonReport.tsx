"use client";

/**
 * ComparisonReport — сравнительный блок «Было ➔ Стало» (Re-fit Loop)
 * ===================================================================
 * ТЗ (v1.14.34, п. 6.3): в итоговом отчёте второго прогона показывать
 * таблицу изменений параметров:
 *
 *   | Метрика        | Прогон #1 (Было) | Прогон #2 (Стало) | Статус    |
 *   | Угол колена    | ~~176.3°~~       | **146.2°**        | Норма ✅  |
 *   | Наклон корпуса | ~~58.7°~~        | **42.1°**         | Норма ✅  |
 *
 * Старое значение зачёркнуто, новое — жирное; статус — по норме НОВОГО
 * значения (анатомический стандарт 180° из JOINT_NORMS). Наверху — краткая
 * сводка анкеты изменений (ReFitFeedbackModal → refitMeta).
 */

import { TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { BikeFitAnalysis } from "@/lib/bike-fit";
import type { RefitMeta } from "@/lib/photo-analysis-store";

interface ComparisonRow {
  key: string;
  label: string;
  before: number;
  after: number;
  /** Норма [min, max] нового значения */
  norm: [number, number];
  unit: string;
}

function buildRows(
  before: BikeFitAnalysis,
  after: BikeFitAnalysis
): ComparisonRow[] {
  return [
    {
      key: "knee",
      label: "Угол колена",
      before: before.kneeAngle.value,
      after: after.kneeAngle.value,
      norm: [after.kneeAngle.min, after.kneeAngle.max],
      unit: "°",
    },
    {
      key: "torso",
      label: "Наклон корпуса",
      before: before.backAngle.value,
      after: after.backAngle.value,
      norm: [after.backAngle.min, after.backAngle.max],
      unit: "°",
    },
    {
      key: "hip",
      label: "Угол бедра",
      before: before.hipAngle.value,
      after: after.hipAngle.value,
      norm: [after.hipAngle.min, after.hipAngle.max],
      unit: "°",
    },
    {
      key: "ankle",
      label: "Угол голеностопа",
      before: before.ankleAngle.value,
      after: after.ankleAngle.value,
      norm: [after.ankleAngle.min, after.ankleAngle.max],
      unit: "°",
    },
  ];
}

/** Краткое человекочитаемое описание анкеты изменений */
function describeMeta(meta: RefitMeta): string {
  const parts: string[] = [];
  if (meta.noChanges) parts.push("настройки не менял");
  if (meta.saddleChanged) {
    parts.push(
      meta.saddleDeltaMm != null
        ? `высота седла ${meta.saddleDeltaMm > 0 ? "+" : "−"}${Math.abs(meta.saddleDeltaMm)} мм`
        : "изменил высоту седла"
    );
  }
  if (meta.movedSaddleOrStem) parts.push("сдвинул седло / поменял вынос");
  const comfort =
    meta.comfort === "better"
      ? "стало лучше 😊"
      : meta.comfort === "same"
        ? "без изменений 😐"
        : "появилась боль 😖";
  return `${parts.length > 0 ? parts.join(", ") : "—"} · комфорт: ${comfort}`;
}

interface ComparisonReportProps {
  /** Анализ первого прогона (архив startRefit) */
  before: BikeFitAnalysis;
  /** Анализ второго (текущего) прогона */
  after: BikeFitAnalysis;
  /** Анкета изменений — опциональна (могла не дожить до refresh) */
  meta?: RefitMeta | null;
}

export function ComparisonReport({ before, after, meta }: ComparisonReportProps) {
  const rows = buildRows(before, after);
  const inNormCount = rows.filter(
    (r) => r.after >= r.norm[0] && r.after <= r.norm[1]
  ).length;

  return (
    <Card className="border-emerald-200 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="size-5 text-emerald-600 dark:text-emerald-400" />
          Сравнение «Было ➔ Стало»
        </CardTitle>
        <CardDescription>
          Прогон #1 — посадка до изменений, прогон #2 — текущая.
          {meta ? ` Изменения: ${describeMeta(meta)}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Горизонтальный скролл на узких экранах (телефон набок) */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Метрика</th>
                <th className="py-2 pr-3 font-medium">Прогон #1 (Было)</th>
                <th className="py-2 pr-3 font-medium">Прогон #2 (Стало)</th>
                <th className="py-2 pr-3 font-medium">Δ</th>
                <th className="py-2 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const afterInNorm = r.after >= r.norm[0] && r.after <= r.norm[1];
                const delta = r.after - r.before;
                return (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="py-2.5 pr-3 font-medium">{r.label}</td>
                    <td className="py-2.5 pr-3 tabular-nums text-muted-foreground">
                      <s>
                        {r.before.toFixed(1)}
                        {r.unit}
                      </s>
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums font-bold">
                      {r.after.toFixed(1)}
                      {r.unit}
                    </td>
                    <td
                      className={cn(
                        "py-2.5 pr-3 tabular-nums",
                        Math.abs(delta) < 0.05
                          ? "text-muted-foreground"
                          : delta < 0
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-amber-600 dark:text-amber-400"
                      )}
                    >
                      {delta > 0 ? "+" : ""}
                      {delta.toFixed(1)}
                      {r.unit}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                          afterInNorm
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        )}
                      >
                        {afterInNorm ? "Норма ✅" : `Вне нормы ⚠️ (${r.norm[0]}–${r.norm[1]}${r.unit})`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {inNormCount === rows.length
            ? "Все ключевые углы в норме — посадка соответствует эталону."
            : `${rows.length - inNormCount} из ${rows.length} углов вне нормы — рекомендации ниже подскажут, что поправить.`}
        </p>
      </CardContent>
    </Card>
  );
}
