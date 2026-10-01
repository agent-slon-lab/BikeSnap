"use client";

import { useState, useEffect } from "react";
import {
  Bike,
  ChevronRight,
  ChevronLeft,
  Moon,
  Sun,
  Settings,
  User,
  ListChecks,
  Info,
  Check,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  useBikeStore,
  type OnboardingStep,
} from "@/lib/bike-store";
import { APP_VERSION } from "@/lib/app-version";
import { WhatsNewDialog } from "@/components/whats-new/whats-new-dialog";
import { OnboardingBody } from "@/components/bike-fit/OnboardingBody";
import { BikeParametersForm } from "@/components/bike-fit/BikeParametersForm";
import { SummaryScreen } from "@/components/bike-fit/SummaryScreen";
import { PhotoAnalysisSection } from "@/components/bike-fit/PhotoAnalysisSection";
import { ModeSelectionScreen } from "@/components/bike-fit/ModeSelectionScreen";
import { ModelSelectionWizard } from "@/components/bike-fit/ModelSelectionWizard";
import { Camera } from "lucide-react";

const STEPS: Array<{
  id: OnboardingStep;
  label: string;
  shortLabel: string;
  icon: typeof Settings;
  description: string;
}> = [
  {
    id: "body",
    label: "Параметры тела",
    shortLabel: "Тело",
    icon: User,
    description: "Рост, inseam, цель и жалобы",
  },
  {
    id: "bike",
    label: "Параметры велосипеда",
    shortLabel: "Велосипед",
    icon: Settings,
    description: "Тип велика, размеры рамы и компоненты",
  },
  {
    id: "summary",
    label: "Сводка",
    shortLabel: "Сводка",
    icon: ListChecks,
    description: "Проверьте данные перед анализом",
  },
  {
    id: "analysis",
    label: "Фотоанализ позы",
    shortLabel: "Анализ",
    icon: Camera,
    description: "Анализ позы на фото (сбоку/сзади/спереди)",
  },
];

function isStepAccessible(
  step: OnboardingStep,
  state: ReturnType<typeof useBikeStore.getState>
): boolean {
  // v1.12.0: шаг «Контекст» убран — его поля переехали:
  // цель и жалобы → в «Тело», тип велика → в «Велосипед».
  if (step === "body") return true;
  if (step === "bike")
    return state.body.height > 0 && state.body.inseam > 0 && !!state.goal;
  // Для summary/analysis нужно: 3 обязательных поля (SH/WB/WH) + тип велика
  // (от него зависят диапазоны нормы геометрии и рекомендации):
  // - saddleHeight (SH) — строгий primary масштаб (userOverride) + проверка положения ног
  // - wheelbase (WB) — fallback масштаба фото (пиксели → мм)
  // - wheelHeight (WH) — dual scale (компенсация перспективы по двум колёсам)
  // Остальные (ETT, Stem, α, CR, BBH) — опциональны, алгоритм высчитает по фото
  const requiredBikeFields =
    !!state.bikeType &&
    !!state.bike.saddleHeight &&
    !!state.bike.wheelbase &&
    !!state.bike.wheelHeight;
  if (step === "summary") return requiredBikeFields;
  if (step === "analysis") return requiredBikeFields;
  return false;
}

export default function Home() {
  const store = useBikeStore();
  const { mode, step, setStep, resetMode } = store;
  const { resolvedTheme, setTheme } = useTheme();

  // ===== РЕЖИМ ВЫБОРА (mode === null) — стартовая страница =====
  if (!mode) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <Header />
        <main className="flex-1">
          <ModeSelectionScreen />
        </main>
        <Footer />
      </div>
    );
  }

  // ===== РЕЖИМ B (mode === "select") — подбор рамы =====
  if (mode === "select") {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <Header onLogoClick={resetMode} />
        <main className="flex-1">
          <ModelSelectionWizard />
        </main>
        <Footer />
      </div>
    );
  }

  // ===== РЕЖИМ A (mode === "fit") — настройка велосипеда =====
  const currentIndex = STEPS.findIndex((s) => s.id === step);
  const currentStep = STEPS[currentIndex];
  const prevStep = currentIndex > 0 ? STEPS[currentIndex - 1] : null;
  const nextStep =
    currentIndex < STEPS.length - 1 ? STEPS[currentIndex + 1] : null;

  const canGoNext = nextStep
    ? isStepAccessible(nextStep.id, store)
    : false;

  const canGoPrev = currentIndex > 0;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header onLogoClick={resetMode} />

      {/* Stepper */}
      <div className="border-b bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          {/* Desktop stepper */}
          <div className="hidden md:flex items-center justify-between">
            {STEPS.map((s, i) => {
              const accessible = isStepAccessible(s.id, store);
              const isActive = s.id === step;
              const isPast = i < currentIndex;
              const Icon = s.icon;
              return (
                <div
                  key={s.id}
                  className="flex items-center flex-1 last:flex-none"
                >
                  <button
                    onClick={() => accessible && setStep(s.id)}
                    disabled={!accessible}
                    className={cn(
                      "flex items-center gap-2 group",
                      accessible && "cursor-pointer",
                      !accessible && "cursor-not-allowed opacity-40"
                    )}
                  >
                    <div
                      className={cn(
                        "flex size-8 items-center justify-center rounded-full text-sm font-bold transition-all",
                        isActive
                          ? "bg-orange-500 text-white ring-4 ring-orange-500/30"
                          : isPast
                            ? "bg-emerald-500 text-white"
                            : "bg-muted text-muted-foreground border"
                      )}
                    >
                      {isPast ? (
                        <ChevronRight className="size-4" />
                      ) : (
                        <Icon className="size-4" />
                      )}
                    </div>
                    <div className="text-left">
                      <p
                        className={cn(
                          "text-xs font-medium leading-tight",
                          isActive && "text-orange-600 dark:text-orange-400"
                        )}
                      >
                        {s.shortLabel}
                      </p>
                      <p className="text-[10px] text-muted-foreground leading-tight">
                        Шаг {i + 1}
                      </p>
                    </div>
                  </button>
                  {i < STEPS.length - 1 && (
                    <div className="flex-1 mx-3 h-px bg-border relative">
                      {i < currentIndex && (
                        <div className="absolute inset-0 bg-emerald-500" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Mobile stepper */}
          <div className="md:hidden">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-semibold">{currentStep?.label}</p>
                <p className="text-xs text-muted-foreground">
                  {currentStep?.description}
                </p>
              </div>
              <Badge className="bg-orange-500">
                {currentIndex + 1}/{STEPS.length}
              </Badge>
            </div>
            {/* Шаги-вкладки (v1.11.0): как на десктопе — кликабельны.
                Раньше были просто черточки без переходов. */}
            <div className="flex gap-1">
              {STEPS.map((s, i) => {
                const accessible = isStepAccessible(s.id, store);
                const isActive = i === currentIndex;
                const isPast = i < currentIndex;
                return (
                  <button
                    key={s.id}
                    onClick={() => accessible && setStep(s.id)}
                    disabled={!accessible}
                    aria-label={`Шаг ${i + 1}: ${s.shortLabel}${accessible ? "" : " (пока недоступен)"}`}
                    aria-current={isActive ? "step" : undefined}
                    className={cn(
                      "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-0.5 py-1.5 transition-colors",
                      accessible ? "cursor-pointer active:bg-muted/60" : "cursor-not-allowed",
                      isActive && "bg-orange-500/10"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors",
                        isActive
                          ? "bg-orange-500 text-white ring-2 ring-orange-500/30"
                          : isPast
                            ? "bg-emerald-500 text-white"
                            : accessible
                              ? "border bg-muted text-muted-foreground"
                              : "border border-dashed bg-muted/50 text-muted-foreground/50"
                      )}
                    >
                      {isPast ? <Check className="size-3.5" /> : i + 1}
                    </span>
                    <span
                      className={cn(
                        "w-full truncate text-center text-[9px] leading-none",
                        isActive
                          ? "font-bold text-orange-600 dark:text-orange-400"
                          : "text-muted-foreground",
                        !accessible && "opacity-50"
                      )}
                    >
                      {s.shortLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        {/* Hero (только на первом шаге — теперь это «Тело») */}
        {step === "body" && (
          <section className="mb-8 text-center">
            <h1 className="mx-auto max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">
              Настройте посадку на велосипеде
              <span className="block text-orange-500">
                по науке и под себя
              </span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
              Пройдите 4 шага онбординга: параметры тела → размеры велосипеда
              → сводка → фотоанализ позы. Получите конкретные рекомендации в
              миллиметрах.
            </p>
          </section>
        )}

        {/* Контент шага */}
        <div className="mb-8">
          {step === "body" && <OnboardingBody />}
          {step === "bike" && <BikeParametersForm />}
          {step === "summary" && <SummaryScreen />}
          {step === "analysis" && <PhotoAnalysisSection />}
        </div>

        {/* Навигация */}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between border-t pt-6">
          <Button
            variant="outline"
            onClick={() => prevStep && setStep(prevStep.id)}
            disabled={!canGoPrev}
            className="sm:w-auto"
          >
            <ChevronLeft className="size-4" />
            {prevStep ? `Назад: ${prevStep.shortLabel}` : "Назад"}
          </Button>

          {nextStep ? (
            <Button
              onClick={() => nextStep && setStep(nextStep.id)}
              disabled={!canGoNext}
              className={cn(
                "sm:w-auto",
                canGoNext
                  ? "bg-orange-500 hover:bg-orange-600"
                  : "bg-muted text-muted-foreground"
              )}
            >
              Далее: {nextStep.shortLabel}
              <ChevronRight className="size-4" />
            </Button>
          ) : null}
        </div>

        {!canGoNext && nextStep && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Заполните обязательные поля на текущем шаге, чтобы продолжить
          </p>
        )}
      </main>

      <Footer />
    </div>
  );
}

// ============================================================
// SHARED COMPONENTS
// ============================================================

function Header({ onLogoClick }: { onLogoClick?: () => void }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <button
          onClick={onLogoClick}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          disabled={!onLogoClick}
        >
          <div className="flex size-8 items-center justify-center rounded-lg bg-orange-500 text-white">
            <Bike className="size-5" />
          </div>
          <div className="flex flex-col -space-y-0.5">
            <span className="text-sm font-bold leading-tight">BikeSnap</span>
            <span className="text-[10px] text-muted-foreground leading-tight">
              Анализ посадки велосипедиста
            </span>
          </div>
        </button>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            title="Переключить тему"
          >
            {mounted && resolvedTheme === "dark" ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}

const VISITED_KEY = "bikesnap-visited";
const SEEN_VERSION_KEY = "bikesnap-seen-version";

function Footer() {
  const [newsOpen, setNewsOpen] = useState(false);
  const [hasNews, setHasNews] = useState(false);

  // Координатор «Что нового» — вернулся в футер (v1.11.0), где и была
  // кнопка версии: новичку версия запоминается тихо, вернувшемуся
  // с непросмотренной версией — показываем диалог
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const visited = localStorage.getItem(VISITED_KEY) === "1";
        const unseen = localStorage.getItem(SEEN_VERSION_KEY) !== APP_VERSION;
        if (!visited) {
          localStorage.setItem(VISITED_KEY, "1");
          localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION);
        } else {
          setHasNews(unseen);
          if (unseen) setNewsOpen(true);
        }
      } catch {
        /* localStorage недоступен — попап просто не покажется */
      }
    }, 900);
    return () => clearTimeout(timer);
  }, []);

  const closeNews = (open: boolean) => {
    setNewsOpen(open);
    if (!open) {
      try {
        localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION);
      } catch {
        /* ignore */
      }
      setHasNews(false);
    }
  };

  return (
    <footer className="mt-auto border-t bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
            <Bike className="size-4 text-orange-500" />
            <span>
              BikeSnap · образовательный инструмент для велосипедистов
            </span>
          </div>
          {/* Кнопка версии «i» — снова в футере (v1.11.0), крупная и тапабельная,
              с пульс-точкой при непросмотренных новостях */}
          <button
            onClick={() => setNewsOpen(true)}
            title="Что нового в этой версии"
            aria-label="Что нового в этой версии"
            className="relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-orange-500/50 bg-orange-500/10 px-3.5 text-sm font-bold text-foreground shadow-sm transition-colors hover:bg-orange-500/20"
          >
            <Info className="size-[18px] text-orange-500" />
            <span className="tabular-nums">{APP_VERSION}</span>
            {hasNews && (
              <span className="absolute -right-1 -top-1 flex size-3.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                <span className="relative inline-flex size-3.5 rounded-full bg-orange-500 ring-2 ring-background" />
              </span>
            )}
          </button>
        </div>
        <p className="mt-3 max-w-md mx-auto text-center text-xs text-muted-foreground sm:mx-0 sm:ml-auto sm:text-right">
          Инструмент носит рекомендательный характер. Для профессионального
          фиттинга обратитесь к сертифицированному специалисту.
        </p>
      </div>

      {/* Диалог «Что нового» (открывается кнопкой версии) */}
      <WhatsNewDialog open={newsOpen} onOpenChange={closeNews} />
    </footer>
  );
}
