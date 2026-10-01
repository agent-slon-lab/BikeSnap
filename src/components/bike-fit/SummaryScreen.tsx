"use client";

import { useEffect, useState } from "react";
import {
  Bike,
  User,
  Target,
  ListChecks,
  CheckCircle2,
  Circle,
  Camera,
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
import { BIKE_TYPES, PARAM_CATEGORY_COLORS } from "@/lib/bike-params";
import { findWheelSize } from "@/lib/bike-perspective";
import {
  COMPLAINTS,
  useBikeStore,
  type OnboardingStep,
} from "@/lib/bike-store";
import { calculateAll } from "@/lib/bike-calculations";
import { StepGuide, type GuideStepDef } from "@/components/guide/step-guide";

// ============================================================
// КРАТКИЙ ТУР ШАГА 4 — одна плашка (v1.11.0). Один раз, автозапуск.
// ============================================================
const SUMMARY_GUIDE_KEY = "bikesnap-summary-guide-done";

const SUMMARY_GUIDE_STEPS: GuideStepDef[] = [
  {
    targetId: "summary-progress",
    title: "Коротко о шаге «Сводка»",
    text: "Шкала — готовность данных. Обязательны SH, WB и типоразмер колеса — остальное алгоритм возьмёт с фото. Клик по карточке — быстрый переход к редактированию. Дальше — «Далее: Анализ».",
    nextLabel: "Понятно, готово",
  },
];

export function SummaryScreen() {
  const {
    bikeType,
    goal,
    complaints,
    body,
    bike,
    setStep,
  } = useBikeStore();

  const riderGoal =
    bikeType && goal ? { bikeType, goal } : null;

  const calc = riderGoal ? calculateAll(body, bike, riderGoal) : null;

  const goalLabels = {
    comfort: { label: "Комфорт", emoji: "🛋️" },
    sport: { label: "Спорт", emoji: "🏆" },
    race: { label: "Гонки", emoji: "🚀" },
  };

  const checklist = [
    {
      label: "Тип велосипеда",
      done: !!bikeType,
      value: bikeType
        ? `${BIKE_TYPES[bikeType].emoji} ${BIKE_TYPES[bikeType].label}`
        : "Не выбран",
    },
    {
      label: "Цель посадки",
      done: !!goal,
      value: goal ? `${goalLabels[goal].emoji} ${goalLabels[goal].label}` : "Не выбрана",
    },
    {
      label: "Жалобы",
      done: complaints.length > 0,
      value:
        complaints.length === 0
          ? "Не выбраны"
          : complaints
              .map((c) => COMPLAINTS.find((x) => x.id === c)?.label)
              .filter(Boolean)
              .join(", "),
    },
    {
      label: "Рост",
      done: body.height > 0,
      value: body.height > 0 ? `${body.height} см` : "Не указан",
    },
    {
      label: "Внутренний шов (inseam)",
      done: body.inseam > 0,
      value: body.inseam > 0 ? `${body.inseam} см` : "Не указан",
    },
    {
      label: "Высота седла",
      done: !!bike.saddleHeight,
      value: bike.saddleHeight ? `${bike.saddleHeight} мм` : "Не указана",
    },
    {
      label: "Колёсная база (WB)",
      done: !!bike.wheelbase,
      value: bike.wheelbase ? `${bike.wheelbase} мм` : "Не указана",
    },
    {
      label: "ETT",
      done: !!bike.ett,
      value: bike.ett ? `${bike.ett} мм` : "Не указан",
    },
    {
      label: "Stem (вынос)",
      done: !!bike.stem,
      value: bike.stem ? `${bike.stem} мм` : "Не указана",
    },
    {
      label: "Угол выноса (α)",
      done: !!bike.stemAngle,
      value: bike.stemAngle != null ? `${bike.stemAngle}°` : "Не указан",
    },
    {
      label: "Длина шатуна",
      done: !!bike.crank,
      value: bike.crank ? `${bike.crank} мм` : "Не указана",
    },
    {
      label: "Радиус колеса (WH)",
      done: !!bike.wheelHeight,
      value: bike.wheelHeight ? `${bike.wheelHeight} мм` : "Не указан",
    },
    {
      label: "Высота каретки (BBH)",
      done: !!bike.bbHeight,
      value: bike.bbHeight ? `${bike.bbHeight} мм` : "Не указана",
    },
  ];

  const doneCount = checklist.filter((c) => c.done).length;
  const totalCount = checklist.length;
  const canProceedToAnalysis = doneCount === totalCount;

  // Обязательные для перехода к анализу — тот же гейт, что и в навигации
  // (SH — строгий масштаб, WB — fallback масштаба, WH — dual scale)
  const requiredReady =
    !!bike.saddleHeight && !!bike.wheelbase && !!bike.wheelHeight;

  // Типоразмер выводим из единственного поля WH (без отдельного контрола)
  const wheelGuess = bike.wheelHeight
    ? findWheelSize(null, bike.wheelHeight)
    : null;

  const goToStep = (step: OnboardingStep) => setStep(step);

  // Авто-старт одноплашечного тура сводки — один раз
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (localStorage.getItem(SUMMARY_GUIDE_KEY) !== "1") setGuideOpen(true);
      } catch {
        /* localStorage недоступен — тур просто не покажется */
      }
    }, 700);
    return () => clearTimeout(t);
  }, []);

  const finishGuide = () => {
    setGuideOpen(false);
    try {
      localStorage.setItem(SUMMARY_GUIDE_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="size-5 text-orange-500" />
            Сводка данных
          </CardTitle>
          <CardDescription>
            Проверьте введённые данные перед видеоанализом. Кликните по
            секции для редактирования.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Прогресс */}
          <div className="mb-6" id="summary-progress">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-sm font-medium">Готовность к анализу</span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {doneCount}/{totalCount}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  requiredReady
                    ? "bg-emerald-500"
                    : "bg-orange-500"
                )}
                style={{ width: `${(doneCount / totalCount) * 100}%` }}
              />
            </div>
          </div>

          {/* Контекстные бейджи распределены по карточкам (v1.12.0,
              шаг «Контекст» убран): цель и жалобы → в «Тело», тип → в «Велосипед» */}
          {/* Тело */}
          <button
            onClick={() => goToStep("body")}
            className="w-full text-left"
          >
            <Card className="hover:border-orange-300 hover:shadow-sm transition-all">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <User className="size-5 text-orange-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Тело райдера
                    </p>
                    {/* Цель и жалобы (v1.12.0 — переехали из убранного «Контекста») */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {goal ? (
                        <Badge variant="secondary">
                          {goalLabels[goal].emoji} {goalLabels[goal].label}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Цель не выбрана
                        </Badge>
                      )}
                      {complaints.length > 0 && (
                        <Badge variant="outline">
                          Жалоб: {complaints.length}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <DataCell label="Рост" value={body.height} unit="см" />
                      <DataCell label="Inseam" value={body.inseam} unit="см" />
                      {body.footLength && (
                        <DataCell
                          label="Стопа"
                          value={body.footLength}
                          unit="см"
                        />
                      )}
                      {body.armLength && (
                        <DataCell
                          label="Рука"
                          value={body.armLength}
                          unit="см"
                        />
                      )}
                      {body.torsoLength && (
                        <DataCell
                          label="Туловище"
                          value={body.torsoLength}
                          unit="см"
                        />
                      )}
                      {body.flexibility && (
                        <DataCell
                          label="Гибкость"
                          value={body.flexibility}
                          unit="/5"
                        />
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </button>

          {/* Велосипед */}
          <button
            onClick={() => goToStep("bike")}
            className="mt-3 w-full text-left"
          >
            <Card className="hover:border-orange-300 hover:shadow-sm transition-all">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <Target className="size-5 text-orange-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Велосипед
                    </p>
                    {/* Тип велика (v1.12.0 — переехал из убранного «Контекста») */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {bikeType ? (
                        <Badge variant="secondary">
                          {BIKE_TYPES[bikeType].emoji} {BIKE_TYPES[bikeType].label}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Тип не выбран
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <DataCell
                        label="SH"
                        value={bike.saddleHeight}
                        unit="мм"
                      />
                      <DataCell label="WB" value={bike.wheelbase} unit="мм" />
                      <DataCell label="ETT" value={bike.ett} unit="мм" />
                      <DataCell label="Stem" value={bike.stem} unit="мм" />
                      {bike.stemAngle != null && (
                        <DataCell label="α" value={bike.stemAngle} unit="°" />
                      )}
                      <DataCell label="CR" value={bike.crank} unit="мм" />
                      <DataCell label="WH" value={bike.wheelHeight} unit="мм" />
                      {/* Типоразмер — вычислен из WH, не отдельное поле */}
                      <div className="rounded-md border bg-muted/30 px-2 py-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Типоразмер
                        </p>
                        <p className="text-sm font-semibold tabular-nums">
                          {wheelGuess ? (
                            <span className="text-cyan-600 dark:text-cyan-400">
                              ≈ {wheelGuess.label}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50 font-normal">—</span>
                          )}
                        </p>
                      </div>
                      <DataCell label="BBH" value={bike.bbHeight} unit="мм" />
                    </div>

                    {/* Расчётные значения */}
                    {calc && (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-xs font-semibold uppercase tracking-wide text-orange-500 mb-2">
                          Рассчитано
                        </p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          <CalcCell
                            label="BB Drop"
                            value={calc.bbDrop}
                            unit="мм"
                          />
                          <CalcCell
                            label="Цел. SH"
                            value={calc.recommendedSaddleHeight}
                            unit="мм"
                          />
                          <CalcCell
                            label="Цел. Reach"
                            value={calc.targetReach}
                            unit="мм"
                          />
                          <CalcCell
                            label="Цел. Stack"
                            value={calc.targetStack}
                            unit="мм"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </button>

          {/* Чек-лист */}
          <div className="mt-6">
            <p className="text-sm font-medium mb-3">Чек-лист данных</p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {checklist.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-sm py-1"
                >
                  {item.done ? (
                    <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                  ) : (
                    <Circle className="size-4 text-muted-foreground/50 shrink-0" />
                  )}
                  <span className="text-muted-foreground">{item.label}:</span>
                  <span
                    className={cn(
                      "font-medium truncate",
                      item.done ? "text-foreground" : "text-muted-foreground/50"
                    )}
                  >
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {!requiredReady ? (
        <p className="text-center text-xs text-muted-foreground">
          Для анализа обязательны: SH (высота седла), WB (колёсная база) и WH (радиус
          колеса) — заполните их на шаге «Велосипед». Остальные данные ({doneCount}/{" "}
          {totalCount}) — по желанию, алгоритм вычислит их по фото.
        </p>
      ) : !canProceedToAnalysis ? (
        <p className="text-center text-xs text-muted-foreground">
          Обязательные поля заполнены — можно переходить к анализу. Не заполнено
          ещё {totalCount - doneCount} доп. полей: они будут вычислены по фото.
        </p>
      ) : null}

      {/* Краткий тур одной плашкой (один раз, см. SUMMARY_GUIDE_STEPS) */}
      {guideOpen && (
        <StepGuide steps={SUMMARY_GUIDE_STEPS} open onFinish={finishGuide} />
      )}
    </div>
  );
}

function DataCell({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | undefined;
  unit: string;
}) {
  return (
    <div className="rounded-md border bg-muted/30 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums">
        {value != null && value > 0 ? (
          <>
            {value}
            <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">
              {unit}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground/50 font-normal">—</span>
        )}
      </p>
    </div>
  );
}

function CalcCell({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | null | undefined;
  unit: string;
}) {
  const colors = PARAM_CATEGORY_COLORS.calculated;
  return (
    <div
      className={cn(
        "rounded-md border px-2 py-1.5",
        colors.bg,
        colors.border
      )}
    >
      <p className={cn("text-[10px] uppercase tracking-wide", colors.color)}>
        {label}
      </p>
      <p className={cn("text-sm font-semibold tabular-nums", colors.color)}>
        {value != null ? (
          <>
            {value}
            <span className="ml-0.5 text-[10px] font-normal opacity-70">
              {unit}
            </span>
          </>
        ) : (
          <span className="opacity-50">—</span>
        )}
      </p>
    </div>
  );
}
