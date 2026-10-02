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
  createdAt: number;
  updatedAt: number;
}

// ============================================================
// КЛЮЧИ localStorage
// ============================================================

const RIDERS_KEY = "bikefit-riders";
const BIKES_KEY = "bikefit-bikes";
const ACTIVE_RIDER_KEY = "bikefit-active-rider";
const ACTIVE_BIKE_KEY = "bikefit-active-bike";

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
  localStorage.setItem(key, JSON.stringify(items));
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
  return load<BikeRecord>(BIKES_KEY);
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

/** Сохранить фото и точки калибровки для велика */
export function updateBikePhoto(id: string, photoData: string | undefined, keyPointsData: string | undefined) {
  const bikes = getBikes();
  const b = bikes.find((b) => b.id === id);
  if (b) {
    b.photoData = photoData;
    b.keyPointsData = keyPointsData;
    b.updatedAt = Date.now();
    save(BIKES_KEY, bikes);
  }
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
  localStorage.setItem(ACTIVE_BIKE_KEY, id);
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
