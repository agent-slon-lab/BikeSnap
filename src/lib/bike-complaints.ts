/**
 * Дерево жалоб велосипедиста → причины → рекомендации
 *
 * Структура: каждая жалоба связана с первичными/вторичными/третичными причинами,
 * каждая причина имеет:
 * - метрику, по которой её можно выявить (если применимо)
 * - конкретное действие по корректировке
 * - приоритет (1 = сначала делать, 2 = если не помогло, 3 = тонкая настройка)
 *
 * Источники:
 * - "Bike Fit" by Phil Burt (2014)
 * - Shimano Bike Fitting Manual
 * - Healthy Cycling blog
 */

import type { Complaint } from "./bike-store";
import type { ViewType, BikeFitAnalysis, BackViewAnalysis, FrontViewAnalysis } from "./bike-fit";

export type Priority = 1 | 2 | 3;

export interface ComplaintCause {
  /** Краткое название причины */
  title: string;
  /** Подробное описание */
  description: string;
  /** Приоритет: 1 = сначала, 2 = если не помогло, 3 = тонкая настройка */
  priority: Priority;
  /** Конкретное действие по корректировке */
  action: string;
  /** Ожидаемая длительность адаптации (дней) */
  adaptationDays: number;
  /** Связанная метрика (для автоматического определения) */
  relatedMetric?: {
    view: ViewType;
    /** Ключ метрики в BikeFitAnalysis/BackViewAnalysis/FrontViewAnalysis */
    key: string;
    /** Условие срабатывания: 'bad' или 'warning' */
    trigger: "bad" | "warning";
  };
}

export interface ComplaintRule {
  complaint: Complaint;
  label: string;
  emoji: string;
  /** Причины, отсортированные по приоритету */
  causes: ComplaintCause[];
}

/**
 * Полное дерево жалоб
 */
export const COMPLAINT_RULES: ComplaintRule[] = [
  {
    complaint: "knee_pain",
    label: "Боль в колене",
    emoji: "🦵",
    causes: [
      {
        title: "Слишком низкое седло",
        description:
          "Колено слишком согнуто в НМТ — перегружаются квадрицепсы и надколенник. Самая частая причина боли спереди колена.",
        priority: 1,
        action:
          "Поднимите седло на 5 мм. Проверьте угол колена в НМТ — должен быть 25-35°.",
        adaptationDays: 3,
        relatedMetric: {
          view: "side",
          key: "kneeAngle",
          trigger: "bad",
        },
      },
      {
        title: "Слишком высокое седло",
        description:
          "Колено слишком прямое в НМТ — перегружается подколенное сухожилие и задняя часть колена. Боль сзади колена.",
        priority: 1,
        action:
          "Опустите седло на 5 мм. Проверьте, что таз не раскачивается при педалировании.",
        adaptationDays: 3,
        relatedMetric: {
          view: "side",
          key: "kneeAngle",
          trigger: "bad",
        },
      },
      {
        title: "KOPS нарушен",
        description:
          "Колено слишком впереди или позади оси педали в горизонтальном положении шатуна. Нагружает колено неравномерно.",
        priority: 2,
        action:
          "Сдвиньте седло по рельсам вперёд или назад на 5 мм. Цель — колено над осью педали (KOPS).",
        adaptationDays: 5,
        relatedMetric: {
          view: "side",
          key: "kops",
          trigger: "bad",
        },
      },
      {
        title: "Шипы на обуви стоят неправильно",
        description:
          "Слишком большой угол шипа вызывает вращение стопы в педали, что передаётся на колено.",
        priority: 3,
        action:
          "Проверьте симметрию коленей по виду сзади. Если колени завалены внутрь/наружу — корректируйте шипы.",
        adaptationDays: 7,
        relatedMetric: {
          view: "back",
          key: "kneeDeviation",
          trigger: "bad",
        },
      },
      {
        title: "Слишком длинный шатун",
        description:
          "Длинный шатун заставляет колено сгибаться сильнее в ВМТ. Особенно важно для низких райдеров.",
        priority: 3,
        action:
          "Замените шатуны на более короткие (170 мм вместо 172.5 мм). Проверьте угол колена в ВМТ.",
        adaptationDays: 14,
      },
    ],
  },
  {
    complaint: "neck_pain",
    label: "Боль в шее",
    emoji: "🧠",
    causes: [
      {
        title: "Слишком низкий руль",
        description:
          "Приходится запрокидывать голову вверх, чтобы видеть дорогу. Перегружается шея.",
        priority: 1,
        action:
          "Поднимите вынос руля (используйте проставочные кольца) или замените вынос на более короткий с углом вверх.",
        adaptationDays: 5,
        relatedMetric: {
          view: "side",
          key: "backAngle",
          trigger: "bad",
        },
      },
      {
        title: "Слишком большой reach",
        description:
          "Приходится тянуться к рулю, что перегружает шею и плечи.",
        priority: 1,
        action:
          "Замените вынос на более короткий (на 10 мм короче). Или сдвиньте седло вперёд на 5 мм.",
        adaptationDays: 5,
        relatedMetric: {
          view: "side",
          key: "shoulderAngle",
          trigger: "bad",
        },
      },
      {
        title: "Седло слишком завалено назад",
        description:
          "Нос седла задран вверх, таз скользит назад, увеличивается дистанция до руля.",
        priority: 2,
        action:
          "Выровняйте седло горизонтально (нос должен быть на уровне или чуть ниже зада).",
        adaptationDays: 2,
      },
      {
        title: "Плохая гибкость шеи",
        description:
          "Если вы новичок — шеи нужно время, чтобы привыкнуть к новой посадке.",
        priority: 3,
        action:
          "Начните с более коротких поездок (до 1 часа). Делайте упражнения на растяжку шеи ежедневно.",
        adaptationDays: 14,
      },
    ],
  },
  {
    complaint: "wrist_numbness",
    label: "Онемение кистей",
    emoji: "✋",
    causes: [
      {
        title: "Слишком низкий руль",
        description:
          "Большая часть веса тела переносится на руки, давит на срединный нерв.",
        priority: 1,
        action:
          "Поднимите руль. Цель — ~40% веса на руки, ~60% на седло.",
        adaptationDays: 3,
        relatedMetric: {
          view: "side",
          key: "shoulderAngle",
          trigger: "bad",
        },
      },
      {
        title: "Слишком узкий руль",
        description:
          "Узкий руль концентрирует давление на ладони, пережимает нерв.",
        priority: 1,
        action:
          "Замените руль на более широкий (на 20 мм шире плеч) или расширьте хват.",
        adaptationDays: 3,
        relatedMetric: {
          view: "front",
          key: "gripWidth",
          trigger: "bad",
        },
      },
      {
        title: "Угол тормозных ручек",
        description:
          "Если ручки наклонены вниз — приходится выкручивать запястья, что пережимает нерв.",
        priority: 2,
        action:
          "Наклоните тормозные ручки так, чтобы при хвате предплечье и кисть были на одной линии.",
        adaptationDays: 1,
      },
      {
        title: "Седло слишком завалено вперёд",
        description:
          "Таз скользит вперёд, руки перегружаются, чтобы удержать тело.",
        priority: 2,
        action: "Выровняйте седло или слегка задерите нос вверх (на 1-2°).",
        adaptationDays: 2,
      },
      {
        title: "Слишком высокий седл",
        description:
          "Таз раскачивается при педалировании, тело ищет опору через руки.",
        priority: 3,
        action:
          "Опустите седло на 3-5 мм. Проверьте угол колена в НМТ.",
        adaptationDays: 3,
        relatedMetric: {
          view: "side",
          key: "kneeAngle",
          trigger: "warning",
        },
      },
    ],
  },
  {
    complaint: "lower_back",
    label: "Боль в пояснице",
    emoji: "↩️",
    causes: [
      {
        title: "Слишком низкий руль (агрессивная посадка)",
        description:
          "Спина переразогнута, поясница перегружена. Самая частая причина.",
        priority: 1,
        action:
          "Поднимите вынос на 5-10 мм или замените на более короткий.",
        adaptationDays: 7,
        relatedMetric: {
          view: "side",
          key: "backAngle",
          trigger: "bad",
        },
      },
      {
        title: "Седло слишком завалено вперёд",
        description:
          "Таз скользит вперёд, поясница скругляется, чтобы удержать тело.",
        priority: 1,
        action: "Выровняйте седло или слегка задерите нос вверх.",
        adaptationDays: 3,
      },
      {
        title: "Слишком большой reach",
        description:
          "Тянемся к рулю, поясница постоянно в напряжении.",
        priority: 2,
        action:
          "Уменьшите reach: более короткий вынос или седло вперёд.",
        adaptationDays: 7,
        relatedMetric: {
          view: "side",
          key: "hipAngle",
          trigger: "warning",
        },
      },
      {
        title: "Низкая гибкость поясницы",
        description:
          "Подколенные сухожилия натянуты, тянут таз назад, поясница скругляется.",
        priority: 3,
        action:
          "Растягивайте подколенные сухожилия ежедневно. Поднимите руль до улучшения гибкости.",
        adaptationDays: 30,
      },
    ],
  },
  {
    complaint: "saddle_sore",
    label: "Дискомфорт в промежности",
    emoji: "🪑",
    causes: [
      {
        title: "Седло слишком высоко",
        description:
          "Таз не находит опоры, раскачивается, трётся о седло.",
        priority: 1,
        action: "Опустите седло на 3-5 мм. Проверьте угол колена в НМТ.",
        adaptationDays: 3,
        relatedMetric: {
          view: "side",
          key: "kneeAngle",
          trigger: "bad",
        },
      },
      {
        title: "Нос седла задран вверх",
        description:
          "Давление на мягкие ткани промежности вместо седалищных бугров.",
        priority: 1,
        action: "Опустите нос седла на 1-2°. Должно быть горизонтально.",
        adaptationDays: 2,
      },
      {
        title: "Слишком широкий reach",
        description:
          "Тянемся к рулю, таз скользит вперёд на узкую часть седла.",
        priority: 2,
        action: "Уменьшите reach: более короткий вынос или седло вперёд.",
        adaptationDays: 5,
        relatedMetric: {
          view: "side",
          key: "hipAngle",
          trigger: "warning",
        },
      },
      {
        title: "Неправильное седло",
        description:
          "Ширина седла не соответствует расстоянию между седалищными буграми.",
        priority: 3,
        action:
          "Измерьте расстояние между седалищными буграми и подберите седло правильной ширины.",
        adaptationDays: 14,
      },
      {
        title: "Слишком мягкое седло",
        description:
          "Мягкое седло проминается, давление переходит на мягкие ткани.",
        priority: 3,
        action:
          "Используйте более жёсткое седло с вырезом в центре (cut-out).",
        adaptationDays: 14,
      },
    ],
  },
  {
    complaint: "foot_numbness",
    label: "Онемение стоп",
    emoji: "🦶",
    causes: [
      {
        title: "Шип слишком далеко вперёд",
        description:
          "Давление на подушечку стопы, пережимается нерв.",
        priority: 1,
        action:
          "Сдвиньте шипы назад на 2-3 мм. Цель — ось шипа под подушечкой стопы или чуть позади.",
        adaptationDays: 5,
      },
      {
        title: "Седло слишком высоко",
        description:
          "Тянемся носком вниз, стопа пережимается в обуви.",
        priority: 1,
        action: "Опустите седло на 3-5 мм.",
        adaptationDays: 3,
        relatedMetric: {
          view: "side",
          key: "ankleAngle",
          trigger: "bad",
        },
      },
      {
        title: "Тугие застёжки",
        description:
          "Слишком сильно затянуты липучки или BOA на обуви.",
        priority: 2,
        action:
          "Ослабьте застёжки. Стопа должна свободно двигаться в обуви.",
        adaptationDays: 1,
      },
      {
        title: "Слишком мягкая стелька",
        description:
          "Стопа проседает, свод стопы пережимается.",
        priority: 3,
        action:
          "Используйте ортопедические стельки с поддержкой свода стопы.",
        adaptationDays: 14,
      },
    ],
  },
  {
    complaint: "shoulder_pain",
    label: "Боль в плечах",
    emoji: "💪",
    causes: [
      {
        title: "Слишком широкий руль",
        description:
          "Перегружаются трапеции и дельтовидные мышцы.",
        priority: 1,
        action: "Сузьте хват или замените руль на более узкий.",
        adaptationDays: 5,
        relatedMetric: {
          view: "front",
          key: "gripWidth",
          trigger: "bad",
        },
      },
      {
        title: "Слишком низкий руль",
        description:
          "Тело перевешивается на руки, плечи перегружены.",
        priority: 1,
        action: "Поднимите вынос на 5-10 мм.",
        adaptationDays: 5,
        relatedMetric: {
          view: "side",
          key: "shoulderAngle",
          trigger: "bad",
        },
      },
      {
        title: "Седло слишком завалено вперёд",
        description:
          "Таз скользит, нагрузка переходит на руки и плечи.",
        priority: 2,
        action: "Выровняйте седло горизонтально.",
        adaptationDays: 3,
      },
      {
        title: "Несимметричный хват",
        description:
          "Одна рука дальше на руле, чем другая — плечи несимметричны.",
        priority: 3,
        action: "Проверьте симметрию хвата по виду спереди.",
        adaptationDays: 3,
        relatedMetric: {
          view: "front",
          key: "elbowAngleSymmetry",
          trigger: "warning",
        },
      },
    ],
  },
];

// ============================================================
// Helper functions
// ============================================================

/**
 * Получить все причины для списка жалоб, отсортированные по приоритету.
 * Опционально фильтрует по метрикам из анализа (если причина срабатывает).
 */
export interface AnalysisResults {
  side: BikeFitAnalysis | null;
  back: BackViewAnalysis | null;
  front: FrontViewAnalysis | null;
}

/**
 * Извлечь метрику по виду и ключу
 */
function getMetricValue(
  analysis: AnalysisResults,
  view: ViewType,
  key: string
): { status: "good" | "warning" | "bad" } | null {
  let source: Record<string, { status: "good" | "warning" | "bad" }> | null = null;
  if (view === "side") source = analysis.side as unknown as Record<string, { status: "good" | "warning" | "bad" }> | null;
  else if (view === "back") source = analysis.back as unknown as Record<string, { status: "good" | "warning" | "bad" }> | null;
  else if (view === "front") source = analysis.front as unknown as Record<string, { status: "good" | "warning" | "bad" }> | null;
  if (!source) return null;
  const metric = source[key];
  if (!metric) return null;
  return metric;
}

/**
 * Получить причины для жалоб, отсортированные по приоритету.
 * Если передан анализ — добавляет флаг "triggered" (сработала ли причина по метрике).
 */
export interface CauseWithTrigger extends ComplaintCause {
  /** Сработала ли причина по метрике из анализа */
  triggered: boolean;
}

export function getCausesForComplaints(
  complaints: Complaint[],
  analysis?: AnalysisResults
): CauseWithTrigger[] {
  if (complaints.length === 0 || complaints.includes("none")) return [];

  const causes: CauseWithTrigger[] = [];

  for (const c of complaints) {
    if (c === "none") continue;
    const rule = COMPLAINT_RULES.find((r) => r.complaint === c);
    if (!rule) continue;

    for (const cause of rule.causes) {
      let triggered = false;
      if (cause.relatedMetric && analysis) {
        const metric = getMetricValue(
          analysis,
          cause.relatedMetric.view,
          cause.relatedMetric.key
        );
        if (metric && metric.status === cause.relatedMetric.trigger) {
          triggered = true;
        }
      }
      causes.push({ ...cause, triggered });
    }
  }

  // Сортируем: сначала triggered, потом по приоритету
  return causes.sort((a, b) => {
    if (a.triggered !== b.triggered) return a.triggered ? -1 : 1;
    return a.priority - b.priority;
  });
}

/**
 * Группировка причин по приоритетам
 */
export function groupCausesByPriority(
  causes: CauseWithTrigger[]
): Record<Priority, CauseWithTrigger[]> {
  return {
    1: causes.filter((c) => c.priority === 1),
    2: causes.filter((c) => c.priority === 2),
    3: causes.filter((c) => c.priority === 3),
  };
}
