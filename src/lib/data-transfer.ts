/**
 * v1.14.40: файловый перенос данных BikeSnap между доменами.
 *
 * Зачем: localStorage изолирован по origin — велосипеды, сохранённые
 * на bike-snap.vercel.app, невидимы на зеркале agent-slon-lab.github.io
 * (и наоборот). Данные при этом никогда не покидают устройство: оба
 * «ящика» лежат локально, браузер лишь разделяет их по домену. Когда
 * vercel заблокирован (SNI-блок без VPN), файл — единственный мост:
 *   1) один раз открыть vercel-версию (VPN) → кнопка «Экспорт» в шапке
 *      → скачивается bikesnap-data-ГГГГ-ММ-ДД.json;
 *   2) открыть зеркало (или работать там дальше) → «Импорт» в шапке →
 *      выбрать файл → велосипеды и райдеры переносятся в ящик зеркала.
 *
 * Формат файла: self-describing JSON с app/kind/schema — чужие и
 * случайные файлы отвергаются с понятной ошибкой. Фото велов едут
 * внутри записей (base64 data URL), объём файла может быть большим —
 * это нормально.
 */

import { APP_VERSION } from "./app-version";
import {
  readSnapshot,
  mergeSnapshot,
  type StorageSnapshot,
  type MergeResult,
} from "./bike-storage";

const PAYLOAD_APP = "bikesnap";
const PAYLOAD_KIND = "bikesnap-data-transfer";
const PAYLOAD_SCHEMA = 1;

export interface TransferPayload extends StorageSnapshot {
  app: string;
  kind: string;
  schema: number;
  /** Версия приложения, которой файл создан */
  fromVersion: string;
  /** ISO-дата экспорта */
  exportedAt: string;
}

/** Собрать payload для экспорта из текущего хранилища. */
export function buildTransferPayload(): TransferPayload {
  const snap = readSnapshot();
  return {
    ...snap,
    app: PAYLOAD_APP,
    kind: PAYLOAD_KIND,
    schema: PAYLOAD_SCHEMA,
    fromVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
  };
}

export interface DownloadResult {
  bikes: number;
  riders: number;
}

/**
 * Скачать файл экспорта (bikesnap-data-ГГГГ-ММ-ДД.json).
 * Возвращает количества для тоста. Вызов только из браузера
 * (кнопка в шапке — клиентский компонент).
 */
export function downloadDataFile(): DownloadResult {
  const payload = buildTransferPayload();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
  a.href = url;
  a.download = `bikesnap-data-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke с запасом: на мобильных загрузка может стартовать с задержкой
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { bikes: payload.bikes.length, riders: payload.riders.length };
}

/**
 * Прочитать и влить файл экспорта в текущее хранилище.
 * Бросает Error с текстом для тоста, если файл чужой/битый.
 */
export async function importDataFile(file: File): Promise<MergeResult> {
  const text = await file.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Файл не читается как JSON — это точно файл BikeSnap?");
  }
  const p = json as Partial<TransferPayload> | null;
  if (!p || p.app !== PAYLOAD_APP || p.kind !== PAYLOAD_KIND) {
    throw new Error("Это не файл данных BikeSnap (экспорт из шапки приложения)");
  }
  if (p.schema !== PAYLOAD_SCHEMA) {
    throw new Error("Неподдерживаемая версия формата файла");
  }
  const incoming: StorageSnapshot = {
    riders: Array.isArray(p.riders) ? p.riders : [],
    bikes: Array.isArray(p.bikes) ? p.bikes : [],
    activeRiderId: typeof p.activeRiderId === "string" ? p.activeRiderId : null,
    activeBikeId: typeof p.activeBikeId === "string" ? p.activeBikeId : null,
  };
  return mergeSnapshot(incoming);
}
