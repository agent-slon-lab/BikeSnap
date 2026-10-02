"use client";

/**
 * КАРТОЧКА «ОТЧЁТ ДЛЯ ОТЛАДКИ» (v2.0.0)
 * Идея пользователя: «создай на гите issue и когда пользов отправляет отчет
 * из анализа, то он автоматом там формируется и заливается на гит. а ты гит
 * мониторишь, скачиваешь и анализируешь и правишь».
 *
 * Одна кнопка «Отправить отчёт» делает всё:
 *   1. Заливает фото и JSON в user-reports/ репозитория BikeSnap (Contents API).
 *   2. Создаёт issue со сводкой (версия, ошибки, гироскоп, ссылки на файлы).
 *   3. Фолбэк/бонус: системное «Поделиться» файлом .json или скачивание.
 *
 * Репозиторий открытый — фото и данные отчёта публикуются. Токен вшит в
 * сборку (NEXT_PUBLIC_GITHUB_TOKEN, fine-grained PAT одного репозитория).
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
import { githubConfigured, uploadReportToGithub, type GithubUploadResult } from "@/lib/report-upload";
import { useBikeStore } from "@/lib/bike-store";

interface DebugReportCardProps {
  views: ReportViewInput[];
}

type Status = { tone: "info" | "ok" | "error"; text: string; link?: string } | null;

export function DebugReportCard({ views }: DebugReportCardProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  // Контекст онбординга — уходит в отчёт, чтобы я видел, в каких условиях
  // считался анализ (тип вела, рост/inseam, размеры рамы, жалобы)
  const { bikeType, goal, complaints, body, bike } = useBikeStore();

  const handleSend = async () => {
    setBusy(true);
    const canGithub = githubConfigured();
    setStatus({
      tone: "info",
      text: canGithub
        ? "Собираем отчёт и заливаем на GitHub…"
        : "Готовим отчёт — упаковываем фото и данные…",
    });
    try {
      const { report, json, filename } = await buildFitReport(views, {
        bikeType,
        goal,
        complaints,
        body,
        bike,
      });

      // 1. GitHub: файлы в user-reports/ + issue. Ошибка не останавливает
      //    локальную доставку — отчёт всё равно уйдёт в share/скачивание.
      let gh: GithubUploadResult | null = null;
      let ghError: string | null = null;
      if (canGithub) {
        try {
          gh = await uploadReportToGithub(report, json, filename);
        } catch (e) {
          ghError = e instanceof Error ? e.message : String(e);
        }
      }

      // 2. Локальная копия пользователю (share-меню на телефоне / файл на десктопе)
      const local = await sendReport(json, filename);

      if (gh) {
        const localNote =
          local === "shared"
            ? " Копия — в меню «Поделиться»."
            : local === "downloaded"
              ? ` Копия сохранена в «Загрузки»: ${filename}.`
              : "";
        setStatus({
          tone: ghError ? "error" : "ok",
          text: ghError
            ? `Issue #${gh.issueNumber} создан, но часть файлов не долилась: ${ghError}`
            : `Готово: issue #${gh.issueNumber}, файлов ${gh.files.length} в user-reports/. Разработчик увидит отчёт в GitHub.${localNote}`,
          link: gh.issueUrl,
        });
      } else {
        if (canGithub && ghError) {
          setStatus({
            tone: "error",
            text: `На GitHub не вышло: ${ghError}. Отчёт собран локально — отправьте его вручную.`,
          });
        } else if (local === "shared") {
          setStatus({
            tone: "ok",
            text: "Отчёт собран — отправьте его через выбранное приложение.",
          });
        } else if (local === "downloaded") {
          setStatus({
            tone: "ok",
            text: `Отчёт сохранён в «Загрузки»: ${filename}.`,
          });
        } else {
          setStatus(null); // пользователь закрыл системное меню — молча
        }
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
          Фото, найденные точки тела, результат анализа (или ошибка) и положение
          телефона в момент снимка. Отправка заливает отчёт на GitHub — issue + файлы
          в user-reports/, — разработчик разбирает его там же. Репозиторий
          открытый: фото и данные будут видны публично.
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
          {busy
            ? "Отправляем…"
            : githubConfigured()
              ? "Отправить отчёт на GitHub"
              : "Отправить отчёт разработчику"}
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
