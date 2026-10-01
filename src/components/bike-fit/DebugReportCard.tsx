"use client";

/**
 * КАРТОЧКА «ОТЧЁТ ДЛЯ ОТЛАДКИ» (v1.6.0)
 * Идея пользователя: кнопка «отправка отчёта — для корректирования кода».
 * Собирает фото + landmarks + анализ/ошибку + гироскоп в момент снимка
 * и отдаёт одним .json (share-меню или скачивание). Появляется в шаге
 * «Анализ», как только загружено хотя бы одно фото — и при успехе, и при
 * ошибке анализа (ошибочные кейсы как раз ценнее всего для отладки).
 */

import { useState } from "react";
import { Send, FileJson } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { buildFitReport, sendReport, type ReportViewInput } from "@/lib/fit-report";
import { useBikeStore } from "@/lib/bike-store";

interface DebugReportCardProps {
  views: ReportViewInput[];
}

type Status = { tone: "info" | "ok" | "error"; text: string } | null;

export function DebugReportCard({ views }: DebugReportCardProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  // Контекст онбординга — уходит в отчёт, чтобы я видел, в каких условиях
  // считался анализ (тип вела, рост/inseam, размеры рамы, жалобы)
  const { bikeType, goal, complaints, body, bike } = useBikeStore();

  const handleSend = async () => {
    setBusy(true);
    setStatus({ tone: "info", text: "Готовим отчёт — упаковываем фото и данные…" });
    try {
      const { json, filename } = await buildFitReport(views, {
        bikeType,
        goal,
        complaints,
        body,
        bike,
      });
      const result = await sendReport(json, filename);
      if (result === "shared") {
        setStatus({
          tone: "ok",
          text: "Отчёт собран — отправьте его разработчику через выбранное приложение.",
        });
      } else if (result === "downloaded") {
        setStatus({
          tone: "ok",
          text: `Отчёт сохранён в «Загрузки»: ${filename}. Перешлите этот файл разработчику.`,
        });
      } else {
        setStatus(null); // пользователь закрыл системное меню — молча
      }
    } catch (e) {
      setStatus({
        tone: "error",
        text: `Не получилось собрать отчёт: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-dashed bg-muted/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileJson className="size-4 text-orange-500" />
          Отчёт для отладки
        </CardTitle>
        <CardDescription>
          Один JSON-файл: фото, найденные точки тела, результат анализа (или
          ошибка) и положение телефона в момент снимка. Нужен, чтобы докручивать
          алгоритмы по реальным данным. Ничего не уходит в сеть само — файл
          откроется в меню «Поделиться» или просто скачается.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          variant="outline"
          onClick={handleSend}
          disabled={busy}
          className="w-full sm:w-auto border-orange-300 text-orange-600 hover:bg-orange-50 hover:text-orange-700 dark:border-orange-800 dark:text-orange-400 dark:hover:bg-orange-950/40"
        >
          <Send className="size-4" />
          {busy ? "Готовим отчёт…" : "Отправить отчёт разработчику"}
        </Button>
        {status && (
          <p
            className={
              "mt-3 text-xs leading-relaxed " +
              (status.tone === "ok"
                ? "text-emerald-600 dark:text-emerald-400"
                : status.tone === "error"
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-muted-foreground")
            }
          >
            {status.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
