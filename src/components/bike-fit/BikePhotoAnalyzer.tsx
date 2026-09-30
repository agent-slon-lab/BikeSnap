"use client";

import { useCallback, useState } from "react";
import {
  Camera,
  ScanLine,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Wand2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PhotoUploader } from "@/components/bike-fit/PhotoUploader";
import { cn } from "@/lib/utils";

interface BikePhotoResult {
  saddleHeight: number | null;
  setback: number | null;
  ett: number | null;
  reach: number | null;
  stack: number | null;
  stem: number | null;
  crank: number | null;
  wheelHeight: number | null;
  bbHeight: number | null;
  confidence: "high" | "medium" | "low";
  notes: string;
}

interface BikePhotoAnalyzerProps {
  /** Callback при успешном распознавании параметров */
  onParamsDetected: (params: BikePhotoResult) => void;
}

const CONFIDENCE_INFO = {
  high: {
    label: "Высокая",
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-100 dark:bg-emerald-950/50",
    badge: "bg-emerald-500",
  },
  medium: {
    label: "Средняя",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-100 dark:bg-amber-950/50",
    badge: "bg-amber-500",
  },
  low: {
    label: "Низкая",
    color: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-100 dark:bg-rose-950/50",
    badge: "bg-rose-500",
  },
} as const;

const FIELD_INFO = {
  saddleHeight: { label: "Высота седла", abbr: "SH", unit: "см" },
  setback: { label: "Сдвиг седла назад", abbr: "SB", unit: "мм" },
  ett: { label: "Эфф. верхняя труба", abbr: "ETT", unit: "мм" },
  reach: { label: "Reach", abbr: "Reach", unit: "мм" },
  stack: { label: "Stack", abbr: "Stack", unit: "мм" },
  stem: { label: "Длина выноса", abbr: "ST", unit: "мм" },
  crank: { label: "Длина шатуна", abbr: "CR", unit: "мм" },
  wheelHeight: { label: "Радиус колеса", abbr: "WH", unit: "мм" },
  bbHeight: { label: "Высота каретки", abbr: "BBH", unit: "мм" },
} as const;

export function BikePhotoAnalyzer({ onParamsDetected }: BikePhotoAnalyzerProps) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<BikePhotoResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePhotoSelected = useCallback((file: File, url: string) => {
    setPhotoFile(file);
    setPhotoUrl(url);
    setResult(null);
    setError(null);
  }, []);

  const handleClear = useCallback(() => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    setPhotoFile(null);
    setResult(null);
    setError(null);
  }, [photoUrl]);

  const handleAnalyze = useCallback(async () => {
    if (!photoFile) return;

    setAnalyzing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("image", photoFile);

      const response = await fetch("/api/analyze-bike-photo", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          errorData?.error || `Сервер вернул статус ${response.status}`
        );
      }

      const data = await response.json();
      if (!data.success || !data.params) {
        throw new Error(data.error || "Неверный формат ответа сервера");
      }

      setResult(data.params);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Не удалось проанализировать фото: ${msg}`);
      setResult(null);
    } finally {
      setAnalyzing(false);
    }
  }, [photoFile]);

  const handleApply = useCallback(() => {
    if (result) {
      onParamsDetected(result);
      handleClear();
    }
  }, [result, onParamsDetected, handleClear]);

  return (
    <Card className="border-dashed">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Camera className="size-5 text-orange-500" />
          <div>
            <CardTitle className="text-base">Анализ фото велосипеда</CardTitle>
            <CardDescription>
              Загрузите фото велосипеда сбоку — AI автоматически определит
              параметры геометрии
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!photoUrl ? (
          <PhotoUploader
            onPhotoSelected={handlePhotoSelected}
            currentPhotoUrl={photoUrl}
            onClear={handleClear}
            label="Загрузите фото велосипеда сбоку"
          />
        ) : (
          <>
            <div className="relative w-full overflow-hidden rounded-xl border bg-black">
              <img
                src={photoUrl}
                alt="Фото велосипеда"
                className="block w-full h-auto max-h-[50vh] object-contain"
              />
              {analyzing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                  <div className="flex flex-col items-center gap-3 text-white">
                    <Loader2 className="size-10 animate-spin text-orange-400" />
                    <p className="text-sm font-medium">Анализирую велосипед...</p>
                    <p className="text-xs text-white/70">
                      Это может занять 10-20 секунд
                    </p>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {result && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge
                    className={cn(
                      CONFIDENCE_INFO[result.confidence].bg,
                      CONFIDENCE_INFO[result.confidence].color
                    )}
                  >
                    <Sparkles className="size-3 mr-1" />
                    Точность: {CONFIDENCE_INFO[result.confidence].label}
                  </Badge>
                  {result.notes && (
                    <span className="text-xs text-muted-foreground">
                      {result.notes}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(Object.keys(FIELD_INFO) as Array<keyof typeof FIELD_INFO>).map(
                    (key) => {
                      const value = result[key as keyof BikePhotoResult] as number | null;
                      const info = FIELD_INFO[key];
                      return (
                        <div
                          key={key}
                          className={cn(
                            "rounded-md border px-2 py-1.5",
                            value != null
                              ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900"
                              : "bg-muted/50 border-border"
                          )}
                        >
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {info.abbr}
                          </p>
                          <p className="text-sm font-semibold tabular-nums">
                            {value != null ? (
                              <>
                                {value}
                                <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">
                                  {info.unit}
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground/50 font-normal">—</span>
                            )}
                          </p>
                        </div>
                      );
                    }
                  )}
                </div>

                <p className="text-xs text-muted-foreground bg-muted/40 rounded-md p-2">
                  ℹ️ <b>BB Drop</b> рассчитается автоматически из Wheel Height и
                  BB Height. Углы STA/HTA не определяются по фото и не
                  требуются для посадки.
                </p>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    onClick={handleApply}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="size-4" />
                    Заполнить форму этими значениями
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleAnalyze}
                    disabled={analyzing}
                    className="sm:w-auto"
                  >
                    <ScanLine className="size-4" />
                    Пересчитать
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  После заполнения вы сможете отредактировать значения вручную
                </p>
              </div>
            )}

            {!result && !error && !analyzing && (
              <Button
                onClick={handleAnalyze}
                className="w-full bg-orange-500 hover:bg-orange-600"
                size="lg"
              >
                <Wand2 className="size-4" />
                Определить параметры по фото
              </Button>
            )}

            <div className="flex justify-center">
              <PhotoUploader
                onPhotoSelected={handlePhotoSelected}
                currentPhotoUrl={photoUrl}
                onClear={handleClear}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export type { BikePhotoResult };
