"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import { WHATS_NEW } from "@/lib/whats-new";

interface WhatsNewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Диалог «Что нового»: показывает записи из WHATS_NEW.
 * Управление открытием — у родителя (координатор в футере),
 * здесь только отображение.
 */
export function WhatsNewDialog({ open, onOpenChange }: WhatsNewDialogProps) {
  const latest = WHATS_NEW[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg overflow-hidden rounded-xl p-0">
        <DialogHeader className="px-5 pb-2 pt-5 text-left">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="size-5 text-orange-500" />
            Что нового в BikeSnap
          </DialogTitle>
          <DialogDescription>
            Обновления и улучшения приложения
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[62vh] px-5">
          <div className="space-y-4 pr-3 pb-4">
            {WHATS_NEW.map((entry, index) => (
              <div
                key={entry.version}
                className="rounded-lg border bg-muted/30 p-4"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge
                    variant={index === 0 ? "default" : "outline"}
                    className={index === 0 ? "bg-orange-500" : undefined}
                  >
                    v{entry.version}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {entry.date}
                  </span>
                  {index === 0 && (
                    <Badge className="bg-orange-500/15 text-orange-600 dark:text-orange-400">
                      новая версия
                    </Badge>
                  )}
                </div>
                <p className="mb-1.5 text-sm font-semibold">{entry.title}</p>
                <ul className="space-y-1">
                  {entry.items.map((item, i) => (
                    <li
                      key={i}
                      className="flex gap-2 text-sm text-muted-foreground"
                    >
                      <span className="mt-[7px] size-1 shrink-0 rounded-full bg-orange-500/70" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="border-t px-5 py-3">
          <p className="text-center text-xs text-muted-foreground">
            Текущая версия:{" "}
            <span className="font-medium text-foreground">
              v{latest?.version}
            </span>{" "}
            · полная история — в CHANGELOG репозитория
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
