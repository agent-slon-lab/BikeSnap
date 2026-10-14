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
import { SADDLE_HIERARCHY_THRESHOLD_MM } from "./poseMetricsEngine";
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
  /** true — карточка фиксирует ПРОТИВОРЕЧИЕ в данных, а не даёт directive (v1.14.28) */
  conflict?: boolean;
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

  // Правило склейки советов по седлу (ТЗ v1.14.22, порог 15 мм с v1.14.29 —
  // Issue #6): если дельта высоты седла с LeMond > 15 мм — приоритет у крупной
  // коррекции по формуле рамы, а микро-подстройки 2–3 мм (угол голеностопа
  // и т.п.) скрываются как шум. Единственный источник порога —
  // SADDLE_HIERARCHY_THRESHOLD_MM из poseMetricsEngine.
  const shDeltaAbs =
    bike.saddleHeight && calc?.recommendedSaddleHeight
      ? Math.abs(bike.saddleHeight - calc.recommendedSaddleHeight)
      : null;
  const lemondDominates = shDeltaAbs != null && shDeltaAbs > SADDLE_HIERARCHY_THRESHOLD_MM;

  // === 1. SH (высота седла) ↔ угол колена (анатомический, норма 140–150°) ===
  // v1.14.28: раньше при прямой ноге текст ВСЕГДА писал «седло выше нормы»,
  // даже когда SH ниже целевой (пользователь: «ввёл 680, целевая 759, а пишет
  // „выше нормы на 79“ и предлагает опустить» — бред). Теперь знак берём из
  // дельты, а при расхождении угла колена и SH честно фиксируем противоречие.
  if (sideAnalysis && bike.saddleHeight && body.inseam > 0) {
    const kneeAngle = sideAnalysis.kneeAngle;
    const targetSH = calc?.recommendedSaddleHeight;
    const currentSH = bike.saddleHeight;
    const shDelta = targetSH ? currentSH - targetSH : null; // > 0 — седло выше целевой
    const flexTxt = kneeAngle.flexion ? kneeAngle.flexion.value.toFixed(0) : "30-40";

    if (kneeAngle.status === "bad" || kneeAngle.status === "warning") {
      const legTooStraight = kneeAngle.value > 150; // нога прямая → седло ведёт себя как завышенное
      const legTooBent = kneeAngle.value < 140;     // нога согнута → седло ведёт себя как заниженное

      // ПРОТИВОРЕЧИЕ: угол колена и высота седла указывают в разные стороны
      const contradicts =
        shDelta != null && ((legTooStraight && shDelta < -5) || (legTooBent && shDelta > 5));

      if (contradicts) {
        const diff = Math.abs(shDelta!);
        refs.push({
          category: "saddle",
          finding: legTooStraight
            ? `Противоречие: колено ${kneeAngle.value.toFixed(1)}° — нога прямая, но седло НИЖЕ целевой на ${diff} мм`
            : `Противоречие: колено ${kneeAngle.value.toFixed(1)}° — нога согнута, но седло ВЫШЕ целевой на ${diff} мм`,
          connection: `SH=${currentSH} мм против ${targetSH} мм по LeMond (разница ${diff} мм), при этом угол колена говорит об обратном. Два источника данных противоречат друг другу — вслепую двигать седло нельзя.`,
          action: "Седло не трогайте. Проверьте: педаль в кадре в нижней точке (НМТ), разметку колена/лодыжки, правильность измерения SH. Если кадр и разметка верны — ориентируйтесь на угол колена, а не на формулу.",
          priority: 1,
          sources: ["фото позы (угол колена)", "калибровка (SH)", "формула LeMond", "кросс-валидация"],
          conflict: true,
        });
      } else if (legTooStraight) {
        refs.push({
          category: "saddle",
          finding: `Угол колена ${kneeAngle.value.toFixed(1)}° — нога слишком прямая (норма 140-150°; сгиб ${flexTxt}°)`,
          connection:
            shDelta != null && shDelta > 5
              ? `SH=${currentSH} мм выше целевой по LeMond (${targetSH} мм) на ${shDelta} мм`
              : `SH=${currentSH} мм — по углу колена седло ведёт себя как завышенное`,
          action:
            shDelta != null && shDelta > 5
              ? `Опустите седло на ${shDelta} мм`
              : "Опустите седло на 10-15 мм и повторите анализ",
          priority: 1,
          sources: ["фото позы (угол колена)", "калибровка (SH)", "формула LeMond"],
        });
      } else if (legTooBent) {
        refs.push({
          category: "saddle",
          finding: `Угол колена ${kneeAngle.value.toFixed(1)}° — слишком согнутое (норма 140-150°; сгиб ${flexTxt}°)`,
          connection:
            shDelta != null && shDelta < -5
              ? `SH=${currentSH} мм ниже целевой по LeMond (${targetSH} мм) на ${Math.abs(shDelta)} мм`
              : `SH=${currentSH} мм — по углу колена седло ведёт себя как заниженное`,
          action:
            shDelta != null && shDelta < -5
              ? `Поднимите седло на ${Math.abs(shDelta)} мм`
              : "Поднимите седло на 10-15 мм и повторите анализ",
          priority: 1,
          sources: ["фото позы (угол колена)", "калибровка (SH)", "формула LeMond"],
        });
      }
    } else if (shDelta != null && Math.abs(shDelta) > SADDLE_HIERARCHY_THRESHOLD_MM) {
      // 1b (v1.14.29, Issue #6): дельта SH с LeMond больше порога, а угол
      // колена в кадре в норме. Спека: «выводить ТОЛЬКО крупную правку
      // высоты седла» — микро-советы и так подавлены (lemondDominates).
      // Честно показываем крупную правку, помечая расхождение данных
      // (философия v1.14.28: вслепую двигать седло нельзя).
      const diff = Math.abs(shDelta);
      refs.push({
        category: "saddle",
        finding: `Высота седла расходится с расчётной на ${diff} мм (SH=${currentSH} мм, целевая ${targetSH} мм)`,
        connection: `Формула LeMond (inseam × 0.883) даёт ${targetSH} мм против введённой SH=${currentSH} мм — расхождение превышает порог ${SADDLE_HIERARCHY_THRESHOLD_MM} мм. Угол колена на фото при этом в норме: проверьте кадр (педаль в НМТ) и измерение inseam, затем примените правку.`,
        action: `${shDelta > 0 ? "Опустите" : "Поднимите"} седло на ${diff} мм`,
        priority: 1,
        sources: ["калибровка (SH)", "формула LeMond", "кросс-валидация"],
        conflict: true,
      });
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

    // Наклон корпуса: <35° — слишком горизонтальная (растянутая) посадка,
    // >45° — слишком вертикальная. Тексты ветвятся по ЗНАЧЕНИЮ, а не только
    // по статусу (раньше при инвертированных текстах советы были навыворот).
    if (backAngle.status === "bad" && backAngle.value < 35 && reachDelta != null && reachDelta > 15) {
      refs.push({
        category: "stem",
        finding: `Наклон корпуса ${backAngle.value.toFixed(1)}° — спина слишком горизонтальная (норма 35-45°)`,
        connection: `Reach=${bike.reach} мм — длиннее целевого ${targetReach} мм на ${Math.abs(reachDelta)} мм`,
        action: `Уменьшите Reach: более короткий вынос или сдвиньте седло вперёд`,
        priority: 2,
        sources: ["фото позы (наклон спины)", "калибровка (Reach)"],
      });
    }

    if (backAngle.status === "bad" && backAngle.value > 45 && reachDelta != null && reachDelta < -15) {
      refs.push({
        category: "frame",
        finding: `Наклон корпуса ${backAngle.value.toFixed(1)}° — спина слишком вертикальная (норма 35-45°)`,
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

    if (backAngle.status === "bad" && backAngle.value < 35 && stackDelta != null && stackDelta < -15) {
      // Стек слишком низкий, спина ушла в горизонталь → нужно поднять руль
      const angleAdvice = stemAngle < 6
        ? `Также замените вынос с углом ${stemAngle}° на +6° или +10°`
        : `Добавьте проставочные кольца под вынос`;
      refs.push({
        category: "handlebar",
        finding: `Наклон корпуса ${backAngle.value.toFixed(1)}° — спина слишком горизонтальная (норма 35-45°)`,
        connection: `Stack=${bike.stack} мм, целевой=${targetStack} мм → ниже нормы на ${Math.abs(stackDelta)} мм. Угол выноса α=${stemAngle}°`,
        action: `Поднимите руль: ${angleAdvice}`,
        priority: 2,
        sources: ["фото позы (наклон спины)", "калибровка (Stack)", "угол выноса α"],
      });
    }

    if (backAngle.status === "bad" && backAngle.value > 45 && stackDelta != null && stackDelta > 15) {
      refs.push({
        category: "handlebar",
        finding: `Наклон корпуса ${backAngle.value.toFixed(1)}° — спина слишком вертикальная (норма 35-45°)`,
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
      // v1.14.28: раньше направление угадывалось по модулю (kops.value > 3)
      // и в половине случаев было навыворот. Теперь берём знаковое значение:
      // > 0 — колено ВПЕРЕДИ оси педали, < 0 — позади.
      const signed = kops.signedValue ?? kops.value;
      const direction = signed > 0 ? "вперёд" : "назад";
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

  // === 5. Угол бедра ↔ Reach + ETT (анатомический, норма 95–105°) ===
  if (sideAnalysis && bike.ett && bike.reach) {
    const hipAngle = sideAnalysis.hipAngle;
    if (hipAngle.status === "bad" && hipAngle.value < 95) {
      refs.push({
        category: "frame",
        finding: `Угол бедра ${hipAngle.value.toFixed(1)}° — тазобедренный сустав пережат (норма 95-105°)`,
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

  // === 7. Угол голеностопа ↔ высота седла (микро-подстройка 2-3 мм).
  // СКЛЕЙКА СОВЕТОВ (ТЗ v1.14.22, порог 15 мм с v1.14.29): если дельта
  // с LeMond > 15 мм — приоритет у крупной коррекции высоты (секция 1),
  // микро-подстройку скрываем, чтобы не советовать «опустите на 41 мм»
  // и тут же «опустите на 2-3 мм». ===
  if (sideAnalysis && bike.saddleHeight && !lemondDominates) {
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

  // === Кросс-проверка направления «руль вверх/вниз» (v1.14.28). ===
  // Если спина слишком вертикальная и Stack выше целевого — карточка выше
  // советует «Опустите руль», но угол плеча < 70° в рекомендациях позы
  // превращается в «поднимите руль». Выполнить оба совета сразу нельзя:
  // заменяем карточку на конфликтную с приоритетом длины посадки.
  const shoulderA = sideAnalysis?.shoulderAngle;
  const backA = sideAnalysis?.backAngle;
  if (shoulderA && backA && backA.value > 45 && shoulderA.value < 70) {
    const idx = refs.findIndex(
      (r) => r.category === "handlebar" && /опустите руль/i.test(r.action)
    );
    if (idx >= 0) {
      const orig = refs[idx];
      refs[idx] = {
        ...orig,
        conflict: true,
        finding: "Противоречие: «опустите руль» против «поднимите руль»",
        connection: `${orig.connection}. При этом угол плеча ${shoulderA.value.toFixed(1)}° (руки близко к корпусу) обычно требует обратного — поднять руль.`,
        action: "Руль не трогайте, пока не скорректирована длина посадки: сначала устраните дельту Reach (удлините до целевой), затем повторите фото — наклон корпуса и угол плеча изменятся одновременно, и высоту руля станет видно честно.",
      };
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
