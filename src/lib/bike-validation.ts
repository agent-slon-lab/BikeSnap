/**
 * Система валидации параметров велосипеда.
 *
 * Проверяет:
 * 1. Физически возможные диапазоны (отбрасывает бред)
 * 2. Кросс-проверки (логическая согласованность)
 * 3. Подсказки при подозрительных значениях (например, см вместо мм)
 *
 * Возвращает список предупреждений (не блокирует ввод, но предупреждает).
 */

import type { BikeMeasurements } from "./bike-calculations";

export type ValidationLevel = "error" | "warning" | "info";

export interface ValidationIssue {
  level: ValidationLevel;
  field: string;
  message: string;
  /** Предлагаемое исправленное значение */
  suggestedValue?: number;
  /** Источник каждого упомянутого параметра (для подсказки, что именно исправлять) */
  fieldSources?: Record<string, "measured" | "photo">;
  /** Какое поле скорее всего с ошибкой (если знаем) */
  suspectField?: string;
}

// ============================================================
// ДИАПАЗОНЫ (физически возможные для велосипеда)
// ============================================================

const RANGES: Record<string, { min: number; max: number; label: string; unit: string }> = {
  saddleHeight: { min: 500, max: 1000, label: "SH (высота седла)", unit: "мм" },
  setback: { min: 0, max: 200, label: "SB (сдвиг седла)", unit: "мм" },
  ett: { min: 450, max: 700, label: "ETT (верхняя труба)", unit: "мм" },
  reach: { min: 280, max: 550, label: "Reach", unit: "мм" },
  stack: { min: 400, max: 700, label: "Stack", unit: "мм" },
  stem: { min: 40, max: 160, label: "Stem (вынос)", unit: "мм" },
  stemAngle: { min: -17, max: 17, label: "α (угол выноса)", unit: "°" },
  crank: { min: 150, max: 185, label: "CR (шатун)", unit: "мм" },
  wheelHeight: { min: 250, max: 450, label: "WH (радиус колеса)", unit: "мм" },
  bbHeight: { min: 200, max: 400, label: "BBH (высота каретки)", unit: "мм" },
  wheelbase: { min: 900, max: 1300, label: "WB (база)", unit: "мм" },
  sta: { min: 68, max: 80, label: "STA (угол подседельной)", unit: "°" },
  hta: { min: 60, max: 76, label: "HTA (угол рулевой)", unit: "°" },
};

// Диапазоны Stack/Reach ratio по типу велосипеда
const STACK_REACH_RATIOS: Record<string, { min: number; max: number }> = {
  road:    { min: 1.35, max: 1.55 },  // шоссе: более вытянутая посадка
  gravel:  { min: 1.40, max: 1.65 },  // грэвел: чуть выше
  mtb:     { min: 1.45, max: 1.85 },  // MTB: Long, Slack & Low — широкий диапазон
  hybrid:  { min: 1.50, max: 1.70 },  // гибрид
  city:    { min: 1.55, max: 1.80 },  // город: максимально вертикальная
};

// ============================================================
// ОСНОВНАЯ ФУНКЦИЯ ВАЛИДАЦИИ
// ============================================================

/**
 * Валидировать параметры велосипеда.
 *
 * @param bike Измеренные параметры
 * @param fieldSources Источник каждого параметра: "measured" (введён вручную в форму) или "photo" (вычислен из фото).
 *                     Если параметр не указан в fieldSources — считается, что он "measured".
 *                     Используется для подсказок: если проверка не проходит и один из параметров из фото,
 *                     то подсказка говорит «проверьте точки на фото», а не «проверьте измерения рулеткой».
 * @returns Массив проблем (пустой = всё ок)
 */
export function validateBikeMeasurements(
  bike: BikeMeasurements,
  fieldSources?: Record<string, "measured" | "photo">,
  bikeType?: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const src = (key: string): "measured" | "photo" =>
    fieldSources?.[key] ?? "measured";

  // Описание источника параметра для текста сообщения
  const srcLabel = (key: string): string =>
    src(key) === "photo" ? " [фото]" : " [ввод]";

  // Подсказка: что проверять — точки на фото или измерения рулеткой
  const fixHint = (keys: string[]): string => {
    const hasPhoto = keys.some((k) => src(k) === "photo");
    const hasMeasured = keys.some((k) => src(k) === "measured");
    if (hasPhoto && !hasMeasured) return "Проверьте положение точек на фото.";
    if (hasMeasured && !hasPhoto) return "Проверьте измерения рулеткой.";
    if (hasPhoto && hasMeasured) return "Скорее всего проблема в фото-точках — подвигайте их на фото.";
    return "Проверьте измерения.";
  };

  // === 1. ПРОВЕРКА ДИАПАЗОНОВ ===

  for (const [key, range] of Object.entries(RANGES)) {
    const value = bike[key as keyof BikeMeasurements] as number | undefined;
    if (value == null || value === 0) continue;

    if (value < range.min || value > range.max) {
      // Проверяем, не ввёл ли пользователь в см вместо мм (×10)
      const valueCm = value * 10;
      if (valueCm >= range.min && valueCm <= range.max) {
        issues.push({
          level: "warning",
          field: key,
          message: `${range.label} = ${value} — похоже, введено в см вместо мм. Умножить на 10?`,
          suggestedValue: valueCm,
        });
      } else {
        issues.push({
          level: "error",
          field: key,
          message: `${range.label} = ${value} ${range.unit} — вне физически возможного диапазона (${range.min}–${range.max} ${range.unit}). Проверьте измерение.`,
        });
      }
    }
  }

  // === 2. КРОСС-ПРОВЕРКИ (согласованность) ===

  // BB Drop = WH − BBH
  if (bike.wheelHeight && bike.bbHeight && bike.wheelHeight > 0 && bike.bbHeight > 0) {
    const bbDrop = bike.wheelHeight - bike.bbHeight;
    if (bbDrop < 0) {
      issues.push({
        level: "error",
        field: "bbHeight",
        message: `BBH (${bike.bbHeight} мм) больше WH (${bike.wheelHeight} мм) — каретка выше оси колеса? Это невозможно. Проверьте измерения.`,
      });
    } else if (bbDrop > 120) {
      issues.push({
        level: "warning",
        field: "bbHeight",
        message: `BB Drop = WH − BBH = ${bike.wheelHeight} − ${bike.bbHeight} = ${bbDrop} мм — слишком много (норма 55–85 мм). Проверьте WH или BBH.`,
      });
    } else if (bbDrop < 30) {
      issues.push({
        level: "warning",
        field: "bbHeight",
        message: `BB Drop = ${bbDrop} мм — очень мало (норма 55–85 мм). Проверьте WH или BBH.`,
      });
    }
  }

  // ETT > Reach (всегда)
  if (bike.ett && bike.reach && bike.ett > 0 && bike.reach > 0) {
    const ettSrc = src("ett");
    const reachSrc = src("reach");
    if (bike.ett < bike.reach) {
      issues.push({
        level: "warning",
        field: "ett",
        fieldSources: { ett: ettSrc, reach: reachSrc },
        suspectField: reachSrc === "photo" ? "reach" : "ett",
        message:
          `ETT (${bike.ett} мм${srcLabel("ett")}) меньше Reach (${bike.reach} мм${srcLabel("reach")}) — это невозможно. ETT всегда больше Reach. ` +
          fixHint(["ett", "reach"]),
      });
    } else if (bike.ett - bike.reach < 100) {
      issues.push({
        level: "info",
        field: "ett",
        fieldSources: { ett: ettSrc, reach: reachSrc },
        message:
          `ETT (${bike.ett} мм${srcLabel("ett")}) − Reach (${bike.reach} мм${srcLabel("reach")}) = ${bike.ett - bike.reach} мм. Обычно разница 120–180 мм. ` +
          fixHint(["ett", "reach"]),
      });
    } else if (bike.ett - bike.reach > 220) {
      issues.push({
        level: "warning",
        field: "ett",
        fieldSources: { ett: ettSrc, reach: reachSrc },
        suspectField: reachSrc === "photo" ? "reach" : "ett",
        message:
          `ETT (${bike.ett} мм${srcLabel("ett")}) − Reach (${bike.reach} мм${srcLabel("reach")}) = ${bike.ett - bike.reach} мм — слишком большая разница (норма 120–180 мм). ` +
          fixHint(["ett", "reach"]),
      });
    }
  }

  // Stack > Stem (всегда)
  if (bike.stack && bike.stem && bike.stack > 0 && bike.stem > 0) {
    if (bike.stack < bike.stem) {
      issues.push({
        level: "warning",
        field: "stack",
        fieldSources: { stack: src("stack"), stem: src("stem") },
        suspectField: src("stack") === "photo" ? "stack" : "stem",
        message:
          `Stack (${bike.stack} мм${srcLabel("stack")}) меньше Stem (${bike.stem} мм${srcLabel("stem")}) — невозможно. Stack всегда больше длины выноса. ` +
          fixHint(["stack", "stem"]),
      });
    }
  }

  // Stack/Reach ratio — с учётом типа велосипеда
  if (bike.stack && bike.reach && bike.stack > 0 && bike.reach > 0) {
    const ratio = bike.stack / bike.reach;
    const bothPhoto = src("stack") === "photo" && src("reach") === "photo";
    // Диапазон по типу велосипеда (default — универсальный)
    const ratioRange = bikeType
      ? STACK_REACH_RATIOS[bikeType] ?? { min: 1.35, max: 1.75 }
      : { min: 1.35, max: 1.75 };

    if (ratio < ratioRange.min - 0.1) {
      issues.push({
        level: "warning",
        field: "stack",
        fieldSources: { stack: src("stack"), reach: src("reach") },
        suspectField: src("stack") === "photo" ? "stack" : "reach",
        message:
          `Stack/Reach = ${ratio.toFixed(2)} — очень низкое (норма для ${bikeType ?? "велосипеда"}: ${ratioRange.min}–${ratioRange.max}). ` +
          (bothPhoto ? "Stack и Reach вычислены из фото — проверьте положение точек BB и HT верх." : fixHint(["stack", "reach"])),
      });
    } else if (ratio > ratioRange.max + 0.1) {
      issues.push({
        level: "warning",
        field: "stack",
        fieldSources: { stack: src("stack"), reach: src("reach") },
        suspectField: src("stack") === "photo" ? "stack" : "reach",
        message:
          `Stack/Reach = ${ratio.toFixed(2)} — очень высокое (норма для ${bikeType ?? "велосипеда"}: ${ratioRange.min}–${ratioRange.max}). ` +
          (bothPhoto
            ? "Stack и Reach вычислены из фото — проверьте положение точек BB и HT верх (HT слишком высоко или BB слишком низко)."
            : fixHint(["stack", "reach"])),
      });
    }
  }

  // WB > Reach (всегда)
  if (bike.wheelbase && bike.reach && bike.wheelbase > 0 && bike.reach > 0) {
    if (bike.wheelbase < bike.reach) {
      issues.push({
        level: "warning",
        field: "wheelbase",
        fieldSources: { wheelbase: src("wheelbase"), reach: src("reach") },
        suspectField: src("reach") === "photo" ? "reach" : "wheelbase",
        message:
          `WB (${bike.wheelbase} мм${srcLabel("wheelbase")}) меньше Reach (${bike.reach} мм${srcLabel("reach")}) — невозможно. Колёсная база всегда больше Reach. ` +
          fixHint(["wheelbase", "reach"]),
      });
    }
  }

  // SH vs Stack (SH всегда больше Stack)
  if (bike.saddleHeight && bike.stack && bike.saddleHeight > 0 && bike.stack > 0) {
    if (bike.saddleHeight < bike.stack) {
      // SH — это измерение рулеткой (если только не вычислено из фото, но SH обычно измеряют).
      // Stack — вычислен из фото или взят из таблицы.
      // Если Stack из фото — он скорее всего неверный, не SH.
      const stackSrc = src("stack");
      const shSrc = src("saddleHeight");
      issues.push({
        level: "warning",
        field: "stack",
        fieldSources: { saddleHeight: shSrc, stack: stackSrc },
        suspectField: stackSrc === "photo" ? "stack" : "saddleHeight",
        message:
          `SH (${bike.saddleHeight} мм${srcLabel("saddleHeight")}) меньше Stack (${bike.stack} мм${srcLabel("stack")}) — невозможно. ` +
          (stackSrc === "photo"
            ? `SH измерена вручную, Stack вычислен из фото → скорее всего ошибка в точке «HT верх» на фото (поднята слишком высоко). ` + fixHint(["stack"])
            : `Проверьте высоту седла (BB → крепление седла) — возможно, измерена неверно. ` + fixHint(["saddleHeight"])),
      });
    }
  }

  // CR типичные значения (150-185, обычно кратно 2.5)
  if (bike.crank && bike.crank > 0) {
    const standardValues = [150, 152.5, 155, 157.5, 160, 162.5, 165, 167.5, 170, 172.5, 175, 177.5, 180];
    const isStandard = standardValues.some(v => Math.abs(bike.crank! - v) < 0.6);
    if (!isStandard) {
      issues.push({
        level: "info",
        field: "crank",
        message: `CR = ${bike.crank} мм — нестандартная длина. Обычно 165/170/172.5/175. Проверьте на шатуне.`,
      });
    }
  }

  // WH типичные значения (для 700c ~330-340)
  if (bike.wheelHeight && bike.wheelHeight > 0) {
    if (bike.wheelHeight >= 330 && bike.wheelHeight <= 340) {
      // 700c — норма, ничего не говорим
    } else if (bike.wheelHeight > 360 && bike.wheelHeight < 380) {
      // Возможно 29" MTB
      issues.push({
        level: "info",
        field: "wheelHeight",
        message: `WH = ${bike.wheelHeight} мм — похоже на 29" MTB колесо.`,
      });
    } else if (bike.wheelHeight < 300) {
      issues.push({
        level: "info",
        field: "wheelHeight",
        message: `WH = ${bike.wheelHeight} мм — маленькое колесо. Проверьте тип велосипеда (детский/складной?).`,
      });
    }
  }

  return issues;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Получить количество проблем по уровню.
 */
export function getIssueCounts(issues: ValidationIssue[]): {
  errors: number;
  warnings: number;
  infos: number;
} {
  return {
    errors: issues.filter(i => i.level === "error").length,
    warnings: issues.filter(i => i.level === "warning").length,
    infos: issues.filter(i => i.level === "info").length,
  };
}

/**
 * Проверить, можно ли использовать параметры (нет критических ошибок).
 */
export function isBikeDataUsable(issues: ValidationIssue[]): boolean {
  return issues.filter(i => i.level === "error").length === 0;
}
