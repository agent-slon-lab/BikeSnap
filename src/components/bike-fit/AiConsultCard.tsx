"use client";

/**
 * v1.14.42: AI-разбор посадки — карточка с кнопкой + диалог запроса.
 *
 * Приватность (см. src/lib/ai-consult.ts): в Gemini уходят ТОЛЬКО числа —
 * углы суставов, антропометрия, геометрия вела, жалобы. Фото никуда не
 * отправляются. Ключ API — пользовательский (BYO), хранится только в
 * localStorage устройства и уходит напрямую в Google.
 */

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  AlertCircle,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Settings2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  AI_KEY_URL,
  AI_MODELS,
  DEFAULT_AI_MODEL,
  AiConsultError,
  buildAiConsultPrompt,
  getAiKey,
  getAiModel,
  requestAiConsult,
  saveAiKey,
  saveAiModel,
  type AiConsultInput,
} from "@/lib/ai-consult";

interface AiConsultCardProps {
  /** Данные для промпта (собраны в родителе); null — карточка скрыта */
  input: Omit<AiConsultInput, "analysis"> | null;
  /** Боковой анализ посадки; null — карточка скрыта */
  analysis: AiConsultInput["analysis"] | null;
}

export function AiConsultCard({ input, analysis }: AiConsultCardProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [model, setModel] = useState<string>(DEFAULT_AI_MODEL);
  const [showKey, setShowKey] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  // При каждом открытии диалога подтягиваем сохранённые настройки и
  // сбрасываем прошлую сессию (отменяем висящий запрос)
  useEffect(() => {
    if (open) {
      setKeyDraft(getAiKey());
      setModel(getAiModel());
      setSettingsOpen(getAiKey() === "");
      setPhase("idle");
      setError(null);
    } else {
      abortRef.current?.abort();
    }
  }, [open]);

  // Cleanup при размонтировании
  useEffect(() => () => abortRef.current?.abort(), []);

  const hasKey = keyDraft.trim().length > 0;

  const run = async () => {
    if (!input || !analysis) return;
    const key = keyDraft.trim();
    if (!key) {
      setError("Вставь бесплатный ключ Google AI Studio — см. кнопку «Получить ключ».");
      setSettingsOpen(true);
      return;
    }
    if (key !== getAiKey()) saveAiKey(key);
    saveAiModel(model);

    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("loading");
    setError(null);
    setResult("");
    try {
      const prompt = buildAiConsultPrompt({ ...input, analysis });
      const text = await requestAiConsult(prompt, {
        apiKey: key,
        model,
        signal: controller.signal,
      });
      setResult(text);
      setPhase("done");
    } catch (e) {
      // Отмена по закрытию диалога — тихо
      if (controller.signal.aborted) {
        setPhase("idle");
        return;
      }
      const msg =
        e instanceof AiConsultError
          ? e.message
          : `Не удалось получить разбор: ${
              e instanceof Error ? e.message : String(e)
            }`;
      setError(msg);
      setPhase("idle");
    }
  };

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(result);
      toast({ title: "Разбор скопирован в буфер обмена" });
    } catch {
      toast({
        title: "Не удалось скопировать",
        variant: "destructive",
      });
    }
  };

  if (!input || !analysis) return null;

  return (
    <>
      <Card className="border-violet-200 dark:border-violet-900 bg-violet-50/40 dark:bg-violet-950/20">
        <CardContent className="py-4">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
            <div className="text-sm text-muted-foreground">
              <p className="flex items-center gap-2 font-medium text-foreground">
                <Sparkles className="size-4 text-violet-500" />
                AI-разбор посадки
              </p>
              <p className="mt-0.5 text-xs">
                Пошаговые корректировки от Google Gemini. Отправляются только
                числа — углы, размеры, жалобы. Фото остаются на устройстве.
              </p>
            </div>
            <Button
              onClick={() => setOpen(true)}
              className="shrink-0 bg-violet-500 hover:bg-violet-600"
            >
              <Sparkles className="size-4" />
              Спросить AI
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-5 text-violet-500" />
              AI-разбор посадки
            </DialogTitle>
            <DialogDescription className="text-left">
              🔒 В Gemini уходят только числа: углы суставов, антропометрия,
              геометрия велосипеда и жалобы. Фотографии не отправляются никуда,
              запрос идёт напрямую из твоего браузера.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Настройки: ключ + модель */}
            <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
              <button
                type="button"
                className="flex w-full items-center justify-between text-sm font-medium"
                onClick={() => setSettingsOpen((v) => !v)}
              >
                <span className="flex items-center gap-2">
                  <Settings2 className="size-4 text-muted-foreground" />
                  Настройки Gemini {hasKey ? "(ключ сохранён)" : "(нужен ключ)"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {settingsOpen ? "скрыть" : "показать"}
                </span>
              </button>
              {settingsOpen && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ai-key" className="text-xs">
                      Ключ Google AI Studio —{" "}
                      <a
                        href={AI_KEY_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 font-medium text-violet-600 dark:text-violet-400 hover:underline"
                      >
                        получить бесплатно <ExternalLink className="size-3" />
                      </a>
                    </Label>
                    <div className="flex gap-1.5">
                      <Input
                        id="ai-key"
                        type={showKey ? "text" : "password"}
                        placeholder="AIza…"
                        value={keyDraft}
                        onChange={(e) => setKeyDraft(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        className="font-mono text-xs"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-9 shrink-0"
                        onClick={() => setShowKey((v) => !v)}
                        title={showKey ? "Скрыть ключ" : "Показать ключ"}
                      >
                        {showKey ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Ключ хранится только на этом устройстве (localStorage) и
                      уходит напрямую в Google — без промежуточных серверов.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ai-model" className="text-xs">
                      Модель
                    </Label>
                    <select
                      id="ai-model"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {AI_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} — {m.hint}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Состояния: idle / loading / done */}
            {phase === "idle" && (
              <div className="flex justify-end">
                <Button
                  onClick={run}
                  className="bg-violet-500 hover:bg-violet-600"
                  disabled={!hasKey}
                >
                  <Sparkles className="size-4" />
                  {hasKey ? "Запустить разбор" : "Вставь ключ выше"}
                </Button>
              </div>
            )}

            {phase === "loading" && (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/30 px-4 py-6 text-sm text-violet-700 dark:text-violet-400">
                <Loader2 className="size-4 animate-spin" />
                Gemini анализирует посадку… обычно 10–30 секунд
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <div className="space-y-2">
                  <p>{error}</p>
                  <Button size="sm" variant="outline" onClick={run}>
                    <RefreshCw className="size-3.5" />
                    Попробовать ещё раз
                  </Button>
                </div>
              </div>
            )}

            {phase === "done" && result && (
              <div className="space-y-3">
                <div
                  ref={resultRef}
                  className="max-h-[45vh] overflow-y-auto rounded-lg border bg-background p-4 text-sm leading-relaxed [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                >
                  <ReactMarkdown>{result}</ReactMarkdown>
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button size="sm" variant="outline" onClick={copyResult}>
                    <Copy className="size-3.5" />
                    Скопировать
                  </Button>
                  <Button size="sm" variant="outline" onClick={run}>
                    <RefreshCw className="size-3.5" />
                    Прогнать заново
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
