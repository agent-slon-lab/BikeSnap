"use client";

/**
 * INFO HINT — ⓘ-подсказка «что это / как измерить», которая НЕ пропадает
 * =======================================================================
 *
 * Проблема (жалоба v1.14.20): Radix Tooltip — hover-компонент. На телефоне
 * hover нет, а тач-поведение капризное: тултип закрывается от любого касания
 * мимо, от скролла, от появления клавиатуры — прочитать длинное описание
 * «как измерить» невозможно («оно просто пропадает»).
 *
 * Решение: полноконтрольный (controlled) тултип-переключатель.
 *  - тап/клик по ⓘ → открылось и ВИСИТ, пока читаешь;
 *  - повторный тап по ⓘ → закрылось (target внутри триггера — не считаем
 *    «внешним касанием», иначе Radix закроет слой ДО клика и тап не сработает);
 *  - тап мимо / Escape → закрылось;
 *  - скролл и открытие клавиатуры больше НЕ закрывают (controlled state без
 *    onOpenChange — внутренние события Radix нас не трогают).
 *
 * Визуал прежний (тёмный пузырь TooltipContent) — меняется только поведение.
 * max-w с запасом на узких экранах: пузырь не вылезает за вьюпорт
 * (collisionPadding=12 + ширина min(20rem, 100vw-2.5rem)).
 */

import { useRef, useState } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function InfoHint({
  what,
  howTo,
  contentClassName,
  side = "bottom",
}: {
  /** Короткий заголовок: «что это» */
  what: React.ReactNode;
  /** Развёрнутое описание: «как измерить» (необязательно) */
  howTo?: React.ReactNode;
  /** Доп. классы для пузыря (ширина/отступы поверх дефолта) */
  contentClassName?: string;
  /** Сторона раскрытия (Radix сам уводит от краёв вьюпорта) */
  side?: "top" | "right" | "bottom" | "left";
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <Tooltip open={open}>
      <TooltipTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label="Подсказка: что это и как измерить"
          aria-expanded={open}
          onClick={(e) => {
            // не даём клику «провалиться» в родительские элементы (Label и т.п.)
            e.preventDefault();
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-full",
            "text-sky-500 transition-colors hover:text-sky-600 dark:text-sky-400 dark:hover:text-sky-300",
            open && "text-sky-600 dark:text-sky-300",
          )}
        >
          <Info className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={6}
        collisionPadding={12}
        className="max-w-[min(20rem,calc(100vw-2.5rem))]"
        // Тап по самому ⓘ — это НЕ «вне»: игнорируем, чтобы сработал toggle-клик
        onPointerDownOutside={(e) => {
          if (triggerRef.current && e.target instanceof Node && triggerRef.current.contains(e.target)) {
            return;
          }
          setOpen(false);
        }}
        onEscapeKeyDown={() => setOpen(false)}
      >
        <div className="space-y-1">
          <p className="text-xs font-medium">{what}</p>
          {howTo ? <p className="text-[11px] text-primary-foreground/75">{howTo}</p> : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
