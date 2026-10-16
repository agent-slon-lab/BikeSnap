/**
 * SYNC BRIDGE (v1.14.41) — бесшовная синхронизация localStorage между
 * доменами vercel и зеркала через скрытый iframe + postMessage.
 * ===========================================================================
 *
 * ПРОБЛЕМА: localStorage изолирован по origin (правило Same-Origin Policy):
 * велики, сохранённые на bike-snap.vercel.app, невидимы на зеркале
 * agent-slon-lab.github.io и наоборот. Файловый экспорт/импорт (v1.14.40)
 * работает, но требует ручных действий. Мост делает то же самое сам.
 *
 * КАК РАБОТАЕТ:
 *  1. Приложение на одном домене монтирует скрытый <iframe> со служебной
 *     страницей /sync-bridge.html на ДРУГОМ домене;
 *  2. iframe исполняется в контексте чужого origin → его скрипт видит
 *     localStorage ЧУЖОГО домена и отвечает на postMessage;
 *  3. Приложение получает снапшот (riders+bikes+активы) и вливает его
 *     через mergeSnapshot() — additively, по id, ничего не перезаписывая.
 *
 * ОБА НАПРАВЛЕНИЯ: на vercel тянем с зеркала, на зеркале — с vercel
 * (взаимный pull, ничего не пишем в чужое хранилище → циклов нет).
 *
 * КОГДА НЕ РАБОТАЕТ (и это нормально): vercel заблокирован без VPN —
 * iframe не загрузится, через SYNC_TIMEOUT_MS мост тихо закрывается,
 * приложение продолжает работать локально. Ручной путь — экспорт/импорт.
 *
 * БЕЗОПАСНОСТЬ: сверяются event.origin (только peer), event.source
 * (только наш iframe) и requestId; снапшот валидируется перед merge;
 * чужие/кривые payload'ы отбрасываются. Данные не покидают устройство —
 * iframe это тот же браузер, тот же диск.
 */

import {
  mergeSnapshot,
  type StorageSnapshot,
} from "./bike-storage";

const MIRROR_ORIGIN = "https://agent-slon-lab.github.io";
const VERCEL_ORIGIN = "https://bike-snap.vercel.app";

const MSG_READ = "BIKESNAP_READ_STORAGE";
const MSG_DATA = "BIKESNAP_STORAGE_DATA";

/** Таймаут ожидания ответа моста (vercel заблокирован → тихий no-op) */
const SYNC_TIMEOUT_MS = 8000;
/** Задержка старта: не конкурировать с первым рендером и SW-регистрацией */
const START_DELAY_MS = 2500;

const STORAGE_KEYS = [
  "bikefit-riders",
  "bikefit-bikes",
  "bikefit-active-rider",
  "bikefit-active-bike",
] as const;

/** Чей снапшот тянем с этого домена (null — домен не наш, синка нет) */
function peerOriginFor(origin: string): string | null {
  if (origin === MIRROR_ORIGIN) return VERCEL_ORIGIN;
  if (origin === VERCEL_ORIGIN) return MIRROR_ORIGIN;
  return null; // localhost и прочие — синхронизация не применима
}

/** Валидация payload моста → StorageSnapshot (кривой payload → null) */
function payloadToSnapshot(
  payload: unknown
): StorageSnapshot | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const parseArray = (key: (typeof STORAGE_KEYS)[number]): unknown[] => {
    const raw = p[key];
    if (raw == null) return [];
    if (typeof raw !== "string") return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const riders = parseArray("bikefit-riders");
  const bikes = parseArray("bikefit-bikes");
  const activeRiderRaw = p["bikefit-active-rider"];
  const activeBikeRaw = p["bikefit-active-bike"];
  return {
    // Касты безопасны: mergeSnapshot построчно валидирует записи
    // (id/name/body|measurements) и молча пропускает кривые
    riders: riders as StorageSnapshot["riders"],
    bikes: bikes as StorageSnapshot["bikes"],
    activeRiderId:
      typeof activeRiderRaw === "string" && activeRiderRaw ? activeRiderRaw : null,
    activeBikeId:
      typeof activeBikeRaw === "string" && activeBikeRaw ? activeBikeRaw : null,
  };
}

export interface SyncResult {
  ok: boolean;
  ridersAdded: number;
  bikesAdded: number;
  /** Причина неудачи для логов (пользователю не показывается) */
  reason?: "peer-not-applicable" | "timeout" | "bad-payload" | "merge-failed";
}

/**
 * Запустить одну синхронизацию со «второй половиной» приложения.
 * Вызывается один раз за загрузку страницы (из SyncBridgeInit).
 */
export function startStorageSync(options?: {
  startDelayMs?: number;
  timeoutMs?: number;
}): Promise<SyncResult> {
  const startDelayMs = options?.startDelayMs ?? START_DELAY_MS;
  const timeoutMs = options?.timeoutMs ?? SYNC_TIMEOUT_MS;

  return new Promise((resolve) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      resolve({ ok: false, ridersAdded: 0, bikesAdded: 0, reason: "peer-not-applicable" });
      return;
    }
    const peer = peerOriginFor(window.location.origin);
    if (!peer) {
      resolve({ ok: false, ridersAdded: 0, bikesAdded: 0, reason: "peer-not-applicable" });
      return;
    }

    let settled = false;
    let iframe: HTMLIFrameElement | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const finish = (res: SyncResult) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      window.removeEventListener("message", onMessage);
      try {
        iframe?.remove();
      } catch {
        /* ignore */
      }
      resolve(res);
    };

    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== peer) return;
      if (!iframe || ev.source !== iframe.contentWindow) return;
      const d = ev.data as { type?: unknown; requestId?: unknown; payload?: unknown } | null;
      if (!d || d.type !== MSG_DATA || d.requestId !== requestId) return;
      const snap = payloadToSnapshot(d.payload);
      if (!snap) {
        console.warn("[syncBridge] кривой payload от моста — пропущен");
        finish({ ok: false, ridersAdded: 0, bikesAdded: 0, reason: "bad-payload" });
        return;
      }
      try {
        // Additive merge по id: существующие записи не трогаем, актив не
        // перебрасывается, если локальный актив существует (см. mergeSnapshot)
        const res = mergeSnapshot(snap);
        finish({
          ok: true,
          ridersAdded: res.ridersAdded,
          bikesAdded: res.bikesAdded,
        });
      } catch (e) {
        console.warn("[syncBridge] merge упал —", e);
        finish({ ok: false, ridersAdded: 0, bikesAdded: 0, reason: "merge-failed" });
      }
    };

    const requestId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const run = () => {
      window.addEventListener("message", onMessage);
      iframe = document.createElement("iframe");
      iframe.style.cssText =
        "position:absolute;width:0;height:0;border:0;visibility:hidden;left:-9999px";
      iframe.setAttribute("aria-hidden", "true");
      iframe.tabIndex = -1;
      iframe.title = "BikeSnap sync bridge";
      iframe.src = peer + "/sync-bridge.html";
      document.body.appendChild(iframe);
      timers.push(
        setTimeout(() => {
          // vercel заблокирован / зеркало недоступно — тихо выходим
          console.info("[syncBridge] вторая половина недоступна — синхронизация пропущена");
          finish({ ok: false, ridersAdded: 0, bikesAdded: 0, reason: "timeout" });
        }, timeoutMs)
      );
    };

    timers.push(setTimeout(run, startDelayMs));
  });
}
