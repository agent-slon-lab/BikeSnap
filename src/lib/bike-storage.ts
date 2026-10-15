/**
 * Локальное хранение райдеров и велосипедов — НЕЗАВИСИМЫЕ списки.
 *
 * Райдеры и велики не привязаны друг к другу.
 * Пользователь миксует любого райдера с любым великом.
 */

import type { BikeMeasurements, BodyMeasurements } from "./bike-calculations";
import type { BikeType } from "./bike-params";
import type { Complaint } from "./bike-store";

// ============================================================
// ТИПЫ
// ============================================================

export interface Rider {
  id: string;
  name: string;
  body: BodyMeasurements;
  // v1.13.2: цель и жалобы — атрибуты райдера (переживают refresh,
  // переключение райдеров и «Начать заново»).
  // undefined = профиль создан старой версией — не трогаем store-значения.
  goal?: "comfort" | "sport" | "race" | null;
  complaints?: Complaint[];
  createdAt: number;
}

export interface BikeRecord {
  id: string;
  name: string;
  type: BikeType;
  measurements: BikeMeasurements;
  /** Фото велосипеда (base64 data URL, сжатый) */
  photoData?: string;
  /** Ключевые точки калибровки (для восстановления) */
  keyPointsData?: string;
  /**
   * Провенанс фото-калибровки: ключи measurements, которые были ЗАПИСАНЫ
   * из фото (например WB, дозаполненный в пустое поле). Нужен, чтобы
   * «Удалить фото»/«Очистить» в калибраторе убирали из карточки только
   * ВЫЧИСЛЕННЫЕ значения, не трогая введённые вручную.
   * Поля, которых в форме нет вообще (reach/stack/sta/hta/FC/RC/ST/BB Drop),
   * сюда не пишутся — они в любом случае чистятся при удалении фото.
   */
  photoDerived?: string[];
  /**
   * Телеметрия последнего успешного расчёта ядра геометрии (v1.14.29,
   * Issue #6): источник масштаба, мм/пиксель, наклон оси колёс в кадре.
   * Уходит в отчёт отладки (telemetry.calibration). Чистится вместе
   * с фото (updateBikePhotoScale(id, null) из handleClear/замены фото).
   */
  photoCalib?: {
    scaleMmPerPx: number;
    scaleSource: string;
    frameTiltDeg: number;
    /** v1.14.34 (ТЗ п. 5.4): pxWheelbase/pxWheelDiameter по фото вела */
    wheelRatio?: number;
  };
  /**
   * v1.14.35: скор авто-проверки «на фото вела обнаружен человек» (0..1)
   * — ТЗ п. 5.3, порог PERSON_BIKE_PHOTO_MAX_SCORE = 0.7. Уходит в отчёт
   * отладки (calibration.personScore): по нему видно, что именно нейросеть
   * сказала о конкретном фото. Чистится при замене/удалении фото.
   */
  photoPersonScore?: number;
  createdAt: number;
  updatedAt: number;
}

// ============================================================
// КЛЮЧИ localStorage
// ============================================================

const RIDERS_KEY = "bikefit-riders";
const BIKES_KEY = "bikefit-bikes";
const ACTIVE_RIDER_KEY = "bikefit-active-rider";
/**
 * v1.14.31: экспортирован для bike-store — подписка на cross-tab «storage»
 * фильтруется по этому ключу, чтобы heal черновика запускался ТОЛЬКО при
 * реальной смене активного вела (а не на каждый autosave из другой вкладки).
 */
export const ACTIVE_BIKE_KEY = "bikefit-active-bike";

/**
 * v1.14.30 (Stale State): событие «активный велик сменился».
 * Диспатчится из setActiveBike/createBike/deleteBike. Подписчики
 * (useActiveBikeId → key={activeBikeId} на шагах онбординга) принудительно
 * перемонтируют форму/сводку/анализ — старые данные протухшего вела
 * размонтируются React'ом, а не «доживают» в useState.
 */
export const ACTIVE_BIKE_CHANGED_EVENT = "bikesnap:active-bike-changed";

function notifyActiveBikeChanged() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(ACTIVE_BIKE_CHANGED_EVENT));
  } catch {
    /* окружение без Event API — просто без уведомления */
  }
}

// ============================================================
// УТИЛИТЫ
// ============================================================

function load<T>(key: string): T[] {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function save<T>(key: string, items: T[]) {
  // v1.14.24: квота localStorage не должна ронять поток сохранения —
  // при переполнении запись просто не проходит (остаётся предыдущая версия).
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch (e) {
    console.warn("[bike-storage] не удалось сохранить (квота?) —", e);
  }
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// РАЙДЕРЫ
// ============================================================

export function getRiders(): Rider[] {
  return load<Rider>(RIDERS_KEY);
}

export function createRider(name: string, body: BodyMeasurements): Rider {
  const rider: Rider = {
    id: genId(),
    name,
    body,
    createdAt: Date.now(),
  };
  const riders = getRiders();
  riders.push(rider);
  save(RIDERS_KEY, riders);
  setActiveRider(rider.id);
  return rider;
}

/** Частичное обновление профиля райдера: тело, цель и/или жалобы */
export function updateRider(
  id: string,
  data: Partial<Pick<Rider, "body" | "goal" | "complaints">>
) {
  const riders = getRiders();
  const r = riders.find((r) => r.id === id);
  if (r) {
    Object.assign(r, data);
    save(RIDERS_KEY, riders);
  }
}

export function deleteRider(id: string) {
  const riders = getRiders().filter((r) => r.id !== id);
  save(RIDERS_KEY, riders);
  if (getActiveRiderId() === id) {
    localStorage.removeItem(ACTIVE_RIDER_KEY);
  }
}

export function getActiveRiderId(): string | null {
  return localStorage.getItem(ACTIVE_RIDER_KEY);
}

export function getActiveRider(): Rider | null {
  const riders = getRiders();
  const activeId = getActiveRiderId();
  if (!activeId) return riders[0] ?? null;
  return riders.find((r) => r.id === activeId) ?? riders[0] ?? null;
}

export function setActiveRider(id: string) {
  localStorage.setItem(ACTIVE_RIDER_KEY, id);
}

// ============================================================
// ВЕЛОСИПЕДЫ (НЕЗАВИСИМО от райдеров)
// ============================================================

export function getBikes(): BikeRecord[] {
  const bikes = load<BikeRecord>(BIKES_KEY);
  // v1.14.24: самолечение записей, повреждённых прежним багом — в photoData
  // мог попасть blob: URL (живёт только до перезагрузки страницы) → после F5
  // «фото не грузится, чёрный экран». Точки (keyPointsData) сохраняем: они
  // в нормированных координатах и подходят к повторно загруженному фото.
  let healed = false;
  for (const b of bikes) {
    if (b.photoData && b.photoData.startsWith("blob:")) {
      delete b.photoData;
      healed = true;
    }
  }
  if (healed) save(BIKES_KEY, bikes);
  return bikes;
}

export function createBike(name: string, type: BikeType, measurements: BikeMeasurements): BikeRecord {
  const bike: BikeRecord = {
    id: genId(),
    name,
    type,
    measurements,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const bikes = getBikes();
  bikes.push(bike);
  save(BIKES_KEY, bikes);
  setActiveBike(bike.id);
  return bike;
}

export function updateBike(id: string, measurements: BikeMeasurements) {
  const bikes = getBikes();
  const b = bikes.find((b) => b.id === id);
  if (b) {
    b.measurements = measurements;
    b.updatedAt = Date.now();
    save(BIKES_KEY, bikes);
  }
}

/** Сохранить фото и точки калибровки для велика.
 *  v1.14.24: blob: URL сюда попадать не должен (умирает при F5 → «чёрный
 *  экран») — такой вызов трактуется как «фото не персистим», точки сохраняются. */
export function updateBikePhoto(id: string, photoData: string | undefined, keyPointsData: string | undefined) {
  const bikes = getBikes();
  const b = bikes.find((b) => b.id === id);
  if (b) {
    b.photoData = photoData && photoData.startsWith("blob:") ? undefined : photoData;
    b.keyPointsData = keyPointsData;
    // v1.14.35: вердикт «человек на фото» относится к СТАРОМУ фото —
    // при замене/удалении кадра он недействителен
    delete b.photoPersonScore;
    b.updatedAt = Date.now();
    save(BIKES_KEY, bikes);
  }
}

/**
 * v1.14.35: сохранить/очистить скор проверки «на фото вела обнаружен
 * человек» (ТЗ п. 5.3). score = null — проверка не шла (модель не готова,
 * фото не загрузилось). Телеметрия уходит в отчёт отладки: жалобы вида
 * «ИИ не понял моё фото» диагностируются по точному числу.
 */
export function updateBikePhotoPersonScore(id: string, score: number | null) {
  const bikes = getBikes();
  const b = bikes.find((b) => b.id === id);
  if (!b) return;
  if (score != null && Number.isFinite(score) && score >= 0) {
    b.photoPersonScore = Math.round(score * 1000) / 1000;
  } else {
    delete b.photoPersonScore;
  }
  b.updatedAt = Date.now();
  save(BIKES_KEY, bikes);
}

/**
 * Сохранить/очистить телеметрию фото-калибровки (v1.14.29, Issue #6):
 * источник масштаба, мм/пиксель и наклон оси колёс — уходят в отчёт отладки.
 * v1.14.34 (ТЗ п. 5.4): + wheelRatio — масштабно-инвариантная пропорция
 * «колёсная база / диаметр колеса» по фото вела (Шаг 2). Используется
 * Bike Match Validation: сравнение с фото райдера (Шаг 1), расхождение
 * > 12% → «возможно, фото двух разных велосипедов».
 * info = null — сброс (фото удалено/заменено, движок упал).
 */
export function updateBikePhotoScale(
  id: string,
  info: {
    scaleMmPerPx: number;
    scaleSource: string;
    frameTiltDeg: number;
    wheelRatio?: number | null;
  } | null
) {
  const bikes = getBikes();
  const b = bikes.find((b) => b.id === id);
  if (!b) return;
  if (info && Number.isFinite(info.scaleMmPerPx) && info.scaleMmPerPx > 0) {
    b.photoCalib = {
      scaleMmPerPx: Math.round(info.scaleMmPerPx * 10000) / 10000,
      scaleSource: info.scaleSource,
      frameTiltDeg: Math.round(info.frameTiltDeg * 10) / 10,
      ...(info.wheelRatio != null && Number.isFinite(info.wheelRatio) && info.wheelRatio > 0
        ? { wheelRatio: Math.round(info.wheelRatio * 1000) / 1000 }
        : {}),
    };
  } else {
    delete b.photoCalib;
  }
  b.updatedAt = Date.now();
  save(BIKES_KEY, bikes);
}

/**
 * Запомнить, какие поля карточки записаны из фото-калибровки (провенанс).
 * keys = null — сбросить провенанс (фото удалено / вычисленные значения очищены).
 */
export function updateBikePhotoDerived(id: string, keys: string[] | null) {
  const bikes = getBikes();
  const b = bikes.find((b) => b.id === id);
  if (b) {
    if (keys && keys.length > 0) {
      b.photoDerived = keys;
    } else {
      delete b.photoDerived;
    }
    b.updatedAt = Date.now();
    save(BIKES_KEY, bikes);
  }
}

export function deleteBike(id: string) {
  const bikes = getBikes().filter((b) => b.id !== id);
  save(BIKES_KEY, bikes);
  if (getActiveBikeId() === id) {
    localStorage.removeItem(ACTIVE_BIKE_KEY);
    // v1.14.30: активный велик удалён — подписчики обязаны узнать
    notifyActiveBikeChanged();
  }
}

export function getActiveBikeId(): string | null {
  return localStorage.getItem(ACTIVE_BIKE_KEY);
}

export function getActiveBike(): BikeRecord | null {
  const bikes = getBikes();
  const activeId = getActiveBikeId();
  if (!activeId) return bikes[0] ?? null;
  return bikes.find((b) => b.id === activeId) ?? bikes[0] ?? null;
}

export function setActiveBike(id: string) {
  const prev = getActiveBikeId();
  localStorage.setItem(ACTIVE_BIKE_KEY, id);
  // v1.14.30: диспатчим только при РЕАЛЬНОЙ смене — лишние ремоунты
  // шагов при повторном клике по уже активной карточке не нужны
  if (prev !== id) notifyActiveBikeChanged();
}

// ============================================================
// ОЧИСТКА
// ============================================================

export function clearAll() {
  localStorage.removeItem(RIDERS_KEY);
  localStorage.removeItem(BIKES_KEY);
  localStorage.removeItem(ACTIVE_RIDER_KEY);
  localStorage.removeItem(ACTIVE_BIKE_KEY);
}
