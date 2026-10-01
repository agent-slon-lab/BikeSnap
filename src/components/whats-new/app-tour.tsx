"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Bike,
  Compass,
  User,
  Camera,
  Activity,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export interface TourSlide {
  icon: typeof Bike;
  title: string;
  text: string;
}

export const TOUR_SLIDES: TourSlide[] = [
  {
    icon: Bike,
    title: "Привет! Это BikeSnap",
    text: "AI-анализ посадки на велосипеде по фото: измеряем углы и переводим их в конкретные рекомендации в миллиметрах.",
  },
  {
    icon: Compass,
    title: "Два режима",
    text: "«Настройка посадки» — полный цикл из 5 шагов: контекст, тело, велосипед, сводка, анализ. «Подбор рамы» — быстрый гид по размеру рамы под твои параметры.",
  },
  {
    icon: User,
    title: "Твой ввод — эталон",
    text: "Рост, inseam, высота седла и колёса вводятся вручную и остаются неприкосновенными: все расчёты строятся вокруг них, а не «угадывают».",
  },
  {
    icon: Camera,
    title: "Съёмка через объектив",
    text: "Телефон — горизонтально, велосипед строго сбоку, оба колеса целиком в кадре. В видоискателе — живая подсказка колёс и авто-спуск 3-2-1, когда ракурс правильный.",
  },
  {
    icon: Activity,
    title: "Анализ и отчёт",
    text: "Углы колена, бедра и спины + рекомендации по седлу и рулю. Что-то распозналось криво? Скачай отчёт для отладки в шаге «Анализ» и передай его разработчику.",
  },
];

interface AppTourProps {
  open: boolean;
  /** done=true — тур пройден (пометить как просмотренный); false — просто закрыт */
  onClose: (done: boolean) => void;
}

/**
 * Краткий тур по приложению для новых пользователей: 5 слайдов,
 * точечная навигация, «Пропустить». Авто-показ на первом визите
 * управляется координатором (футер).
 */
export function AppTour({ open, onClose }: AppTourProps) {
  const [index, setIndex] = useState(0);
  const last = index === TOUR_SLIDES.length - 1;
  const slide = TOUR_SLIDES[index];
  const Icon = slide.icon;

  const go = (delta: number) =>
    setIndex((i) => Math.min(TOUR_SLIDES.length - 1, Math.max(0, i + delta)));

  const finish = () => {
    setIndex(0);
    onClose(true);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setIndex(0);
          onClose(false);
        }
      }}
    >
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-xl p-0">
        <DialogHeader className="px-6 pb-0 pt-6 text-left">
          <DialogTitle className="sr-only">Краткий тур по BikeSnap</DialogTitle>
          <DialogDescription asChild>
            <div className="flex items-center justify-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-orange-500/10">
                <Icon className="size-7 text-orange-500" />
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 text-center">
          <p className="text-lg font-bold tracking-tight">{slide.title}</p>
          <p className="mt-2 min-h-[72px] text-sm leading-relaxed text-muted-foreground">
            {slide.text}
          </p>
        </div>

        {/* Точки прогресса */}
        <div className="flex items-center justify-center gap-1.5 py-2">
          {TOUR_SLIDES.map((_, i) => (
            <button
              key={i}
              aria-label={`Слайд ${i + 1}`}
              onClick={() => setIndex(i)}
              className={cn(
                "h-2 rounded-full transition-all",
                i === index
                  ? "w-6 bg-orange-500"
                  : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
              )}
            />
          ))}
        </div>

        <div className="flex items-center gap-2 border-t px-5 py-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={finish}
          >
            Пропустить
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {index > 0 && (
              <Button variant="outline" size="sm" onClick={() => go(-1)}>
                <ChevronLeft className="size-4" />
                Назад
              </Button>
            )}
            {last ? (
              <Button
                size="sm"
                className="bg-orange-500 hover:bg-orange-600"
                onClick={finish}
              >
                Понятно, поехали
                <Bike className="size-4" />
              </Button>
            ) : (
              <Button
                size="sm"
                className="bg-orange-500 hover:bg-orange-600"
                onClick={() => go(1)}
              >
                Далее
                <ChevronRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
