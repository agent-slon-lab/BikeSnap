/**
 * Формулы расчёта параметров велосипеда и посадки
 *
 * Источники:
 * - LeMond, Greg. "Complete Book of Bicycling." (1987)
 * - Bike Fit by Phil Burt (2014)
 * - Shimano Bike Fitting Manual
 * - Mountain Tactical Institute bike fit guidelines
 *
 * Все размеры в см (если не указано иное).
 */

import type { BikeType } from "./bike-params";

export interface BodyMeasurements {
  /** Рост, см */
  height: number;
  /** Внутренний шов (inseam), см — от паха до пола в носках */
  inseam: number;
  /** Длина стопы, см (опционально) */
  footLength?: number;
  /** Длина руки от акромиона до запястья, см (опционально) */
  armLength?: number;
  /** Длина туловища от акромиона до таза, см (опционально) */
  torsoLength?: number;
  /** Гибкость по шкале 1-5 (1 = плохо, 5 = отлично) */
  flexibility?: number;
}

export interface BikeMeasurements {
  /** Высота седла, см (от центра BB до верха седла) */
  saddleHeight?: number;
  /** Setback — горизонталь от BB до носа седла, мм */
  setback?: number;
  /** ETT (эффективная верхняя труба), мм */
  ett?: number;
  /** Reach — горизонталь от BB до центра рулевой трубы, мм (измеряется напрямую) */
  reach?: number;
  /** Stack — вертикаль от BB до центра рулевой трубы, мм (измеряется напрямую) */
  stack?: number;
  /** Длина выноса, мм */
  stem?: number;
  stemAngle?: number;
  /** Длина шатуна, мм */
  crank?: number;
  /** Угол подседельной трубы, ° (опционально, для справки) */
  sta?: number;
  /** Угол рулевой трубы, ° (опционально, для справки) */
  hta?: number;
  /** Высота колеса с покрышкой от земли, мм (радиус) */
  wheelHeight?: number;
  /** Высота центра каретки от земли, мм */
  bbHeight?: number;
  /** Колёсная база, мм (опционально) */
  wheelbase?: number;
  // v1.13.5: справочная геометрия рамы из фото-калибровки (кнопка
  // «Записать в параметры велика»). В форме НЕ редактируются — источник
  // только фото, поэтому перезапись вручную введённого невозможна.
  /** Передний центр FC (BB → передняя ось), мм */
  frontCenter?: number;
  /** Задний центр RC (BB → задняя ось), мм */
  rearCenter?: number;
  /** Длина подседельной трубы ST (BB → верх рамы), мм */
  seatTube?: number;
  /** BB Drop (насколько каретка ниже оси колеса), мм */
  bbDrop?: number;
}

export interface RiderGoal {
  /** Цель: комфорт / спорт / гонки */
  goal: "comfort" | "sport" | "race";
  /** Тип велосипеда */
  bikeType: BikeType;
}

export interface CalcResults {
  /** Целевая высота седла по LeMond, мм */
  targetSaddleHeightLemond: number | null;
  /** Целевая высота седла по формуле 1.09, мм */
  targetSaddleHeight109: number | null;
  /** Рекомендуемая высота седла (средняя по методам), мм */
  recommendedSaddleHeight: number | null;
  /** Дельта: текущая - целевая, мм (отрицательная = нужно опустить) */
  saddleHeightDelta: number | null;
  /** BB Drop = Wheel Height − BB Height, мм (вычисляется из измеряемых параметров) */
  bbDrop: number | null;
  /** Stack/Reach ratio (если известны оба) */
  stackReachRatio: number | null;
  /** Целевой reach рамы по эмпирической формуле Хаяши, мм */
  targetReach: number | null;
  /** Дельта reach: текущий - целевой, мм (если reach измерен) */
  reachDelta: number | null;
  /** Целевой stack рамы по эмпирической формуле, мм */
  targetStack: number | null;
  /** Дельта stack: текущий - целевой, мм */
  stackDelta: number | null;
  /** Рекомендованная длина шатуна по росту, мм */
  recommendedCrank: number | null;
  /** Рекомендованная длина выноса, мм (по типу велосипеда и росту) */
  recommendedStem: number | null;
  /** Общая оценка посадки (по данным параметров) */
  notes: string[];
}

/**
 * Формула LeMond для высоты седла:
 *   saddleHeight = inseam × 0.883 × 10  (в мм)
 *
 * Inseam вводится в см, результат — в мм.
 *
 * Источник: Greg LeMond, "Complete Book of Bicycling" (1987)
 * До сих пор считается золотым стандартом для начальной настройки.
 *
 * @param inseam Внутренний шов в см
 * @returns Целевая высота седла в мм (от BB до верха седла по прямой)
 */
export function calcSaddleHeightLeMond(inseam: number): number {
  return Math.round(inseam * 0.883 * 10); // см → мм
}

/**
 * Альтернативная формула: inseam × 1.09
 * Это 'inseam-to-saddle-height' ratio, где saddleHeight измеряется
 * от центра BB до верха седла.
 *
 * Считается чуть более 'агрессивной' (выше), чем LeMond.
 *
 * @param inseam Внутренний шов в см
 */
export function calcSaddleHeight109(inseam: number): number {
  return Math.round(inseam * 1.09 * 0.81 * 10); // см → мм
}

/**
 * Расчёт BB Drop:
 *   bbDrop = wheelHeight − bbHeight
 *
 * Простейшая формула — обе величины измеряются рулеткой от земли.
 *
 * @param wheelHeight в мм (от земли до оси колеса)
 * @param bbHeight в мм (от земли до центра каретки)
 * @returns bbDrop в мм
 */
export function calcBBDrop(wheelHeight: number, bbHeight: number): number {
  return Math.round(wheelHeight - bbHeight);
}

/**
 * Опциональный расчёт setback седла по высоте седла и углу подседельной трубы:
 *   setback = saddleHeight × cos(STA)
 *
 * @param saddleHeight в мм
 * @param sta угол подседельной трубы в градусах
 * @returns setback в мм
 */
export function calcSetbackFromSTA(saddleHeight: number, sta: number): number {
  const rad = (sta * Math.PI) / 180;
  return Math.round(saddleHeight * Math.cos(rad)); // мм → мм
}

/**
 * Эмпирическая формула целевого Reach по росту.
 *
 * Получена путём анализа реальных значений из базы моделей
 * (Specialized/Trek/Giant/Cannondale/Canyon/Cervélo и др.):
 *
 * Шоссе size 54 (рост 175-180): Reach ≈ 380-386
 * Шоссе size 56 (рост 180-185): Reach ≈ 388-396
 * Шоссе size 52 (рост 170-175): Reach ≈ 370-378
 *
 * Линейная регрессия: Reach ≈ height + 200 (для шоссе)
 *
 * Корректировки по типу велосипеда и цели.
 */
export function calcTargetReach(
  height: number,
  bikeType: BikeType,
  goal: "comfort" | "sport" | "race"
): number {
  // Базовая эмпирика для шоссе: Reach ≈ height + 200
  let base = height + 200;

  // Корректировка по типу велосипеда (спека/база моделей)
  const bikeAdjust: Record<BikeType, number> = {
    road: 0,
    gravel: -5,      // грэвел немного короче
    mtb: 25,         // MTB имеет больший Reach
    hybrid: -15,     // гибриды короче
    city: -15,       // городские короче
  };
  base += bikeAdjust[bikeType];

  // Корректировка по цели (спека: ±10 мм)
  const goalAdjust: Record<"comfort" | "sport" | "race", number> = {
    comfort: -10,   // комфорт = короче (более вертикальная посадка)
    sport: 0,
    race: +10,      // гонки = длиннее (более вытянутая)
  };
  base += goalAdjust[goal];

  return Math.round(base);
}

/**
 * Рекомендованная длина шатуна по росту.
 * Современная тенденция к более коротким шатунам.
 *
 * @param height Рост в см
 */
export function recommendCrankByHeight(height: number): number {
  if (height < 160) return 165;
  if (height < 170) return 167.5;
  if (height < 180) return 170;
  if (height < 190) return 172.5;
  return 175;
}

/**
 * Рекомендованная длина выноса по типу велосипеда и росту.
 */
export function recommendStem(
  bikeType: BikeType,
  height: number,
  goal: "comfort" | "sport" | "race"
): number {
  const base: Record<BikeType, number> = {
    road: 100,
    gravel: 90,
    mtb: 50,
    hybrid: 70,
    city: 60,
  };
  let stem = base[bikeType];

  // Корректировка по росту
  if (height > 185) stem += 10;
  if (height < 165) stem -= 10;

  // Корректировка по цели
  if (goal === "comfort") stem -= 10;
  if (goal === "race") stem += 10;

  return stem;
}

/**
 * Классификация посадки по соотношению Stack/Reach (спека):
 *   < 1.40  — агрессивная/гоночная;
 *   1.40–1.50 — спортивная/универсальная;
 *   > 1.50  — комфортная/вертикальная.
 */
export function classifyStackReachRatio(ratio: number): string {
  if (ratio < 1.4) return "агрессивная/гоночная посадка";
  if (ratio <= 1.5) return "спортивная/универсальная посадка";
  return "комфортная/вертикальная посадка";
}

/**
 * Полный расчёт всех производных параметров
 */
export function calculateAll(
  body: BodyMeasurements,
  bike: BikeMeasurements,
  goal: RiderGoal
): CalcResults {
  const notes: string[] = [];

  // 1. Целевая высота седла
  let targetSaddleHeightLemond: number | null = null;
  let targetSaddleHeight109: number | null = null;
  let recommendedSaddleHeight: number | null = null;
  let saddleHeightDelta: number | null = null;

  if (body.inseam > 0) {
    targetSaddleHeightLemond = calcSaddleHeightLeMond(body.inseam);
    targetSaddleHeight109 = calcSaddleHeight109(body.inseam);
    recommendedSaddleHeight = Math.round(
      (targetSaddleHeightLemond + targetSaddleHeight109) / 2
    );

    if (bike.saddleHeight && bike.saddleHeight > 0) {
      // Дельта строго по LeMond (спека: SH − targetSH, targetSH = inseam × 0.883)
      saddleHeightDelta = bike.saddleHeight - targetSaddleHeightLemond;
      if (Math.abs(saddleHeightDelta) > 5) {
        const direction =
          saddleHeightDelta > 0 ? "опустить" : "поднять";
        notes.push(
          `Высота седла: рекомендуется ${direction} на ${Math.abs(saddleHeightDelta)} мм (цель по LeMond ${targetSaddleHeightLemond} мм, текущая ${bike.saddleHeight} мм).`
        );
      } else {
        notes.push("Высота седла близка к рекомендуемой по LeMond (дельта ≤ 5 мм).");
      }
    }
  }

  // 2. Setback — теперь берётся напрямую (измеряется рулеткой), не вычисляется
  // Если введён напрямую — используем это значение для заметок
  if (bike.setback && bike.setback > 0) {
    const typical: Record<BikeType, [number, number]> = {
      road: [50, 90],
      gravel: [60, 100],
      mtb: [50, 100],
      hybrid: [60, 100],
      city: [70, 110],
    };
    const range = typical[goal.bikeType];
    if (bike.setback < range[0] - 10) {
      notes.push(
        `Setback седла ${bike.setback} мм меньше типичного для ${goal.bikeType} (${range[0]}-${range[1]} мм) — возможно, седло слишком далеко вперёд.`
      );
    } else if (bike.setback > range[1] + 10) {
      notes.push(
        `Setback седла ${bike.setback} мм больше типичного для ${goal.bikeType} (${range[0]}-${range[1]} мм) — возможно, седло слишком далеко назад.`
      );
    }
  }

  // 3. Reach — теперь берётся напрямую (измеряется рулеткой от BB до центра рулевой)
  // Используем bike.reach если он введён
  const reach = bike.reach ?? null;

  // 4. Stack/Reach ratio (если оба измерены напрямую)
  let stackReachRatio: number | null = null;
  if (bike.stack && bike.reach && bike.reach > 0) {
    stackReachRatio = round2(bike.stack / bike.reach);
    notes.push(
      `Stack/Reach = ${stackReachRatio} — ${classifyStackReachRatio(stackReachRatio)}.`
    );
  }

  // 5. Целевой Reach (по эмпирической формуле)
  let targetReach: number | null = null;
  if (body.height > 0) {
    targetReach = calcTargetReach(body.height, goal.bikeType, goal.goal);
  }

  // 6. Дельта Reach (если reach измерен напрямую)
  let reachDelta: number | null = null;
  if (reach && targetReach) {
    reachDelta = reach - targetReach;
    if (Math.abs(reachDelta) > 15) {
      const direction = reachDelta > 0 ? "длинный" : "короткий";
      const stemFix = reachDelta > 0 ? "короче" : "длиннее";
      notes.push(
        `Reach велосипеда (${reach} мм) ${direction} относительно рекомендованного (${targetReach} мм). Дельта: ${Math.abs(reachDelta)} мм. Рекомендация: изменить длину выноса на ~${Math.abs(reachDelta)} мм (${stemFix}).`
      );
    }
  }

  // 6b. Целевой Stack (по эмпирической формуле)
  let targetStack: number | null = null;
  if (body.height > 0) {
    targetStack = calcTargetStack(body.height, goal.bikeType, goal.goal);
  }

  // 6c. Дельта Stack
  let stackDelta: number | null = null;
  if (bike.stack && targetStack) {
    stackDelta = bike.stack - targetStack;
    if (Math.abs(stackDelta) > 15) {
      const direction = stackDelta > 0 ? "высокий" : "низкий";
      notes.push(
        `Stack велосипеда (${bike.stack} мм) ${direction} относительно рекомендованного (${targetStack} мм). Дельта: ${Math.abs(stackDelta)} мм.`
      );
    }
  }

  // 7. BB Drop = Wheel Height − BB Height (ВЫЧИСЛЯЕТСЯ АВТОМАТИЧЕСКИ)
  let bbDrop: number | null = null;
  if (bike.wheelHeight && bike.bbHeight && bike.wheelHeight > 0 && bike.bbHeight > 0) {
    bbDrop = calcBBDrop(bike.wheelHeight, bike.bbHeight);
    // Жёсткая валидация по спеке: BB Drop должен быть 40-90 мм
    if (bbDrop < 40 || bbDrop > 90) {
      notes.push(
        `⚠ BB Drop ${bbDrop} мм вне нормы 40–90 мм — проверьте измерения Wheel Height и BB Height (рулеткой от земли).`
      );
    }
    const typical: Record<BikeType, [number, number]> = {
      road: [65, 75],
      gravel: [70, 80],
      mtb: [55, 70],
      hybrid: [60, 75],
      city: [65, 80],
    };
    const range = typical[goal.bikeType];
    if (bbDrop < range[0] - 5) {
      notes.push(
        `BB Drop ${bbDrop} мм меньше типичного для ${goal.bikeType} (${range[0]}-${range[1]} мм) — выше центр тяжести, стабильнее но риск зацепить педалью ниже.`
      );
    } else if (bbDrop > range[1] + 5) {
      notes.push(
        `BB Drop ${bbDrop} мм больше типичного для ${goal.bikeType} (${range[0]}-${range[1]} мм) — ниже центр тяжести, поворотливее но выше риск зацепить педалью.`
      );
    } else {
      notes.push(`BB Drop ${bbDrop} мм — в пределах нормы для ${goal.bikeType}.`);
    }
  }

  // 8. Рекомендованная длина шатуна
  let recommendedCrank: number | null = null;
  if (body.height > 0) {
    recommendedCrank = recommendCrankByHeight(body.height);
    if (bike.crank && Math.abs(bike.crank - recommendedCrank) > 5) {
      notes.push(
        `Текущая длина шатуна ${bike.crank} мм, рекомендуется ${recommendedCrank} мм по росту. Короткий шатун снижает нагрузку на колено в ВМТ.`
      );
    }
  }

  // 9. Рекомендованная длина выноса
  let recommendedStem: number | null = null;
  if (body.height > 0) {
    recommendedStem = recommendStem(
      goal.bikeType,
      body.height,
      goal.goal
    );
    if (bike.stem && Math.abs(bike.stem - recommendedStem) > 15) {
      const direction = bike.stem > recommendedStem ? "длинный" : "короткий";
      notes.push(
        `Вынос ${bike.stem} мм — ${direction} для вашего типа велосипеда и цели (рекомендуется ${recommendedStem} мм).`
      );
    }
  }

  // 10. Гибкость и цель
  if (body.flexibility && body.flexibility <= 2) {
    notes.push(
      "Низкая гибкость спины: рекомендуется более вертикальная посадка (комфортный Stack)."
    );
  }

  return {
    targetSaddleHeightLemond,
    targetSaddleHeight109,
    recommendedSaddleHeight,
    saddleHeightDelta,
    bbDrop,
    stackReachRatio,
    targetReach,
    reachDelta,
    targetStack,
    stackDelta,
    recommendedCrank,
    recommendedStem,
    notes,
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Эмпирическая формула целевого Stack по росту.
 *
 * Получена путём анализа реальных значений из базы моделей:
 *
 * Шоссе size 54 (рост 175-180): Stack ≈ 539-555
 * Шоссе size 56 (рост 180-185): Stack ≈ 565-590
 * Шоссе size 52 (рост 170-175): Stack ≈ 514-534
 *
 * Линейная регрессия: Stack ≈ height × 2.5 + 100 (для шоссе race)
 *
 * Корректировки по типу велосипеда и цели.
 */
export function calcTargetStack(
  height: number,
  bikeType: BikeType,
  goal: "comfort" | "sport" | "race"
): number {
  // Базовая эмпирика для шоссе: Stack ≈ height × 2.5 + 100
  let base = height * 2.5 + 100;

  // Корректировка по типу велосипеда
  const bikeAdjust: Record<BikeType, number> = {
    road: 0,
    gravel: +20,      // грэвел выше (комфорт)
    mtb: +30,         // MTB ещё выше
    hybrid: +40,      // гибриды высокие
    city: +60,        // городские самые высокие
  };
  base += bikeAdjust[bikeType];

  // Корректировка по цели
  const goalAdjust: Record<"comfort" | "sport" | "race", number> = {
    comfort: +20,     // комфорт = выше Stack (вертикальная посадка)
    sport: 0,
    race: -15,        // гонки = ниже Stack (агрессивная посадка)
  };
  base += goalAdjust[goal];

  return Math.round(base);
}
