/**
 * AI-разбор посадки через Google Gemini API (v1.14.42).
 *
 * Принципы (важно — офлайн-PWA и приватность):
 *  1. ФОТО НИКУДА НЕ УХОДЯТ. В облако летят ТОЛЬКО ЧИСЛА: углы суставов,
 *     антропометрия, геометрия велосипеда, цель и жалобы. Это одновременно
 *     приватнее, дешевле по токенам и точнее для анализа.
 *  2. BYO-ключ (bring your own key): пользователь вставляет свой бесплатный
 *     ключ Google AI Studio (aistudio.google.com/apikey). Ключ хранится
 *     ТОЛЬКО в localStorage его устройства и уходит напрямую в Google —
 *     между ними нет нашего сервера. Статический PWA не может прятать ключ,
 *     поэтому ключ не «наш», а пользовательский.
 *  3. Кнопка «AI-разбор» — опция «когда есть интернет». Офлайн-режим
 *     приложения она не затрагивает: всё остальное работает как раньше.
 */

import type { BodyMeasurements, BikeMeasurements } from "./bike-calculations";
import { BIKE_TYPES, type BikeType } from "./bike-params";
import type { AngleResult, BikeFitAnalysis } from "./bike-fit";
import type { Complaint } from "./bike-store";
import { COMPLAINTS } from "./bike-store";

// ============================================================
// НАСТРОЙКИ (ключ + модель) — localStorage устройства
// ============================================================

export const AI_KEY_STORAGE = "bikefit-ai-key";
export const AI_MODEL_STORAGE = "bikefit-ai-model";

/** Куда идти за бесплатным ключом */
export const AI_KEY_URL = "https://aistudio.google.com/apikey";

export interface AiModelOption {
  id: string;
  label: string;
  hint: string;
}

/**
 * Модели free tier Google AI Studio (на момент v1.14.42). Дефолт —
 * gemini-2.0-flash: у него самый щедрый бесплатный лимит запросов в день.
 * Список редактируется — Google меняет линейку чаще, чем мы релизимся.
 */
export const AI_MODELS: AiModelOption[] = [
  {
    id: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    hint: "рекомендуется: больше бесплатных запросов в день",
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    hint: "самая сообразительная, дневной лимит ниже",
  },
  {
    id: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
    hint: "самая быстрая и лёгкая",
  },
];

export const DEFAULT_AI_MODEL = AI_MODELS[0].id;

export function getAiKey(): string {
  try {
    return localStorage.getItem(AI_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function saveAiKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) localStorage.setItem(AI_KEY_STORAGE, trimmed);
    else localStorage.removeItem(AI_KEY_STORAGE);
  } catch {
    /* приватный режим / переполнение — ключ просто не сохранится */
  }
}

export function getAiModel(): string {
  try {
    return localStorage.getItem(AI_MODEL_STORAGE) || DEFAULT_AI_MODEL;
  } catch {
    return DEFAULT_AI_MODEL;
  }
}

export function saveAiModel(model: string): void {
  try {
    if (AI_MODELS.some((m) => m.id === model)) {
      localStorage.setItem(AI_MODEL_STORAGE, model);
    } else {
      localStorage.removeItem(AI_MODEL_STORAGE);
    }
  } catch {
    /* ignore */
  }
}

// ============================================================
// ВХОДНЫЕ ДАННЫЕ
// ============================================================

export interface AiConsultInput {
  /** Имя райдера — опционально, в промпт попадает только как обращение */
  riderName?: string;
  body: BodyMeasurements;
  /** Название вела (введено пользователем) — контекст, не тайна */
  bikeName?: string;
  bikeType: BikeType;
  measurements: BikeMeasurements;
  /** Боковой анализ посадки (BikeSnap) */
  analysis: BikeFitAnalysis;
  goal?: "comfort" | "sport" | "race" | null;
  complaints?: Complaint[];
  /**
   * Фактическая высота седла текущего вела (мм), если введена/откалибрована —
   * Gemini может привязывать советы к реальной высоте.
   */
  saddleHeightMm?: number | null;
}

export interface AiPrompt {
  system: string;
  user: string;
}

// ============================================================
// СБОРКА ПРОМПТА (чистая функция — покрывается тестом)
// ============================================================

const GOAL_RU: Record<"comfort" | "sport" | "race", string> = {
  comfort: "комфортные поездки",
  sport: "спорт / длинные тренировки",
  race: "гонки / максимум производительности",
};

const STATUS_RU: Record<AngleResult["status"], string> = {
  good: "в норме",
  warning: "на границе нормы",
  bad: "вне нормы",
};

function fmtNum(n: number | undefined, digits = 1): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return String(Math.round(n * 10 ** digits) / 10 ** digits);
}

/** Одна метрика → строка «Название: 143.2° (норма 140–150°, в норме)» */
function fmtAngle(a: AngleResult): string {
  const unit = a.unit ?? "°";
  const parts = [
    `${a.label}: ${fmtNum(a.value)}${unit}`,
    `норма ${a.min}–${a.max}${unit}`,
    STATUS_RU[a.status],
  ];
  if (a.flexion) {
    parts.push(
      `сгиб ${fmtNum(a.flexion.value)}${unit} (норма ${a.flexion.min}–${a.flexion.max}${unit})`
    );
  }
  // KOPS: value — модуль, знак живёт в signedValue. Без него AI не сможет
  // сказать, в какую сторону двигать седло (вперёд/назад относительно педали).
  if (typeof a.signedValue === "number" && Number.isFinite(a.signedValue)) {
    parts.push(
      `знаковое значение ${fmtNum(a.signedValue)}${unit} (>0 — колено впереди оси педали, <0 — позади)`
    );
  }
  return `- ${parts.join(" — ")}`;
}

const MEASUREMENT_FIELDS: Array<{
  key: keyof BikeMeasurements;
  label: string;
  unit?: string;
  digits?: number;
}> = [
  { key: "saddleHeight", label: "высота седла", unit: "мм", digits: 0 },
  { key: "setback", label: "setback", unit: "мм", digits: 0 },
  { key: "ett", label: "ETT (верхняя труба)", unit: "мм", digits: 0 },
  { key: "reach", label: "reach", unit: "мм", digits: 0 },
  { key: "stack", label: "stack", unit: "мм", digits: 0 },
  { key: "stem", label: "вынос", unit: "мм", digits: 0 },
  { key: "stemAngle", label: "угол выноса", unit: "°" },
  { key: "crank", label: "шатуны", unit: "мм", digits: 0 },
  { key: "sta", label: "угол подседельной", unit: "°" },
  { key: "hta", label: "угол рулевой", unit: "°" },
  { key: "wheelbase", label: "колёсная база", unit: "мм", digits: 0 },
  { key: "frontCenter", label: "front center", unit: "мм", digits: 0 },
  { key: "rearCenter", label: "chainstay (rear center)", unit: "мм", digits: 0 },
  { key: "seatTube", label: "подседельная труба", unit: "мм", digits: 0 },
  { key: "bbDrop", label: "BB drop", unit: "мм", digits: 0 },
  { key: "wheelHeight", label: "высота колеса", unit: "мм", digits: 0 },
  { key: "bbHeight", label: "высота каретки", unit: "мм", digits: 0 },
];

/**
 * Собрать пару промптов (system + user) для разбора посадки.
 * Чистая функция: ничего не читает из localStorage и не ходит в сеть —
 * покрыта тестом scripts/test-ai-consult.ts.
 */
export function buildAiConsultPrompt(input: AiConsultInput): AiPrompt {
  const system = [
    "Ты — опытный специалист по bike fitting (посадке велосипедиста).",
    "Тебе дают данные одного велосипедиста: антропометрию, геометрию его велосипеда, измеренные приложением BikeSnap углы суставов в рабочей посадке (вид сбоку) и жалобы. Статусы норм BikeSnap уже посчитал.",
    "Твоя задача — провести разбор посадки:",
    "1) Короткое резюме: что в посадке хорошо (2-3 пункта).",
    "2) Проблемные метрики (статусы «на границе» и «вне нормы»): объясни простыми словами, что это значит и на что влияет.",
    "3) Конкретные корректировки: что крутить (седло/вынос/подседель/шатуны), на сколько мм или градусов, в каком порядке. Если точное число назвать нельзя — дай рабочий диапазон и способ проверки.",
    "4) Свяжи советы с жалобами райдера, если они есть, и с целью катания.",
    "5) Памятка безопасности: менять не более 1-2 параметров за раз, проверять на спокойных поездках, записывать исходные значения.",
    "Правила: пиши по-русски, просто и по делу, без воды; markdown (заголовки ###, короткие списки); НЕ выдумывай измерения, которых нет в данных, — если данных не хватает, скажи, что именно дозамерить; не ставь медицинских диагнозов; при стойкой боли или онемении посоветуй обратиться к врачу. Объём — до 400 слов.",
  ].join(" ");

  const lines: string[] = [];

  lines.push("## Райдер");
  const riderTitle = input.riderName?.trim();
  lines.push(
    `- Рост: ${fmtNum(input.body.height, 0)} см; Inseam (внутренний шов): ${fmtNum(
      input.body.inseam,
      0
    )} см`
  );
  if (input.body.flexibility) {
    lines.push(`- Гибкость: ${input.body.flexibility}/5`);
  }
  if (input.body.footLength) lines.push(`- Длина стопы: ${fmtNum(input.body.footLength, 0)} см`);
  if (input.body.armLength) lines.push(`- Длина руки: ${fmtNum(input.body.armLength, 0)} см`);
  if (input.body.torsoLength) {
    lines.push(`- Длина туловища: ${fmtNum(input.body.torsoLength, 0)} см`);
  }
  if (input.goal) lines.push(`- Цель катания: ${GOAL_RU[input.goal]}`);
  const complaintsRu = (input.complaints ?? [])
    .filter((c) => c !== "none")
    .map((c) => {
      const info = COMPLAINTS.find((x) => x.id === c);
      return info ? `${info.emoji} ${info.label}` : c;
    });
  lines.push(
    complaintsRu.length > 0
      ? `- Жалобы: ${complaintsRu.join(", ")}`
      : "- Жалобы: нет"
  );

  const bikeTitle = input.bikeName?.trim() || "Велосипед";
  lines.push("");
  lines.push(
    `## Велосипед: ${bikeTitle} (${BIKE_TYPES[input.bikeType].label})`
  );
  const measLines: string[] = [];
  for (const f of MEASUREMENT_FIELDS) {
    const v = input.measurements[f.key];
    if (typeof v === "number" && Number.isFinite(v)) {
      measLines.push(`${f.label}: ${fmtNum(v, f.digits ?? 1)}${f.unit ?? ""}`);
    }
  }
  lines.push(`- Геометрия: ${measLines.length > 0 ? measLines.join("; ") : "не введена"}`);
  if (
    typeof input.saddleHeightMm === "number" &&
    Number.isFinite(input.saddleHeightMm)
  ) {
    lines.push(`- Фактическая высота седла сейчас: ${fmtNum(input.saddleHeightMm, 0)} мм`);
  }

  const a = input.analysis;
  lines.push("");
  lines.push(
    `## Углы посадки — вид сбоку (анализ BikeSnap, ${a.side === "left" ? "левая" : "правая"} нога)`
  );
  lines.push(fmtAngle(a.kneeAngle));
  lines.push(fmtAngle(a.hipAngle));
  lines.push(fmtAngle(a.backAngle));
  lines.push(fmtAngle(a.shoulderAngle));
  lines.push(fmtAngle(a.ankleAngle));
  lines.push(fmtAngle(a.kops));
  if (a.warnings?.length) {
    lines.push(`- Замечания к качеству кадра: ${a.warnings.join("; ")}`);
  }

  lines.push("");
  lines.push("## Задача");
  lines.push(
    "Разбери посадку по этим данным: что хорошо, что проблемно и какие корректировки сделать (с числами и порядком действий)."
  );

  return { system, user: lines.join("\n") };
}

// ============================================================
// ЗАПРОС К GEMINI
// ============================================================

export class AiConsultError extends Error {}

export interface AiRequestOptions {
  apiKey: string;
  model: string;
  /** Таймаут, мс (дефолт 60 с — «думающие» ответы могут идти долго) */
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/**
 * Вызвать Gemini generateContent и вернуть текст разбора.
 * Ключ передаётся в заголовке x-goog-api-key (не в query — не попадает
 * в историю/логи прокси). Ошибки — AiConsultError с человеческим текстом.
 */
export async function requestAiConsult(
  prompt: AiPrompt,
  opts: AiRequestOptions
): Promise<string> {
  const apiKey = opts.apiKey.trim();
  if (!apiKey) {
    throw new AiConsultError(
      "Нет ключа API. Вставь бесплатный ключ Google AI Studio — кнопка «Получить ключ» выше."
    );
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    opts.model
  )}:generateContent`;

  // Комбинируем внешний signal (отмена диалогом) с внутренним таймаутом
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onExternalAbort);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt.system }] },
        contents: [{ role: "user", parts: [{ text: prompt.user }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = "";
      try {
        const j = (await res.json()) as GeminiResponse;
        detail = j?.error?.message ?? "";
      } catch {
        /* тело не JSON — обойдёмся статусом */
      }
      if (res.status === 400 && /api[_ ]?key/i.test(detail)) {
        throw new AiConsultError(
          "Google не принял ключ API. Проверь, что скопировал ключ целиком (aistudio.google.com/apikey)."
        );
      }
      if (res.status === 403) {
        throw new AiConsultError(
          "Доступ запрещён (403). Проверь ключ или попробуй другую модель из списка."
        );
      }
      if (res.status === 429) {
        throw new AiConsultError(
          "Бесплатный лимит Gemini исчерпан — попробуй через минуту или возьми модель полегче в настройках."
        );
      }
      if (res.status === 404) {
        throw new AiConsultError(
          "Модель не найдена (404) — возможно, недоступна для твоего ключа. Выбери другую в настройках."
        );
      }
      throw new AiConsultError(
        `Gemini ответил ошибкой ${res.status}${detail ? `: ${detail}` : ""}`
      );
    }

    const data = (await res.json()) as GeminiResponse;
    const block = data.promptFeedback?.blockReason;
    if (block) {
      throw new AiConsultError(
        `Gemini отказался отвечать (${block}). Это редкость для числовых данных — попробуй ещё раз.`
      );
    }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p?.text ?? "")
      .join("")
      .trim();
    if (!text) {
      throw new AiConsultError(
        "Gemini вернул пустой ответ — попробуй запустить разбор ещё раз."
      );
    }
    return text;
  } catch (e) {
    if (e instanceof AiConsultError) throw e;
    if (controller.signal.aborted) {
      throw new AiConsultError(
        opts.signal?.aborted
          ? "Запрос отменён."
          : "Gemini не ответил за минуту — проверь интернет и попробуй ещё раз."
      );
    }
    throw new AiConsultError(
      `Сеть недоступна или Google недостижим: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }
}
