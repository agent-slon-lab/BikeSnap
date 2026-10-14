/**
 * ПЕРСИСТ ФОТО И АНАЛИЗА ШАГА 4 «АНАЛИЗ» (v1.14.17)
 * ===========================================================================
 * Жалоба: «на шаге 4 загрузил фото, сделал анализ посадки — ЭТО НАДО ВСЕГДА
 * И ПОСТОЯННО СОХРАНЯТЬ! каждый шаг. а то я обновляю прил и постоянно гружу
 * файл». Раньше фото (blob: URL!) и результаты анализа жили в useState
 * PhotoAnalysisSection: refresh, закрытие вкладки и даже переход на другой
 * шаг (секция размонтируется) стирали всё.
 *
 * Решение: Zustand + persist в localStorage. Фото хранится как JPEG dataURL
 * ≤1280px (blob: URL мёртв после перезагрузки — не персистим его никогда,
 * а при ре-гидрации выбрасываем). Объём: 3 фото ≈ 0.3–1.5 МБ — в лимит
 * localStorage (~5 МБ) помещается; переполнение ловится safeStorage и не
 * роняет UI (фото просто не персистятся до следующего раза).
 */

import { create } from "zustand";
import {
  persist,
  createJSONStorage,
  type StateStorage,
} from "zustand/middleware";
import type {
  Point,
  ViewType,
  BikeFitAnalysis,
  BackViewAnalysis,
  FrontViewAnalysis,
} from "@/lib/bike-fit";
import type { CaptureMeta } from "@/lib/fit-report";

/** Что хранится по каждому ракурсу (side/back/front). */
export interface PersistedViewPhoto {
  /** JPEG dataURL ≤1280px — переживает refresh. blob: не персистим. */
  photoData: string | null;
  /** Последние успешно найденные landmarks (могут быть без analysis). */
  landmarks: Point[] | null;
  /** Результат анализа ракурса (union — при чтении кастуется по view). */
  analysis: BikeFitAnalysis | BackViewAnalysis | FrontViewAnalysis | null;
  /** Гироскоп в момент спуска (кадры из камеры). */
  captureMeta: CaptureMeta | null;
  /** Когда фото загружено (мс). */
  savedAt: number | null;
}

const emptyView = (): PersistedViewPhoto => ({
  photoData: null,
  landmarks: null,
  analysis: null,
  captureMeta: null,
  savedAt: null,
});

const emptyViews = (): Record<ViewType, PersistedViewPhoto> => ({
  side: emptyView(),
  back: emptyView(),
  front: emptyView(),
});

interface PhotoAnalysisState {
  /**
   * v1.14.30 (Stale State): какому велику принадлежат фото/анализы.
   * Отчёт Bike_B, собранный из углов Bike_A («система наложила углы нового
   * фото на геометрию старого вела») — главный источник невязок. Теперь
   * ракурсы жёстко привязаны к активному велику: syncBikeId при смене
   * стирает ВСЁ (фото + landmarks + анализы) и пишет новый id.
   */
  bikeId: string | null;
  views: Record<ViewType, PersistedViewPhoto>;
  /**
   * v1.14.30: вызывается из PhotoAnalysisSection при маунте/смене активного
   * велика. Тот же id — идемпотентный no-op; другой id — жёсткий сброс всех
   * ракурсов (фото/анализы прежнего вела не имеют права попасть в отчёт).
   */
  syncBikeId: (bikeId: string | null) => void;
  /** Новое фото: мгновенно показываем url (может быть blob:), analysis сбрасываем. */
  setViewPhoto: (
    view: ViewType,
    photo: { photoData: string; captureMeta?: CaptureMeta | null }
  ) => void;
  /** Замена blob: на компактный dataURL после сжатия (персистим только его). */
  setViewPhotoData: (view: ViewType, photoData: string) => void;
  /**
   * Результат анализа. landmarks === undefined → оставить прежние
   * (семантика старого кода: при полном промахе детектора старые метки живут).
   */
  setViewResult: (
    view: ViewType,
    landmarks: Point[] | null | undefined,
    analysis: BikeFitAnalysis | BackViewAnalysis | FrontViewAnalysis | null
  ) => void;
  clearView: (view: ViewType) => void;
}

/** localStorage, который не бросает исключений (quota/SSR/приватный режим). */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch (e) {
      console.warn(
        "[photo-analysis] не удалось сохранить в localStorage (квота?) — фото останутся только до перезагрузки",
        e
      );
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {}
  },
};

/** blob: URL не может пережить перезагрузку — при гидрации выбрасываем. */
const sanitize = (v: string | null): string | null =>
  v && !v.startsWith("blob:") ? v : null;

export const usePhotoAnalysisStore = create<PhotoAnalysisState>()(
  persist(
    (set) => ({
      bikeId: null,
      views: emptyViews(),

      // v1.14.30 (Stale State): привязка ракурсов к велику. Сменился велик —
      // жёсткий сброс ВСЕХ фото и анализов: калибровка/углы Bike_A запрещены
      // в отчёте Bike_B (ТЗ, п. A.2 «Проверка перед расчетом»). Если высоты
      // седла у нового вела нет — она обязана быть введена заново, а не
      // подтягиваться из протухшего черновика.
      syncBikeId: (bikeId) =>
        set((s) => {
          if (s.bikeId === bikeId) return {}; // тот же велик — ничего не трогаем
          return { bikeId, views: emptyViews() };
        }),

      setViewPhoto: (view, { photoData, captureMeta }) =>
        set((s) => ({
          views: {
            ...s.views,
            [view]: {
              ...emptyView(),
              photoData,
              captureMeta: captureMeta ?? null,
              savedAt: Date.now(),
            },
          },
        })),

      setViewPhotoData: (view, photoData) =>
        set((s) => ({
          views: {
            ...s.views,
            [view]: { ...s.views[view], photoData },
          },
        })),

      setViewResult: (view, landmarks, analysis) =>
        set((s) => ({
          views: {
            ...s.views,
            [view]: {
              ...s.views[view],
              ...(landmarks !== undefined ? { landmarks } : {}),
              analysis,
            },
          },
        })),

      clearView: (view) =>
        set((s) => ({
          views: { ...s.views, [view]: emptyView() },
        })),
    }),
    {
      name: "bikefit-photo-analysis",
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({ bikeId: state.bikeId, views: state.views }),
      // Гидрация: выбрасываем мёртвые blob:-ссылки, чиним битые структуры.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PhotoAnalysisState>;
        const src = p.views ?? {};
        const views = emptyViews();
        (Object.keys(views) as ViewType[]).forEach((v) => {
          const saved = src[v];
          if (!saved || typeof saved !== "object") return;
          views[v] = {
            photoData: sanitize(saved.photoData ?? null),
            landmarks: Array.isArray(saved.landmarks) ? saved.landmarks : null,
            analysis: saved.analysis ?? null,
            captureMeta: saved.captureMeta ?? null,
            savedAt: typeof saved.savedAt === "number" ? saved.savedAt : null,
          };
        });
        // v1.14.30: bikeId из персиста (string|null). Если пользователь
        // обновил страницу — привязка ракурсов к велику сохраняется.
        const bikeId = typeof p.bikeId === "string" ? p.bikeId : null;
        return { ...current, bikeId, views };
      },
    }
  )
);
