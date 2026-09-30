"use client";

import { Check, Target, Heart, Info } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  BIKE_TYPES,
  type BikeType,
} from "@/lib/bike-params";
import {
  useBikeStore,
  COMPLAINTS,
  type Complaint,
} from "@/lib/bike-store";

const GOALS = [
  {
    id: "comfort" as const,
    label: "Комфорт",
    emoji: "🛋️",
    description:
      "Длительные поездки без боли. Приоритет комфорту над скоростью.",
  },
  {
    id: "sport" as const,
    label: "Спорт",
    emoji: "🏆",
    description:
      "Тренировки, любительские гонки. Баланс между скоростью и выносливостью.",
  },
  {
    id: "race" as const,
    label: "Гонки",
    emoji: "🚀",
    description:
      "Максимальная аэродинамика и мощность. Готов жертвовать комфортом ради скорости.",
  },
];

export function OnboardingContext() {
  const {
    bikeType,
    goal,
    complaints,
    setBikeType,
    setGoal,
    toggleComplaint,
  } = useBikeStore();

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-8">
      {/* Шаг 1: Тип велосипеда */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-full bg-orange-500 text-white text-sm font-bold">
            1
          </div>
          <h2 className="text-xl font-semibold">Тип велосипеда</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-muted-foreground hover:text-foreground p-0.5">
                <Info className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-sm">
              <div className="space-y-1">
                <p className="text-xs font-medium">Зачем нужен тип велосипеда?</p>
                <p className="text-[11px] text-muted-foreground">
                  Тип определяет диапазоны нормы геометрии: угол подседельной трубы (STA), рулевой (HTA), соотношение Stack/Reach. На шоссе STA 73.5-74.5°, на MTB — 73-75°. Это влияет на рекомендации по настройке.
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(BIKE_TYPES) as BikeType[]).map((typeId) => {
            const type = BIKE_TYPES[typeId];
            const selected = bikeType === typeId;
            return (
              <Card
                key={typeId}
                role="button"
                tabIndex={0}
                onClick={() => setBikeType(typeId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setBikeType(typeId);
                  }
                }}
                className={cn(
                  "cursor-pointer gap-2 py-4 transition-all hover:scale-[1.02] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500",
                  selected
                    ? "border-orange-500 ring-2 ring-orange-500/30 bg-orange-50/50 dark:bg-orange-950/20"
                    : "hover:border-orange-300"
                )}
              >
                <CardContent className="px-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{type.emoji}</span>
                      <div>
                        <p className="font-semibold">{type.label}</p>
                        <p className="text-xs text-muted-foreground">
                          ETT {type.ettRange[0]}-{type.ettRange[1]} мм
                        </p>
                      </div>
                    </div>
                    {selected && (
                      <Check className="size-5 text-orange-500 shrink-0" />
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {type.description}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Шаг 2: Цель */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-full bg-orange-500 text-white text-sm font-bold">
            2
          </div>
          <h2 className="text-xl font-semibold">Цель посадки</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-muted-foreground hover:text-foreground p-0.5">
                <Info className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-sm">
              <div className="space-y-1">
                <p className="text-xs font-medium">Что такое цель посадки?</p>
                <p className="text-[11px] text-muted-foreground">
                  Цель определяет компромисс между аэродинамикой (низкая посадка = выше скорость) и комфортом (высокая посадка = меньше усталость). От цели зависят рекомендации по высоте седла, длине выноса, углу наклона корпуса.
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {GOALS.map((g) => {
            const selected = goal === g.id;
            return (
              <Card
                key={g.id}
                role="button"
                tabIndex={0}
                onClick={() => setGoal(g.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setGoal(g.id);
                  }
                }}
                className={cn(
                  "cursor-pointer gap-2 py-4 transition-all hover:scale-[1.02] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500",
                  selected
                    ? "border-orange-500 ring-2 ring-orange-500/30 bg-orange-50/50 dark:bg-orange-950/20"
                    : "hover:border-orange-300"
                )}
              >
                <CardContent className="px-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{g.emoji}</span>
                      <p className="font-semibold">{g.label}</p>
                    </div>
                    {selected && (
                      <Check className="size-5 text-orange-500 shrink-0" />
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {g.description}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Шаг 3: Жалобы */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-full bg-orange-500 text-white text-sm font-bold">
            3
          </div>
          <h2 className="text-xl font-semibold">
            Жалобы и дискомфорт
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              (можно выбрать несколько)
            </span>
          </h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-muted-foreground hover:text-foreground p-0.5">
                <Info className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-sm">
              <div className="space-y-1">
                <p className="text-xs font-medium">Зачем указывать жалобы?</p>
                <p className="text-[11px] text-muted-foreground">
                  Жалобы — главный сигнал для байк-фиттера. По ним определяются приоритетные настройки. Например, боль в колене спереди = седло слишком низко. Боль в шее = вынос слишком низко или посадка растянута.
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COMPLAINTS.map((c) => {
            const selected = complaints.includes(c.id as Complaint);
            return (
              <Card
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => toggleComplaint(c.id as Complaint)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleComplaint(c.id as Complaint);
                  }
                }}
                className={cn(
                  "cursor-pointer gap-2 py-3 transition-all hover:scale-[1.02] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500",
                  selected
                    ? "border-orange-500 ring-2 ring-orange-500/30 bg-orange-50/50 dark:bg-orange-950/20"
                    : "hover:border-orange-300"
                )}
              >
                <CardContent className="px-3">
                  <div className="flex flex-col items-center text-center gap-1">
                    <span className="text-2xl">{c.emoji}</span>
                    <p className="text-xs font-medium leading-tight">{c.label}</p>
                    {selected && (
                      <Check className="size-4 text-orange-500 mt-0.5" />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Образовательный блок */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-4">
          <div className="flex items-start gap-3 text-sm">
            <Target className="size-5 shrink-0 text-orange-500 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium">Зачем мы спрашиваем?</p>
              <p className="text-muted-foreground">
                Тип велосипеда определяет диапазоны нормы для геометрии
                (например, угол подседельной трубы 73-75° на шоссе против
                71-73° на MTB). Цель смещает баланс между аэродинамикой и
                комфортом. Жалобы указывают, на что обратить внимание при
                рекомендациях.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
    </TooltipProvider>
  );
}
