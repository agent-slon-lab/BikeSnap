/**
 * Автосвязь между калибровкой велосипеда и фотоанализом позы.
 *
 * Объединяет:
 * - Геометрию рамы (из калибровки фото вела: Reach, Stack, ETT, BBH)
 * - Параметры тела (рост, inseam, гибкость)
 * - Углы позы (из фотоанализа: колено, бедро, спина, плечо, KOPS)
 * - Жалобы пользователя
 *
 * Выдаёт комплексные рекомендации, связывающие геометрию с позой.
 */

import type { BikeFitAnalysis } from "./bike-fit";
import type { BikeMeasurements, BodyMeasurements, RiderGoal, CalcResults } from "./bike-calculations";
import type { Complaint } from "./bike-store";
import { getCausesForComplaints, type AnalysisResults, type CauseWithTrigger } from "./bike-complaints";

export interface CrossReference {
  /** Категория рекомендации */
  category: "saddle" | "stem" | "handlebar" | "cleats" | "frame" | "posture";
  /** Что обнаружено */
  finding: string;
  /** Связь: геометрия ↔ поза */
  connection: string;
  /** Конкретное действие */
  action: string;
  /** Приоритет: 1 = срочно, 2 = важно, 3 = желательно */
  priority: 1 | 2 | 3;
  /** Источники данных */
  sources: string[];
}

export interface CrossRefResult {
  crossReferences: CrossReference[];
  /** Сводка: сколько рекомендаций по категориям */
  summary: {
    saddle: number;
    stem: number;
    handlebar: number;
    cleats: number;
    frame: number;
    posture: number;
  };
}

/**
 * Сгенерировать комплексные рекомендации, связывающие геометрию рамы с позой.
 */
export function generateCrossReferences(
  bike: BikeMeasurements,
  body: BodyMeasurements,
  goal: RiderGoal | null,
  calc: CalcResults | null,
  sideAnalysis: BikeFitAnalysis | null,
  complaints: Complaint[],
): CrossRefResult {
  const refs: CrossReference[] = [];

  // === 1. SH (высота седла) ↔ угол колена ===
  if (sideAnalysis && bike.saddleHeight && body.inseam > 0) {
    const kneeAngle = sideAnalysis.kneeAngle;
    const targetSH = calc?.recommendedSaddleHeight;
    const currentSH = bike.saddleHeight;
    const shDelta = targetSH ? currentSH - targetSH : null;

    if (kneeAngle.status === "bad" || kneeAngle.status === "warning") {
      if (kneeAngle.value > 35) {
        // Колено слишком прямое → седло слишком высоко
        refs.push({
          category: "saddle",
          finding: `Угол колена ${kneeAngle.value.toFixed(1)}° — слишком прямое (норма 25-35°)`,
          connection: `SH=${currentSH} мм, целевая по LeMond=${targetSH} мм → седло выше нормы на ${shDelta != null ? Math.abs(shDelta) : "?"} мм`,
          action: `Опустите седло на ${shDelta != null ? Math.abs(shDelta) : 5} мм`,
          priority: 1,
          sources: ["фото позы (угол колена)", "калибровка (SH)", "формула LeMond"],
        });
      } else {
        // Колено слишком согнутое → седло слишком низко
        refs.push({
          category: "saddle",
          finding: `Угол колена ${kneeAngle.value.toFixed(1)}° — слишком согнутое (норма 25-35°)`,
          connection: `SH=${currentSH} мм, целевая по LeMond=${targetSH} мм → седло ниже нормы на ${shDelta != null ? Math.abs(shDelta) : "?"} мм`,
          action: `Поднимите седло на ${shDelta != null ? Math.abs(shDelta) : 5} мм`,
          priority: 1,
          sources: ["фото позы (угол колена)", "калибровка (SH)", "формула LeMond"],
        });
      }
    }
  }

  // === 2. Reach ↔ угол плеча / спины ===
  if (sideAnalysis && bike.reach && body.height > 0) {
    const shoulderAngle = sideAnalysis.shoulderAngle;
    const backAngle = sideAnalysis.backAngle;
    const targetReach = calc?.targetReach;
    const reachDelta = targetReach ? bike.reach - targetReach : null;

    if (shoulderAngle.status === "bad" && reachDelta != null && reachDelta > 15) {
      refs.push({
        category: "stem",
        finding: `Угол плеча ${shoulderAngle.value.toFixed(1)}° — руки перерастянуты (норма 70-100°)`,
        connection: `Reach=${bike.reach} мм, целевой=${targetReach} мм → рама/вынос длиннее нормы на ${Math.abs(reachDelta)} мм`,
        action: `Замените вынос на более короткий (на ${Math.min(Math.round(Math.abs(reachDelta) / 10) * 10, 40)} мм короче)`,
        priority: 2,
        sources: ["фото позы (угол плеча)", "калибровка (Reach)", "формула по росту"],
      });
    }

    if (backAngle.status === "bad" && reachDelta != null && reachDelta > 15) {
      refs.push({
        category: "stem",
        finding: `Наклон корпуса ${backAngle.value.toFixed(1)}° — слишком вытянутая посадка (норма 30-55°)`,
        connection: `Reach=${bike.reach} мм — длиннее целевого ${targetReach} мм на ${Math.abs(reachDelta)} мм`,
        action: `Уменьшите Reach: более короткий вынос или сдвиньте седло вперёд`,
        priority: 2,
        sources: ["фото позы (наклон спины)", "калибровка (Reach)"],
      });
    }

    if (backAngle.status === "bad" && reachDelta != null && reachDelta < -15) {
      refs.push({
        category: "frame",
        finding: `Наклон корпуса ${backAngle.value.toFixed(1)}° — слишком вертикальная посадка`,
        connection: `Reach=${bike.reach} мм — короче целевого ${targetReach} мм на ${Math.abs(reachDelta)} мм`,
        action: `Рама слишком короткая. Увеличьте Reach: более длинный вынос или сдвиньте седло назад`,
        priority: 3,
        sources: ["фото позы (наклон спины)", "калибровка (Reach)"],
      });
    }
  }

  // === 3. Stack ↔ угол спины + угол выноса (α) ===
  if (sideAnalysis && bike.stack && body.height > 0) {
    const backAngle = sideAnalysis.backAngle;
    const targetStack = calc?.targetStack;
    const stackDelta = targetStack ? bike.stack - targetStack : null;
    const stemAngle = bike.stemAngle ?? 0;

    if (backAngle.status === "bad" && stackDelta != null && stackDelta < -15) {
      // Стек слишком низкий → нужно поднять руль
      const angleAdvice = stemAngle < 6
        ? `Также замените вынос с углом ${stemAngle}° на +6° или +10°`
        : `Добавьте проставочные кольца под вынос`;
      refs.push({
        category: "handlebar",
        finding: `Наклон корпуса ${backAngle.value.toFixed(1)}° — слишком низко (норма 30-55°)`,
        connection: `Stack=${bike.stack} мм, целевой=${targetStack} мм → ниже нормы на ${Math.abs(stackDelta)} мм. Угол выноса α=${stemAngle}°`,
        action: `Поднимите руль: ${angleAdvice}`,
        priority: 2,
        sources: ["фото позы (наклон спины)", "калибровка (Stack)", "угол выноса α"],
      });
    }

    if (backAngle.status === "bad" && stackDelta != null && stackDelta > 15) {
      refs.push({
        category: "handlebar",
        finding: `Наклон корпуса ${backAngle.value.toFixed(1)}° — слишком вертикально (норма 30-55°)`,
        connection: `Stack=${bike.stack} мм, целевой=${targetStack} мм → выше нормы на ${Math.abs(stackDelta)} мм`,
        action: `Опустите руль: снимите проставочные кольца или замените вынос на более отрицательный угол`,
        priority: 3,
        sources: ["фото позы (наклон спины)", "калибровка (Stack)"],
      });
    }
  }

  // === 4. KOPS ↔ угол колена + Setback ===
  if (sideAnalysis) {
    const kops = sideAnalysis.kops;
    if (kops.status === "bad") {
      const direction = kops.value > 3 ? "вперёд" : "назад";
      refs.push({
        category: "saddle",
        finding: `KOPS: колено смещено ${direction} от оси педали на ${kops.value.toFixed(1)} ед.`,
        connection: `Регулируется сдвигом седла по рельсам ${direction === "вперёд" ? "назад" : "вперёд"}`,
        action: `Сдвиньте седло ${direction === "вперёд" ? "назад на 5-10 мм" : "вперёд на 5-10 мм"} по рельсам`,
        priority: 2,
        sources: ["фото позы (KOPS)"],
      });
    }
  }

  // === 5. Угол бедра ↔ Reach + ETT ===
  if (sideAnalysis && bike.ett && bike.reach) {
    const hipAngle = sideAnalysis.hipAngle;
    if (hipAngle.status === "bad" && hipAngle.value < 40) {
      refs.push({
        category: "frame",
        finding: `Угол бедра ${hipAngle.value.toFixed(1)}° — слишком закрытый (норма 40-55°)`,
        connection: `ETT=${bike.ett} мм, Reach=${bike.reach} мм → возможно рама слишком длинная`,
        action: `Уменьшите дистанцию седло-руль: короткий вынос или седло вперёд`,
        priority: 2,
        sources: ["фото позы (угол бедра)", "калибровка (ETT, Reach)"],
      });
    }
  }

  // === 6. BB Drop ↔ устойчивость ===
  if (calc?.bbDrop != null && goal) {
    if (calc.bbDrop < 60 && goal.bikeType === "road") {
      refs.push({
        category: "frame",
        finding: `BB Drop = ${calc.bbDrop} мм — высокий для шоссейника (норма 65-75 мм)`,
        connection: `Вычислено из WH=${bike.wheelHeight} мм − BBH=${bike.bbHeight} мм`,
        action: `Это геометрия рамы — не регулируется. Высокий BB Drop = менее стабильно в поворотах`,
        priority: 3,
        sources: ["калибровка (WH, BBH)"],
      });
    }
  }

  // === 7. Угол голеностопа ↔ высота седла ===
  if (sideAnalysis && bike.saddleHeight) {
    const ankleAngle = sideAnalysis.ankleAngle;
    if (ankleAngle.status === "bad" && ankleAngle.value > 110) {
      refs.push({
        category: "saddle",
        finding: `Угол голеностопа ${ankleAngle.value.toFixed(1)}° — носок опущен (норма 90-110°)`,
        connection: `SH=${bike.saddleHeight} мм — возможно седло слишком высоко, приходится тянуться носком`,
        action: `Опустите седло на 2-3 мм. Проверьте положение шипов`,
        priority: 2,
        sources: ["фото позы (голеностоп)", "калибровка (SH)"],
      });
    }
  }

  // Сортировка по приоритету
  refs.sort((a, b) => a.priority - b.priority);

  // Сводка
  const summary = {
    saddle: refs.filter(r => r.category === "saddle").length,
    stem: refs.filter(r => r.category === "stem").length,
    handlebar: refs.filter(r => r.category === "handlebar").length,
    cleats: refs.filter(r => r.category === "cleats").length,
    frame: refs.filter(r => r.category === "frame").length,
    posture: refs.filter(r => r.category === "posture").length,
  };

  return { crossReferences: refs, summary };
}
