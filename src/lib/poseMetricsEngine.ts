/**
 * POSE METRICS ENGINE — единый анатомический стандарт углов суставов
 * ===================================================================
 *
 * ТЗ (v1.14.22): привести все углы суставов и их нормы к единому
 * анатомическому стандарту — 180° = полностью выпрямленный сустав.
 *
 * КРИТИЧЕСКАЯ ОШИБКА, которую чинит модуль: раньше bike-fit.ts сравнивал
 * анатомический угол разгибания колена (например, 176.3°) с диапазоном
 * СГИБА 25–35° — отсюда ложные «критично» и противоречивые советы
 * («колено слишком прямое — опустите седло» при нормальной ноге).
 *
 * Стандартные определения:
 *  1. Угол колена (Knee Extension): Hip → Knee → Ankle, норма 140–150°
 *     (оптимум ~145°). Угол сгиба для UI = 180° − kneeAngle (норма 30–40°).
 *  2. Угол бедра (Hip): между вектором туловища (Shoulder → Hip) и вектором
 *     бедра (Hip → Knee), норма 95–105° в НМТ.
 *  3. Наклон корпуса (Torso): вектор спины (Hip → Shoulder) относительно
 *     горизонтальной оси X. Норма шоссе 35–45°.
 *       > 45° — спина слишком ВЕРТИКАЛЬНАЯ (комфортная/высокая посадка);
 *       < 35° — спина слишком ГОРИЗОНТАЛЬНАЯ (агрессивная/низкая посадка).
 *  4. Угол голеностопа (Ankle): Knee → Ankle → Toe, норма 90–110°.
 *
 * Координаты — экранные (Canvas): Y растёт вниз. Все векторные функции
 * учитывают это явной инверсией.
 */

export interface JointPoint {
  x: number;
  y: number;
}

export interface BodyKeypoints {
  shoulder: JointPoint;
  hip: JointPoint;
  knee: JointPoint;
  ankle: JointPoint;
  toe: JointPoint;
}

export interface MetricRange {
  min: number;
  max: number;
  unit: string;
}

export interface PoseMetricResult {
  value: number;
  norm: MetricRange;
  status: "OPTIMAL" | "TOO_LOW" | "TOO_HIGH";
  description: string;
  recommendation?: string;
}

export interface FullPoseAnalysis {
  kneeAngle: PoseMetricResult;
  hipAngle: PoseMetricResult;
  torsoAngle: PoseMetricResult;
  ankleAngle: PoseMetricResult;
}

// ------------------------------------------------------------------
// КОНФИГУРАЦИЯ НОРМ (единый источник — импортируется bike-fit.ts)
// ------------------------------------------------------------------

export const JOINT_NORMS = {
  /** Анатомический угол разгибания колена в НМТ (180° = выпрямлен) */
  knee: { min: 140, max: 150, unit: "°" } as MetricRange,
  /** Угол бедра: туловище ↔ бедро */
  hip: { min: 95, max: 105, unit: "°" } as MetricRange,
  /** Наклон корпуса к горизонту (0° = горизонтально, 90° = вертикально) */
  torso: { min: 35, max: 45, unit: "°" } as MetricRange,
  /** Угол голеностопа: голень ↔ стопа */
  ankle: { min: 90, max: 110, unit: "°" } as MetricRange,
} as const;

/** Норма угла СГИБА колена, если в UI показываем сгиб (180° − анатомический) */
export const KNEE_FLEXION_NORM: MetricRange = { min: 30, max: 40, unit: "°" };

/** Угол сгиба колена из анатомического угла (сгиб = 180° − разгибание) */
export function kneeFlexion(anatomicalKneeAngle: number): number {
  return 180 - anatomicalKneeAngle;
}

/** Порог кросс-валидации «спина почти вертикальна» (жалобы на руки) */
export const TORSO_UPRIGHT_THRESHOLD_DEG = 50;

/**
 * Кросс-валидация «жалобы vs поза»: если райдер жалуется на перегруз рук,
 * но спина почти вертикальна (> 50°) — «низкий руль» под вопросом; частая
 * причина — седло, заваленное вперёд, или слишком длинный вынос, из-за
 * которых тело сползает вперёд.
 */
export function isTorsoUprightForHandComplaints(torsoAngleDeg: number | null | undefined): boolean {
  return torsoAngleDeg != null && torsoAngleDeg > TORSO_UPRIGHT_THRESHOLD_DEG;
}

// ------------------------------------------------------------------
// Вспомогательные функции расчёта углов
// ------------------------------------------------------------------

/** Анатомический угол в вершине b между векторами b→a и b→c, градусы [0..180] */
export function calculateAngle3Points(a: JointPoint, b: JointPoint, c: JointPoint): number {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };

  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.hypot(ab.x, ab.y);
  const magCB = Math.hypot(cb.x, cb.y);

  if (magAB === 0 || magCB === 0) return 0;

  const cosTheta = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

/**
 * Угол вектора p1→p2 относительно горизонтальной оси X, градусы [0..90].
 * dy инвертирован: в Canvas Y направлен вниз. 0° = горизонтально,
 * 90° = вертикально.
 */
export function calculateVectorAngleToHorizontal(p1: JointPoint, p2: JointPoint): number {
  const dx = p2.x - p1.x;
  const dy = p1.y - p2.y; // В Canvas Y направлен вниз
  const rad = Math.atan2(dy, Math.abs(dx));
  return (rad * 180) / Math.PI;
}

// ------------------------------------------------------------------
// Главная функция анализа позы
// ------------------------------------------------------------------

export function analyzeRiderPose(pts: BodyKeypoints): FullPoseAnalysis {
  // 1. Угол колена (Hip - Knee - Ankle)
  const rawKneeAngle = calculateAngle3Points(pts.hip, pts.knee, pts.ankle);
  const kneeValue = Number(rawKneeAngle.toFixed(1));
  const kneeNorm: MetricRange = { ...JOINT_NORMS.knee };

  let kneeStatus: "OPTIMAL" | "TOO_LOW" | "TOO_HIGH" = "OPTIMAL";
  let kneeRec = "Высота седла находится в пределах нормы.";
  if (kneeValue > kneeNorm.max) {
    kneeStatus = "TOO_HIGH";
    kneeRec = `Нога слишком прямая (${kneeValue}°). Опустите седло, чтобы угол в НМТ составлял 140–150°.`;
  } else if (kneeValue < kneeNorm.min) {
    kneeStatus = "TOO_LOW";
    kneeRec = `Колено слишком согнуто (${kneeValue}°). Поднимите седло для предотвращения перегрузки сустава.`;
  }

  // 2. Угол бедра (Shoulder - Hip - Knee)
  const rawHipAngle = calculateAngle3Points(pts.shoulder, pts.hip, pts.knee);
  const hipValue = Number(rawHipAngle.toFixed(1));
  const hipNorm: MetricRange = { ...JOINT_NORMS.hip };

  let hipStatus: "OPTIMAL" | "TOO_LOW" | "TOO_HIGH" = "OPTIMAL";
  let hipRec = "Тазобедренный угол оптимален.";
  if (hipValue < hipNorm.min) {
    hipStatus = "TOO_LOW";
    hipRec = "Тазобедренный сустав пережат. Увеличьте дистанцию до руля или поднимите вынос.";
  } else if (hipValue > hipNorm.max) {
    hipStatus = "TOO_HIGH";
    hipRec = "Угол бедра слишком открыт. Посадка может быть избыточно растянутой.";
  }

  // 3. Наклон корпуса (Hip -> Shoulder к горизонту)
  const rawTorsoAngle = calculateVectorAngleToHorizontal(pts.hip, pts.shoulder);
  const torsoValue = Number(Math.abs(rawTorsoAngle).toFixed(1));
  const torsoNorm: MetricRange = { ...JOINT_NORMS.torso };

  let torsoStatus: "OPTIMAL" | "TOO_LOW" | "TOO_HIGH" = "OPTIMAL";
  let torsoRec = "Наклон спины соответствует норме для шоссейной посадки.";
  if (torsoValue > torsoNorm.max) {
    torsoStatus = "TOO_HIGH";
    // > 45° — спина более ВЕРТИКАЛЬНАЯ (комфортная/высокая посадка)
    torsoRec = "Спина стоит слишком вертикально. Для улучшения аэродинамики опустите или удлините вынос.";
  } else if (torsoValue < torsoNorm.min) {
    torsoStatus = "TOO_LOW";
    // < 35° — спина более ГОРИЗОНТАЛЬНАЯ (агрессивная/низкая посадка)
    torsoRec = "Спина наклонена слишком низко. Поднимите вынос руля для снижения нагрузки на поясницу и руки.";
  }

  // 4. Угол голеностопа (Knee - Ankle - Toe)
  const rawAnkleAngle = calculateAngle3Points(pts.knee, pts.ankle, pts.toe);
  const ankleValue = Number(rawAnkleAngle.toFixed(1));
  const ankleNorm: MetricRange = { ...JOINT_NORMS.ankle };

  let ankleStatus: "OPTIMAL" | "TOO_LOW" | "TOO_HIGH" = "OPTIMAL";
  let ankleRec = "Положение стопы стабильное.";
  if (ankleValue > ankleNorm.max) {
    ankleStatus = "TOO_HIGH";
    ankleRec = "Носок слишком опущен вниз. Возможно, седло задрано слишком высоко, и вы тянетесь к педали.";
  } else if (ankleValue < ankleNorm.min) {
    ankleStatus = "TOO_LOW";
    ankleRec = "Пятка сильно провалена вниз. Проверьте положение шипа на велотуфлях.";
  }

  return {
    kneeAngle: {
      value: kneeValue,
      norm: kneeNorm,
      status: kneeStatus,
      description: "Угол выпрямления колена в нижней точке педалирования (НМТ).",
      recommendation: kneeRec,
    },
    hipAngle: {
      value: hipValue,
      norm: hipNorm,
      status: hipStatus,
      description: "Угол между туловищем и бедром.",
      recommendation: hipRec,
    },
    torsoAngle: {
      value: torsoValue,
      norm: torsoNorm,
      status: torsoStatus,
      description: "Угол наклона спины относительно горизонтали.",
      recommendation: torsoRec,
    },
    ankleAngle: {
      value: ankleValue,
      norm: ankleNorm,
      status: ankleStatus,
      description: "Угол сгиба стопы на педали.",
      recommendation: ankleRec,
    },
  };
}
