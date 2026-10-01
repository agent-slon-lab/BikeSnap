"use client";

import {
  Bike,
  Wrench,
  Search,
  ChevronRight,
  Sparkles,
  History,
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
import { useBikeStore, type OnboardingStep } from "@/lib/bike-store";
import { BIKE_MODELS, getModelCountByType } from "@/lib/bike-models";

const FIT_STEP_LABELS: Record<OnboardingStep, string> = {
  body: "Тело",
  bike: "Велосипед",
  summary: "Сводка",
  analysis: "Анализ",
};
const SELECT_STEP_LABELS = [
  "Тип и цель",
  "Тело",
  "Целевая геометрия",
  "Результаты",
];

export function ModeSelectionScreen() {
  const {
    setMode,
    reset,
    body,
    goal,
    complaints,
    bike,
    bikeType,
    selectStep,
    step,
  } = useBikeStore();
  const counts = getModelCountByType();
  const totalModels = BIKE_MODELS.length;

  // Новый сценарий = чистое состояние: сбрасываем ВСЁ, что осталось от
  // предыдущего прохода (тип/цель/жалобы/тело/параметры велика/колесо),
  // иначе при «создании нового» протекали старые данные (stale state).
  // Библиотеки великов и райдеров сохраняются — их подгрузит шаг 2/3.
  const handleSelectMode = (mode: "fit" | "select") => {
    reset();
    setMode(mode);
  };

  // ===== v1.13.0: «Продолжить с того же места» =====
  // Прогресс есть? (данные сценариев сохранены в bikefit-storage)
  const hasSelectProgress =
    selectStep > 0 && (!!bikeType || !!goal || body.height > 0);
  const hasFitProgress =
    body.height > 0 ||
    body.inseam > 0 ||
    !!goal ||
    complaints.length > 0 ||
    !!bike.saddleHeight ||
    !!bike.wheelbase ||
    !!bike.wheelHeight;
  // Сценарии взаимоисключаемы (карточка режима сбрасывает всё), но body/goal
  // общие — при прогрессе подбора рамы показываем только его, чтобы не путать
  const resumeSelect = hasSelectProgress;
  const resumeFit = !hasSelectProgress && hasFitProgress;

  const handleResume = () => {
    // Без reset() — возвращаемся ровно на сохранённый шаг (mode/step/selectStep
    // восстановились из bikefit-storage при загрузке страницы)
    setMode(resumeSelect ? "select" : "fit");
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* v1.13.0: баннер «Продолжить» — если есть незавершённый сценарий */}
      {(resumeFit || resumeSelect) && (
        <div className="mb-6 rounded-xl border border-orange-500/40 bg-orange-500/5 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-orange-500/15">
                <History className="size-5 text-orange-500" />
              </div>
              <div>
                <p className="text-sm font-bold">
                  Продолжить с того места, где остановились
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {resumeSelect
                    ? `Подбор рамы · шаг ${selectStep + 1} из 4 «${SELECT_STEP_LABELS[selectStep] ?? "—"}» — все данные сохранены`
                    : `Настройка велосипеда · шаг «${FIT_STEP_LABELS[step]}» — все данные сохранены`}
                </p>
              </div>
            </div>
            <Button
              onClick={handleResume}
              className="shrink-0 bg-orange-500 hover:bg-orange-600"
            >
              Продолжить
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Hero */}
      <div className="mb-10 text-center">
        <div className="mb-4 flex justify-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-500/30">
            <Bike className="size-9" />
          </div>
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
          BikeSnap
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">
          Помогаем велосипедистам с посадкой и подбором велосипеда.
          Выберите подходящий режим.
        </p>
      </div>

      {/* Две карточки режимов */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Режим A: Настроить велосипед */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => handleSelectMode("fit")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleSelectMode("fit");
            }
          }}
          className="group cursor-pointer transition-all hover:scale-[1.02] hover:border-orange-400 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
        >
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex size-12 items-center justify-center rounded-xl bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400">
                <Wrench className="size-6" />
              </div>
              <Badge variant="outline" className="bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400">
                4 шага
              </Badge>
            </div>
            <CardTitle className="mt-4 text-xl">Настроить мой велосипед</CardTitle>
            <CardDescription>
              У вас уже есть велосипед — улучшите посадку под себя
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-orange-500" />
                <span>Ввод параметров тела и велосипеда</span>
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-orange-500" />
                <span>Фото велосипеда для автозаполнения</span>
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-orange-500" />
                <span>Фотоанализ позы с 3 ракурсов</span>
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-orange-500" />
                <span>Рекомендации по жалобам и целям</span>
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-orange-500" />
                <span>Сравнение «до и после» настройки</span>
              </li>
            </ul>
            <Button className="w-full bg-orange-500 hover:bg-orange-600 group-hover:bg-orange-600">
              Начать настройку
              <ChevronRight className="size-4" />
            </Button>
            {(resumeFit || resumeSelect) && (
              <p className="text-center text-[11px] text-muted-foreground">
                Начать заново — сохранённый прогресс будет удалён
              </p>
            )}
          </CardContent>
        </Card>

        {/* Режим B: Подобрать раму */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => handleSelectMode("select")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleSelectMode("select");
            }
          }}
          className="group cursor-pointer transition-all hover:scale-[1.02] hover:border-emerald-400 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex size-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                <Search className="size-6" />
              </div>
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                4 шага
              </Badge>
            </div>
            <CardTitle className="mt-4 text-xl">Подобрать раму</CardTitle>
            <CardDescription>
              Хотите купить велосипед — узнайте, какая геометрия подойдёт
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                <span>Укажите тип велосипеда и цель</span>
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                <span>Введите параметры тела (рост, inseam, гибкость)</span>
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                <span>Получите целевые Stack/Reach/ETT</span>
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                <span>Список моделей с рейтингом соответствия</span>
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                <span>Кнопка «Искать в Google» для каждой модели</span>
              </li>
            </ul>
            <Button className="w-full bg-emerald-500 hover:bg-emerald-600 group-hover:bg-emerald-600">
              Подобрать раму
              <ChevronRight className="size-4" />
            </Button>
            {(resumeFit || resumeSelect) && (
              <p className="text-center text-[11px] text-muted-foreground">
                Начать заново — сохранённый прогресс будет удалён
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Информация о базе моделей */}
      <div className="mt-8 rounded-xl border border-dashed bg-muted/30 p-4 text-center">
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="size-4 text-orange-500" />
          <span>
            База содержит <b className="text-foreground">{totalModels}</b> моделей
            от {Object.keys({
              Specialized: 1,
              Trek: 1,
              Giant: 1,
              Cannondale: 1,
              Canyon: 1,
              Cervélo: 1,
              Merida: 1,
              Pinarello: 1,
            }).length} брендов: {counts.road} шоссе · {counts.gravel} грэвел ·{" "}
            {counts.mtb} MTB · {counts.hybrid + counts.city} городских
          </span>
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Мы не продаём велосипеды и не даём рекомендаций о покупке.
          Только геометрические параметры для самостоятельного выбора.
        </p>
      </div>
    </div>
  );
}
