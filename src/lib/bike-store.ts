/**
 * Хранилище состояния онбординга и параметров велосипеда.
 * Используется Zustand для клиентского состояния.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BikeType } from "@/lib/bike-params";
import type { BodyMeasurements, BikeMeasurements, RiderGoal } from "@/lib/bike-calculations";

export type OnboardingStep =
  | "context" // тип велосипеда, цель, жалобы
  | "body" // рост, inseam и т.д.
  | "bike" // параметры велосипеда
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
  step: OnboardingStep;

  // Данные онбординга (общие для обоих режимов)
  bikeType: BikeType | null;
  goal: "comfort" | "sport" | "race" | null;
  complaints: Complaint[];

  // Тело (общие для обоих режимов)
  body: BodyMeasurements;

  // Велосипед (только для Режима A)
  bike: BikeMeasurements;

  // Типоразмер колеса (26"/27.5"/29"/700c и т.д.) — для dual scale
  // Хранится отдельно, т.к. используется и в форме параметров, и в калибраторе
  wheelSizeId: string;

  // Действия общие
  setMode: (mode: "fit" | "select" | null) => void;
  resetMode: () => void;

  // Действия Режима A (настройка)
  setStep: (step: OnboardingStep) => void;
  setBikeType: (type: BikeType) => void;
  setGoal: (goal: "comfort" | "sport" | "race") => void;
  toggleComplaint: (c: Complaint) => void;
  setBody: (b: Partial<BodyMeasurements>) => void;
  setBike: (b: Partial<BikeMeasurements>) => void;
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
      step: "context",
      bikeType: null,
      goal: null,
      complaints: [],
      body: initialBody,
      bike: initialBike,
      wheelSizeId: "26",

      setMode: (mode) => set({ mode }),
      resetMode: () => set({ mode: null, step: "context" }),

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
      setBody: (b) => set((state) => ({ body: { ...state.body, ...b } })),
      setBike: (b) => set((state) => {
        // Если передан пустой объект или есть флаг reset — полностью очищаем
        const isReset = Object.keys(b).length === 0;
        return { bike: isReset ? { ...initialBike } : { ...state.bike, ...b } };
      }),

      setWheelSizeId: (id) => set({ wheelSizeId: id }),

      reset: () =>
        set({
          step: "context",
          bikeType: null,
          goal: null,
          complaints: [],
          body: initialBody,
          bike: initialBike,
        }),

      getRiderGoal: () => {
        const { bikeType, goal } = get();
        if (!bikeType || !goal) return null;
        return { bikeType, goal };
      },
    }),
    {
      name: "bikefit-storage",
      // сохраняем только данные, не UI-состояние
      // wheelSizeId — параметр колеса из шага 3, нужен на сводке и в калибраторе
      partialize: (state) => ({
        bikeType: state.bikeType,
        goal: state.goal,
        complaints: state.complaints,
        body: state.body,
        bike: state.bike,
        wheelSizeId: state.wheelSizeId,
      }),
    }
  )
);
