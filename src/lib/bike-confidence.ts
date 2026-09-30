/**
 * Confidence Score — оценка достоверности вычисленных параметров.
 *
 * Прежняя логика отбраковывала "невозможные" значения в null, из-за чего
 * пользователь не видел НИКАКИХ цифр при кривом фото. Теперь: всегда возвращаем
 * значение, но с уровнем уверенности и предупреждениями.
 *
 * Уровни:
 * - high: параметр в типичном диапазоне для типа велосипеда, источник чёткий
 * - medium: параметр на границе диапазона, либо средняя перспектива
 * - low: параметр за пределами диапазона (возможно сильное искажение), но не null
 */

import type { ComputedBikeParams } from "./bike-photo-scale";
import type { DualScale } from "./bike-dual-scale";

export type Confidence = "high" | "medium" | "low";

export interface ParamConfidence {
  field: string;
  label: string;
  value: number;
  confidence: Confidence;
  warnings: string[];
  /** Типичный диапазон для bikeType */
  range?: { min: number; max: number };
}

export interface ConfidenceAssessment {
  /** Достоверность по каждому параметру */
  params: ParamConfidence[];
  /** Общая достоверность (минимум по всем параметрам) */
  overall: Confidence;
  /** Сводное предупреждение для UI */
  summary: string;
  /**Dual scale если есть */
  dualScale?: DualScale | null;
}

// Типичные диапазоны по типам велосипедов
const PARAM_RANGES: Record<string, Record<string, { min: number; max: number; label: string }>> = {
  road: {
    saddleHeight: { min: 650, max: 950, label: "SH" },
    ett:          { min: 510, max: 590, label: "ETT" },
    reach:        { min: 360, max: 440, label: "Reach" },
    stack:        { min: 490, max: 600, label: "Stack" },
    wheelbase:    { min: 970, max: 1030, label: "WB" },
    bbHeight:     { min: 250, max: 290, label: "BBH" },
    sta:          { min: 73, max: 76, label: "STA" },
    hta:          { min: 72, max: 75, label: "HTA" },
  },
  gravel: {
    saddleHeight: { min: 650, max: 950, label: "SH" },
    ett:          { min: 540, max: 620, label: "ETT" },
    reach:        { min: 360, max: 460, label: "Reach" },
    stack:        { min: 510, max: 630, label: "Stack" },
    wheelbase:    { min: 1010, max: 1070, label: "WB" },
    bbHeight:     { min: 270, max: 310, label: "BBH" },
    sta:          { min: 71, max: 75, label: "STA" },
    hta:          { min: 69, max: 73, label: "HTA" },
  },
  mtb: {
    saddleHeight: { min: 650, max: 950, label: "SH" },
    ett:          { min: 560, max: 660, label: "ETT" },
    reach:        { min: 380, max: 500, label: "Reach" },
    stack:        { min: 540, max: 660, label: "Stack" },
    wheelbase:    { min: 1080, max: 1280, label: "WB" },
    bbHeight:     { min: 290, max: 360, label: "BBH" },
    sta:          { min: 70, max: 78, label: "STA" },
    hta:          { min: 63, max: 71, label: "HTA" },
  },
  hybrid: {
    saddleHeight: { min: 650, max: 950, label: "SH" },
    ett:          { min: 530, max: 610, label: "ETT" },
    reach:        { min: 370, max: 450, label: "Reach" },
    stack:        { min: 530, max: 630, label: "Stack" },
    wheelbase:    { min: 1020, max: 1100, label: "WB" },
    bbHeight:     { min: 270, max: 320, label: "BBH" },
    sta:          { min: 71, max: 75, label: "STA" },
    hta:          { min: 70, max: 73, label: "HTA" },
  },
  city: {
    saddleHeight: { min: 650, max: 950, label: "SH" },
    ett:          { min: 540, max: 620, label: "ETT" },
    reach:        { min: 370, max: 460, label: "Reach" },
    stack:        { min: 540, max: 650, label: "Stack" },
    wheelbase:    { min: 1030, max: 1110, label: "WB" },
    bbHeight:     { min: 280, max: 330, label: "BBH" },
    sta:          { min: 70, max: 75, label: "STA" },
    hta:          { min: 69, max: 73, label: "HTA" },
  },
};

const DEFAULT_RANGES: Record<string, { min: number; max: number; label: string }> = {
  saddleHeight: { min: 600, max: 1000, label: "SH" },
  ett:          { min: 500, max: 650, label: "ETT" },
  reach:        { min: 350, max: 480, label: "Reach" },
  stack:        { min: 480, max: 660, label: "Stack" },
  wheelbase:    { min: 980, max: 1180, label: "WB" },
  bbHeight:     { min: 250, max: 350, label: "BBH" },
  sta:          { min: 70, max: 76, label: "STA" },
  hta:          { min: 68, max: 75, label: "HTA" },
};

function getRange(field: string, bikeType?: string): { min: number; max: number; label: string } {
  const type = (bikeType || "").toLowerCase();
  const typeRanges = PARAM_RANGES[type] ?? DEFAULT_RANGES;
  return typeRanges[field] ?? DEFAULT_RANGES[field] ?? { min: 0, max: Infinity, label: field };
}

function confidenceForValue(
  value: number | null | undefined,
  range: { min: number; max: number; label: string },
  fieldLabel: string,
  dualScale: DualScale | null,
  photoDistorted: boolean
): ParamConfidence | null {
  if (value == null || !isFinite(value) || value <= 0) return null;

  const warnings: string[] = [];
  let confidence: Confidence = "high";

  const { min, max } = range;

  // Проверка диапазона
  if (value < min * 0.7 || value > max * 1.3) {
    confidence = "low";
    warnings.push(
      `${fieldLabel} = ${Math.round(value)} — далеко за типичным диапазоном [${min}–${max}]. Скорее всего сильное перспективное искажение фото или точки поставлены неточно.`
    );
  } else if (value < min * 0.9 || value > max * 1.1) {
    confidence = "medium";
    warnings.push(
      `${fieldLabel} = ${Math.round(value)} — на границе диапазона [${min}–${max}]. Возможно лёгкое искажение.`
    );
  }

  // Учет перспективы
  if (dualScale) {
    if (dualScale.perspectiveSeverity > 0.15) {
      if (confidence === "high") confidence = "medium";
      warnings.push(
        `Сильная перспектива (разница масштабов ${(dualScale.perspectiveSeverity * 100).toFixed(0)}%) — погрешность может быть ±15 мм.`
      );
    } else if (dualScale.perspectiveSeverity > 0.05 && confidence === "high") {
      confidence = "medium";
      warnings.push(
        `Лёгкая перспектива — погрешность может быть ±5 мм. Dual scale компенсирует.`
      );
    }
  } else if (photoDistorted) {
    if (confidence === "high") confidence = "medium";
    warnings.push(
      `Перспектива подозрительная, но точки верха колёс не размечены — погрешность может быть ±10 мм. Отметь верх колёс для dual scale.`
    );
  }

  return {
    field: fieldLabel,
    label: fieldLabel,
    value: Math.round(value),
    confidence,
    warnings,
    range: { min, max },
  };
}

/**
 * Оценить достоверность всех вычисленных параметров.
 *
 * @param params Вычисленные параметры (из фото)
 * @param bikeType Тип велосипеда (road/gravel/mtb/hybrid/city)
 * @param dualScale Dual scale (если есть wheelTop точки и wheelHeight)
 * @param photoDistorted True если detectPerspective показал искажение, но dual scale недоступен
 */
export function assessConfidence(
  params: ComputedBikeParams,
  bikeType?: string,
  dualScale?: DualScale | null,
  photoDistorted: boolean = false
): ConfidenceAssessment {
  const result: ParamConfidence[] = [];

  // Проверяем ключевые параметры
  const fieldsToCheck: Array<{ key: keyof ComputedBikeParams; label: string; rangeKey: string }> = [
    { key: "saddleHeight", label: "SH", rangeKey: "saddleHeight" },
    { key: "ett", label: "ETT", rangeKey: "ett" },
    { key: "reach", label: "Reach", rangeKey: "reach" },
    { key: "stack", label: "Stack", rangeKey: "stack" },
    { key: "wheelbase", label: "WB", rangeKey: "wheelbase" },
    { key: "bbHeight", label: "BBH", rangeKey: "bbHeight" },
    { key: "sta", label: "STA", rangeKey: "sta" },
    { key: "hta", label: "HTA", rangeKey: "hta" },
  ];

  for (const { key, label, rangeKey } of fieldsToCheck) {
    const rawValue = params[key];
    // value may be number | null | KnownDimensionKey (e.g. calibratedBy string) — coerce
    const value: number | null | undefined =
      typeof rawValue === "number" ? rawValue : null;
    const range = getRange(rangeKey, bikeType);
    const conf = confidenceForValue(value, range, label, dualScale ?? null, photoDistorted);
    if (conf) result.push(conf);
  }

  // Общая достоверность = минимум по всем
  let overall: Confidence = "high";
  for (const p of result) {
    if (p.confidence === "low") { overall = "low"; break; }
    if (p.confidence === "medium") { overall = "medium"; }
  }

  // Сводное сообщение
  let summary: string;
  const lowCount = result.filter((p) => p.confidence === "low").length;
  const mediumCount = result.filter((p) => p.confidence === "medium").length;

  if (overall === "high") {
    summary = "Все параметры в типичных диапазонах — фото качественное, расчёты точные.";
  } else if (overall === "medium") {
    summary = mediumCount > 0
      ? `${mediumCount} параметр(ов) на границе диапазона. Проверь точки на фото.`
      : "Средняя достоверность — лёгкая перспектива компенсирована dual scale.";
  } else {
    summary = `${lowCount} параметр(ов) далеко за диапазоном. Сильное искажение фото. Лучше переснять или отметить верх колёс для dual scale.`;
  }

  return {
    params: result,
    overall,
    summary,
    dualScale,
  };
}

/**
 * Получить цвет для бейджа уверенности.
 */
export function confidenceColor(c: Confidence): {
  bg: string;
  border: string;
  text: string;
  label: string;
  icon: string;
} {
  switch (c) {
    case "high":
      return {
        bg: "bg-emerald-50 dark:bg-emerald-950/30",
        border: "border-emerald-300 dark:border-emerald-800",
        text: "text-emerald-700 dark:text-emerald-400",
        label: "Точно",
        icon: "✓",
      };
    case "medium":
      return {
        bg: "bg-amber-50 dark:bg-amber-950/30",
        border: "border-amber-300 dark:border-amber-800",
        text: "text-amber-700 dark:text-amber-400",
        label: "Приблизительно",
        icon: "≈",
      };
    case "low":
      return {
        bg: "bg-rose-50 dark:bg-rose-950/30",
        border: "border-rose-300 dark:border-rose-800",
        text: "text-rose-700 dark:text-rose-400",
        label: "Под вопросом",
        icon: "?",
      };
  }
}
