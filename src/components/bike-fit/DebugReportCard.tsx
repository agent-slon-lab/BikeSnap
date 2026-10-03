"use client";

/**
 * КАРТОЧКА «ОТЧЁТ ДЛЯ ОТЛАДКИ» (v3.0.0)
 * Идея пользователя: «создай на гите issue и когда пользов отправляет отчет
 * из анализа, то он автоматом там формируется и заливается на гит. а ты гит
 * мониторишь, скачиваешь и анализируешь и правишь».
 *
 * v3.0.0 (по жалобе «мне все также предлагают скачать файл, а надо чтобы
 * просто отправлялось на гит»): отправка идёт через серверный релей
 * /api/report-upload → GitHub (issue + файлы в user-reports/). ПРИ УСПЕХЕ
 * никаких системных диалогов «поделиться/скачать» не появляется — только
 * статус со ссылкой на issue. Скачивание копии — отдельная явная кнопка,
 * которая возникает, только если заливка не удалась.
 */

import { useState } from "react";
import { Send, FileJson, Download } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { buildFitReport, sendReport, type BikeCalibrationInput, type ReportViewInput } from "@/lib/fit-report";
import { getActiveBike } from "@/lib/bike-storage";
import { useBikeStore } from "@/lib/bike-store";

interface DebugReportCardProps {
  views: ReportViewInput[];
}

type Status = { tone: "info" | "ok" | "error"; text: string; link?: string } | null;

/** Копия отчёта, отложенная для явного скачивания при сбое заливки. */
type PendingCopy = { json: string; filename: string } | null;

export function DebugReportCard({ views }: DebugReportCardProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [pendingCopy, setPendingCopy] = useState<PendingCopy>(null);
  // Контекст онбординга — уходит в отчёт, чтобы я видел, в каких условиях
  // считался анализ (тип вела, рост/inseam, размеры рамы, жалобы)
  const { bikeType, goal, complaints, body, bike } = useBikeStore();

  // Калибровка шага 2 (v1.14.15): фото велика + точки разметки из карточки
  // активного велика (bikefit-bikes). «НАДО ЧТОБЫ эти действия ТОЖЕ
  // СОХРАНЯЛИСЬ» — теперь уходят в отчёт вместе с фото позы.
  const calibration: BikeCalibrationInput | null = (() => {
    try {
      const b = getActiveBike();
      if (!b || (!b.photoData && !b.keyPointsData)) return null;
      let points: BikeCalibrationInput["points"] = null;
      if (b.keyPointsData) {
        const parsed = JSON.parse(b.keyPointsData) as Record<
          string,
          { x: number | null; y: number | null } | null
        >;
        // оставляем только валидные точки (x/y числа)
        const clean: Record<string, { x: number; y: number } | null> = {};
        for (const [k, v] of Object.entries(parsed)) {
          clean[k] =
            v && typeof v.x === "number" && typeof v.y === "number"
              ? { x: v.x, y: v.y }
              : null;
        }
        points = clean;
      }
      return { photo: b.photoData ?? null, points };
    } catch {
      return null;
    }
  })();

  const handleSend = async () => {
    setBusy(true);
    setStatus({ tone: "info", text: "Отправляем отчёт на GitHub…" });
    try {
      const { report, json, filename } = await buildFitReport(
        views,
        {
          bikeType,
          goal,
          complaints,
          body,
          bike,
        },
        calibration,
      );

      try {
        const res = await fetch("/api/report-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ report, filename }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          issueNumber?: number;
          issueUrl?: string;
          files?: string[];
          error?: string;
        };
        if (res.ok && data.issueUrl && typeof data.issueNumber === "number") {
          setPendingCopy(null);
          setStatus({
            tone: "ok",
            text: `Готово: issue #${data.issueNumber}, файлов в репозитории ${
              data.files?.length ?? 0
            }. Отчёт лежит на GitHub — разработчик его разберёт.`,
            link: data.issueUrl,
          });
        } else {
          setPendingCopy({ json, filename });
          setStatus({
            tone: "error",
            text: `На GitHub не ушло: ${data.error ?? `HTTP ${res.status}`}. Можно скачать копию кнопкой ниже и передать вручную.`,
          });
        }
      } catch (netErr) {
        setPendingCopy({ json, filename });
        setStatus({
          tone: "error",
          text: `Сервер недоступен: ${
            netErr instanceof Error ? netErr.message : String(netErr)
          }. Можно скачать копию кнопкой ниже и передать вручную.`,
        });
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

  const handleDownloadCopy = async () => {
    if (!pendingCopy) return;
    const result = await sendReport(pendingCopy.json, pendingCopy.filename);
    setStatus({
      tone: "ok",
      text:
        result === "shared"
          ? "Копия открыта в меню «Поделиться»."
          : result === "downloaded"
            ? `Копия сохранена в «Загрузки»: ${pendingCopy.filename}.`
            : "Копия готова — отправьте её разработчику.",
    });
  };

  return (
    <Card className="border-dashed bg-muted/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileJson className="size-4 text-orange-500" />
          Отчёт для отладки
        </CardTitle>
        <CardDescription>
          Фото, найденные точки тела, результат анализа (или ошибка) и положение
          телефона в момент снимка. Отправка заливает отчёт на GitHub — issue +
          файлы в user-reports/ — и на этом всё: никаких диалогов и скачиваний.
          Репозиторий открытый: фото и данные будут видны публично.
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
          {busy ? "Отправляем…" : "Отправить отчёт на GitHub"}
        </Button>
        {pendingCopy && !busy && (
          <Button
            type="button"
            variant="ghost"
            onClick={handleDownloadCopy}
            className="mt-2 w-full sm:w-auto text-muted-foreground"
          >
            <Download className="size-4" />
            Скачать копию отчёта
          </Button>
        )}
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
            {status.text}{" "}
            {status.link && (
              <a
                href={status.link}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline underline-offset-2"
              >
                открыть issue →
              </a>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
