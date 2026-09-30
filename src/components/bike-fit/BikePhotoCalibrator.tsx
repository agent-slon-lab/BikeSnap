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
  type BikeKeypoints as EngineKeypoints,
  type CalibrationConfig as EngineCalibrationConfig,
  type CalibrationKey as EngineCalibrationKey,
  type BikeGeometryResult,
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

const KNOWN_DIM_OPTIONS: Array<{ key: KnownDimensionKey; label: string; unit: string; placeholder: string }> = [
  { key: "saddleHeight", label: "Высота седла (SH)", unit: "мм", placeholder: "730" },
  { key: "ett", label: "ETT (эфф. верхняя труба)", unit: "мм", placeholder: "545" },
  { key: "wheelbase", label: "WB (колёсная база)", unit: "мм", placeholder: "1000" },
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

  // Когда measured меняется (пользователь редактировал форму выше) — синхронизируем,
  // но только для тех полей, которые у нас в calibInputs пустые.
  // Заполненные пользователем в калибраторе поля не трогаем — он может их переопределять.
  useEffect(() => {
    setCalibInputs((prev) => ({
      saddleHeight: prev.saddleHeight || (measured.saddleHeight != null ? String(measured.saddleHeight) : ""),
      ett: prev.ett || (measured.ett != null ? String(measured.ett) : ""),
      wheelbase: prev.wheelbase || (measured.wheelbase != null ? String(measured.wheelbase) : ""),
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

  const runCalibration = useCallback(
    (pts: BikeKeyPoints, knownVal: number) => {
      // Логируем входные данные
      const ts = new Date().toLocaleTimeString();
      const newLog = [
        `[${ts}] runCalibration вызвана:`,
        `  knownKey = ${knownKey}`,
        `  knownValue = ${knownVal} мм`,
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

      // STRICT-иерархия масштаба: ручной ввод — приоритет, WB — только fallback
      const SUPPORTED_OVERRIDE_KEYS = new Set(["saddleHeight", "wheelbase", "ett"]);
      const wbFallbackMm = getCalibValue("wheelbase");
      const engineConfig: EngineCalibrationConfig = {
        userOverrideKey: SUPPORTED_OVERRIDE_KEYS.has(knownKey)
          ? (knownKey as EngineCalibrationKey)
          : undefined,
        userOverrideValueMm: knownVal,
        fallbackWheelbaseMm: wbFallbackMm ?? undefined,
      };
      if (!SUPPORTED_OVERRIDE_KEYS.has(knownKey)) {
        setDebugLog((prev) => [
          ...prev,
          ``,
          `  ⚠ knownKey=${knownKey} не поддерживается ядром — масштаб по fallback WB`,
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
        `  ЯДРО v2 (rotation-first, strict scale):`,
        `    Направление: ${engine.frame.facingRight ? "вправо" : "влево → зеркалено (нормализовано вправо)"}`,
        `    Наклон оси колёс: ${engine.anglesDeg.frameTilt.toFixed(2)}° — ПОВОРОТ применён ДО всех расчётов`,
        `    МАСШТАБ: ${engine.scaleMmPerPx.toFixed(4)} мм/пикс`,
        `    Источник масштаба: ${engine.scaleSource}`,
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
        `    SH (BB→седло) = ${params.saddleHeight ?? "null"} мм`,
        `    ETT (пересечение горизонали HT с осью ST) = ${params.ett ?? "null"} мм`,
        `    ETT прямой (горизонталь ST→HT) = ${params.ettDirect ?? "null"} мм`,
        `    Reach (горизонталь BB→HT) = ${params.reach ?? "null"} мм`,
        `    Stack (вертикаль BB→HT) = ${params.stack ?? "null"} мм`,
        `    WB (rear→front ось) = ${params.wheelbase ?? "null"} мм`,
        `    Setback (⊥ к оси подседельной) = ${params.setback ?? "null"} мм`,
        `    BB Drop (вертикаль BB→ось колеса) = ${params.bbDrop ?? "null"} мм`,
        `    ST (BB→верх ST) = ${params.seatTubeLength ?? "null"} мм`,
        `    RC (BB→задняя ось) = ${params.rearCenter ?? "null"} мм`,
        `    FC (BB→передняя ось) = ${params.frontCenter ?? "null"} мм`,
        `    HT length (HTверх→HTниз) = ${params.headTubeLength ?? "null"} мм`,
        `    Fork length (HTниз→передняя ось) = ${params.forkLength ?? "null"} мм`,
        `    Fork offset = ${params.forkOffset ?? "null"} мм`,
        `    Stack/Reach = ${params.stackReachRatio ?? "null"}`,
        `    STA = ${params.sta ?? "null"}° (угол подседельной трубы)`,
        `    HTA = ${params.hta ?? "null"}° (угол рулевой трубы)`,
        ``,
        `  Предупреждения движка (${engine.warnings.length}):`,
        ...(engine.warnings.length > 0
          ? engine.warnings.map((w) => `    ⚠ ${w}`)
          : [`    ✓ нет`]),
        ``,
        `  Проверки (что физически возможно):`,
        ...buildValidationChecks(params),
      ]);

      const cmp = compareMeasuredVsComputed(measured, params);
      setComparisons(cmp);

      // === DUAL SCALE (компенсация перспективы по двум колёсам) ===
      // WH берём из ввода; если не введён — фолбэк на радиус из типоразмера
      // колеса (wheelSizeId из стора, напр. 26" → 334 мм). Это позволяет
      // dual scale работать сразу после разметки верхов колёс, без ручного WH.
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
        photoDistorted
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
    [knownKey, measured, getCalibValue, imgSize, bikeType]
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
            `Возможно saddleMount стоит на верхней кромке штыря, а не на хомуте крепления седла.`
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
        // Полный порядок размещения: 8 обязательных + 2 опциональные (верх колёс для dual scale)
        const order: Array<keyof BikeKeyPoints> = [
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
        const currentIdx = order.indexOf(placementPointKey);
        let next: keyof BikeKeyPoints | null = null;
        for (let i = currentIdx + 1; i < order.length; i++) {
          const k = order[i];
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
    }
    onAveraged(averaged);
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
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {([
                    { key: "bb", label: "BB (каретка)", color: "#ef4444", hint: "Центр вала между шатунами", optional: false },
                    { key: "stTop", label: "Верх ST", color: "#f97316", hint: "Где штырь входит в раму (хомут)", optional: false },
                    { key: "saddleMount", label: "Крепление седла", color: "#eab308", hint: "Хомут седла к штырю (не нос!)", optional: false },
                    { key: "htTop", label: "Верх HT", color: "#22c55e", hint: "Верх стакана рамы (где вынос крепится к трубе)", optional: false },
                    { key: "htBottom", label: "Низ HT", color: "#3b82f6", hint: "Низ стакана = корона вилки (стык вилки с рамой)", optional: false },
                    { key: "htTopCap", label: "Top cap", color: "#10b981", hint: "Верхняя крышка рулевой с болтом (для посадки)", optional: false },
                    { key: "rearAxle", label: "Задняя ось", color: "#a855f7", hint: "Центр оси заднего колеса", optional: false },
                    { key: "frontAxle", label: "Передняя ось", color: "#ec4899", hint: "Центр оси переднего колеса", optional: false },
                    { key: "rearWheelTop", label: "Верх зад. колеса", color: "#7c3aed", hint: "ОПЦИОНАЛЬНО: верх покрышки заднего колеса (для dual scale)", optional: true },
                    { key: "frontWheelTop", label: "Верх пер. колеса", color: "#be185d", hint: "ОПЦИОНАЛЬНО: верх покрышки переднего колеса (для dual scale)", optional: true },
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
                        <span className="flex-1 truncate">{label}</span>
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
                    <div className="text-[11px] font-mono text-rose-600/80 dark:text-rose-400/70 border-t border-rose-200/50 dark:border-rose-900/50 pt-1 mt-1">
                      <div>Обязательные точки ядра (7): rearAxle, frontAxle, bb, stTop, saddleMount, htBottom, htTop</div>
                      <div>Отсутствуют: <b>{pointsMissing.join(", ")}</b></div>
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

            {/* Результат определения точек */}
            {keyPoints && (
              <div className="space-y-4">
                {pointsMissing.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                    <AlertCircle className="size-4 mt-0.5 shrink-0" />
                    <span>
                      Не удалось определить точки: {pointsMissing.join(", ")}
                    </span>
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
                        <div className="text-[11px] font-mono text-muted-foreground mt-1 space-y-0.5">
                          <div>scaleFront = <b>{dualScale.scaleFront.toFixed(2)}</b> мм/пикс (по переднему колесу)</div>
                          <div>scaleRear = <b>{dualScale.scaleRear.toFixed(2)}</b> мм/пикс (по заднему колесу)</div>
                          <div>Перспектива: <b>{(dualScale.perspectiveSeverity * 100).toFixed(1)}%</b> (0%=нет, &gt;15%=сильно)</div>
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
                            <span className="text-xs font-bold uppercase tracking-wide">
                              {String(s.pointKey)}
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
                          <p className="text-[10px] text-muted-foreground/60 font-mono">
                            текущее: ({s.current.x?.toFixed(3) ?? "—"}, {s.current.y?.toFixed(3) ?? "—"})
                            → цель: ({s.suggested.x.toFixed(3)}, {s.suggested.y.toFixed(3)})
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
                                  ? "border-emerald-400 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/20"
                                  : "border-input"
                              )}
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">
                              {opt.unit}
                            </span>
                          </div>
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
                            Калибровка масштаба (ядро v2 — rotation-first)
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Рабочий масштаб считается СТРОГО по выбранному вами primary-параметру.
                            Все проекции (Stack/Reach/ETT) считаются после поворота кадра по оси колёс.
                          </p>
                        </div>
                      </div>
                      <div className="text-[10px] font-mono space-y-0.5">
                        <div className="text-violet-700 dark:text-violet-400">
                          Масштаб: <b>{scaleSourceInfo.scaleMmPerPx.toFixed(4)} мм/пикс</b>
                        </div>
                        <div className="text-muted-foreground">Источник: {scaleSourceInfo.source}</div>
                        <div className="text-muted-foreground">
                          Поворот кадра: {scaleSourceInfo.tiltDeg.toFixed(2)}° (применён до расчётов)
                          {" · "}{scaleSourceInfo.facingRight ? "смотрит вправо" : "смотрит влево → нормализовано"}
                        </div>
                      </div>
                      {autoCalibration?.candidates && autoCalibration.candidates.length > 1 && (
                        <div className="text-[10px] font-mono space-y-0.5 border-t border-violet-200 dark:border-violet-900 pt-1.5">
                          <div className="text-muted-foreground">Перекрёстная проверка (справочно):</div>
                          {autoCalibration.candidates.map((c) => (
                            <div key={c.type} className="text-muted-foreground">
                              {c.type}: {c.scale.toFixed(4)} мм/пикс
                              {c.isPrimary ? "  [база]" : `  (откл. ${c.deviationPct > 0 ? "+" : ""}${c.deviationPct.toFixed(1)}%)`}
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
                  <div className="space-y-3">
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
                        Масштаб: {computed.scale.toFixed(3)} мм/пикс ·
                        Калибровка по: {KNOWN_DIM_OPTIONS.find((o) => o.key === computed.calibratedBy)?.label}
                        {scaleSourceInfo?.source.includes("USER_OVERRIDE") ? " (СТРОГО, ручной ввод)" : " (fallback WB)"}
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
                      className="w-full bg-emerald-600 hover:bg-emerald-700"
                      size="sm"
                    >
                      <CheckCircle2 className="size-4" />
                      Записать в параметры велика
                    </Button>
                    <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
                      Шаг 2: переносит Reach и Stack (в форме не вводятся) в карточку
                      велика; WB дозаполняется, только если поле пустое. Введённое
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
