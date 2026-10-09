/**
 * Утилиты для работы с позой велосипедиста
 * Расчёт углов суставов по keypoints из MediaPipe PoseLandmarker
 *
 * v1.14.22 — ЕДИНЫЙ АНАТОМИЧЕСКИЙ СТАНДАРТ (180° = полностью выпрямленный
 * сустав). Нормы живут в src/lib/poseMetricsEngine.ts (JOINT_NORMS) и
 * импортируются отсюда. Раньше угол колена (анатомический, ~145° в НМТ)
 * сравнивался с диапазоном СГИБА 25–35° — отсюда ложные «критично»;
 * текст наклона корпуса был инвертирован. Исправлено по ТЗ.
 */

import { JOINT_NORMS, KNEE_FLEXION_NORM, kneeFlexion } from "./poseMetricsEngine";

export interface Point {
  x: number; // нормализованная координата 0..1
  y: number;
  visibility?: number;
}

export interface Landmarks {
  [key: number]: Point;
}

/**
 * Индексы ключевых точек MediaPipe BlazePose (33 точки)
 * @see https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
 */
export const POSE_LANDMARKS = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

/**
 * Скалярное произведение
 */
function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Длина вектора
 */
function length(a: Point): number {
  return Math.sqrt(dot(a, a));
}

/**
 * Угол между тремя точками (вершина — средняя точка)
 * Возвращает угол в градусах [0..180]
 *
 * @param a первая точка (например, бедро)
 * @param b вершина угла (например, колено)
 * @param c третья точка (например, лодыжка)
 *
 * Пример: kneeAngle = angleBetween(hip, knee, ankle)
 */
export function angleBetween(a: Point, b: Point, c: Point): number {
  const ba: Point = { x: a.x - b.x, y: a.y - b.y };
  const bc: Point = { x: c.x - b.x, y: c.y - b.y };

  const cosTheta = dot(ba, bc) / (length(ba) * length(bc) + 1e-9);
  const clamped = Math.max(-1, Math.min(1, cosTheta));
  return (Math.acos(clamped) * 180) / Math.PI;
}

/**
 * Угол прямой (b → a) относительно горизонтальной оси
 * Например, спина: от бедра к плечу — угол наклона корпуса
 *
 * @returns угол в градусах [0..180], где 0 = горизонталь, 90 = вертикаль
 */
export function angleToHorizontal(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  // Инвертируем Y, т.к. в canvas Y растёт вниз
  const angleRad = Math.atan2(-dy, dx);
  let deg = (angleRad * 180) / Math.PI;
  // Нормализуем к [0..90] как угол наклона относительно горизонтали
  deg = Math.abs(deg);
  if (deg > 90) deg = 180 - deg;
  return deg;
}

/**
 * KOPS (Knee Over Pedal Spindle)
 * Горизонтальное смещение колена относительно оси педали
 *
 * @param knee точка колена
 * @param pedal точка оси педали (лодыжка как приближение)
 * @returns смещение в пикселях: + если колено впереди педали, - если сзади
 *          null если направление съёмки не позволяет вычислить
 */
export function horizontalOffset(a: Point, b: Point): number {
  return a.x - b.x;
}

/**
 * Доступность точки (visibility > 0.5)
 */
export function isVisible(p?: Point): p is Point {
  return !!p && (p.visibility ?? 1) > 0.5;
}

export interface AngleResult {
  value: number;
  // Диапазон нормы [min, max]
  min: number;
  max: number;
  // Качественная оценка
  status: "good" | "warning" | "bad";
  // Человекочитаемое название
  label: string;
  // Пояснение для новичка
  description: string;
  // Рекомендация по корректировке
  recommendation: string;
  // Производный угол СГИБА колена (только у kneeAngle): 180° − анатомический
  flexion?: {
    value: number;
    min: number;
    max: number;
    label: string;
  };
  // Цвет для UI (Tailwind классы)
  color: {
    text: string;
    bg: string;
    border: string;
    ring: string;
  };
}

function classifyStatus(value: number, min: number, max: number): AngleResult["status"] {
  const range = max - min;
  const tolerance = range * 0.25; // допустимое отклонение
  if (value >= min && value <= max) return "good";
  if (value >= min - tolerance && value <= max + tolerance) return "warning";
  return "bad";
}

const STATUS_COLORS = {
  good: {
    text: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    border: "border-emerald-200 dark:border-emerald-900",
    ring: "ring-emerald-500/30",
  },
  warning: {
    text: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    border: "border-amber-200 dark:border-amber-900",
    ring: "ring-amber-500/30",
  },
  bad: {
    text: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-50 dark:bg-rose-950/40",
    border: "border-rose-200 dark:border-rose-900",
    ring: "ring-rose-500/30",
  },
} as const;

function makeResult(
  value: number,
  min: number,
  max: number,
  label: string,
  description: string,
  recommendation: string,
  flexion?: AngleResult["flexion"]
): AngleResult {
  const status = classifyStatus(value, min, max);
  return {
    value: Math.round(value * 10) / 10,
    min,
    max,
    status,
    label,
    description,
    recommendation,
    flexion,
    color: STATUS_COLORS[status],
  };
}

/**
 * Опциональные параметры анализа: если передан масштаб ЭТОГО ЖЕ кадра,
 * KOPS считается в миллиметрах (спека: норма ±10 мм); иначе — в условных
 * единицах (доля ширины кадра × 100, как раньше).
 */
export interface AnalyzeFitOptions {
  /** Ширина кадра, px */
  imgWidthPx?: number;
  /** Масштаб мм/px калибровки этого же кадра */
  mmPerPx?: number;
}

/**
 * Полный анализ посадки по keypoints
 * @param landmarks массив из 33 точек MediaPipe
 * @param opts опционально: масштаб кадра для KOPS в мм
 * @returns набор результатов
 */
export interface BikeFitAnalysis {
  kneeAngle: AngleResult;
  hipAngle: AngleResult;
  backAngle: AngleResult;
  ankleAngle: AngleResult;
  shoulderAngle: AngleResult;
  kops: AngleResult;
  // сторона тела, выбранная для анализа (левая/правая)
  side: "left" | "right";
}

export function analyzeBikeFit(
  landmarks: Landmarks,
  opts?: AnalyzeFitOptions
): BikeFitAnalysis | null {
  // Определяем, какая сторона тела лучше видна
  // На боковой съёмке одна сторона ближе к камере и лучше определяется
  const leftVis =
    (landmarks[POSE_LANDMARKS.LEFT_HIP]?.visibility ?? 0) +
    (landmarks[POSE_LANDMARKS.LEFT_KNEE]?.visibility ?? 0) +
    (landmarks[POSE_LANDMARKS.LEFT_ANKLE]?.visibility ?? 0);
  const rightVis =
    (landmarks[POSE_LANDMARKS.RIGHT_HIP]?.visibility ?? 0) +
    (landmarks[POSE_LANDMARKS.RIGHT_KNEE]?.visibility ?? 0) +
    (landmarks[POSE_LANDMARKS.RIGHT_ANKLE]?.visibility ?? 0);

  const side: "left" | "right" = leftVis >= rightVis ? "left" : "right";

  const S = side === "left" ? POSE_LANDMARKS.LEFT_SHOULDER : POSE_LANDMARKS.RIGHT_SHOULDER;
  const E = side === "left" ? POSE_LANDMARKS.LEFT_ELBOW : POSE_LANDMARKS.RIGHT_ELBOW;
  const H = side === "left" ? POSE_LANDMARKS.LEFT_HIP : POSE_LANDMARKS.RIGHT_HIP;
  const K = side === "left" ? POSE_LANDMARKS.LEFT_KNEE : POSE_LANDMARKS.RIGHT_KNEE;
  const A = side === "left" ? POSE_LANDMARKS.LEFT_ANKLE : POSE_LANDMARKS.RIGHT_ANKLE;
  const HE = side === "left" ? POSE_LANDMARKS.LEFT_HEEL : POSE_LANDMARKS.RIGHT_HEEL;

  const shoulder = landmarks[S];
  const elbow = landmarks[E];
  const hip = landmarks[H];
  const knee = landmarks[K];
  const ankle = landmarks[A];
  const heel = landmarks[HE];
  const FT = side === "left" ? POSE_LANDMARKS.LEFT_FOOT_INDEX : POSE_LANDMARKS.RIGHT_FOOT_INDEX;
  const toe = landmarks[FT];

  // Проверяем видимость ключевых точек
  if (
    !isVisible(shoulder) ||
    !isVisible(hip) ||
    !isVisible(knee) ||
    !isVisible(ankle)
  ) {
    return null;
  }

  // 1. Угол колена (hip-knee-ankle) — АНАТОМИЧЕСКИЙ угол разгибания,
  //    норма 140–150° в НМТ (180° = нога полностью выпрямлена).
  //    Для UI дополнительно считаем угол СГИБА = 180° − угол (норма 30–40°).
  const kneeAngleValue = angleBetween(hip, knee, ankle);
  const kneeAngle = makeResult(
    kneeAngleValue,
    JOINT_NORMS.knee.min,
    JOINT_NORMS.knee.max,
    "Угол колена (разгибание)",
    "Анатомический угол бедро–колено–лодыжка в нижней точке педалирования (НМТ): 180° — нога полностью выпрямлена. Норма 140–150° (сгибу 30–40°). Влияет на мощность и нагрузку на сустав.",
    kneeAngleValue > JOINT_NORMS.knee.max
      ? `Нога слишком прямая (${kneeAngleValue.toFixed(0)}°). Опустите седло, чтобы угол в НМТ составлял 140–150°.`
      : `Колено слишком согнуто (${kneeAngleValue.toFixed(0)}°). Поднимите седло для предотвращения перегрузки сустава.`,
    {
      value: Math.round(kneeFlexion(kneeAngleValue) * 10) / 10,
      min: KNEE_FLEXION_NORM.min,
      max: KNEE_FLEXION_NORM.max,
      label: "сгиб",
    }
  );
  // Sanity: только нижняя граница — анатомический <130° (сгиб >50°) физически
  // недостижим на велосипеде → ошибка распознавания. ВЕРХНЮЮ границу НЕ ставим:
  // почти прямая нога (176°) — легитимный случай «седло сильно завышено»,
  // и он должен давать совет «Опустите седло», а не «ошибка распознавания»
  // (именно это было частью исходного бага из ТЗ).
  if (kneeAngleValue < 130) {
    kneeAngle.status = "bad";
    kneeAngle.color = STATUS_COLORS.bad;
    kneeAngle.recommendation =
      "Ошибка распознавания позы или экстремальная настройка — проверьте кадр: НМТ должна быть снята в нижней фазе педалирования.";
  }

  // 2. Угол бедра (shoulder-hip-knee) — АНАТОМИЧЕСКИЙ, норма 95–105° в НМТ
  const hipAngleValue = angleBetween(shoulder, hip, knee);
  const hipAngle = makeResult(
    hipAngleValue,
    JOINT_NORMS.hip.min,
    JOINT_NORMS.hip.max,
    "Угол бедра",
    "Анатомический угол между туловищем (плечо→бедро) и бедром (бедро→колено). Норма шоссе 95–105°. Определяет закрытость тазобедренного сустава.",
    hipAngleValue < JOINT_NORMS.hip.min
      ? "Тазобедренный сустав пережат — увеличьте дистанцию седло–руль или приподнимите/удлините вынос."
      : "Угол бедра слишком открыт — посадка избыточно растянута; сократите дистанцию седло–руль."
  );

  // 3. Наклон корпуса (спина: hip → shoulder к горизонту) — норма шоссе 35–45°.
  //    0° = горизонтально (агрессивная посадка), 90° = вертикально (комфорт).
  //    Тексты ПО ТЗ: >45° — слишком ВЕРТИКАЛЬНАЯ спина, <35° — слишком
  //    ГОРИЗОНТАЛЬНАЯ (раньше формулировки были перепутаны местами).
  const backAngleValue = angleToHorizontal(shoulder, hip);
  const backAngle = makeResult(
    backAngleValue,
    JOINT_NORMS.torso.min,
    JOINT_NORMS.torso.max,
    "Наклон корпуса",
    "Угол наклона спины (бедро→плечо) к горизонту: 0° — горизонтально (агрессивная посадка), 90° — вертикально (комфорт). Норма шоссе 35–45°.",
    backAngleValue > JOINT_NORMS.torso.max
      ? "Спина стоит слишком вертикально — посадка высокая/комфортная. Для аэродинамики опустите или удлините вынос."
      : "Спина наклонена слишком низко — посадка агрессивная. Поднимите вынос руля для снижения нагрузки на поясницу и руки."
  );

  // 4. Угол голеностопа (knee-ankle-toe, при недоступности носка — heel).
  //    Норма 90–110°. >110° — носок опущен (седло высоко), <90° — пятка провалена.
  const ankleAngleValue = isVisible(toe)
    ? angleBetween(knee, ankle, toe)
    : isVisible(heel)
      ? angleBetween(knee, ankle, heel)
      : 90;
  const ankleAngle = makeResult(
    ankleAngleValue,
    JOINT_NORMS.ankle.min,
    JOINT_NORMS.ankle.max,
    "Угол голеностопа",
    "Угол между голенью (колено→лодыжка) и стопой (лодыжка→носок). Норма 90–110°.",
    ankleAngleValue > JOINT_NORMS.ankle.max
      ? "Носок слишком опущен вниз — возможно, седло задрано слишком высоко, и вы тянетесь к педали."
      : "Пятка сильно провалена вниз — проверьте положение шипа на велотуфлях."
  );

  // 5. Угол плеча (elbow-shoulder-hip) — без изменений по ТЗ
  const shoulderAngleValue = isVisible(elbow)
    ? angleBetween(elbow, shoulder, hip)
    : 90;
  const shoulderAngle = makeResult(
    shoulderAngleValue,
    70,
    100,
    "Угол плеча",
    "Угол между плечом и корпусом. Характеризует положение рук на руле.",
    shoulderAngleValue < 70
      ? "Руки слишком опущены — поднимите руль или используйте более короткий вынос."
      : "Руки слишком разведены — проверьте ширину хвата руля."
  );

  // 6. KOPS — горизонтальное смещение колена относительно оси педали.
  // Спека: норма ±10 мм, > 0 — колено впереди оси. В мм считается ТОЛЬКО
  // при переданном масштабе этого же кадра (opts), иначе — условные
  // единицы (доля ширины кадра × 100), как раньше.
  const kopsRaw = horizontalOffset(knee, ankle); // доля ширины кадра
  const hasScale = !!(opts?.imgWidthPx && opts?.mmPerPx);
  const kopsValue = hasScale
    ? kopsRaw * opts!.imgWidthPx! * opts!.mmPerPx! // мм
    : kopsRaw * 100; // условные единицы
  const kopsLimit = hasScale ? 10 : 3;
  const kopsUnit = hasScale ? "мм" : "у.е.";
  const kops = makeResult(
    Math.abs(kopsValue),
    0,
    kopsLimit,
    `KOPS (колено над осью педали, ${kopsUnit})`,
    "Горизонтальное смещение колена относительно оси педали. Идеал — колено ровно над осью (норма ±10 мм).",
    kopsValue > kopsLimit
      ? `Колено впереди оси педали на ${Math.abs(kopsValue).toFixed(0)} ${kopsUnit} — сдвиньте седло назад на 5–10 мм.`
      : kopsValue < -kopsLimit
        ? `Колено позади оси педали на ${Math.abs(kopsValue).toFixed(0)} ${kopsUnit} — сдвиньте седло вперёд на 5–10 мм.`
        : "Отличное положение колена над осью педали."
  );

  return {
    kneeAngle,
    hipAngle,
    backAngle,
    ankleAngle,
    shoulderAngle,
    kops,
    side,
  };
}

/**
 * Получить ключевые точки скелета для отрисовки
 */
export const POSE_CONNECTIONS: [number, number][] = [
  // Корпус
  [11, 12], // плечи
  [11, 23], // левое плечо - левое бедро
  [12, 24], // правое плечо - правое бедро
  [23, 24], // бёдра
  // Левая рука
  [11, 13],
  [13, 15],
  // Правая рука
  [12, 14],
  [14, 16],
  // Левая нога
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  [27, 31],
  // Правая нога
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [28, 32],
];

// ============================================================
// АНАЛИЗ ПО ВИДУ СЗАДИ (BACK VIEW)
// ============================================================

export interface SymmetryResult extends AngleResult {
  /** Абсолютное отклонение от идеала (0 = идеальная симметрия) */
  deviation: number;
}

export interface BackViewAnalysis {
  /** Горизонтальность плеч (наклон) */
  shoulderTilt: SymmetryResult;
  /** Горизонтальность таза (бёдер) */
  hipTilt: SymmetryResult;
  /** Симметрия коленей по высоте */
  kneeHeightSymmetry: SymmetryResult;
  /** Отклонение коленей внутрь/наружу (valgus/varus) */
  kneeDeviation: SymmetryResult;
  /** Наклон головы */
  headTilt: SymmetryResult;
  /** Симметрия стоп */
  footSymmetry: SymmetryResult;
  // Дополнительно: оценки по сторонам
  leftShoulderY: number;
  rightShoulderY: number;
  leftHipY: number;
  rightHipY: number;
}

/**
 * Разница между Y-координатами двух точек (для симметрии)
 * Возвращает положительное число (модуль разницы), нормализованное к ширине плеч/таза.
 */
function tiltAngle(a: Point, b: Point, ref: Point, refEnd: Point): number {
  // Наклон линии a-b относительно горизонтали
  // Нормализуем к ширине плеч (или таза)
  const dy = Math.abs(a.y - b.y);
  const dx = Math.abs(ref.x - refEnd.x);
  if (dx < 0.001) return 0;
  // Возвращаем угол в градусах
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function makeSymmetryResult(
  deviation: number,
  maxAllowed: number,
  label: string,
  description: string,
  recommendation: string
): SymmetryResult {
  const status: AngleResult["status"] =
    deviation <= maxAllowed * 0.5
      ? "good"
      : deviation <= maxAllowed
        ? "warning"
        : "bad";
  return {
    value: Math.round(deviation * 10) / 10,
    min: 0,
    max: maxAllowed,
    status,
    label,
    description,
    recommendation,
    color: STATUS_COLORS[status],
    deviation: Math.round(deviation * 10) / 10,
  };
}

export function analyzeBackView(landmarks: Landmarks): BackViewAnalysis | null {
  const ls = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
  const rs = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
  const lh = landmarks[POSE_LANDMARKS.LEFT_HIP];
  const rh = landmarks[POSE_LANDMARKS.RIGHT_HIP];
  const lk = landmarks[POSE_LANDMARKS.LEFT_KNEE];
  const rk = landmarks[POSE_LANDMARKS.RIGHT_KNEE];
  const la = landmarks[POSE_LANDMARKS.LEFT_ANKLE];
  const ra = landmarks[POSE_LANDMARKS.RIGHT_ANKLE];
  const nose = landmarks[POSE_LANDMARKS.NOSE];

  if (!isVisible(ls) || !isVisible(rs) || !isVisible(lh) || !isVisible(rh)) {
    return null;
  }

  // 1. Наклон плеч
  const shoulderTiltAngle = tiltAngle(ls, rs, ls, rs);
  const shoulderTilt = makeSymmetryResult(
    shoulderTiltAngle,
    3, // максимум 3°
    "Наклон плеч",
    "Горизонтальность линии плеч. Наклон указывает на разную длину рук или асимметрию корпуса.",
    shoulderTiltAngle > 1.5
      ? "Заметен наклон плеч — проверьте симметричность хвата руля и длину рук. Возможно, нужно подложить шайбу под один из рычагов."
      : "Плечи горизонтальны — отличная симметрия."
  );

  // 2. Наклон таза
  const hipTiltAngle = tiltAngle(lh, rh, lh, rh);
  const hipTilt = makeSymmetryResult(
    hipTiltAngle,
    3,
    "Наклон таза",
    "Горизонтальность линии бёдер. Наклон может указывать на разную длину ног или перекос седла.",
    hipTiltAngle > 1.5
      ? "Заметен наклон таза — проверьте симметричность седла и шипов. Возможно, нужна шайба под одну ногу."
      : "Таз горизонтален — отличная симметрия."
  );

  // 3. Симметрия коленей по высоте
  let kneeHeightSymmetry: SymmetryResult;
  if (isVisible(lk) && isVisible(rk)) {
    const kneeDiff = Math.abs(lk.y - rk.y) * 100;
    kneeHeightSymmetry = makeSymmetryResult(
      kneeDiff,
      5,
      "Симметрия коленей по высоте",
      "Разница в высоте коленей левой и правой ноги. Может указывать на разную длину ног или асимметричное педалирование.",
      kneeDiff > 3
        ? "Колени на разной высоте — возможно разная длина ног или асимметрия в посадке на седле."
        : "Колени симметричны по высоте."
    );
  } else {
    kneeHeightSymmetry = makeSymmetryResult(
      0,
      5,
      "Симметрия коленей по высоте",
      "Разница в высоте коленей. Не удалось определить — колени не видны.",
      "Колени не распознаны на фото."
    );
  }

  // 4. Отклонение коленей внутрь/наружу (valgus/varus)
  // Измеряется как горизонтальное смещение колена от вертикали, проходящей через бедро
  let kneeDeviation: SymmetryResult;
  if (isVisible(lk) && isVisible(rk) && isVisible(lh) && isVisible(rh)) {
    const leftDev = Math.abs(lk.x - lh.x) * 100;
    const rightDev = Math.abs(rk.x - rh.x) * 100;
    const avgDev = (leftDev + rightDev) / 2;
    const asymmetry = Math.abs(leftDev - rightDev);
    // Если колени сильно внутрь (valgus) — отклонение заметное
    kneeDeviation = makeSymmetryResult(
      avgDev,
      4,
      "Отклонение коленей (вальгус/варус)",
      "Горизонтальное отклонение колена от вертикали бедра. Внутрь = вальгус, наружу = варус. Влияет на износ коленного сустава.",
      avgDev > 3
        ? "Колени заметно отклонены — проверьте положение шипов на обувь. Вальгус (внутрь) — сдвиньте шипы медиально, варус (наружу) — латерально."
        : asymmetry > 2
          ? "Заметна асимметрия левой/правой ноги — проверьте симметричность шипов и седла."
          : "Колени в нейтральном положении."
    );
  } else {
    kneeDeviation = makeSymmetryResult(
      0,
      4,
      "Отклонение коленей",
      "Горизонтальное отклонение колена от вертикали бедра.",
      "Не удалось определить."
    );
  }

  // 5. Наклон головы
  let headTilt: SymmetryResult;
  if (isVisible(nose) && isVisible(ls) && isVisible(rs)) {
    // Нос должен быть по центру между плечами
    const shoulderCenterX = (ls.x + rs.x) / 2;
    const shoulderWidth = Math.abs(ls.x - rs.x);
    const headOffset = Math.abs(nose.x - shoulderCenterX) / shoulderWidth * 100;
    headTilt = makeSymmetryResult(
      headOffset,
      10,
      "Наклон головы",
      "Отклонение носа от центра между плечами. Показывает наклон головы.",
      headOffset > 5
        ? "Голова наклонена в сторону — проверьте положение шеи и седла."
        : "Голова по центру — норма."
    );
  } else {
    headTilt = makeSymmetryResult(
      0,
      10,
      "Наклон головы",
      "Отклонение носа от центра плеч.",
      "Не удалось определить."
    );
  }

  // 6. Симметрия стоп
  let footSymmetry: SymmetryResult;
  if (isVisible(la) && isVisible(ra)) {
    const footDiff = Math.abs(la.y - ra.y) * 100;
    footSymmetry = makeSymmetryResult(
      footDiff,
      5,
      "Симметрия стоп",
      "Разница в высоте стоп. Если одна стопа ниже другой — возможно, одна нога длиннее или седло перекошено.",
      footDiff > 3
        ? "Стопы на разной высоте — проверьте горизонтальность седла и шипов."
        : "Стопы симметричны."
    );
  } else {
    footSymmetry = makeSymmetryResult(
      0,
      5,
      "Симметрия стоп",
      "Разница в высоте стоп.",
      "Не удалось определить."
    );
  }

  return {
    shoulderTilt,
    hipTilt,
    kneeHeightSymmetry,
    kneeDeviation,
    headTilt,
    footSymmetry,
    leftShoulderY: ls.y,
    rightShoulderY: rs.y,
    leftHipY: lh.y,
    rightHipY: rh.y,
  };
}

// ============================================================
// АНАЛИЗ ПО ВИДУ СПЕРЕДИ (FRONT VIEW)
// ============================================================

export interface FrontViewAnalysis {
  /** Ширина хвата руля относительно плеч */
  gripWidth: AngleResult;
  /** Симметрия плеч (наклон) */
  shoulderTilt: SymmetryResult;
  /** Положение локтей (внутрь/наружу от плеч) */
  elbowPosition: SymmetryResult;
  /** Наклон головы */
  headTilt: SymmetryResult;
  /** Симметрия коленей */
  kneeSymmetry: SymmetryResult;
  /** Угол между локтями (раскрытие рук) */
  elbowAngleSymmetry: SymmetryResult;
  leftShoulderX: number;
  rightShoulderX: number;
  leftWristX: number;
  rightWristX: number;
}

export function analyzeFrontView(landmarks: Landmarks): FrontViewAnalysis | null {
  const ls = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
  const rs = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
  const lw = landmarks[POSE_LANDMARKS.LEFT_WRIST];
  const rw = landmarks[POSE_LANDMARKS.RIGHT_WRIST];
  const le = landmarks[POSE_LANDMARKS.LEFT_ELBOW];
  const re = landmarks[POSE_LANDMARKS.RIGHT_ELBOW];
  const nose = landmarks[POSE_LANDMARKS.NOSE];
  const lk = landmarks[POSE_LANDMARKS.LEFT_KNEE];
  const rk = landmarks[POSE_LANDMARKS.RIGHT_KNEE];

  if (!isVisible(ls) || !isVisible(rs)) {
    return null;
  }

  const shoulderWidth = Math.abs(ls.x - rs.x);

  // 1. Ширина хвата руля (относительно плеч)
  let gripWidth: AngleResult;
  if (isVisible(lw) && isVisible(rw)) {
    const wristWidth = Math.abs(lw.x - rw.x);
    const ratio = wristWidth / shoulderWidth;
    // Норма: руль на 2-10 см шире плеч, или ratio 1.05-1.30
    const gripValue = Math.round(ratio * 100);
    const status: AngleResult["status"] =
      ratio >= 1.0 && ratio <= 1.3
        ? "good"
        : ratio < 0.95 || ratio > 1.4
          ? "bad"
          : "warning";
    gripWidth = {
      value: gripValue / 100,
      min: 1.0,
      max: 1.3,
      status,
      label: "Ширина хвата руля",
      description:
        "Отношение ширины хвата к ширине плеч. Слишком узко = затруднённое дыхание, слишком широко = перегрузка плеч.",
      recommendation:
        ratio < 1.0
          ? "Хват слишком узкий — расширьте хват или замените руль на более широкий."
          : ratio > 1.3
            ? "Хват слишком широкий — сузьте хват или замените руль."
            : "Ширина хвата оптимальна.",
      color: STATUS_COLORS[status],
    };
  } else {
    gripWidth = makeResult(
      1.15,
      1.0,
      1.3,
      "Ширина хвата руля",
      "Отношение ширины хвата к ширине плеч.",
      "Кисти не распознаны."
    );
  }

  // 2. Наклон плеч
  const shoulderTiltAngle = tiltAngle(ls, rs, ls, rs);
  const shoulderTilt = makeSymmetryResult(
    shoulderTiltAngle,
    3,
    "Наклон плеч",
    "Горизонтальность плеч. Асимметрия указывает на разную длину рук или несимметричный хват.",
    shoulderTiltAngle > 1.5
      ? "Заметен наклон плеч — проверьте симметричность хвата руля."
      : "Плечи горизонтальны."
  );

  // 3. Положение локтей (внутрь/наружу от плеч)
  let elbowPosition: SymmetryResult;
  if (isVisible(le) && isVisible(re)) {
    // Локти должны быть примерно под плечами
    const leftElbowOffset = Math.abs(le.x - ls.x) / shoulderWidth * 100;
    const rightElbowOffset = Math.abs(re.x - rs.x) / shoulderWidth * 100;
    const avgOffset = (leftElbowOffset + rightElbowOffset) / 2;
    elbowPosition = makeSymmetryResult(
      avgOffset,
      15,
      "Положение локтей",
      "Отклонение локтей от вертикали плеч. Локти внутрь (узкие) = лучше аэродинамика, наружу = стабильность.",
      avgOffset > 10
        ? "Локти сильно отведены от вертикали плеч — проверьте ширину хвата и положение рук."
        : "Локти под плечами — норма."
    );
  } else {
    elbowPosition = makeSymmetryResult(
      0,
      15,
      "Положение локтей",
      "Отклонение локтей от вертикали плеч.",
      "Локти не распознаны."
    );
  }

  // 4. Наклон головы
  let headTilt: SymmetryResult;
  if (isVisible(nose)) {
    const shoulderCenterX = (ls.x + rs.x) / 2;
    const headOffset = Math.abs(nose.x - shoulderCenterX) / shoulderWidth * 100;
    headTilt = makeSymmetryResult(
      headOffset,
      10,
      "Наклон головы",
      "Отклонение головы от центра плеч.",
      headOffset > 5
        ? "Голова наклонена — проверьте симметричность шеи."
        : "Голова по центру."
    );
  } else {
    headTilt = makeSymmetryResult(
      0,
      10,
      "Наклон головы",
      "Отклонение головы от центра плеч.",
      "Не удалось определить."
    );
  }

  // 5. Симметрия коленей
  let kneeSymmetry: SymmetryResult;
  if (isVisible(lk) && isVisible(rk)) {
    const kneeDiff = Math.abs(lk.y - rk.y) * 100;
    kneeSymmetry = makeSymmetryResult(
      kneeDiff,
      5,
      "Симметрия коленей",
      "Разница в высоте коленей. Асимметрия указывает на разную длину ног или несимметричное педалирование.",
      kneeDiff > 3
        ? "Колени на разной высоте — проверьте длину ног и настройку шипов."
        : "Колени симметричны."
    );
  } else {
    kneeSymmetry = makeSymmetryResult(
      0,
      5,
      "Симметрия коленей",
      "Разница в высоте коленей.",
      "Не удалось определить."
    );
  }

  // 6. Симметрия углов локтей
  let elbowAngleSymmetry: SymmetryResult;
  if (isVisible(le) && isVisible(re) && isVisible(lw) && isVisible(rw)) {
    // Угол между линией плечо-локоть-кисть для обеих рук
    const leftAngle = angleBetween(ls, le, lw);
    const rightAngle = angleBetween(rs, re, rw);
    const asymmetry = Math.abs(leftAngle - rightAngle);
    elbowAngleSymmetry = makeSymmetryResult(
      asymmetry,
      10,
      "Симметрия углов локтей",
      "Разница в сгибании левого и правого локтя. Большая асимметрия указывает на разную длину рук или несимметричный хват.",
      asymmetry > 5
        ? "Углы локтей асимметричны — проверьте положение рук на руле."
        : "Локти симметричны."
    );
  } else {
    elbowAngleSymmetry = makeSymmetryResult(
      0,
      10,
      "Симметрия углов локтей",
      "Разница в сгибании локтей.",
      "Не удалось определить."
    );
  }

  return {
    gripWidth,
    shoulderTilt,
    elbowPosition,
    headTilt,
    kneeSymmetry,
    elbowAngleSymmetry,
    leftShoulderX: ls.x,
    rightShoulderX: rs.x,
    leftWristX: lw?.x ?? 0,
    rightWristX: rw?.x ?? 0,
  };
}

// ============================================================
// ОБЪЕДИНЁННЫЙ ТИП АНАЛИЗА
// ============================================================

export type ViewType = "side" | "back" | "front";

export interface MultiViewAnalysis {
  side: BikeFitAnalysis | null;
  back: BackViewAnalysis | null;
  front: FrontViewAnalysis | null;
}

export const VIEW_LABELS: Record<ViewType, { ru: string; short: string; emoji: string; description: string }> = {
  side: {
    ru: "Вид сбоку",
    short: "Сбоку",
    emoji: "➡️",
    description:
      "ФОТО С ЧЕЛОВЕКОМ НА ВЕЛОСИПЕДЕ. Снимайте сбоку, перпендикулярно велосипеду, на уровне седла. Велосипедист должен сидеть в рабочей посадке. Педаль в НМТ (нижняя точка). Видны: плечо, бедро, колено, голеностоп, стопа на педали.",
  },
  back: {
    ru: "Вид сзади",
    short: "Сзади",
    emoji: "⬅️",
    description:
      "ФОТО С ЧЕЛОВЕКОМ НА ВЕЛОСИПЕДЕ. Снимайте строго сзади, на расстоянии 3-4 метра. Виден весь велосипедист сверху донизу — голова, плечи, таз, колени, стопы. Оценка симметрии тела.",
  },
  front: {
    ru: "Вид спереди",
    short: "Спереди",
    emoji: "➡️",
    description:
      "ФОТО С ЧЕЛОВЕКОМ НА ВЕЛОСИПЕДЕ. Снимайте спереди-сбоку (под углом 30-45°), чтобы видеть руки на руле и плечи. Камера на уровне руля. Оценка хвата и положения рук.",
  },
};

