/**
 * Хранилище состояния онбординга и параметров велосипеда.
 * Используется Zustand для клиентского состояния.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BikeType } from "@/lib/bike-params";
import type { BodyMeasurements, BikeMeasurements, RiderGoal } from "@/lib/bike-calculations";
// v1.14.31: только значения (не типы) — bike-storage не импортирует из
// bike-store ничего рантаймного (только type Complaint), цикла нет.
import {
  getActiveBikeId,
  getBikes,
  ACTIVE_BIKE_CHANGED_EVENT,
  ACTIVE_BIKE_KEY,
} from "./bike-storage";

export type OnboardingStep =
  | "body" // рост, inseam, цель, жалобы (v1.12.0: сюда переехали цель+жалобы из убранного «Контекста»)
  | "bike" // параметры велосипеда + тип велика (v1.12.0: тип переехал из убранного «Контекста»)
  | "summary" // сводка
  | "analysis"; // видеоанализ позы

export type Complaint =
  | "none"
  | "knee_pain"
  | "neck_pain"
  | "wrist_numbness"
  | "lower_back"
  | "saddle_sore"
  | "foot_numbness"
  | "shoulder_pain";

interface ComplaintInfo {
  id: Complaint;
  label: string;
  emoji: string;
  description: string;
}

export const COMPLAINTS: ComplaintInfo[] = [
  {
    id: "none",
    label: "Жалоб нет",
    emoji: "✅",
    description: "Профилактическая настройка, всё устраивает.",
  },
  {
    id: "knee_pain",
    label: "Боль в колене",
    emoji: "🦵",
    description: "Боль спереди/сзади колена при педалировании.",
  },
  {
    id: "neck_pain",
    label: "Боль в шее",
    emoji: "🧠",
    description: "Затекает шея, тяжело держать голову.",
  },
  {
    id: "wrist_numbness",
    label: "Онемение кистей",
    emoji: "✋",
    description: "Немеют пальцы, тяжесть в запястьях.",
  },
  {
    id: "lower_back",
    label: "Боль в пояснице",
    emoji: "↩️",
    description: "Дискомфорт в нижней части спины.",
  },
  {
    id: "saddle_sore",
    label: "Дискомфорт в промежности",
    emoji: "🪑",
    description: "Боль в седле, натёртости, онемение.",
  },
  {
    id: "foot_numbness",
    label: "Онемение стоп",
    emoji: "🦶",
    description: "Немеют пальцы стоп или свод стопы.",
  },
  {
    id: "shoulder_pain",
    label: "Боль в плечах",
    emoji: "💪",
    description: "Затекают плечи, трапеции.",
  },
];

interface AppState {
  // Режим приложения: настройка существующего велосипеда или подбор рамы
  mode: "fit" | "select" | null;

  // Текущий шаг (для Режима A — настройки велосипеда)
  // v1.13.0: персистится — после refresh/перезахода открываемся на том же шаге
  step: OnboardingStep;

  // Текущий шаг мастера подбора рамы (Режим B), 0..3
  // v1.13.0: был локальный useState — терялся при refresh
  selectStep: number;

  // Данные онбординга (общие для обоих режимов)
  bikeType: BikeType | null;
  goal: "comfort" | "sport" | "race" | null;
  complaints: Complaint[];

  // Тело (общие для обоих режимов)
  body: BodyMeasurements;

  // Велосипед (только для Режима A)
  bike: BikeMeasurements;

  /**
   * v1.14.31 (Multi-Bike State Isolation, ТЗ п. A.1 «Жёсткая привязка
   * калибровки»): какому велосипеду принадлежат значения черновика `bike`.
   * Раньше SH/Reach/Stack были «голыми» числами без proof of ownership —
   * анализ не мог доказать, что калибровка получена для ТЕКУЩЕГО вела, и
   * при race (F5 на шаге 4, вторая вкладка, удаление активного вела)
   * чужое SH=800 попадало в LeMond-сравнение отчёта Bike_B.
   * null = принадлежность не доказана (чистый/legacy черновик).
   * Устанавливается ТОЛЬКО через loadBikeData(m, bikeId); проверяется в
   * точке расчёта (applySaddleHeightContext / generateCrossReferences):
   * `if (calibration.bikeId !== currentBike.id) — калибровка запрещена`.
   */
  bikeId: string | null;

  // Типоразмер колеса (26"/27.5"/29"/700c и т.д.) — для dual scale
  // Хранится отдельно, т.к. используется и в форме параметров, и в калибраторе
  wheelSizeId: string;

  // Действия общие
  setMode: (mode: "fit" | "select" | null) => void;
  resetMode: () => void;

  // Действия Режима A (настройка)
  setStep: (step: OnboardingStep) => void;
  setSelectStep: (n: number) => void;
  setBikeType: (type: BikeType) => void;
  setGoal: (goal: "comfort" | "sport" | "race") => void;
  toggleComplaint: (c: Complaint) => void;
  setComplaints: (list: Complaint[]) => void;
  setBody: (b: Partial<BodyMeasurements>) => void;
  setBike: (b: Partial<BikeMeasurements>) => void;
  /**
   * v1.14.30 (Stale State): ПОЛНАЯ замена черновика велика БЕЗ merge со
   * старым содержимым. Единственный способ загрузить карточку другого
   * велосипеда: setBick мерджит ({ ...state.bike, ...b }) и при неполных
   * measurements протаскивал SH/WB/ETT от прежнего вела — именно так 800 мм
   * от Bike_A попадали в отчёт Bike_B (и автосейвом записывались туда
   * НАСОВСЕМ). Здесь — только известные ключи, всё остальное = undefined.
   *
   * v1.14.31: второй параметр `bikeId` — id карточки-источника. ONLY способ
   * доказать принадлежность калибровки в точке расчёта. Вызов без id
   * обнуляет bikeId (принадлежность не доказана) — консервативно.
   */
  loadBikeData: (m: BikeMeasurements, bikeId?: string | null) => void;
  /**
   * v1.14.30: жёсткий сброс черновика СЦЕНАРИЯ (параметры велика +
   * типоразмер колеса) при смене/создании велосипеда. Тело/цель/жалобы
   * НЕ трогает — это атрибуты райдера (как и в reset()).
   */
  resetDraftState: () => void;
  setWheelSizeId: (id: string) => void;
  reset: () => void;

  // Получить цель райдера
  getRiderGoal: () => RiderGoal | null;
}

const initialBody: BodyMeasurements = {
  height: 0,
  inseam: 0,
  footLength: undefined,
  armLength: undefined,
  torsoLength: undefined,
  flexibility: 3,
};

const initialBike: BikeMeasurements = {
  saddleHeight: undefined,
  setback: undefined,
  ett: undefined,
  reach: undefined,
  stack: undefined,
  stem: undefined,
  stemAngle: undefined,
  crank: undefined,
  sta: undefined,
  hta: undefined,
  wheelHeight: undefined,
  bbHeight: undefined,
  wheelbase: undefined,
};

export const useBikeStore = create<AppState>()(
  persist(
    (set, get) => ({
      mode: null,
      step: "body",
      selectStep: 0,
      bikeType: null,
      goal: null,
      complaints: [],
      body: initialBody,
      bike: initialBike,
      bikeId: null,
      wheelSizeId: "26",

      setMode: (mode) => set({ mode }),
      // v1.13.0: «На главную» больше не сбрасывает шаг — меню покажет
      // «Продолжить», и пользователь вернётся ровно туда, где остановился
      resetMode: () => set({ mode: null }),
      setSelectStep: (n) => set({ selectStep: Math.max(0, Math.min(3, Math.round(n))) }),

      setStep: (step) => set({ step }),
      setBikeType: (bikeType) => set({ bikeType }),
      setGoal: (goal) => set({ goal }),
      toggleComplaint: (c) =>
        set((state) => {
          if (c === "none") {
            return { complaints: ["none"] };
          }
          const withoutNone = state.complaints.filter(
            (x) => x !== "none"
          );
          const exists = withoutNone.includes(c);
          return {
            complaints: exists
              ? withoutNone.filter((x) => x !== c)
              : [...withoutNone, c],
          };
        }),
      // v1.13.2: прямая установка списка (нужна для синхронизации с профилем
      // райдера в OnboardingBody — жалобы теперь атрибут райдера)
      setComplaints: (list) => set({ complaints: list }),
      setBody: (b) => set((state) => ({ body: { ...state.body, ...b } })),
      setBike: (b) => set((state) => {
        // Если передан пустой объект или есть флаг reset — полностью очищаем
        const isReset = Object.keys(b).length === 0;
        return { bike: isReset ? { ...initialBike } : { ...state.bike, ...b } };
      }),

      setWheelSizeId: (id) => set({ wheelSizeId: id }),

      // v1.14.30 (Stale State): полная замена черновика. Каждый известный
      // ключ получает значение карточки ЛИБО undefined — спреда state.bike
      // нет вообще, протухшие значения и мусорные ключи старого черновика
      // выжить не могут. merge-поведение setBike остаётся для патчей формы
      // (ввод одного поля не должен стирать остальные).
      // v1.14.31: bikeId — proof of ownership (см. докмент поля).
      loadBikeData: (m, bikeId) =>
        set(() => {
          const clean = {} as BikeMeasurements;
          for (const k of Object.keys(initialBike) as Array<keyof BikeMeasurements>) {
            const v = m[k];
            clean[k] =
              typeof v === "number" && Number.isFinite(v) ? v : undefined;
          }
          return { bike: clean, bikeId: bikeId ?? null };
        }),

      // v1.14.30: жёсткий сброс черновика сценария (без атрибутов райдера).
      // v1.14.31: вместе с параметрами стирается и принадлежность (bikeId),
      // иначе пустой черновик «наследовал» бы id чужого вела.
      resetDraftState: () =>
        set({ bike: { ...initialBike }, bikeId: null, wheelSizeId: "26" }),

      // ПОЛНЫЙ сброс сценария: вызывается ТОЛЬКО по явному «Начать заново»
      // (кнопка на карточке режима). Чистит данные СЦЕНАРИЯ: позицию шагов,
      // параметры велика и типоразмер колеса.
      // v1.13.2: тело/цель/жалобы НЕ сбрасываем — это атрибуты РАЙДЕРА, а не
      // сценария (персистят и в профиле активного райдера в bikefit-riders).
      // Раньше reset() стирал жалобы/цель — именно их «забывало» приложение
      // после клика по карточке режима. Библиотеки великов/райдеров
      // (localStorage bikefit-*) не трогает.
      reset: () =>
        set({
          step: "body",
          selectStep: 0,
          bikeType: null,
          bike: { ...initialBike },
          bikeId: null,
          wheelSizeId: "26",
        }),

      getRiderGoal: () => {
        const { bikeType, goal } = get();
        if (!bikeType || !goal) return null;
        return { bikeType, goal };
      },
    }),
    {
      name: "bikefit-storage",
      // v1.13.0: сохраняем ВСЁ — и данные, и позицию пользователя (режим,
      // шаг настроек, шаг подбора рамы). Теперь каждый клик/этап переживает
      // refresh и перезаход: открываемся ровно там, где остановились.
      // wheelSizeId — параметр колеса из шага 3, нужен на сводке и в калибраторе
      partialize: (state) => ({
        mode: state.mode,
        step: state.step,
        selectStep: state.selectStep,
        bikeType: state.bikeType,
        goal: state.goal,
        complaints: state.complaints,
        body: state.body,
        bike: state.bike,
        bikeId: state.bikeId,
        wheelSizeId: state.wheelSizeId,
      }),
      // Санитайзер ре-гидрации: старые бэкапы (без mode/step/selectStep) и
      // мусорные значения не должны ломать навигацию (напр. step: "context"
      // из версий ≤ v1.11.x).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const fitSteps: OnboardingStep[] = ["body", "bike", "summary", "analysis"];
        const mode = p.mode === "fit" || p.mode === "select" ? p.mode : null;
        const step =
          p.step && fitSteps.includes(p.step) ? p.step : "body";
        const selectStep =
          typeof p.selectStep === "number" &&
          p.selectStep >= 0 &&
          p.selectStep <= 3
            ? Math.round(p.selectStep)
            : 0;
        return {
          ...current,
          ...p,
          mode,
          step,
          selectStep,
          // v1.14.31: bikeId из персиста — только string|null; legacy-бэкапы
          // (v1.14.30 и старше) без поля получают null (принадлежность не
          // доказана → heal ниже загрузит карточку активного вела с его id).
          bikeId:
            p.bikeId === null || typeof p.bikeId === "string"
              ? p.bikeId
              : null,
        };
      },
    }
  )
);

// ==================================================================
// v1.14.31 (Multi-Bike State Isolation, ТЗ п. A.1/A.2): heal черновика.
// ==================================================================
// Черновик ОБЯЗАН следовать за активным велом даже когда компонент формы
// не смонтирован (F5 прямо на шаге 4, вторая вкладка, удаление активного
// вела). Раньше loadBikeData вызывался только из BikeParametersForm —
// при cross-tab смене вела вкладка с шагом 4 продолжала анализировать
// фото нового вела с SH старого (главная причина «смешанных» отчётов).
//
// Правила (консервативные):
//  • id совпадает → no-op (несохранённые правки черновика не трогаем);
//  • id чужой/не доказан, активный вел известен → ПОЛНАЯ замена из
//    карточки, найденной СТРОГО по id (без fallback bikes[0] — иначе
//    можно приписать черновику чужой id);
//  • активного вела нет → сброс ТОЛЬКО если черновик claim'ит какой-то
//    id (осиротевший); legacy-черновик без bikeId не трогаем.
if (typeof window !== "undefined") {
  const healDraftOwnership = () => {
    try {
      const activeId = getActiveBikeId();
      const s = useBikeStore.getState();
      if (s.bikeId === activeId) return; // владение доказано (включ. оба null)
      if (!activeId) {
        if (s.bikeId !== null) s.resetDraftState();
        return;
      }
      const card = getBikes().find((b) => b.id === activeId) ?? null;
      if (card) s.loadBikeData(card.measurements, card.id);
      else s.resetDraftState();
    } catch {
      /* localStorage недоступен — черновик остаётся как есть */
    }
  };

  // 1. Мгновенный heal при загрузке модуля (persist localStorage синхронный —
  //    к этому моменту черновик уже ре-гидрирован).
  healDraftOwnership();

  // 2. Same-tab смена вела (setActiveBike/createBike/deleteBike).
  window.addEventListener(ACTIVE_BIKE_CHANGED_EVENT, healDraftOwnership);

  // 3. Cross-tab: только реальная смена ключа активного вела — autosave
  //    соседней вкладки (bikefit-storage) heal не запускает.
  window.addEventListener("storage", (e) => {
    if (e.key === null || e.key === ACTIVE_BIKE_KEY) healDraftOwnership();
  });
}
