"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface GuideStepDef {
  /** DOM id элемента, который подсвечиваем (карточка/кнопка/поле) */
  targetId: string;
  title: string;
  text: string;
  /**
   * Автопереход дальше, когда условие выполнено (например, поле заполнено).
   * Проверяется каждые 350 мс, пока шаг активен.
   */
  done?: () => boolean;
  /** Свой текст кнопки (по умолчанию «Далее») */
  nextLabel?: string;
}

interface StepGuideProps {
  steps: GuideStepDef[];
  open: boolean;
  onFinish: () => void;
}

const PAD = 8; // отступ «ореола» вокруг подсвеченного элемента
const CARD_W = 300; // ширина карточки подсказки

/**
 * Неблокирующий пошаговый гид: подсвечивает реальный элемент интерфейса
 * (крупное оранжевое кольцо + затемнение всего остального через box-shadow),
 * но НЕ перехватывает клики — пользователь сразу работает с подсвеченным
 * полем. Шаг с done() проваливается сам, как только условие выполнено.
 */
export function StepGuide({ steps, open, onFinish }: StepGuideProps) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [cardH, setCardH] = useState(150);
  const [vw, setVw] = useState(1024);
  const [vh, setVh] = useState(768);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const step = steps[index];
  const last = index === steps.length - 1;

  // Размеры вьюпорта (для позиционирования карточки)
  useEffect(() => {
    if (!open) return;
    const sync = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [open]);

  // При смене шага — плавно подскроллить цель к центру экрана
  useEffect(() => {
    if (!open || !step) return;
    document
      .getElementById(step.targetId)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [open, step]);

  // Живой замер цели: rAF ловит и smooth-скролл, и ресайзы
  useEffect(() => {
    if (!open || !step) return;
    let raf = 0;
    let prev = "";
    const loop = () => {
      const el = document.getElementById(step.targetId);
      if (el) {
        const r = el.getBoundingClientRect();
        const key = `${Math.round(r.top)},${Math.round(r.left)},${Math.round(r.width)},${Math.round(r.height)}`;
        if (key !== prev) {
          prev = key;
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        }
      } else if (prev !== "none") {
        prev = "none";
        setRect(null); // цель скрыта — карточка по центру низа
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open, step]);

  // Высота карточки — чтобы правильно выбрать «сверху/снизу»
  useEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [index, open, step]);

  // Автопереход: поле заполнили — идём дальше без клика
  useEffect(() => {
    if (!open || !step?.done) return;
    const timer = setInterval(() => {
      if (step.done?.()) {
        setIndex((i) => Math.min(steps.length - 1, i + 1));
      }
    }, 350);
    return () => clearInterval(timer);
  }, [open, step, steps.length]);

  if (!open || !step) return null;

  // Позиция карточки: под целью, если влезает, иначе — над целью
  const spot = rect
    ? {
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;
  const cardLeft = rect
    ? Math.min(
        Math.max(rect.left + rect.width / 2 - CARD_W / 2, 12),
        Math.max(12, vw - CARD_W - 12)
      )
    : Math.max(12, (vw - CARD_W) / 2);
  const fitsBelow = rect ? rect.top + rect.height + cardH + 24 < vh : true;
  const cardTop = rect
    ? fitsBelow
      ? Math.min(rect.top + rect.height + 12, vh - cardH - 12)
      : Math.max(12, rect.top - cardH - 12)
    : vh - cardH - 24;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-label="Пошаговая подсказка">
      {/* Подсветка цели: ореол + затемнение остального (клики проходят насквозь) */}
      {spot ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-4 ring-orange-500 transition-all duration-150"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
          }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-black/45" />
      )}

      {/* Карточка подсказки */}
      <div
        ref={cardRef}
        className="absolute w-[300px] rounded-xl border bg-popover p-3.5 text-popover-foreground shadow-2xl"
        style={{ top: cardTop, left: cardLeft }}
      >
        <div className="flex items-center justify-between">
          <Badge className="bg-orange-500 text-white">
            {index + 1} / {steps.length}
          </Badge>
          <button
            onClick={onFinish}
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Пропустить
          </button>
        </div>
        <p className="mt-2 text-sm font-bold leading-tight">{step.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {step.text}
        </p>
        <Button
          size="sm"
          className="mt-3 w-full bg-orange-500 hover:bg-orange-600"
          onClick={() => (last ? onFinish() : setIndex((i) => i + 1))}
        >
          {last ? "Понятно, готово" : (step.nextLabel ?? "Далее")}
        </Button>
        {!last && step.done && (
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
            Заполнишь поле — перейдём дальше сами
          </p>
        )}
      </div>
    </div>
  );
}
