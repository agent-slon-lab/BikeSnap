"use client";

/**
 * ReFitFeedbackModal — мини-анкета перед повторным замером посадки
 * =================================================================
 * ТЗ «Re-fit Loop» (v1.14.34, п. 6.2): перед переходом к камере
 * пользователь отмечает, ЧТО он изменил с прошлого замера:
 *   [ ] Изменил высоту седла (+/- мм)
 *   [ ] Сдвинул седло / поменял вынос
 *   [ ] Настройки не менял (повторный замер)
 * и фиксирует субъективный комфорт: [Стало лучше / Без изменений / Появилась боль].
 *
 * Ответы попадают в refitMeta стора и в заголовок блока сравнения
 * «Было → Стало» (ComparisonReport). Геометрия рамы (Шаг 2) НЕ сбрасывается —
 * архивируется только фото-анализ шага 4 (startRefit в photo-analysis-store).
 */

import { useEffect, useState } from "react";
import { Camera, RotateCcw, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { RefitMeta } from "@/lib/photo-analysis-store";

const COMFORT_OPTIONS: Array<{
  value: RefitMeta["comfort"];
  label: string;
  emoji: string;
}> = [
  { value: "better", label: "Стало лучше", emoji: "😊" },
  { value: "same", label: "Без изменений", emoji: "😐" },
  { value: "pain", label: "Появилась боль", emoji: "😖" },
];

interface ReFitFeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Подтверждение: анкета собрана — стартуем повторный замер */
  onConfirm: (meta: RefitMeta) => void;
}

export function ReFitFeedbackModal({
  open,
  onOpenChange,
  onConfirm,
}: ReFitFeedbackModalProps) {
  const [saddleChanged, setSaddleChanged] = useState(false);
  const [saddleDeltaRaw, setSaddleDeltaRaw] = useState("");
  const [movedSaddleOrStem, setMovedSaddleOrStem] = useState(false);
  const [noChanges, setNoChanges] = useState(false);
  const [comfort, setComfort] = useState<RefitMeta["comfort"] | null>(null);

  // Каждое открытие — чистая анкета (защита от протечки прошлого ответа)
  useEffect(() => {
    if (open) {
      setSaddleChanged(false);
      setSaddleDeltaRaw("");
      setMovedSaddleOrStem(false);
      setNoChanges(false);
      setComfort(null);
    }
  }, [open]);

  const toggleSaddle = (v: boolean) => {
    setSaddleChanged(v);
    if (v) setNoChanges(false);
  };
  const toggleMoved = (v: boolean) => {
    setMovedSaddleOrStem(v);
    if (v) setNoChanges(false);
  };
  const toggleNoChanges = (v: boolean) => {
    setNoChanges(v);
    if (v) {
      setSaddleChanged(false);
      setMovedSaddleOrStem(false);
      setSaddleDeltaRaw("");
    }
  };

  const canSubmit =
    comfort != null && (noChanges || saddleChanged || movedSaddleOrStem);

  const submit = () => {
    if (!canSubmit) return;
    let saddleDeltaMm: number | null = null;
    if (saddleChanged && saddleDeltaRaw.trim() !== "") {
      const parsed = Number(saddleDeltaRaw.replace(",", "."));
      if (Number.isFinite(parsed)) saddleDeltaMm = Math.round(parsed * 10) / 10;
    }
    onConfirm({
      saddleChanged,
      saddleDeltaMm,
      movedSaddleOrStem,
      noChanges,
      comfort: comfort!,
      startedAt: Date.now(),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="size-5 text-orange-500" />
            Повторный замер посадки
          </DialogTitle>
          <DialogDescription className="text-left">
            Отметьте, что изменилось с прошлого замера — это попадёт в
            сравнение «Было → Стало». Фото и разметка велосипеда (Шаг 2)
            сохранятся.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Чекбоксы изменений */}
          <div className="space-y-2.5">
            <label className="flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer hover:bg-muted/40">
              <Checkbox
                checked={saddleChanged}
                onCheckedChange={(v) => toggleSaddle(v === true)}
                className="mt-0.5"
              />
              <span className="text-sm leading-snug">
                Изменил высоту седла
                {saddleChanged && (
                  <span className="mt-1.5 flex items-center gap-2">
                    <Input
                      autoFocus
                      type="number"
                      step="any"
                      placeholder="+ поднял / − опустил, мм"
                      value={saddleDeltaRaw}
                      onChange={(e) => setSaddleDeltaRaw(e.target.value)}
                      className="h-8 w-44 text-sm"
                    />
                    <span className="text-xs text-muted-foreground">мм</span>
                  </span>
                )}
              </span>
            </label>

            <label className="flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer hover:bg-muted/40">
              <Checkbox
                checked={movedSaddleOrStem}
                onCheckedChange={(v) => toggleMoved(v === true)}
                className="mt-0.5"
              />
              <span className="text-sm leading-snug">
                Сдвинул седло / поменял вынос
              </span>
            </label>

            <label className="flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer hover:bg-muted/40">
              <Checkbox
                checked={noChanges}
                onCheckedChange={(v) => toggleNoChanges(v === true)}
                className="mt-0.5"
              />
              <span className="text-sm leading-snug">
                Настройки не менял (повторный замер)
              </span>
            </label>
          </div>

          {/* Комфорт */}
          <div>
            <p className="mb-2 text-sm font-medium">Субъективный комфорт:</p>
            <div className="grid grid-cols-3 gap-1.5">
              {COMFORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setComfort(opt.value)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-[11px] font-medium transition-colors",
                    comfort === opt.value
                      ? "border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-300"
                      : "hover:bg-muted/40"
                  )}
                >
                  <span className="text-lg leading-none">{opt.emoji}</span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              <X className="size-4" />
              Отмена
            </Button>
            <Button
              size="sm"
              disabled={!canSubmit}
              onClick={submit}
              className={cn(
                canSubmit
                  ? "bg-orange-500 hover:bg-orange-600"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <Camera className="size-4" />
              Перейти к съёмке
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
