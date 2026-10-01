"use client";

import { useMemo, useState } from "react";
import {
  ChevronRight,
  ChevronLeft,
  Search,
  ExternalLink,
  Star,
  Bike,
  Target,
  Check,
  Info,
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
  Sparkles,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
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
  findMatchingModels,
  getGoogleSearchUrl,
  type ModelMatchResult,
} from "@/lib/bike-models";
import {
  calcTargetReach,
  calcTargetStack,
  type BodyMeasurements,
} from "@/lib/bike-calculations";
import { useBikeStore } from "@/lib/bike-store";

const GOALS = [
  { id: "comfort" as const, label: "Комфорт", emoji: "🛋️", description: "Длительные поездки без боли" },
  { id: "sport" as const, label: "Спорт", emoji: "🏆", description: "Тренировки и любительские гонки" },
  { id: "race" as const, label: "Гонки", emoji: "🚀", description: "Максимальная аэродинамика" },
];

type WizardStep = 0 | 1 | 2 | 3;

// ============================================================
// ГЛАВНЫЙ КОМПОНЕНТ
// ============================================================

export function ModelSelectionWizard() {
  const store = useBikeStore();
  const { bikeType, goal, body, setBikeType, setGoal, setBody, resetMode } = store;

  const [step, setStep] = useState<WizardStep>(0);

  // Состояние тела — локальное, синхронизировано с store
  const [height, setHeight] = useState<number>(body.height || 0);
  const [inseam, setInseam] = useState<number>(body.inseam || 0);
  const [flexibility, setFlexibility] = useState<number>(body.flexibility || 3);

  // Сохраняем в store при изменении
  const syncBody = (updates: Partial<BodyMeasurements>) => {
    setBody(updates);
  };

  // Расчёт целевых параметров
  const targetReach = useMemo(() => {
    if (!bikeType || !goal || height <= 0) return null;
    return calcTargetReach(height, bikeType, goal);
  }, [bikeType, goal, height]);

  const targetStack = useMemo(() => {
    if (!bikeType || !goal || height <= 0) return null;
    return calcTargetStack(height, bikeType, goal);
  }, [bikeType, goal, height]);

  // Поиск подходящих моделей
  const matches = useMemo(() => {
    if (!bikeType || !targetStack || !targetReach) return [];
    return findMatchingModels(bikeType, targetStack, targetReach);
  }, [bikeType, targetStack, targetReach]);

  // Можно ли перейти к следующему шагу
  const canProceed = (() => {
    if (step === 0) return !!bikeType && !!goal;
    if (step === 1) return height > 0 && inseam > 0;
    if (step === 2) return targetReach != null && targetStack != null;
    if (step === 3) return true;
    return false;
  })();

  const handleNext = () => {
    if (step < 3 && canProceed) {
      setStep((step + 1) as WizardStep);
    }
  };

  const handlePrev = () => {
    if (step > 0) setStep((step - 1) as WizardStep);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <Button variant="ghost" onClick={resetMode} size="sm">
            <ChevronLeft className="size-4" />
            На главную
          </Button>
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
            Режим: Подбор рамы
          </Badge>
        </div>

        {/* Stepper */}
        <div className="mb-8">
          <div className="hidden sm:flex items-center justify-between">
            {[
              { n: 0, label: "Тип и цель" },
              { n: 1, label: "Тело" },
              { n: 2, label: "Целевая геометрия" },
              { n: 3, label: "Результаты" },
            ].map((s, i) => (
              <div key={s.n} className="flex items-center flex-1 last:flex-none">
                <button
                  onClick={() => s.n < step && setStep(s.n as WizardStep)}
                  disabled={s.n > step}
                  className={cn(
                    "flex items-center gap-2 group",
                    s.n <= step ? "cursor-pointer" : "cursor-not-allowed opacity-40"
                  )}
                >
                  <div
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full text-sm font-bold transition-all",
                      step === s.n
                        ? "bg-emerald-500 text-white ring-4 ring-emerald-500/30"
                        : s.n < step
                          ? "bg-emerald-500 text-white"
                          : "bg-muted text-muted-foreground border"
                    )}
                  >
                    {s.n < step ? <Check className="size-4" /> : s.n + 1}
                  </div>
                  <div className="text-left">
                    <p className={cn("text-xs font-medium", step === s.n && "text-emerald-600 dark:text-emerald-400")}>
                      {s.label}
                    </p>
                  </div>
                </button>
                {i < 3 && (
                  <div className="flex-1 mx-3 h-px bg-border relative">
                    {i < step && <div className="absolute inset-0 bg-emerald-500" />}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Mobile stepper */}
          <div className="sm:hidden">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">
                Шаг {step + 1} из 4
              </span>
              <span className="text-xs text-muted-foreground">
                {["Тип и цель", "Тело", "Целевая геометрия", "Результаты"][step]}
              </span>
            </div>
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors",
                    i === step
                      ? "bg-emerald-500"
                      : i < step
                        ? "bg-emerald-500"
                        : "bg-muted"
                  )}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Содержимое шага */}
        <div className="mb-6">
          {step === 0 && <Step1Context bikeType={bikeType} goal={goal} setBikeType={setBikeType} setGoal={setGoal} />}
          {step === 1 && (
            <Step2Body
              height={height}
              inseam={inseam}
              flexibility={flexibility}
              setHeight={(v) => { setHeight(v); syncBody({ height: v }); }}
              setInseam={(v) => { setInseam(v); syncBody({ inseam: v }); }}
              setFlexibility={(v) => { setFlexibility(v); syncBody({ flexibility: v }); }}
            />
          )}
          {step === 2 && (
            <Step3Target
              bikeType={bikeType}
              goal={goal}
              targetReach={targetReach}
              targetStack={targetStack}
              height={height}
              inseam={inseam}
            />
          )}
          {step === 3 && <Step4Results matches={matches} bikeType={bikeType} goal={goal} />}
        </div>

        {/* Навигация */}
        <div className="flex justify-between border-t pt-4">
          <Button variant="outline" onClick={handlePrev} disabled={step === 0}>
            <ChevronLeft className="size-4" />
            Назад
          </Button>
          {step < 3 ? (
            <Button
              onClick={handleNext}
              disabled={!canProceed}
              className={cn(
                "bg-emerald-500 hover:bg-emerald-600",
                !canProceed && "bg-muted text-muted-foreground hover:bg-muted"
              )}
            >
              Далее
              <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button variant="outline" onClick={resetMode}>
              Завершить
            </Button>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

// ============================================================
// ШАГ 1: Тип велосипеда и цель
// ============================================================

function Step1Context({
  bikeType, goal, setBikeType, setGoal,
}: {
  bikeType: BikeType | null;
  goal: "comfort" | "sport" | "race" | null;
  setBikeType: (t: BikeType) => void;
  setGoal: (g: "comfort" | "sport" | "race") => void;
}) {
  return (
    <div className="space-y-8">
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Bike className="size-5 text-emerald-500" />
          <h2 className="text-xl font-semibold">Тип велосипеда</h2>
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
                  "cursor-pointer gap-2 py-4 transition-all hover:scale-[1.02] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                  selected
                    ? "border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20"
                    : "hover:border-emerald-300"
                )}
              >
                <CardContent className="px-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{type.emoji}</span>
                      <div>
                        <p className="font-semibold">{type.label}</p>
                      </div>
                    </div>
                    {selected && <Check className="size-5 text-emerald-500 shrink-0" />}
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

      <section>
        <div className="mb-4 flex items-center gap-2">
          <Target className="size-5 text-emerald-500" />
          <h2 className="text-xl font-semibold">Цель посадки</h2>
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
                  "cursor-pointer gap-2 py-4 transition-all hover:scale-[1.02] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                  selected
                    ? "border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20"
                    : "hover:border-emerald-300"
                )}
              >
                <CardContent className="px-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{g.emoji}</span>
                      <p className="font-semibold">{g.label}</p>
                    </div>
                    {selected && <Check className="size-5 text-emerald-500 shrink-0" />}
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
    </div>
  );
}

// ============================================================
// ШАГ 2: Параметры тела
// ============================================================

function Step2Body({
  height, inseam, flexibility,
  setHeight, setInseam, setFlexibility,
}: {
  height: number;
  inseam: number;
  flexibility: number;
  setHeight: (v: number) => void;
  setInseam: (v: number) => void;
  setFlexibility: (v: number) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>Параметры тела</span>
        </CardTitle>
        <CardDescription>
          Введите измерения — на их основе рассчитаем целевую геометрию рамы
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Рост *</Label>
            <div className="relative">
              <Input
                type="number"
                inputMode="decimal"
                value={height || ""}
                onChange={(e) => setHeight(e.target.value === "" ? 0 : parseFloat(e.target.value))}
                placeholder="178"
                className="pr-12"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                см
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium flex items-center gap-1">
              Внутренний шов (inseam) *
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="inline-flex size-6 items-center justify-center rounded-full text-sky-500 transition-colors hover:text-sky-600 dark:text-sky-400 dark:hover:text-sky-300">
                    <Info className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p className="text-xs">Расстояние от паха до пола по внутренней стороне ноги, стоя в носках. Измерьте через книгу, прижатую к стене.</p>
                </TooltipContent>
              </Tooltip>
            </Label>
            <div className="relative">
              <Input
                type="number"
                inputMode="decimal"
                value={inseam || ""}
                onChange={(e) => setInseam(e.target.value === "" ? 0 : parseFloat(e.target.value))}
                placeholder="82"
                className="pr-12"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                см
              </span>
            </div>
          </div>
        </div>

        {/* Гибкость */}
        <div className="mt-6 space-y-3">
          <Label className="text-sm font-medium">Гибкость спины</Label>
          <Slider
            value={[flexibility]}
            min={1}
            max={5}
            step={1}
            onValueChange={(v) => setFlexibility(v[0])}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>1 — Плохо</span>
            <span>3 — Средне</span>
            <span>5 — Отлично</span>
          </div>
          <p className="text-xs text-muted-foreground">
            При низкой гибкости рекомендуется рама с большим Stack (более вертикальная посадка).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// ШАГ 3: Целевая геометрия
// ============================================================

function Step3Target({
  bikeType, goal, targetReach, targetStack, height, inseam,
}: {
  bikeType: BikeType | null;
  goal: "comfort" | "sport" | "race" | null;
  targetReach: number | null;
  targetStack: number | null;
  height: number;
  inseam: number;
}) {
  if (!bikeType || !goal) return null;

  const targetEtt = targetReach ? Math.round(targetReach + 165) : null; // приблизительно ETT ≈ Reach + 165 мм

  return (
    <div className="space-y-6">
      <Card className="bg-emerald-50/30 dark:bg-emerald-950/10 border-emerald-200 dark:border-emerald-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="size-5 text-emerald-500" />
            Целевые параметры рамы
          </CardTitle>
          <CardDescription>
            Рассчитано по вашим параметрам: рост {height} см, inseam {inseam} см, гибкость {3}/5,
            тип «{BIKE_TYPES[bikeType].label}», цель «{GOALS.find((g) => g.id === goal)?.label}»
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <TargetValue label="Stack" value={targetStack} unit="мм" description="Высота рамы" />
            <TargetValue label="Reach" value={targetReach} unit="мм" description="Длина рамы" />
            <TargetValue label="ETT" value={targetEtt} unit="мм" description="Эфф. верхняя труба" />
            {targetStack && targetReach && (
              <TargetValue
                label="SR Ratio"
                value={Math.round((targetStack / targetReach) * 100) / 100}
                unit=""
                description="Stack/Reach"
              />
            )}
          </div>

          {/* Расшифровка */}
          <div className="mt-6 space-y-2 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-background/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              Что это значит
            </p>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>• Ищите раму с Stack в диапазоне <b>{targetStack ? `${targetStack - 15}–${targetStack + 15}` : "—"}</b> мм</li>
              <li>• Reach в диапазоне <b>{targetReach ? `${targetReach - 15}–${targetReach + 15}` : "—"}</b> мм</li>
              <li>• ETT в диапазоне <b>{targetEtt ? `${targetEtt - 15}–${targetEtt + 15}` : "—"}</b> мм</li>
              <li>• Допускается корректировка выносом (±10–20 мм от целевого Reach)</li>
              <li>• Допускается корректировка проставками под выносом (±5–10 мм от целевого Stack)</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card className="border-dashed bg-muted/30">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            ⚠️ <b>Дисклеймер:</b> Это расчётные рекомендации по геометрии рамы.
            Мы не даём советов о покупке конкретной модели — только показываем
            какие рамы подходят под ваши параметры. Финальное решение принимаете вы.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function TargetValue({
  label, value, unit, description,
}: {
  label: string;
  value: number | null;
  unit: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
        {value != null ? (
          <>
            {value}
            <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>
          </>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground">{description}</p>
    </div>
  );
}

// ============================================================
// ШАГ 4: Результаты подбора
// ============================================================

function Step4Results({
  matches, bikeType, goal,
}: {
  matches: ModelMatchResult[];
  bikeType: BikeType | null;
  goal: "comfort" | "sport" | "race" | null;
}) {
  if (!bikeType) return null;

  return (
    <div className="space-y-4">
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Найдено моделей: {matches.length}</h2>
          <p className="text-sm text-muted-foreground">
            Сортировка: по соответствию целевым параметрам
          </p>
        </div>
        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
          {BIKE_TYPES[bikeType].emoji} {BIKE_TYPES[bikeType].label}
        </Badge>
      </div>

      {/* Карточки моделей */}
      {matches.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Нет подходящих моделей в базе. Попробуйте изменить тип велосипеда или параметры тела.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {matches.map((match, i) => (
            <ModelCard key={match.model.id} match={match} rank={i + 1} />
          ))}
        </div>
      )}

      {/* Дисклеймер */}
      <Card className="border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20">
        <CardContent className="py-3">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            ⚠️ Мы не продаём велосипеды и не даём рекомендаций о покупке.
            Используйте кнопку «Искать в Google» для самостоятельного поиска.
            Геометрия моделей может отличаться от года к году — сверяйтесь с
            официальной документацией производителя.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// КАРТОЧКА МОДЕЛИ
// ============================================================

function ModelCard({ match, rank }: { match: ModelMatchResult; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const { model, closestSize, score, distance, stackDelta, reachDelta } = match;

  // Цвет границы по score
  const borderColor = score === 5
    ? "border-emerald-500"
    : score === 4
      ? "border-emerald-400"
      : score === 3
        ? "border-amber-400"
        : score === 2
          ? "border-orange-400"
          : "border-rose-400";

  const bgColor = score === 5
    ? "bg-emerald-50/50 dark:bg-emerald-950/20"
    : score === 4
      ? "bg-emerald-50/30 dark:bg-emerald-950/10"
      : score === 3
        ? "bg-amber-50/30 dark:bg-amber-950/10"
        : "";

  return (
    <Card className={cn("transition-all hover:shadow-md", borderColor, bgColor)}>
      <CardContent className="py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* Левая часть: ранг + название модели */}
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white text-xs font-bold">
              {rank}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="font-semibold text-base truncate">{model.brand} {model.model}</h3>
                <Badge variant="outline" className="text-[10px]">
                  с {model.yearFrom}
                </Badge>
                <Badge variant="outline" className="text-[10px] uppercase">
                  {model.category}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{model.description}</p>

              {/* Звёзды соответствия */}
              <div className="mt-2 flex items-center gap-2">
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      className={cn(
                        "size-4",
                        s <= score
                          ? "fill-emerald-500 text-emerald-500"
                          : "fill-muted text-muted"
                      )}
                    />
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">
                  соответствие {score * 20}%
                </span>
              </div>
            </div>
          </div>

          {/* Правая часть: размер + кнопки */}
          <div className="flex flex-col items-end gap-2">
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Подходящий размер</p>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{closestSize.size}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? "Скрыть" : "Подробнее"}
              </Button>
              <Button
                asChild
                size="sm"
                className="bg-emerald-500 hover:bg-emerald-600"
              >
                <a
                  href={getGoogleSearchUrl(model.brand, model.model, model.yearFrom, closestSize.size)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Search className="size-3.5" />
                  Google
                  <ExternalLink className="size-3" />
                </a>
              </Button>
            </div>
          </div>
        </div>

        {/* Расширенная информация */}
        {expanded && (
          <div className="mt-4 pt-4 border-t space-y-3">
            {/* Параметры выбранного размера */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Геометрия размера {closestSize.size}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ParamCell label="Stack" value={closestSize.stack} unit="мм" delta={stackDelta} />
                <ParamCell label="Reach" value={closestSize.reach} unit="мм" delta={reachDelta} />
                {closestSize.ett && <ParamCell label="ETT" value={closestSize.ett} unit="мм" />}
                {closestSize.sta && <ParamCell label="STA" value={closestSize.sta} unit="°" />}
                {closestSize.hta && <ParamCell label="HTA" value={closestSize.hta} unit="°" />}
                {closestSize.wb && <ParamCell label="WB" value={closestSize.wb} unit="мм" />}
                {closestSize.bbDrop && <ParamCell label="BB Drop" value={closestSize.bbDrop} unit="мм" />}
                {closestSize.stLength && <ParamCell label="ST" value={closestSize.stLength} unit="мм" />}
              </div>
            </div>

            {/* Дельта */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Отклонение от целевых значений
              </p>
              <div className="grid grid-cols-2 gap-2">
                <DeltaCell label="Stack" delta={stackDelta} />
                <DeltaCell label="Reach" delta={reachDelta} />
              </div>
            </div>

            {/* Все размеры модели */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Все доступные размеры
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1 px-2">Размер</th>
                      <th className="text-right py-1 px-2">Stack</th>
                      <th className="text-right py-1 px-2">Reach</th>
                      {model.sizes[0]?.ett && <th className="text-right py-1 px-2">ETT</th>}
                      {model.sizes[0]?.sta && <th className="text-right py-1 px-2">STA</th>}
                      {model.sizes[0]?.hta && <th className="text-right py-1 px-2">HTA</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {model.sizes.map((s) => (
                      <tr
                        key={s.size}
                        className={cn(
                          "border-b",
                          s.size === closestSize.size && "bg-emerald-50 dark:bg-emerald-950/30 font-semibold"
                        )}
                      >
                        <td className="py-1 px-2">{s.size}</td>
                        <td className="text-right py-1 px-2 tabular-nums">{s.stack}</td>
                        <td className="text-right py-1 px-2 tabular-nums">{s.reach}</td>
                        {s.ett && <td className="text-right py-1 px-2 tabular-nums">{s.ett}</td>}
                        {s.sta && <td className="text-right py-1 px-2 tabular-nums">{s.sta}°</td>}
                        {s.hta && <td className="text-right py-1 px-2 tabular-nums">{s.hta}°</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ParamCell({
  label, value, unit, delta,
}: {
  label: string;
  value: number;
  unit: string;
  delta?: number;
}) {
  return (
    <div className="rounded-md border bg-background px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">
        {value}
        <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{unit}</span>
      </p>
      {delta != null && (
        <p
          className={cn(
            "text-[10px]",
            Math.abs(delta) < 5
              ? "text-emerald-600 dark:text-emerald-400"
              : Math.abs(delta) < 15
                ? "text-amber-600 dark:text-amber-400"
                : "text-rose-600 dark:text-rose-400"
          )}
        >
          {delta > 0 ? "+" : ""}{delta} мм
        </p>
      )}
    </div>
  );
}

function DeltaCell({ label, delta }: { label: string; delta: number }) {
  const isGood = Math.abs(delta) < 5;
  const isOk = Math.abs(delta) < 15;
  const Icon = Math.abs(delta) < 1 ? ArrowUpDown : delta > 0 ? ArrowUp : ArrowDown;
  const color = isGood
    ? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900"
    : isOk
      ? "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900"
      : "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900";

  return (
    <div className={cn("rounded-md border px-3 py-2", color)}>
      <p className="text-[10px] uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-sm font-semibold flex items-center gap-1">
        <Icon className="size-3.5" />
        {delta > 0 ? "+" : ""}{delta} мм
      </p>
    </div>
  );
}
