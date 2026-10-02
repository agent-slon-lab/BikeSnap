"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  ArrowUpDown,
  Ruler,
  ZoomIn,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhotoUploader } from "@/components/bike-fit/PhotoUploader";
import { cn } from "@/lib/utils";
import { pointFullLabel } from "@/lib/point-labels";
import { InteractivePhoto } from "./InteractivePhoto";
import {
  compareMeasuredVsComputed,
  getOverallMatch,
  detectPerspective,
  type BikeKeyPoints,
  type KnownDimensionKey,
  type ComputedBikeParams,
  type ComparisonResult,
  type PerspectiveInfo,
  type NullablePoint,
} from "@/lib/bike-photo-scale";
import {
  calculateBikeGeometry,
  makeAlignedTransform,
  isPlausibleOverrideMm,
  OVERRIDE_PHYSICAL_RANGE_MM,
  type BikeKeypoints as EngineKeypoints,
  type CalibrationConfig as EngineCalibrationConfig,
  type CalibrationKey as EngineCalibrationKey,
  type BikeGeometryResult,
  type AuxScaleCandidate,
} from "@/lib/bike-geometry-engine";
import {
  calculateDualScale,
  getLocalScale,
  type DualScale,
} from "@/lib/bike-dual-scale";
import {
  assessConfidence,
  confidenceColor,
  type ConfidenceAssessment,
} from "@/lib/bike-confidence";
import {
  calculateAutoFitCalibration,
  type CalibrationResult,
} from "@/lib/bike-calibration-helper";
import type { BikeMeasurements } from "@/lib/bike-calculations";
import { findWheelSize } from "@/lib/bike-perspective";
import { useBikeStore } from "@/lib/bike-store";
import { validateBikeMeasurements } from "@/lib/bike-validation";
import {
  suggestPointCorrections,
  applySuggestion,
  type PointSuggestion,
} from "@/lib/bike-point-suggestions";

/** Человекопонятные названия источников калибровки (для перекрёстной проверки) */
const CALIB_SOURCE_HUMAN: Record<string, string> = {
  saddleHeight: "высоте седла",
  ett: "ETT (горизонталь седло→руль)",
  wheelbase: "колёсной базе",
  wheelDiameter: "диаметру колеса",
};

interface BikePhotoCalibratorProps {
  /** Текущие измеренные параметры из формы */
  measured: BikeMeasurements;
  /** Callback при усреднении значений */
  onAveraged?: (averaged: Record<string, number | null>) => void;
  /** Сохранённое фото (base64 data URL) — восстанавливается при выборе велика */
  initialPhotoUrl?: string;
  /** Сохранённые ключевые точки — восстанавливаются при выборе велика */
  initialKeyPoints?: BikeKeyPoints | null;
  /** Callback когда фото/точки изменились — родитель может сохранить */
  onPhotoChange?: (photoDataUrl: string | null, keyPoints: BikeKeyPoints | null) => void;
}

/** Сжать изображение до maxDim по длинной стороне, JPEG quality */
async function compressImage(dataUrl: string, maxDim: number, quality: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** Ключи калибровочных полей, поддержанных панелью (и ядром) */
type CalibFieldKey = "saddleHeight" | "ett" | "wheelbase";

const KNOWN_DIM_OPTIONS: Array<{ key: CalibFieldKey; label: string; unit: string; placeholder: string }> = [
  { key: "saddleHeight", label: "Высота седла (SH)", unit: "мм", placeholder: "730" },
  { key: "ett", label: "ETT (эфф. верхняя труба)", unit: "мм", placeholder: "545" },
  { key: "wheelbase", label: "WB (колёсная база)", unit: "мм", placeholder: "1000" },
];

/** Единый порядок ручной разметки: 8 обязательных + 2 опциональные (dual scale) */
const PLACEMENT_ORDER: Array<keyof BikeKeyPoints> = [
  "bb",
  "stTop",
  "saddleMount",
  "htTop",
  "htBottom",
  "htTopCap",
  "rearAxle",
  "frontAxle",
  "rearWheelTop",
  "frontWheelTop",
];

const MATCH_COLORS = {
  good: { bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-900", text: "text-emerald-600 dark:text-emerald-400", label: "✓ Хорошо" },
  acceptable: { bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-900", text: "text-amber-600 dark:text-amber-400", label: "≈ Приемлемо" },
  poor: { bg: "bg-rose-50 dark:bg-rose-950/30", border: "border-rose-200 dark:border-rose-900", text: "text-rose-600 dark:text-rose-400", label: "✗ Расхождение" },
  unknown: { bg: "bg-muted/50", border: "border-border", text: "text-muted-foreground", label: "—" },
};

export function BikePhotoCalibrator({ measured, onAveraged, initialPhotoUrl, initialKeyPoints, onPhotoChange }: BikePhotoCalibratorProps) {
  const bikeType = useBikeStore((s) => s.bikeType);
  // Инициализация: если есть сохранённое фото — восстанавливаем
  const [photoUrl, setPhotoUrl] = useState<string | null>(initialPhotoUrl ?? null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Восстанавливаем точки если есть
  const [keyPoints, setKeyPoints] = useState<BikeKeyPoints | null>(initialKeyPoints ?? null);

  // Если initialPhotoUrl изменился (сменили велик) — принудительно обновляем.
  // ВАЖНО: используем ref для отслеживания значений, которые мы сами эмитнули
  // через onPhotoChange. Если входящий initialPhotoUrl/initialKeyPoints совпадает
  // с тем, что мы только что отправили — это наше собственное обновление,
  // и сбрасывать state НЕЛЬЗЯ (иначе убьём placementMode после первого клика!).
  const lastEmittedRef = useRef<{ photoUrl: string | null; keyPoints: BikeKeyPoints | null }>({
    photoUrl: initialPhotoUrl ?? null,
    keyPoints: initialKeyPoints ?? null,
  });

  useEffect(() => {
    // Если это эхо нашего собственного onPhotoChange — пропускаем, иначе
    // мы сбросили бы placementMode = false прямо во время разметки (критичный баг:
    // после первой точки BB больше нельзя поставить ни одной).
    const isOurEcho =
      (initialPhotoUrl ?? null) === lastEmittedRef.current.photoUrl &&
      JSON.stringify(initialKeyPoints ?? null) ===
        JSON.stringify(lastEmittedRef.current.keyPoints);

    if (isOurEcho) return;

    setPhotoUrl(initialPhotoUrl ?? null);
    setKeyPoints(initialKeyPoints ?? null);
    setComputed(null);
    setComparisons([]);
    setError(null);
    setPointsMissing([]);
    setDebugLog([]);
    setPlacementMode(false);
    setPlacementPointKey(null);
    setPerspectiveInfo(null);
    setDualScale(null);
    setAutoCalibration(null);
    setConfidenceAssessment(null);
    setEngineWarnings([]);
    setEngineResult(null);
    setScaleSourceInfo(null);

    lastEmittedRef.current = {
      photoUrl: initialPhotoUrl ?? null,
      keyPoints: initialKeyPoints ?? null,
    };
  }, [initialPhotoUrl, initialKeyPoints]);

  const [knownKey, setKnownKey] = useState<KnownDimensionKey>("saddleHeight");
  const [computed, setComputed] = useState<ComputedBikeParams | null>(null);
  const [comparisons, setComparisons] = useState<ComparisonResult[]>([]);
  const [pointsMissing, setPointsMissing] = useState<string[]>([]);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  // v1.13.5: мгновенная обратная связь под кнопкой «Записать в параметры велика» —
  // перечисляем, что именно ушло в карточку (лечит «нажимаю — и ничего не происходит»).
  const [appliedSummary, setAppliedSummary] = useState<string | null>(null);
  // v1.14.0: авто-скролл к результатам после «Вычислить все параметры»
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const [placementMode, setPlacementMode] = useState(false);
  const [placementPointKey, setPlacementPointKey] = useState<keyof BikeKeyPoints | null>(null);
  // Перспектива: только ИНФОРМАЦИЯ для dual scale — интерактивная коррекция
  // удалена: ядро v2 выравнивает кадр автоматически (rotation-first)
  const [perspectiveInfo, setPerspectiveInfo] = useState<PerspectiveInfo | null>(null);
  // NOTE: useMultiCalibration/multiCalibration УБРАНО — теперь авто-выбор primary
  // (через calculateAutoFitCalibration из bike-calibration-helper.ts).
  // Dual scale + confidence (без авто-выравнивания — точки НЕ мутируются)
  const [dualScale, setDualScale] = useState<DualScale | null>(null);
  // Авто-калибровка: scale + tiltAngleRad (математическая компенсация, БЕЗ поворота точек)
  const [autoCalibration, setAutoCalibration] = useState<CalibrationResult | null>(null);
  // ЯДРО v2 (bike-geometry-engine): предупреждения и источник рабочего масштаба
  const [engineWarnings, setEngineWarnings] = useState<string[]>([]);
  const [engineResult, setEngineResult] = useState<BikeGeometryResult | null>(null);
  const [scaleSourceInfo, setScaleSourceInfo] = useState<{
    scaleMmPerPx: number;
    source: string;
    tiltDeg: number;
    facingRight: boolean;
  } | null>(null);
  const [confidenceAssessment, setConfidenceAssessment] = useState<ConfidenceAssessment | null>(null);
  const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(null);

  // Загружаем реальные размеры фото — критично для расчётов в неквадратных фото
  useEffect(() => {
    if (!photoUrl) {
      setImgSize(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      setImgSize({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => setImgSize(null);
    img.src = photoUrl;
  }, [photoUrl]);

  // Локальные поля для калибровки — 3 input поля прямо в панели.
  // Инициализируются из measured (значения из карточки велика),
  // пользователь может их тут же править.
  const [calibInputs, setCalibInputs] = useState<{
    saddleHeight: string;
    ett: string;
    wheelbase: string;
  }>({
    saddleHeight: measured.saddleHeight != null ? String(measured.saddleHeight) : "",
    ett: measured.ett != null ? String(measured.ett) : "",
    wheelbase: measured.wheelbase != null ? String(measured.wheelbase) : "",
  });

  // Поля, которые пользователь ВРУЧНУЮ правил в калибраторе (в этой сессии).
  // Грязные поля не перетираются из карточки — НО мусорные значения
  // (вне физического диапазона) исправляются onBlur и guard-ом в runCalibration.
  const calibDirtyRef = useRef<{ saddleHeight: boolean; ett: boolean; wheelbase: boolean }>({
    saddleHeight: false,
    ett: false,
    wheelbase: false,
  });

  // Когда measured меняется (пользователь редактировал карточку велика) —
  // зеркалим во ВСЕ нетронутые поля. Раньше синхронизировались только ПУСТЫЕ
  // поля, из-за чего однажды введённый мусор (например «8» вместо «800»)
  // жил в поле вечно и строго уезжал в масштаб — все метрики уезжали в 100 раз.
  useEffect(() => {
    setCalibInputs((prev) => ({
      saddleHeight: calibDirtyRef.current.saddleHeight
        ? prev.saddleHeight
        : measured.saddleHeight != null
          ? String(measured.saddleHeight)
          : "",
      ett: calibDirtyRef.current.ett
        ? prev.ett
        : measured.ett != null
          ? String(measured.ett)
          : "",
      wheelbase: calibDirtyRef.current.wheelbase
        ? prev.wheelbase
        : measured.wheelbase != null
          ? String(measured.wheelbase)
          : "",
    }));
  }, [measured.saddleHeight, measured.ett, measured.wheelbase]);

  // Получить числовое значение из calibInputs (или measured как фоллбэк)
  const getCalibValue = useCallback((key: KnownDimensionKey): number | null => {
    const fromInput = key === "saddleHeight"
      ? calibInputs.saddleHeight
      : key === "ett"
        ? calibInputs.ett
        : key === "wheelbase"
          ? calibInputs.wheelbase
          : "";
    if (fromInput && fromInput.trim() !== "") {
      const n = parseFloat(fromInput.replace(",", "."));
      if (!isNaN(n) && n > 0) return n;
    }
    // Фоллбэк на measured
    switch (key) {
      case "saddleHeight": return measured.saddleHeight ?? null;
      case "ett": return measured.ett ?? null;
      case "wheelbase": return measured.wheelbase ?? null;
      default: return null;
    }
  }, [calibInputs, measured.saddleHeight, measured.ett, measured.wheelbase]);

  // Текущее значение primary-параметра для калибровки
  const knownValue = getCalibValue(knownKey);
  const hasKnownValue = knownValue != null && knownValue > 0;

  // Число из сырого поля ввода (или null)
  const parseCalibRaw = useCallback((raw: string): number | null => {
    if (!raw || raw.trim() === "") return null;
    const n = parseFloat(raw.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, []);

  // Значение поля ВНЕ физического диапазона → мусор, в масштаб не допускается
  const isImplausibleInput = useCallback(
    (key: KnownDimensionKey, raw: string): boolean => {
      if (key !== "saddleHeight" && key !== "ett" && key !== "wheelbase") return false;
      const n = parseCalibRaw(raw);
      return n != null && !isPlausibleOverrideMm(key, n);
    },
    [parseCalibRaw]
  );

  // Значение из карточки велика для ключа калибровки
  const getMeasuredFor = useCallback(
    (key: CalibFieldKey): number | null =>
      key === "saddleHeight"
        ? (measured.saddleHeight ?? null)
        : key === "ett"
          ? (measured.ett ?? null)
          : (measured.wheelbase ?? null),
    [measured.saddleHeight, measured.ett, measured.wheelbase]
  );

  // Подсчёт сколько значений заполнено (для auto-включения мульти-калибровки)
  const filledKnownsCount = useMemo(() => {
    let n = 0;
    if (getCalibValue("saddleHeight") != null) n++;
    if (getCalibValue("ett") != null) n++;
    if (getCalibValue("wheelbase") != null) n++;
    return n;
  }, [getCalibValue]);

  const handlePhotoSelected = useCallback((file: File, url: string) => {
    setPhotoFile(file);
    setPhotoUrl(url);
    setKeyPoints(null);
    setComputed(null);
    setComparisons([]);
    setError(null);
    setPointsMissing([]);
    setDebugLog([]);
    setPlacementMode(false);
    setPlacementPointKey(null);
    setPerspectiveInfo(null);
    setDualScale(null);
    setAutoCalibration(null);
    setConfidenceAssessment(null);
    setEngineWarnings([]);
    setEngineResult(null);
    setScaleSourceInfo(null);
    // Конвертируем в base64 и сохраняем
    if (onPhotoChange) {
      const reader = new FileReader();
      reader.onload = () => {
        // Сжимаем изображение (max 1200px, JPEG 0.8)
        compressImage(reader.result as string, 1200, 0.8).then((compressed) => {
          // Обновляем ref ДО вызова, иначе useEffect воспримет это как внешнее изменение
          lastEmittedRef.current = { photoUrl: compressed, keyPoints: null };
          onPhotoChange(compressed, null);
        });
      };
      reader.readAsDataURL(file);
    }
  }, [onPhotoChange]);

  const handleClear = useCallback(() => {
    if (photoUrl && photoUrl.startsWith("blob:")) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    setPhotoFile(null);
    setKeyPoints(null);
    setComputed(null);
    setComparisons([]);
    setError(null);
    setPointsMissing([]);
    setDebugLog([]);
    setPlacementMode(false);
    setPlacementPointKey(null);
    setPerspectiveInfo(null);
    setDualScale(null);
    setAutoCalibration(null);
    setConfidenceAssessment(null);
    setEngineWarnings([]);
    setEngineResult(null);
    setScaleSourceInfo(null);
    if (onPhotoChange) {
      lastEmittedRef.current = { photoUrl: null, keyPoints: null };
      onPhotoChange(null, null);
    }
  }, [photoUrl, onPhotoChange]);

  // Старт ручной разметки — инициализирует точки null-ами и начинает с первой
  const startManualPlacement = useCallback(() => {
    const emptyPoints: BikeKeyPoints = {
      bb: { x: null, y: null },
      stTop: { x: null, y: null },
      saddleMount: { x: null, y: null },
      htTop: { x: null, y: null },
      htBottom: { x: null, y: null },
      rearAxle: { x: null, y: null },
      htTopCap: { x: null, y: null },
      frontAxle: { x: null, y: null },
      // Опциональные точки для dual scale (не обязательны)
      rearWheelTop: { x: null, y: null },
      frontWheelTop: { x: null, y: null },
    };
    setKeyPoints(emptyPoints);
    setComputed(null);
    setComparisons([]);
    setError(null);
    setPointsMissing([]);
    setEngineWarnings([]);
    setScaleSourceInfo(null);
    setPlacementMode(true);
    setPlacementPointKey("bb");

    // Логируем старт ручной разметки
    const ts = new Date().toLocaleTimeString();
    setDebugLog((prev) => [
      ...prev.slice(-50),
      ``,
      `[${ts}] Старт ручной разметки (пользователь кликает по фото):`,
      `  Инициализированы 8 обязательных + 2 опциональные точки (null)`,
      `  Порядок: BB → ST → седло → HT верх → HT низ → Top cap → зад. ось → пер. ось`,
      `  После 8 основных точек выйдет из режима разметки. Опциональные (верх колёс) можно разместить отдельно кнопками ниже.`,
    ]);
  }, []);

  // Выбрать точку для размещения
  const selectPointForPlacement = useCallback((key: keyof BikeKeyPoints) => {
    setPlacementPointKey(key);
    setPlacementMode(true);
  }, []);

  // Выйти из режима разметки
  const exitPlacementMode = useCallback(() => {
    setPlacementMode(false);
    setPlacementPointKey(null);
  }, []);

  // Продолжить разметку: войти в режим разметки БЕЗ сброса уже стоящих точек.
  // Стартуем с первой незаполненной точки (если всё стоит — с BB: нужную точку
  // можно перекачать через чипы в панели разметки).
  const continuePlacement = useCallback(() => {
    if (!keyPoints) return;
    let first: keyof BikeKeyPoints = "bb";
    for (const k of PLACEMENT_ORDER) {
      const pt = keyPoints[k];
      if (!pt || pt.x == null || pt.y == null) {
        first = k;
        break;
      }
    }
    setPlacementMode(true);
    setPlacementPointKey(first);
    setDebugLog((prev) => [
      ...prev.slice(-50),
      `[${new Date().toLocaleTimeString()}] Продолжение разметки с точки ${first} (существующие точки сохранены)`,
    ]);
  }, [keyPoints]);

  const runCalibration = useCallback(
    (pts: BikeKeyPoints, knownVal: number) => {
      const ts = new Date().toLocaleTimeString();
      // Пересчёт обесценивает прошлую запись — убираем сводку под кнопкой.
      setAppliedSummary(null);

      // === ЗАЩИТА ОТ МУСОРНОГО МАСШТАБА (кейс «SH = 8» вместо «800») ===
      // Значение ВНЕ физического диапазона не допускается до строгого масштаба:
      //  1) если в карточке велика есть физически возможное значение — берём его;
      //  2) иначе блокируем расчёт с понятной ошибкой.
      // Ядро страхует это же правило со своей стороны (isPlausibleOverrideMm).
      const SUPPORTED_GUARD_KEYS = ["saddleHeight", "ett", "wheelbase"] as const;
      let effectiveKnown = knownVal;
      let guardNote: string | null = null;
      if (
        (SUPPORTED_GUARD_KEYS as readonly string[]).includes(knownKey) &&
        !isPlausibleOverrideMm(knownKey as (typeof SUPPORTED_GUARD_KEYS)[number], knownVal)
      ) {
        const gk = knownKey as (typeof SUPPORTED_GUARD_KEYS)[number];
        const fromCard = getMeasuredFor(gk);
        if (fromCard != null && isPlausibleOverrideMm(gk, fromCard)) {
          effectiveKnown = fromCard;
          guardNote =
            `  🛡 Поле калибровки = ${knownVal} мм — вне физического диапазона ` +
            `(${OVERRIDE_PHYSICAL_RANGE_MM[gk].min}–${OVERRIDE_PHYSICAL_RANGE_MM[gk].max} мм). ` +
            `В расчёте использовано значение из карточки велика: ${fromCard} мм.`;
        } else {
          const range = OVERRIDE_PHYSICAL_RANGE_MM[gk];
          const label = KNOWN_DIM_OPTIONS.find((o) => o.key === gk)?.label ?? knownKey;
          setError(
            `Калибровка заблокирована: ${label} = ${knownVal} мм — вне физического диапазона ${range.min}–${range.max} мм. Исправьте значение в зелёной панели «Калибровка масштаба» или в карточке велика.`
          );
          setDebugLog((prev) => [
            ...prev.slice(-50),
            ``,
            `[${ts}] 🛡 РАСЧЁТ ЗАБЛОКИРОВАН: ${knownKey} = ${knownVal} мм вне диапазона ${range.min}–${range.max} мм — мусорное значение не допущено до масштаба.`,
            `  Карточка велика: ${fromCard != null ? `${fromCard} мм (тоже вне диапазона)` : "значение не заполнено"}.`,
          ]);
          return;
        }
      }

      // Расхождение поля калибровки с карточкой (обе физически возможны) —
      // отдельная явная строка в логе, чтобы источник истины был виден сразу
      let divergenceNote: string | null = null;
      if (
        (SUPPORTED_GUARD_KEYS as readonly string[]).includes(knownKey) &&
        effectiveKnown === knownVal
      ) {
        const gk = knownKey as (typeof SUPPORTED_GUARD_KEYS)[number];
        const fromCard = getMeasuredFor(gk);
        if (fromCard != null && fromCard !== knownVal && isPlausibleOverrideMm(gk, knownVal)) {
          divergenceNote =
            `  ⓘ Поле калибровки (${knownVal} мм) ≠ карточка велика (${fromCard} мм) — ` +
            `масштаб СТРОГО по полю калибровки.`;
        }
      }

      // Логируем входные данные
      const newLog = [
        `[${ts}] runCalibration вызвана:`,
        `  knownKey = ${knownKey}`,
        `  knownValue = ${effectiveKnown} мм${effectiveKnown !== knownVal ? ` (в поле калибровки: ${knownVal})` : ""}`,
        `  measured из формы (то, что ввёл пользователь):`,
        `    SH (saddleHeight) = ${measured.saddleHeight ?? "—"} мм ${measured.saddleHeight != null ? "[ввод]" : ""}`,
        `    ETT = ${measured.ett ?? "—"} мм [ввод]`,
        `    WB = ${measured.wheelbase ?? "—"} мм [ввод]`,
        `    Stem = ${measured.stem ?? "—"} мм [ввод]`,
        `    CR = ${measured.crank ?? "—"} мм [ввод]`,
        `    WH = ${measured.wheelHeight ?? "—"} мм [ввод]`,
        `    BBH = ${measured.bbHeight ?? "—"} мм [ввод]`,
        `    Reach (старый) = ${measured.reach ?? "—"} мм ${measured.reach != null ? "[фото-раньше]" : "[нет]"}`,
        `    Stack (старый) = ${measured.stack ?? "—"} мм ${measured.stack != null ? "[фото-раньше]" : "[нет]"}`,
        `  bikeType = ${useBikeStore.getState().bikeType ?? "— (не выбран)"}`,
        `  points (нормализованные 0..1):`,
        ...Object.entries(pts).map(([k, v]) => `    ${k}: x=${v?.x?.toFixed(4) ?? "null"}, y=${v?.y?.toFixed(4) ?? "null"}`),
        ...(guardNote ? [``, guardNote] : []),
        ...(divergenceNote ? [divergenceNote] : []),
      ];
      setDebugLog((prev) => [...prev.slice(-50), ...newLog]);

      // Детекция перспективы по осям колёс
      const perspective = detectPerspective(pts);
      setPerspectiveInfo(perspective);
      if (perspective) {
        setDebugLog((prev) => [
          ...prev,
          ``,
          `  Перспектива:`,
          `    deltaY (front.y − rear.y) = ${perspective.deltaY.toFixed(4)} норм.ед.`,
          `    angle ≈ ${perspective.angleDeg.toFixed(2)}°`,
          `    severity = ${perspective.severity}`,
          `    ${perspective.needsCorrection ? "⚠ Наклон заметный — учтён ядром автоматически; при сильном завале лучше переснять" : "✓ Наклон мал — компенсируется ядром автоматически"}`,
        ]);
      }

      // === ЯДРО v2 (bike-geometry-engine): STRICT SCALE HIERARCHY + ROTATION FIRST ===
      // Правило ТЗ №2: userOverride СТРОГО — масштаб считается по отрезку,
      // выбранному пользователем (knownKey). Переключение на авто-WB физически
      // невозможно (см. scaleSource в результате движка).
      // Правило ТЗ №3: сначала ПОВОРОТ всех точек по оси колёс, затем масштаб
      // и проекции — Stack/Reach/ETT считаются в выровненной системе.
      if (!imgSize) {
        setError("Размеры фото ещё не загружены — попробуйте ещё раз через секунду.");
        setDebugLog((prev) => [...prev, ``, `  ❌ imgSize не готов — расчёт в пикселях невозможен`]);
        return;
      }

      // 7 обязательных bike-only точек ядра
      const requiredKeys = [
        "rearAxle",
        "frontAxle",
        "bb",
        "stTop",
        "saddleMount",
        "htBottom",
        "htTop",
      ] as const;
      const missing = requiredKeys.filter(
        (k) => !pts[k] || pts[k].x == null || pts[k].y == null
      );
      if (missing.length > 0) {
        setPointsMissing([...missing]);
        setError(
          `Для расчёта не хватает точек: ${missing.join(", ")}. Разметьте их на фото.`
        );
        setDebugLog((prev) => [
          ...prev,
          ``,
          `  ❌ Отсутствуют обязательные точки ядра: ${missing.join(", ")}`,
        ]);
        return;
      }
      setPointsMissing([]);

      // Нормализованные [0..1] → пиксели (критично для неквадратных фото:
      // X нормирован по ширине, Y — по высоте)
      const toPxPt = (p: NullablePoint): { x: number; y: number } => ({
        x: (p.x ?? 0) * imgSize.width,
        y: (p.y ?? 0) * imgSize.height,
      });
      const enginePts: EngineKeypoints = {
        rearAxle: toPxPt(pts.rearAxle as NullablePoint),
        frontAxle: toPxPt(pts.frontAxle as NullablePoint),
        bb: toPxPt(pts.bb as NullablePoint),
        stTop: toPxPt(pts.stTop as NullablePoint),
        saddleMount: toPxPt(pts.saddleMount as NullablePoint),
        htBottom: toPxPt(pts.htBottom as NullablePoint),
        htTop: toPxPt(pts.htTop as NullablePoint),
      };

      // КОНСЕНСУС-МАСШТАБ v2.1: в ядро уходят ВСЕ введённые размеры (не только
      // primary) + радиусы колёс из точек верха покрышек. Ядро само выбирает
      // надёжный масштаб: primary СТРОГО, если он согласован с остальными,
      // иначе — медиана согласного кластера (выброс отбрасывается с подсказкой).
      const SUPPORTED_OVERRIDE_KEYS = new Set(["saddleHeight", "wheelbase", "ett"]);
      const shMmIn = getCalibValue("saddleHeight");
      const ettMmIn = getCalibValue("ett");
      const wbMmIn = getCalibValue("wheelbase");

      // Радиус колеса: ввод WH или типоразмер из стора (та же логика, что у dual scale)
      const wheelHeightInput = getCalibValue("wheelHeight" as any) ?? measured.wheelHeight ?? null;
      let wheelHeightMm = wheelHeightInput;
      let wheelHeightSource = wheelHeightInput ? "ввод" : null;
      if (!wheelHeightMm) {
        const ws = findWheelSize(useBikeStore.getState().wheelSizeId);
        if (ws) {
          wheelHeightMm = ws.radiusMm;
          wheelHeightSource = `типоразмер ${ws.label} (R≈${ws.radiusMm} мм)`;
        }
      }
      const auxScaleCandidates: AuxScaleCandidate[] = [];
      if (wheelHeightMm && wheelHeightMm > 0 && imgSize) {
        const pxOf = (a?: NullablePoint, b?: NullablePoint) => {
          if (!a || !b || a.x == null || a.y == null || b.x == null || b.y == null) return 0;
          return Math.hypot((a.x - b.x) * imgSize.width, (a.y - b.y) * imgSize.height);
        };
        const frontR = pxOf(pts.frontWheelTop, pts.frontAxle);
        const rearR = pxOf(pts.rearWheelTop, pts.rearAxle);
        if (frontR > 20) {
          auxScaleCandidates.push({
            key: "wheelFront",
            label: "радиус переднего колеса",
            valueMm: wheelHeightMm,
            px: frontR,
            suspectPoints: "точки frontWheelTop/frontAxle",
          });
        }
        if (rearR > 20) {
          auxScaleCandidates.push({
            key: "wheelRear",
            label: "радиус заднего колеса",
            valueMm: wheelHeightMm,
            px: rearR,
            suspectPoints: "точки rearWheelTop/rearAxle",
          });
        }
      }

      const wbFallbackMm = getCalibValue("wheelbase");
      const engineConfig: EngineCalibrationConfig = {
        userOverrideKey: SUPPORTED_OVERRIDE_KEYS.has(knownKey)
          ? (knownKey as EngineCalibrationKey)
          : undefined,
        userOverrideValueMm: effectiveKnown,
        fallbackWheelbaseMm: wbFallbackMm ?? undefined,
        extraMeasurements: {
          saddleHeight: shMmIn ?? undefined,
          ett: ettMmIn ?? undefined,
          wheelbase: wbMmIn ?? undefined,
        },
        auxScaleCandidates,
      };
      if (!SUPPORTED_OVERRIDE_KEYS.has(knownKey)) {
        setDebugLog((prev) => [
          ...prev,
          ``,
          `  ⚠ knownKey=${knownKey} не поддерживается ядром — масштаб по консенсусу остальных измерений`,
        ]);
      }

      let engine: BikeGeometryResult;
      try {
        engine = calculateBikeGeometry(enginePts, engineConfig);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Ядро геометрии: ${msg}`);
        setComputed(null);
        setComparisons([]);
        setEngineWarnings([]);
        setEngineResult(null);
        setScaleSourceInfo(null);
        setDebugLog((prev) => [...prev, ``, `  ❌ calculateBikeGeometry: ${msg}`]);
        return;
      }

      setEngineWarnings(engine.warnings);
      setEngineResult(engine);
      setScaleSourceInfo({
        scaleMmPerPx: engine.scaleMmPerPx,
        source: engine.scaleSource,
        tiltDeg: engine.anglesDeg.frameTilt,
        facingRight: engine.frame.facingRight,
      });

      setDebugLog((prev) => [
        ...prev,
        ``,
        `  ЯДРО v2.1 (rotation-first, consensus scale):`,
        `    Направление: ${engine.frame.facingRight ? "вправо" : "влево → зеркалено (нормализовано вправо)"}`,
        `    Наклон оси колёс: ${engine.anglesDeg.frameTilt.toFixed(2)}° — ПОВОРОТ применён ДО всех расчётов`,
        `    МАСШТАБ: ${engine.scaleMmPerPx.toFixed(4)} мм/пикс`,
        `    Источник масштаба: ${engine.scaleSource}`,
        ...(auxScaleCandidates.length > 0
          ? [`    Кандидаты от колёс: ${auxScaleCandidates.map((a) => `${a.key} = ${(a.valueMm / a.px).toFixed(3)} мм/пикс`).join(", ")}`]
          : []),
      ]);

      // === ПЕРЕКРЁСТНАЯ ПРОВЕРКА (справочно; на рабочий масштаб НЕ влияет) ===
      const shMm = getCalibValue("saddleHeight");
      const ettMm = getCalibValue("ett");
      const wbMm = getCalibValue("wheelbase");
      const autoCalib = calculateAutoFitCalibration(
        {
          bb: pts.bb as any,
          saddle: pts.saddleMount as any,
          rearAxle: pts.rearAxle as any,
          frontAxle: pts.frontAxle as any,
          stTop: pts.stTop as any,
          htTop: pts.htTop as any,
        },
        {
          shMm: shMm ?? undefined,
          ettMm: ettMm ?? undefined,
          wbMm: wbMm ?? undefined,
        },
        imgSize ?? undefined
      );
      setAutoCalibration(autoCalib);
      setDebugLog((prev) => [
        ...prev,
        ``,
        `  Перекрёстная проверка масштаба (справочно — приоритет у userOverride):`,
        ...(autoCalib.candidates && autoCalib.candidates.length > 1
          ? [
              `    Кандидаты:`,
              ...autoCalib.candidates.map(
                (c) =>
                  `      ${c.type}: ${c.scale.toFixed(4)} мм/пикс${c.isPrimary ? "  [базовый для сравнения]" : `  (откл. ${c.deviationPct > 0 ? "+" : ""}${c.deviationPct.toFixed(1)}%)`}`
              ),
            ]
          : []),
        autoCalib.validationWarning
          ? `    ⚠ Согласованность: ${autoCalib.validationWarning}`
          : `    ✓ Кандидаты согласованы (расхождение <12%)`,
      ]);

      // Опциональный htTopCap (посадка райдера) — проецируем в выровненную
      // систему тем же преобразованием, что и ядро (makeAlignedTransform)
      const xform = makeAlignedTransform(engine.frame);
      const capPx =
        pts.htTopCap && pts.htTopCap.x != null && pts.htTopCap.y != null
          ? xform(toPxPt(pts.htTopCap))
          : null;

      // Маппинг результата движка в ComputedBikeParams (совместимость с UI)
      const params: ComputedBikeParams = {
        saddleHeight: engine.metricsMm.saddleHeight,
        ett: engine.metricsMm.ett,
        ettDirect: engine.extendedMm.ettDirect,
        reach: engine.metricsMm.reach,
        stack: engine.metricsMm.stack,
        stem: null,
        wheelbase: engine.metricsMm.wheelbase,
        wheelHeight: null,
        bbHeight: null,
        bbDrop: engine.extendedMm.bbDrop,
        rearCenter: engine.extendedMm.rearCenter,
        frontCenter: engine.extendedMm.frontCenter,
        stackReachRatio: engine.extendedMm.stackReachRatio,
        setback: engine.extendedMm.setback,
        seatTubeLength: engine.extendedMm.seatTubeLength,
        forkLength: engine.extendedMm.forkLength,
        headTubeLength: engine.extendedMm.headTubeLength,
        forkOffset: engine.extendedMm.forkOffset,
        handlebarHeight: capPx
          ? Math.round(Math.abs(engine.rotated.bb.y - capPx.y) * engine.scaleMmPerPx)
          : null,
        spacerStackHeight: capPx
          ? Math.round(Math.abs(engine.rotated.htTop.y - capPx.y) * engine.scaleMmPerPx)
          : null,
        sta: Number.isFinite(engine.anglesDeg.seatTubeAngle)
          ? engine.anglesDeg.seatTubeAngle
          : null,
        hta: Number.isFinite(engine.anglesDeg.headTubeAngle)
          ? engine.anglesDeg.headTubeAngle
          : null,
        scale: engine.scaleMmPerPx,
        calibratedBy: knownKey,
      };
      setComputed(params);

      setDebugLog((prev) => [
        ...prev,
        ``,
        `  Вычисленные параметры (выровненная система, мм):`,
        `    SH (BB→верх седла вдоль трубы) = ${params.saddleHeight ?? "null"} мм`,
        `    ETT (пересечение горизонали HT с осью ST) = ${params.ett ?? "null"} мм`,
        `    ETT прямой (горизонталь ST→HT) = ${params.ettDirect ?? "null"} мм`,
        `    Reach (горизонталь BB→HT) = ${params.reach ?? "null"} мм`,
        `    Stack (вертикаль BB→HT) = ${params.stack ?? "null"} мм`,
        `    WB (rear→front ось) = ${params.wheelbase ?? "null"} мм`,
        `    Setback (горизонталь BB→седло, + = позади) = ${params.setback ?? "null"} мм`,
        `    BB Drop (вертикаль BB→ось колеса) = ${params.bbDrop ?? "null"} мм`,
        `    ST (BB→верх ST) = ${params.seatTubeLength ?? "null"} мм`,
        `    RC (BB→задняя ось) = ${params.rearCenter ?? "null"} мм`,
        `    FC (BB→передняя ось) = ${params.frontCenter ?? "null"} мм`,
        `    HT length (HTверх→HTниз) = ${params.headTubeLength ?? "null"} мм`,
        `    Fork length (HTниз→передняя ось) = ${params.forkLength ?? "null"} мм`,
        `    Fork offset = ${params.forkOffset ?? "null"} мм`,
        `    Stack/Reach = ${params.stackReachRatio ?? "—"}`,
        `    STA = ${params.sta ?? "null"}° (угол подседельной трубы)`,
        `    HTA = ${params.hta ?? "null"}° (угол рулевой трубы)`,
        ``,
        `  Предупреждения движка (${engine.warnings.length}):`,
        ...(engine.warnings.length > 0
          ? engine.warnings.map((w) => `    ⚠ ${w}`)
          : [`    ✓ нет`]),
        ...(engine.physicsViolations.length > 0
          ? [
              ``,
              `  🛑 ФИЗИЧЕСКИЕ НАРУШЕНИЯ (${engine.physicsViolations.length}) — разметка недостоверна:`,
              ...engine.physicsViolations.map((v) => `    ❌ ${v.title}`),
            ]
          : [``, `  ✓ Физических нарушений разметки нет`]),
        ``,
        `  Проверки (что физически возможно):`,
        ...buildValidationChecks(params),
      ]);

      const cmp = compareMeasuredVsComputed(measured, params);
      setComparisons(cmp);

      // === DUAL SCALE (компенсация перспективы по двум колёсам) ===
      // wheelHeightMm уже вычислен выше (для консенсуса масштаба) —
      // тут только сам расчёт dual scale по точкам верха колёс.
      let computedDualScale: DualScale | null = null;
      if (imgSize && wheelHeightMm && wheelHeightMm > 0) {
        computedDualScale = calculateDualScale(pts, wheelHeightMm, {
          width: imgSize.width,
          height: imgSize.height,
        });
      }
      setDualScale(computedDualScale);
      if (computedDualScale) {
        setDebugLog((prev) => [
          ...prev,
          ``,
          `  Dual scale (по двум колёсам):`,
          `    WheelHeight (мм) = ${wheelHeightMm} [${wheelHeightSource}]`,
          `    Front px radius = ${computedDualScale.frontPxRadius.toFixed(1)}`,
          `    Rear px radius = ${computedDualScale.rearPxRadius.toFixed(1)}`,
          `    scaleFront = ${computedDualScale.scaleFront.toFixed(2)} мм/пикс`,
          `    scaleRear = ${computedDualScale.scaleRear.toFixed(2)} мм/пикс`,
          `    Средний масштаб = ${computedDualScale.scaleAvg.toFixed(2)} мм/пикс`,
          `    Perspective severity = ${(computedDualScale.perspectiveSeverity * 100).toFixed(1)}%`,
          `    ${computedDualScale.description}`,
          `    ⓘ Радиус из типоразмера — предположение. Реальная покрышка может отличаться на ±5-10 мм.`,
        ]);
      } else {
        // Диагностируем, ЧЕГО именно не хватает для dual scale
        const hasWheelTops = !!(pts.rearWheelTop && pts.frontWheelTop &&
          pts.rearWheelTop.x != null && pts.frontWheelTop.x != null);
        if (!hasWheelTops) {
          if (perspective && perspective.needsCorrection) {
            setDebugLog((prev) => [
              ...prev,
              ``,
              `  ⚠ Перспектива ${perspective.severity}, но точки верха колёс не размечены.`,
              `    Отметь rearWheelTop + frontWheelTop для dual scale (компенсации).`,
            ]);
          }
        } else if (!wheelHeightMm) {
          setDebugLog((prev) => [
            ...prev,
            ``,
            `  ⚠ Точки верха колёс размечены, но радиус колеса неизвестен`,
            `    (нет WH в форме и не определён типоразмер) — dual scale недоступен.`,
          ]);
        }
      }

      // === CONFIDENCE SCORE (вместо null-валидации) ===
      // ВАЖНО: используем СВЕЖУЮ перспективу из этой же итерации (локальная
      // переменная perspective), а не perspectiveInfo из стейта — тот на один
      // рендер отстаёт и на первом прогоне всегда null.
      const photoDistorted = !!(perspective && perspective.needsCorrection && !computedDualScale);
      const assessment = assessConfidence(
        params,
        bikeType ?? undefined,
        computedDualScale,
        photoDistorted,
        engine.physicsViolations.length
      );
      setConfidenceAssessment(assessment);
      setDebugLog((prev) => [
        ...prev,
        ``,
        `  Confidence Score:`,
        `    Overall: ${assessment.overall}`,
        `    Summary: ${assessment.summary}`,
        ...assessment.params
          .filter((p) => p.confidence !== "high")
          .map((p) => `    ${p.label}: ${p.value} [${p.confidence}] ${p.warnings[0] ?? ""}`),
      ]);
    },
    [knownKey, measured, getCalibValue, getMeasuredFor, imgSize, bikeType]
  );

  const handleCalibrate = useCallback(() => {
    if (!keyPoints || knownValue == null || knownValue <= 0) return;
    // Логируем ручной запуск
    const ts = new Date().toLocaleTimeString();
    setDebugLog((prev) => [
      ...prev.slice(-80),
      ``,
      `[${ts}] 🎯 Пользователь нажал «Вычислить все параметры»`,
      `  knownKey = ${knownKey}, knownValue = ${knownValue} мм`,
    ]);
    runCalibration(keyPoints, knownValue);
    // Результат рендерится ниже — плавно показываем его, чтобы не было
    // ощущения «нажал — ничего не произошло».
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
  }, [keyPoints, knownValue, runCalibration, knownKey]);

  // Подсказки для точек — что и где нужно поправить.
  // v2: работают в пиксельном пространстве через результат ядра
  // (масштаб мм/пикс, выровненная система) — цифры совпадают с отчётом.
  const pointSuggestions: PointSuggestion[] = useMemo(() => {
    if (!keyPoints || !engineResult || !bikeType || !imgSize) return [];
    return suggestPointCorrections(
      keyPoints,
      { imgSize, engine: engineResult },
      bikeType
    );
  }, [keyPoints, engineResult, bikeType, imgSize]);

  const handleApplySuggestion = useCallback((suggestion: PointSuggestion) => {
    if (!keyPoints) return;
    const oldPt = keyPoints[suggestion.pointKey];
    const corrected = applySuggestion(keyPoints, suggestion);

    // Логируем: применена подсказка
    const ts = new Date().toLocaleTimeString();
    const oldStr = oldPt?.x != null && oldPt?.y != null
      ? `x=${oldPt.x.toFixed(4)}, y=${oldPt.y.toFixed(4)}`
      : "null";
    const newStr = `x=${suggestion.suggested.x.toFixed(4)}, y=${suggestion.suggested.y.toFixed(4)}`;
    setDebugLog((prev) => [
      ...prev.slice(-80),
      ``,
      `[${ts}] ⚡ Применена подсказка: ${suggestion.pointKey}`,
      `  было:  ${oldStr}`,
      `  стало: ${newStr}`,
      `  причина: ${suggestion.problem}`,
      `  действие: ${suggestion.action}`,
    ]);

    setKeyPoints(corrected);
    if (knownValue != null && knownValue > 0) {
      runCalibration(corrected, knownValue);
    }
  }, [keyPoints, knownValue, runCalibration]);

  const handleApplyAllSuggestions = useCallback(() => {
    if (!keyPoints) return;
    let corrected = keyPoints;

    // Логируем
    const ts = new Date().toLocaleTimeString();
    setDebugLog((prev) => [
      ...prev.slice(-80),
      ``,
      `[${ts}] ⚡⚡ Применить ВСЕ подсказки (${pointSuggestions.length} шт.):`,
    ]);

    for (const s of pointSuggestions) {
      const oldPt = corrected[s.pointKey];
      const oldStr = oldPt?.x != null && oldPt?.y != null
        ? `x=${oldPt.x.toFixed(4)}, y=${oldPt.y.toFixed(4)}`
        : "null";
      const newStr = `x=${s.suggested.x.toFixed(4)}, y=${s.suggested.y.toFixed(4)}`;
      setDebugLog((prev) => [
        ...prev.slice(-80),
        `  ${s.pointKey}: ${oldStr} → ${newStr}`,
      ]);
      corrected = applySuggestion(corrected, s);
    }
    setKeyPoints(corrected);
    if (knownValue != null && knownValue > 0) {
      runCalibration(corrected, knownValue);
    }
  }, [keyPoints, pointSuggestions, knownValue, runCalibration]);

  // NOTE: Авто-выравнивание (поворот точек) УБРАНО.
  // Точки на фото НЕ двигаются — остаются там, где их поставил пользователь.
  // Наклон горизонта компенсируется МАТЕМАТИЧЕСКИ через tiltAngleRad
  // в авто-калибровке (см. calculateAutoFitCalibration в bike-calibration-helper.ts).
  // Это решает проблему «точки уплыли с железа после нажатия кнопки».

  // Хелпер для лога: прогоняет вычисленные параметры через те же проверки,
  // что и в форме, и формирует человекочитаемый результат.
  const buildValidationChecks = (params: ComputedBikeParams): string[] => {
    const lines: string[] = [];
    const measuredForValidation: BikeMeasurements = {
      saddleHeight: measured.saddleHeight ?? undefined,
      ett: measured.ett ?? undefined,
      reach: params.reach ?? undefined,
      stack: params.stack ?? undefined,
      stem: measured.stem ?? undefined,
      crank: measured.crank ?? undefined,
      wheelHeight: measured.wheelHeight ?? undefined,
      bbHeight: measured.bbHeight ?? undefined,
      wheelbase: measured.wheelbase ?? undefined,
    };
    const sources: Record<string, "measured" | "photo"> = {
      saddleHeight: "measured",
      ett: "measured",
      reach: "photo",
      stack: "photo",
      stem: "measured",
      crank: "measured",
      wheelHeight: "measured",
      bbHeight: "measured",
      wheelbase: "measured",
    };
    const issues = validateBikeMeasurements(measuredForValidation, sources);

    // Дополнительные проверки: measured vs computed (есть и то, и то)
    const extraChecks: string[] = [];
    if (measured.ett != null && params.ett != null && measured.ett > 0 && params.ett > 0) {
      const delta = Math.round(params.ett - measured.ett);
      const pct = Math.round((Math.abs(delta) / measured.ett) * 100);
      if (pct > 5) {
        // Умная диагностика: сравниваем формульный ETT (Reach + Stack/tan(STA))
        // с прямым горизонтальным ST→HT. Если прямой совпадает с измеренным —
        // расхождение даёт формула, чувствительная к точке stTop.
        let suspect: string;
        if (params.ettDirect != null) {
          const directPct = (Math.abs(params.ettDirect - measured.ett) / measured.ett) * 100;
          if (directPct < 3) {
            suspect = `формула ETT (прямой ST→HT по фото = ${Math.round(params.ettDirect)} мм ≈ измеренному; слагаемое Stack/tan(STA) добавляет ${Math.round(params.ett - params.ettDirect)} мм — проверьте точку stTop)`;
          } else {
            suspect = "точки ST/HT";
          }
        } else {
          suspect = pct > 15 ? "калибровка (масштаб по SH)" : "точки ST/HT";
        }
        extraChecks.push(`    ⚠️ ETT: измерено ${measured.ett}, по фото ${params.ett} (Δ ${delta > 0 ? "+" : ""}${delta}, ${pct}%) — [подозрение: ${suspect}]`);
      }
    }
    if (measured.wheelbase != null && params.wheelbase != null && measured.wheelbase > 0 && params.wheelbase > 0) {
      const delta = Math.round(params.wheelbase - measured.wheelbase);
      const pct = Math.round((Math.abs(delta) / measured.wheelbase) * 100);
      if (pct > 5) {
        const suspect = pct > 15 ? "калибровка (масштаб по SH) или точки осей кривые" : "точки осей";
        extraChecks.push(`    ⚠️ WB: измерено ${measured.wheelbase}, по фото ${params.wheelbase} (Δ ${delta > 0 ? "+" : ""}${delta}, ${pct}%) — [подозрение: ${suspect}]`);
      }
    }
    if (measured.saddleHeight != null && params.saddleHeight != null && measured.saddleHeight > 0 && params.saddleHeight > 0) {
      const delta = Math.round(params.saddleHeight - measured.saddleHeight);
      const pct = Math.round((Math.abs(delta) / measured.saddleHeight) * 100);
      // SH — калибровочный параметр, расхождения не должно быть
      // Но если оно есть — значит что-то совсем не так с точками BB/saddleMount
      if (pct > 2) {
        // Проверяем, согласованы ли ETT и WB — если да, то масштаб по ним правильный,
        // и значит реальный SH не соответствует фото-расстоянию BB→saddleMount.
        // Это НЕ значит что SH неверный — это значит точки BB/saddleMount стоят неточно.
        const ettScale = measured.ett != null && params.ett != null && params.ett > 0
          ? measured.ett / params.ett
          : null;
        const wbScale = measured.wheelbase != null && params.wheelbase != null && params.wheelbase > 0
          ? measured.wheelbase / params.wheelbase
          : null;
        const otherScales = [ettScale, wbScale].filter((s): s is number => s != null);
        if (otherScales.length > 0) {
          const avgOtherScale = otherScales.reduce((a, b) => a + b, 0) / otherScales.length;
          const scaleRatio = avgOtherScale; // currentScale / (currentScale) * avgOtherScale... упростим
          // Если scale по ETT/WB в 1.15+ раз больше, чем по SH — точки BB/saddleMount стоят слишком далеко
          // (см. мульти-калибровку выше)
          extraChecks.push(
            `    ⚠️ SH: измерено ${measured.saddleHeight}, по фото ${params.saddleHeight} (Δ ${delta > 0 ? "+" : ""}${delta}, ${pct}%). ` +
            `SH измерен верно (доверяем), но точки BB/saddleMount на фото стоят слишком далеко друг от друга. ` +
            `Возможно saddleMount стоит не на самой верхней точке седла — проверьте, что точка на верхе седла там, где оно сидит на подседельном штыре.`
          );
        } else {
          extraChecks.push(`    ⚠️ SH: измерено ${measured.saddleHeight}, по фото ${params.saddleHeight} (Δ ${delta > 0 ? "+" : ""}${delta}, ${pct}%) — расхождение > 2%, проверьте точки BB/saddleMount`);
        }
      }
    }

    if (issues.length === 0 && extraChecks.length === 0) {
      lines.push("    ✓ Все проверки пройдены");
      return lines;
    }
    for (const issue of issues) {
      const icon =
        issue.level === "error" ? "❌" : issue.level === "warning" ? "⚠️" : "ℹ️";
      const suspect =
        issue.suspectField != null
          ? ` [подозрение: ${issue.suspectField}]`
          : "";
      lines.push(`    ${icon} ${issue.message}${suspect}`);
    }
    lines.push(...extraChecks);
    return lines;
  };

  // Обёртка для onPointsChange — после клика переводим к следующей точке
  const handlePointsChange = useCallback(
    (pts: BikeKeyPoints) => {
      // Логируем: какая точка изменилась и куда
      if (keyPoints) {
        const changedKey = (Object.keys(pts) as Array<keyof BikeKeyPoints>).find(
          (k) => {
            const old = keyPoints[k];
            const neu = pts[k];
            if (!old || !neu) return old !== neu;
            return old.x !== neu.x || old.y !== neu.y;
          }
        );
        if (changedKey) {
          const oldPt = keyPoints[changedKey];
          const newPt = pts[changedKey];
          const ts = new Date().toLocaleTimeString();
          const mode = placementMode ? "разметка" : "драг";
          const oldStr = oldPt?.x != null && oldPt?.y != null
            ? `x=${oldPt.x.toFixed(4)}, y=${oldPt.y.toFixed(4)}`
            : "null";
          const newStr = newPt?.x != null && newPt?.y != null
            ? `x=${newPt.x.toFixed(4)}, y=${newPt.y.toFixed(4)}`
            : "null";
          setDebugLog((prev) => [
            ...prev.slice(-80),
            `[${ts}] ${mode}: ${changedKey} — ${oldStr} → ${newStr}`,
          ]);
        }
      }

      setKeyPoints(pts);

      // Сохраняем keyPoints через callback (debounce не нужен — localStorage быстрый)
      // ВАЖНО: обновляем ref, иначе useEffect выше воспримет это как внешнее изменение
      // и сбросит placementMode = false.
      if (onPhotoChange) {
        lastEmittedRef.current = { photoUrl, keyPoints: pts };
        onPhotoChange(photoUrl, pts);
      }

      // Если в режиме разметки — перейти к следующей null-точке
      if (placementMode && placementPointKey) {
        // Ищем следующую незаполненную точку С НАЧАЛА PLACEMENT_ORDER: так
        // ранее не размещённые точки не пропускаются, даже если пользователь
        // через чипы размещал точки в произвольном порядке.
        let next: keyof BikeKeyPoints | null = null;
        for (let i = 0; i < PLACEMENT_ORDER.length; i++) {
          const k = PLACEMENT_ORDER[i];
          const pt = pts[k];
          if (!pt || pt.x == null || pt.y == null) {
            next = k;
            break;
          }
        }
        if (next) {
          setPlacementPointKey(next);
          // Подсказка при переходе к опциональным точкам
          if (next === "rearWheelTop" || next === "frontWheelTop") {
            setDebugLog((prev) => [
              ...prev.slice(-80),
              `[${new Date().toLocaleTimeString()}] 📌 Переход к опциональной точке ${next} (для dual scale)`,
            ]);
          }
        } else {
          // Все точки размещены — выходим из режима разметки
          setPlacementMode(false);
          setPlacementPointKey(null);
          setDebugLog((prev) => [
            ...prev.slice(-80),
            `[${new Date().toLocaleTimeString()}] Все 10 точек размещены — выход из режима разметки`,
          ]);

          // Если есть knownValue — запускаем калибровку
          if (knownValue != null && knownValue > 0) {
            setTimeout(() => runCalibration(pts, knownValue), 50);
          }
        }
      } else {
        // Не в режиме разметки — простой пересчёт при драге
        if (knownValue != null && knownValue > 0) {
          runCalibration(pts, knownValue);
        }
      }
    },
    [placementMode, placementPointKey, knownValue, runCalibration, keyPoints]
  );

  const handleApplyAveraged = useCallback(() => {
    if (comparisons.length === 0 || !onAveraged) return;
    // ГЕЙТ: физически невозможная разметка → числа мусор, в карточку не пишем.
    if (engineResult && engineResult.physicsViolations.length > 0) {
      setError(
        `Запись заблокирована: разметка физически невозможна (${engineResult.physicsViolations.length} наруш. — красная карточка выше). Исправьте отмеченные точки и снова нажмите «Вычислить все параметры».`
      );
      const ts = new Date().toLocaleTimeString();
      setDebugLog((prev) => [
        ...prev.slice(-80),
        `[${ts}] 🛡 Запись в карточку велика ЗАБЛОКИРОВАНА: ${engineResult.physicsViolations.length} физических нарушений разметки.`,
        ...engineResult.physicsViolations.map((v) => `  ❌ ${v.title}`),
      ]);
      return;
    }
    const averaged: Record<string, number | null> = {};
    for (const c of comparisons) {
      averaged[c.key] = c.averaged;
    }
    // ПРИНЦИП «ЭТАЛОН»: WB не входит в comparisons (он known-размер и используется
    // как калибровка), поэтому фото-WB передаём отдельно из результата ядра v2.
    // Право записать его остаётся у формы: WB пишется ТОЛЬКО в пустое поле,
    // введённое вручную значение никогда не перезаписывается.
    if (engineResult) {
      averaged.wheelbase = engineResult.metricsMm.wheelbase;
      // v1.13.5: углы — справочные, в форме не редактируются, так что
      // перезапись вручную введённого невозможна по построению.
      averaged.sta = Math.round(engineResult.anglesDeg.seatTubeAngle * 10) / 10;
      averaged.hta = Math.round(engineResult.anglesDeg.headTubeAngle * 10) / 10;
    }
    // Сводка того, что уйдёт в карточку — рендерится под кнопкой.
    // Setback в карточку НЕ переносим: там это отсылка седла (нос седла от BB,
    // влияет на фит-предупреждения), а из фото считается сетбэк рамы
    // (BB → крепление седла) — семантика разная, смешивать нельзя.
    const parts: string[] = [];
    const push = (label: string, val: number | null | undefined, unit = "мм") => {
      if (val != null && val > 0) parts.push(`${label} ${val}${unit}`);
    };
    push("Reach", averaged.reach);
    push("Stack", averaged.stack);
    push("STA", averaged.sta, "°");
    push("HTA", averaged.hta, "°");
    push("FC", averaged.frontCenter);
    push("RC", averaged.rearCenter);
    push("ST", averaged.seatTubeLength);
    push("BB Drop", averaged.bbDrop);
    onAveraged(averaged);
    setAppliedSummary(
      parts.length > 0
        ? `✓ Записано в карточку велика: ${parts.join(", ")}`
        : null
    );
  }, [comparisons, onAveraged, engineResult]);

  const overall = comparisons.length > 0 ? getOverallMatch(comparisons) : null;

  return (
    <Card className="border-dashed border-emerald-300 dark:border-emerald-900">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Ruler className="size-5 text-emerald-500" />
          <div>
            <CardTitle className="text-base">Калибровка геометрии по фото</CardTitle>
            <CardDescription>
              ФОТО ВЕЛОСИПЕДА БЕЗ ЧЕЛОВЕКА. Снимите сбоку, перпендикулярно, на расстоянии 3-4 м. Видны оба колеса, рама целиком, седло и руль. Система определит ключевые точки и вычислит все параметры в масштабе.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!photoUrl ? (
          <PhotoUploader
            onPhotoSelected={handlePhotoSelected}
            currentPhotoUrl={photoUrl}
            onClear={handleClear}
            label="Загрузите фото велосипеда (БЕЗ человека) сбоку"
          />
        ) : (
          <>
            {/* Фото с интерактивными точками */}
            <InteractivePhoto
              photoUrl={photoUrl}
              keyPoints={keyPoints}
              onPointsChange={handlePointsChange}
              loading={loading}
              placementMode={placementMode}
              placementPointKey={placementPointKey}
            />

            {/* Панель режима разметки */}
            {placementMode && keyPoints && (
              <div className="rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                    ✏️ Ручная разметка
                  </p>
                  <Button
                    onClick={exitPlacementMode}
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                  >
                    Готово
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Кликай по фото, чтобы разместить выбранную точку. После клика автоматически
                  переключается к следующей.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {([
                    { key: "bb", label: "Каретка", color: "#ef4444", hint: "Центр каретки (ось педалей) — центр вала между шатунами", optional: false },
                    { key: "stTop", label: "Верх подседельной трубы", color: "#f97316", hint: "Верх подседельной трубы (хомут) — где штырь входит в раму", optional: false },
                    { key: "saddleMount", label: "Верх седла с подседелом", color: "#eab308", hint: "Верх седла над линией штыря — не нос и не зад седла", optional: false },
                    { key: "htTop", label: "Верх рулевого стакана", color: "#22c55e", hint: "Верх рулевого стакана рамы — стык выноса с рамой", optional: false },
                    { key: "htBottom", label: "Низ рулевого стакана", color: "#3b82f6", hint: "Низ рулевого стакана = корона вилки (стык вилки с рамой)", optional: false },
                    { key: "htTopCap", label: "Крышка рулевой", color: "#10b981", hint: "Верхняя крышка рулевой колонки с болтом (для расчёта посадки)", optional: false },
                    { key: "rearAxle", label: "Ось заднего колеса", color: "#a855f7", hint: "Центр оси заднего колеса", optional: false },
                    { key: "frontAxle", label: "Ось переднего колеса", color: "#ec4899", hint: "Центр оси переднего колеса", optional: false },
                    { key: "rearWheelTop", label: "Верх заднего колеса", color: "#7c3aed", hint: "ОПЦИОНАЛЬНО: верх покрышки заднего колеса (для dual scale)", optional: true },
                    { key: "frontWheelTop", label: "Верх переднего колеса", color: "#be185d", hint: "ОПЦИОНАЛЬНО: верх покрышки переднего колеса (для dual scale)", optional: true },
                  ] as const).map(({ key, label, color, hint, optional }) => {
                    const pt = keyPoints[key as keyof BikeKeyPoints] as NullablePoint | undefined;
                    const isPlaced = pt && pt.x != null && pt.y != null;
                    const isActive = placementPointKey === key;
                    return (
                      <button
                        key={key}
                        onClick={() => selectPointForPlacement(key as keyof BikeKeyPoints)}
                        title={hint}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] text-left transition-colors",
                          optional && "border-dashed",
                          isActive
                            ? "border-emerald-500 bg-emerald-100 dark:bg-emerald-900/50"
                            : "border-border bg-white dark:bg-background hover:bg-muted"
                        )}
                      >
                        <span
                          className="size-3 rounded-full shrink-0 border-2"
                          style={{
                            borderColor: color,
                            background: isPlaced ? color : "transparent",
                          }}
                        />
                        <span className="flex-1 whitespace-normal leading-tight">{label}</span>
                        {isPlaced && (
                          <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">✓</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Подсказка про ручной режим, когда точки ещё не определены */}
            {keyPoints === null && !loading && !placementMode && (
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                <p className="font-semibold mb-1">📐 Разметка точек вручную</p>
                <p className="text-muted-foreground mb-2">
                  Кликаешь по фото 8 раз — точки ровно на своих местах.
                  Подсказки для каждой точки покажутся сверху над фото.
                  После разметки можно перетаскивать точки мышкой.
                </p>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <div>{error}</div>
                  {pointsMissing.length > 0 && (
                    <div className="text-[11px] text-rose-600/80 dark:text-rose-400/70 border-t border-rose-200/50 dark:border-rose-900/50 pt-1 mt-1">
                      <div>Обязательные точки (7): обе оси колёс, каретка, верх подседельной трубы, верх седла с подседелом, верх и низ рулевого стакана</div>
                      <div>Отсутствуют: <b>{pointsMissing.map((k) => pointFullLabel(k)).join(", ")}</b></div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Кнопка: ручная разметка (только ручная — ИИ-определение удалено, оно кривое) */}
            {keyPoints === null && !loading && (
              <div className="space-y-2">
                <Button
                  onClick={startManualPlacement}
                  className="w-full bg-emerald-500 hover:bg-emerald-600"
                  size="lg"
                >
                  ✏️ Ручная разметка (8 точек)
                </Button>
              </div>
            )}

            {/* Продолжить разметку — ТОЛЬКО когда точки ещё не все стоят.
                Когда все 10 стоят — никакой кнопки не нужно: точки и так
                можно перетаскивать мышкой прямо на фото. */}
            {keyPoints !== null && !loading && !placementMode && (() => {
              const nullCount = PLACEMENT_ORDER.filter((k) => {
                const pt = keyPoints[k];
                return !pt || pt.x == null || pt.y == null;
              }).length;
              if (nullCount === 0) return null;
              return (
                <Button
                  onClick={continuePlacement}
                  className="w-full bg-emerald-500 hover:bg-emerald-600"
                  size="lg"
                >
                  ✏️ Продолжить разметку — осталось точек: {nullCount}
                </Button>
              );
            })()}

            {/* Результат определения точек */}
            {keyPoints && (
              <div className="space-y-4">
                {pointsMissing.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                    <AlertCircle className="size-4 mt-0.5 shrink-0" />
                    <span>
                      Не удалось определить точки: {pointsMissing.map((k) => pointFullLabel(k)).join(", ")}
                    </span>
                  </div>
                )}

                {/* ===== ФИЗИЧЕСКИЕ ГЕЙТЫ — разметка невозможна ===== */}
                {engineResult && engineResult.physicsViolations.length > 0 && (
                  <div className="rounded-lg border-l-4 border-rose-500 dark:border-rose-600 bg-rose-50 dark:bg-rose-950/30 p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="size-4 mt-0.5 shrink-0 text-rose-500" />
                      <div className="flex-1">
                        <p className="text-sm font-bold text-rose-700 dark:text-rose-400">
                          🛑 Разметка физически невозможна ({engineResult.physicsViolations.length})
                        </p>
                        <p className="text-[11px] text-rose-600/80 dark:text-rose-400/70 mt-0.5 leading-relaxed">
                          Так велосипед не устроен. Пока эти точки не исправлены,
                          все вычисленные числа — мусор и записывать их в карточку
                          велика нельзя. Перетащите отмеченные точки прямо на фото
                          в правильные места и снова нажмите «Вычислить все параметры».
                        </p>
                      </div>
                    </div>
                    <ul className="space-y-1.5">
                      {engineResult.physicsViolations.map((v, i) => (
                        <li
                          key={i}
                          className="rounded-md border border-rose-300 dark:border-rose-800 bg-white dark:bg-rose-950/20 p-2 space-y-1"
                        >
                          <p className="text-xs font-semibold text-rose-700 dark:text-rose-400">
                            ❌ {v.title}
                          </p>
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            → {v.fix}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* ===== DUAL SCALE — компенсация перспективы по двум колёсам ===== */}
                {dualScale ? (
                  <div className="rounded-lg border-l-4 border-cyan-400 dark:border-cyan-600 bg-cyan-50 dark:bg-cyan-950/30 p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <ZoomIn className="size-4 mt-0.5 shrink-0 text-cyan-500" />
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-semibold text-cyan-700 dark:text-cyan-400">
                          Dual Scale активен
                        </p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {dualScale.description}
                        </p>
                        <div className="text-[11px] text-muted-foreground mt-1">
                          Перспектива: <b>{(dualScale.perspectiveSeverity * 100).toFixed(1)}%</b> — масштаб подстраивается под каждое колесо отдельно
                        </div>
                      </div>
                    </div>
                  </div>
                ) : perspectiveInfo && perspectiveInfo.needsCorrection && (
                  /* Подсказка про dual scale когда перспектив есть, но точки верха не размечены */
                  <div className="rounded-lg border-l-4 border-cyan-300 dark:border-cyan-700 bg-cyan-50/50 dark:bg-cyan-950/20 p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <ZoomIn className="size-4 mt-0.5 shrink-0 text-cyan-500" />
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-semibold text-cyan-700 dark:text-cyan-400">
                          💡 Отметь верх колёс для dual scale
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Перспектива обнаружена. Если отметить две опциональные точки
                          (верх заднего и верх переднего колеса) —dual scale компенсирует
                          разницу в размерах колёс и улучшит точность на 10–15 мм.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* ===== CONFIDENCE SCORE ===== */}
                {confidenceAssessment && (() => {
                  const colors = confidenceColor(confidenceAssessment.overall);
                  return (
                    <div className={cn("rounded-lg border-l-4 p-3 space-y-2", colors.bg, colors.border)}>
                      <div className="flex items-start gap-2">
                        <span className={cn("text-lg font-bold", colors.text)}>
                          {colors.icon}
                        </span>
                        <div className="flex-1 space-y-1">
                          <p className={cn("text-sm font-semibold", colors.text)}>
                            Достоверность: {colors.label}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {confidenceAssessment.summary}
                          </p>
                        </div>
                      </div>
                      {/* Детализация по параметрам с non-high confidence */}
                      {confidenceAssessment.params.filter((p) => p.confidence !== "high").length > 0 && (
                        <div className="space-y-1 pt-1 border-t border-current/10">
                          {confidenceAssessment.params
                            .filter((p) => p.confidence !== "high")
                            .map((p) => {
                              const pc = confidenceColor(p.confidence);
                              return (
                                <div key={p.field} className="text-[11px]">
                                  <div className="flex items-center gap-2">
                                    <span className={pc.text}>{pc.icon}</span>
                                    <span className="font-mono">
                                      {p.label} = {p.value}
                                      {p.range && <span className="text-muted-foreground"> (диапазон {p.range.min}–{p.range.max})</span>}
                                    </span>
                                  </div>
                                  {p.warnings[0] && (
                                    <p className="text-muted-foreground ml-5 mt-0.5">{p.warnings[0]}</p>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Статус кадра — лаконично: ядро v2 выравнивает горизонт
                    автоматически (rotation-first), вопросов и кнопок нет.
                    Предупреждение только при сильном завале (>8°). */}
                {engineResult && (() => {
                  const tilt = Math.abs(engineResult.anglesDeg.frameTilt);
                  if (tilt > 8) {
                    return (
                      <div className="flex items-start gap-2 rounded-lg border-l-4 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 p-3">
                        <AlertCircle className="size-4 mt-0.5 shrink-0 text-amber-500" />
                        <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                          Фотография сделана под сильным углом ({tilt.toFixed(1)}°).
                          Для идеальной точности рекомендуем сделать снимок строго сбоку
                          на уровне каретки.
                        </p>
                      </div>
                    );
                  }
                  if (tilt > 0.5) {
                    return (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                        Горизонт кадра автоматически выровнен ({tilt.toFixed(1)}°)
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* Подсказки по точкам: что стоит поправить */}
                {pointSuggestions.length > 0 && (
                  <div className="space-y-2 rounded-lg border-l-4 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="size-4 mt-0.5 shrink-0 text-amber-500" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                          Подсказки по точкам ({pointSuggestions.length})
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Эти точки стоят неточно. Можно поправить вручную или применить автоматически.
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {pointSuggestions.map((s, i) => (
                        <div
                          key={i}
                          className={cn(
                            "rounded-md border p-2 space-y-1.5",
                            s.severity === "major"
                              ? "border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30"
                              : "border-amber-200 dark:border-amber-900 bg-white dark:bg-amber-950/20"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-bold">
                              {pointFullLabel(String(s.pointKey))}
                              {s.severity === "major" && (
                                <span className="ml-1 text-rose-600 dark:text-rose-400 text-[10px]">срочно</span>
                              )}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px] shrink-0"
                              onClick={() => handleApplySuggestion(s)}
                            >
                              Поставить автоматически
                            </Button>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            {s.problem}
                          </p>
                          <p className="text-[11px] text-amber-700 dark:text-amber-400">
                            → {s.action}
                          </p>
                          <p className="text-[10px] text-muted-foreground/70">
                            Смещение от текущего положения: {Math.round(s.distance)} мм
                          </p>
                        </div>
                      ))}
                    </div>
                    {pointSuggestions.length > 1 && (
                      <Button
                        size="sm"
                        variant="default"
                        className="w-full bg-amber-500 hover:bg-amber-600 text-white"
                        onClick={handleApplyAllSuggestions}
                      >
                        Применить все подсказки ({pointSuggestions.length})
                      </Button>
                    )}
                  </div>
                )}

                {/* Калибровка масштаба — 3 прямых поля ввода */}
                <div className="space-y-3 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/10 p-4">
                  <div className="flex items-center gap-2">
                    <ArrowUpDown className="size-4 text-emerald-500" />
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      Калибровка масштаба — 3 известных размера
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Введите 1–3 известных размера велосипеда. Чем больше — тем точнее
                    (мульти-калибровка усреднит). Хотя бы одно поле обязательно.
                  </p>

                  {/* 3 input поля */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {KNOWN_DIM_OPTIONS.map((opt) => {
                      const rawVal = opt.key === "saddleHeight"
                        ? calibInputs.saddleHeight
                        : opt.key === "ett"
                          ? calibInputs.ett
                          : calibInputs.wheelbase;
                      const numVal = getCalibValue(opt.key);
                      const isPrimary = knownKey === opt.key;
                      return (
                        <div key={opt.key} className="space-y-1">
                          <Label className="text-[11px] flex items-center justify-between">
                            <span>{opt.label}</span>
                            {isPrimary && (
                              <span className="text-[9px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400">primary</span>
                            )}
                          </Label>
                          <div className="relative">
                            <Input
                              type="text"
                              inputMode="decimal"
                              value={rawVal}
                              placeholder={opt.placeholder}
                              onChange={(e) => {
                                const v = e.target.value;
                                calibDirtyRef.current[opt.key] = true;
                                setCalibInputs((prev) => ({
                                  ...prev,
                                  [opt.key]: v,
                                }));
                                // Логируем ввод
                                const ts = new Date().toLocaleTimeString();
                                setDebugLog((prev) => [
                                  ...prev.slice(-80),
                                  `[${ts}] ⌨️ Ввод ${opt.key}: "${v}"`,
                                ]);
                              }}
                              onBlur={() => {
                                const raw = calibInputs[opt.key];
                                // Мусор в поле (вне физического диапазона) —
                                // чиним сразу при выходе из поля: значение из
                                // карточки, если оно физически возможно, иначе очищаем.
                                if (isImplausibleInput(opt.key, raw)) {
                                  const measuredVal = getMeasuredFor(opt.key);
                                  const fixed =
                                    measuredVal != null && isPlausibleOverrideMm(opt.key, measuredVal)
                                      ? String(measuredVal)
                                      : "";
                                  const ts = new Date().toLocaleTimeString();
                                  setCalibInputs((prev) => ({ ...prev, [opt.key]: fixed }));
                                  calibDirtyRef.current[opt.key] = false;
                                  setDebugLog((prev) => [
                                    ...prev.slice(-80),
                                    `[${ts}] 🛡 Поле ${opt.key} = "${raw}" — вне физического диапазона, исправлено на ${fixed || "(пусто)"}.`,
                                  ]);
                                  if (fixed && keyPoints) {
                                    setTimeout(() => runCalibration(keyPoints, parseFloat(fixed)), 0);
                                  }
                                  return;
                                }
                                // При потере фокуса — пересчитать, если есть точки и хоть одно значение
                                if (keyPoints && numVal != null && numVal > 0) {
                                  setTimeout(() => {
                                    // knownValue обновится после re-render — используем getCalibValue напрямую
                                    const v = getCalibValue(opt.key);
                                    if (v != null && v > 0) {
                                      runCalibration(keyPoints, v);
                                    }
                                  }, 0);
                                }
                              }}
                              className={cn(
                                "h-9 pr-10 text-sm",
                                numVal != null && numVal > 0
                                  ? isImplausibleInput(opt.key, rawVal)
                                    ? "border-rose-500 dark:border-rose-600 bg-rose-50/50 dark:bg-rose-950/20"
                                    : "border-emerald-400 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/20"
                                  : "border-input"
                              )}
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">
                              {opt.unit}
                            </span>
                          </div>
                          {(() => {
                            const measuredVal = getMeasuredFor(opt.key);
                            const range = OVERRIDE_PHYSICAL_RANGE_MM[opt.key];
                            const implausible = isImplausibleInput(opt.key, rawVal);
                            if (implausible) {
                              return (
                                <p className="text-[10px] leading-tight text-rose-600 dark:text-rose-400">
                                  ⛔ {parseCalibRaw(rawVal)} мм — вне физического диапазона {range.min}–{range.max} мм. Поле не допускается до масштаба{measuredVal != null ? ` — в карточке: ${measuredVal} мм` : ""}.
                                </p>
                              );
                            }
                            if (numVal != null && measuredVal != null && numVal !== measuredVal) {
                              return (
                                <p className="text-[10px] leading-tight text-amber-600 dark:text-amber-400">
                                  ⓘ В карточке велика: {measuredVal} мм — масштаб строго по этому полю.
                                </p>
                              );
                            }
                            return null;
                          })()}
                          {numVal != null && numVal > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                const ts = new Date().toLocaleTimeString();
                                setDebugLog((prev) => [
                                  ...prev.slice(-80),
                                  `[${ts}] 🎯 Primary: ${opt.key} = ${numVal} ${opt.unit}`,
                                ]);
                                setKnownKey(opt.key);
                                if (keyPoints) {
                                  setTimeout(() => runCalibration(keyPoints, numVal), 0);
                                }
                              }}
                              className={cn(
                                "text-[10px] hover:underline",
                                isPrimary
                                  ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                                  : "text-muted-foreground"
                              )}
                            >
                              {isPrimary ? "✓ primary" : "сделать primary"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Primary вне физического диапазона — расчёт по нему заблокирован */}
                  {knownValue != null && knownValue > 0 &&
                    (knownKey === "saddleHeight" || knownKey === "ett" || knownKey === "wheelbase") &&
                    !isPlausibleOverrideMm(knownKey, knownValue) && (
                      <p className="rounded-md border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-400">
                        ⛔ Primary «{KNOWN_DIM_OPTIONS.find((o) => o.key === knownKey)?.label}» = {knownValue} мм — вне физического диапазона. Расчёт по нему заблокирован: исправьте поле выше или очистите его (иначе масштаб возьмётся из карточки велика).
                      </p>
                    )}

                  {/* Статус: сколько значений заполнено */}
                  <div className="text-xs">
                    {filledKnownsCount === 0 ? (
                      <p className="text-amber-600 dark:text-amber-400">
                        ⚠ Заполните хотя бы одно поле выше — нужно для калибровки масштаба
                      </p>
                    ) : filledKnownsCount === 1 ? (
                      <p className="text-emerald-600 dark:text-emerald-400">
                        ✓ Калибровка по 1 размеру: <b>{knownValue} мм</b>.
                        Введите ETT или WB для проверки — увидите расхождение.
                      </p>
                    ) : (
                      <p className="text-emerald-600 dark:text-emerald-400">
                        ✓ Заполнено {filledKnownsCount} размера(ов) — рабочий масштаб по primary (СТРОГО), остальные — перекрёстная проверка.
                      </p>
                    )}
                  </div>

                  {/* ЯДРО v2: калибровка масштаба (strict hierarchy) + поворот кадра */}
                  {scaleSourceInfo && keyPoints && (
                    <div className="space-y-2 rounded-md border border-violet-200 dark:border-violet-900 bg-violet-50/50 dark:bg-violet-950/20 p-2.5">
                      <div className="flex items-start gap-2">
                        <div className="flex-1">
                          <p className="text-xs font-semibold text-violet-700 dark:text-violet-400">
                            Как считается масштаб
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Рабочий масштаб — по вашему primary-размеру, если он согласуется
                            с остальными введёнными размерами и радиусами колёс; при противоречии
                            — медиана согласных измерений (выброс отбрасывается с подсказкой).
                            Все проекции (Stack/Reach/ETT) считаются после авто-выравнивания кадра.
                          </p>
                        </div>
                      </div>
                      <div className="text-[10px] space-y-0.5">
                        <div className="text-violet-700 dark:text-violet-400">
                          Рабочий масштаб: <b>{scaleSourceInfo.source.startsWith("USER_OVERRIDE") ? "строго по вашему вводу (консенсус согласен)" : scaleSourceInfo.source.startsWith("CONSENSUS") ? "консенсус-медиана согласных измерений" : "по колёсной базе (fallback)"}</b>
                        </div>
                      </div>
                      {autoCalibration?.candidates && autoCalibration.candidates.length > 1 && (
                        <div className="text-[10px] font-mono space-y-0.5 border-t border-violet-200 dark:border-violet-900 pt-1.5">
                          <div className="text-muted-foreground">Перекрёстная проверка (справочно):</div>
                          {autoCalibration.candidates.map((c) => (
                            <div key={c.type} className="text-muted-foreground">
                              по {CALIB_SOURCE_HUMAN[c.type] ?? c.type}
                              {c.isPrimary ? " — рабочий" : ` — откл. ${c.deviationPct > 0 ? "+" : ""}${c.deviationPct.toFixed(1)}%`}
                            </div>
                          ))}
                        </div>
                      )}
                      {autoCalibration?.validationWarning ? (
                        <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40">
                          ⚠ {autoCalibration.validationWarning}
                        </div>
                      ) : (
                        <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/40">
                          ✓ Кандидаты согласованы (расхождение &lt;12%)
                        </div>
                      )}
                    </div>
                  )}

                  {/* ЯДРО v2: предупреждения движка (валидация разметки) */}
                  {engineWarnings.length > 0 && (
                    <div className="space-y-1.5 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/20 p-2.5">
                      <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                        Предупреждения движка ({engineWarnings.length})
                      </p>
                      <ul className="text-[10px] text-amber-700/90 dark:text-amber-400/90 space-y-1 list-disc list-inside">
                        {engineWarnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <Button
                    onClick={handleCalibrate}
                    disabled={!hasKnownValue}
                    className="w-full bg-emerald-500 hover:bg-emerald-600"
                    size="sm"
                  >
                    <Ruler className="size-4" />
                    Вычислить все параметры
                  </Button>
                  <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
                    Шаг 1: расчёт геометрии из фото по вашему primary-размеру.
                    Результат появится ниже для сверки с вашим вводом — в форму велика
                    ничего не записывается.
                  </p>
                </div>

                {/* Результаты сравнения */}
                {comparisons.length > 0 && overall && (
                  <div ref={resultsRef} className="space-y-3 scroll-mt-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">Сравнение: измерено vs вычислено</p>
                      <div className="flex gap-2 text-xs">
                        {overall.good > 0 && (
                          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                            {overall.good} ✓
                          </Badge>
                        )}
                        {overall.acceptable > 0 && (
                          <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                            {overall.acceptable} ≈
                          </Badge>
                        )}
                        {overall.poor > 0 && (
                          <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400">
                            {overall.poor} ✗
                          </Badge>
                        )}
                      </div>
                    </div>

                    {computed && (
                      <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2">
                        Масштаб по фото: {KNOWN_DIM_OPTIONS.find((o) => o.key === computed.calibratedBy)?.label}
                        {scaleSourceInfo?.source.includes("USER_OVERRIDE")
                          ? " — строго, по вашему вводу"
                          : scaleSourceInfo?.source.startsWith("CONSENSUS")
                            ? " — консенсус измерений (выбросы отброшены)"
                            : " — по колёсной базе (fallback)"}
                      </div>
                    )}

                    {/* Карточки сравнения */}
                    {/* Предупреждение если большое расхождение */}
                    {comparisons.some(c => c.discrepancyPercent != null && c.discrepancyPercent > 30) && (
                      <div className="flex items-start gap-2 rounded-lg border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
                        <AlertCircle className="size-4 mt-0.5 shrink-0" />
                        <div>
                          <p className="font-medium">Большое расхождение между измерениями и фото!</p>
                          <p className="text-xs mt-1">
                            Это нормально — ИИ неточно определяет точки на фото.
                            <b> Подвигайте точки мышкой на фото</b> выше, чтобы исправить положение.
                            При движении точек значения пересчитаются автоматически.
                          </p>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {comparisons.map((c) => {
                        const colors = MATCH_COLORS[c.match];
                        const hasMeasured = c.measured != null;
                        const hasComputed = c.computed != null;
                        return (
                          <div
                            key={c.key}
                            className={cn(
                              "rounded-lg border p-3 space-y-1.5",
                              colors.bg,
                              colors.border
                            )}
                          >
                            {/* Заголовок: имя параметра + бейдж качества */}
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold">{c.label}</span>
                              <span className={cn("text-[10px] font-medium", colors.text)}>
                                {colors.label}
                                {c.discrepancyPercent != null && ` ${c.discrepancyPercent}%`}
                              </span>
                            </div>

                            {/* Описание параметра — что это */}
                            <p className="text-[10px] text-muted-foreground/80 leading-snug">
                              {c.description}
                            </p>

                            {/* Сравнение измерено vs фото */}
                            <div className="flex items-center gap-2 text-xs">
                              <div className="flex flex-col">
                                <span className="text-[9px] text-muted-foreground uppercase tracking-wide">
                                  {hasMeasured ? "Измерено (ввод)" : "Измерено"}
                                </span>
                                <span className={cn("tabular-nums font-medium", hasMeasured ? "text-foreground" : "text-muted-foreground/50")}>
                                  {hasMeasured ? `${c.measured} мм` : "—"}
                                </span>
                              </div>
                              <ArrowRight className="size-3 text-muted-foreground shrink-0" />
                              <div className="flex flex-col">
                                <span className="text-[9px] text-muted-foreground uppercase tracking-wide">
                                  {hasComputed ? "Из фото" : "Из фото"}
                                </span>
                                <span className={cn("tabular-nums font-medium", hasComputed ? "text-foreground" : "text-muted-foreground/50")}>
                                  {hasComputed ? `${c.computed} мм` : "—"}
                                </span>
                              </div>
                              {c.delta != null && (
                                <span className={cn("tabular-nums ml-auto font-bold text-[11px]", colors.text)}>
                                  Δ {c.delta > 0 ? "+" : ""}{c.delta}
                                </span>
                              )}
                            </div>

                            {/* Типичный диапазон */}
                            {c.typicalRange && (
                              <div className="text-[10px] text-muted-foreground/70 border-t pt-1">
                                <span className="text-muted-foreground/60">Типично: </span>
                                {c.typicalRange}
                              </div>
                            )}

                            {/* Усреднённое значение */}
                            {c.averaged != null && (
                              <div className="text-[11px] text-foreground border-t pt-1">
                                <span className="text-muted-foreground">Рекомендуемое: </span>
                                <b>{c.averaged} мм</b>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Кнопка применить усреднённые */}
                    <Button
                      onClick={handleApplyAveraged}
                      disabled={!!engineResult && engineResult.physicsViolations.length > 0}
                      className="w-full bg-emerald-600 hover:bg-emerald-700"
                      size="sm"
                    >
                      <CheckCircle2 className="size-4" />
                      Записать в параметры велика
                    </Button>
                    {engineResult && engineResult.physicsViolations.length > 0 && (
                      <p className="text-[11px] text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-md px-2 py-1.5 text-center leading-snug">
                        ⛔ Запись заблокирована: сначала исправьте физические нарушения разметки (красная карточка выше)
                      </p>
                    )}
                    {appliedSummary && (
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-md px-2 py-1.5 text-center leading-snug">
                        {appliedSummary}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
                      Шаг 2: переносит в карточку велика Reach, Stack и справочную
                      геометрию (STA, HTA, FC, RC, ST, BB Drop) — она появится на
                      схеме. WB дозаполняется, только если поле пустое. Введённое
                      вручную — эталон и не перезаписывается. Сохраняется автоматически.
                    </p>
                  </div>
                )}

                {/* Переснять */}
                <div className="flex justify-center">
                  <PhotoUploader
                    onPhotoSelected={handlePhotoSelected}
                    currentPhotoUrl={photoUrl}
                    onClear={handleClear}
                  />
                </div>

                {/* Раскрывающийся подробный лог для отладки */}
                {debugLog.length > 0 && (
                  <details className="rounded-lg border border-muted-foreground/20 bg-muted/30 text-xs">
                    <summary className="cursor-pointer px-3 py-2 font-semibold select-none">
                      📋 Подробный лог калибровки ({debugLog.length} строк) — нажми, чтобы развернуть
                    </summary>
                    <div className="px-3 py-2 border-t border-muted-foreground/20">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-muted-foreground">
                          Можно скопировать и прислать разработчику
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => {
                            const text = debugLog.join("\n");
                            navigator.clipboard.writeText(text).then(() => {
                              setDebugLog((prev) => [...prev, `[скопировано в буфер]`]);
                            }).catch(() => {});
                          }}
                        >
                          Копировать лог
                        </Button>
                      </div>
                      <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground max-h-80 overflow-auto">
{debugLog.join("\n")}
                      </pre>
                    </div>
                  </details>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
