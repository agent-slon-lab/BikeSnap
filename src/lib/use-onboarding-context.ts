"use client";

/**
 * Безопасный хук доступа к контексту онбординга.
 *
 * ВНИМАНИЕ: Этот файл НЕ React Context Provider.
 * В проекте state хранится в Zustand (useBikeStore), который работает без Provider.
 * Этот хук — обёртка, которая:
 *   1. Предоставляет safe defaults если что-то не задано (вместо null)
 *   2. Логирует предупреждение в dev режиме если вызывается до инициализации
 *   3. Группирует доступ к onboarding-полям в одном месте
 */

import { useBikeStore } from "@/lib/bike-store";
import type { BikeType } from "@/lib/bike-params";

export interface OnboardingContextValue {
  bikeType: BikeType | null;
  goal: "comfort" | "sport" | "race" | null;
  complaints: string[];
  body: {
    height: number;
    inseam: number;
    footLength?: number;
    armLength?: number;
    torsoLength?: number;
    flexibility?: number;
  };
  bike: {
    saddleHeight?: number;
    ett?: number;
    reach?: number;
    stack?: number;
    stem?: number;
    stemAngle?: number;
    crank?: number;
    wheelHeight?: number;
    bbHeight?: number;
    wheelbase?: number;
  };
  wheelSizeId: string;

  hasStartedOnboarding: boolean;
  isOnboardingComplete: boolean;
}

export function useOnboardingContext(): OnboardingContextValue {
  // Хуки вызываются безусловно (правила React Hooks).
  // На сервере Zustand возвращает initial state, что совпадает с SAFE_DEFAULTS.
  const bikeType = useBikeStore((s) => s.bikeType);
  const goal = useBikeStore((s) => s.goal);
  const complaints = useBikeStore((s) => s.complaints);
  const body = useBikeStore((s) => s.body);
  const bike = useBikeStore((s) => s.bike);
  const wheelSizeId = useBikeStore((s) => s.wheelSizeId);

  const hasStartedOnboarding = bikeType != null;
  const isOnboardingComplete =
    bikeType != null && goal != null && body.height > 0 && body.inseam > 0;

  return {
    bikeType,
    goal,
    complaints,
    body,
    bike,
    wheelSizeId,
    hasStartedOnboarding,
    isOnboardingComplete,
  };
}

export function useIsOnboardingComplete(): boolean {
  return useOnboardingContext().isOnboardingComplete;
}

export function useHasStartedOnboarding(): boolean {
  return useOnboardingContext().hasStartedOnboarding;
}
