"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Move } from "lucide-react";
import type { BikeKeyPoints, NullablePoint, PixelPoint } from "@/lib/bike-photo-scale";
import { pointFullLabel } from "@/lib/point-labels";

interface InteractivePhotoProps {
  photoUrl: string;
  keyPoints: BikeKeyPoints | null;
  onPointsChange: (points: BikeKeyPoints) => void;
  loading?: boolean;
  /** Режим ручной разметки: клик по фото размещает выбранную точку */
  placementMode?: boolean;
  /** Какую точку размещать в режиме placementMode */
  placementPointKey?: keyof BikeKeyPoints | null;
}

// Названия, цвета и подробные подсказки для точек.
// Подсказка показывает куда именно ставить точку — это критично,
// потому что HT верх/низ часто путают с короной вилки или выносом.
const POINT_CONFIG: Array<{
  key: keyof BikeKeyPoints;
  label: string;
  color: string;
  hint: string;
  antiHint?: string;
  optional?: boolean;
}> = [
  {
    key: "bb",
    label: "Каретка",
    color: "#ef4444",
    hint: "Центр каретки — точка, где ось шатунов проходит через раму. Видно как центр вала между шатунами.",
    antiHint: "Не ставь на шатун или педаль — именно на ось в раме.",
  },
  {
    key: "stTop",
    label: "Верх подседельной трубы",
    color: "#f97316",
    hint: "Верх подседельной трубы РАМЫ — где подседельный штырь входит в трубу. Обычно там зажимной хомут (QR или болт).",
    antiHint: "Не путай с штырём или седлом — точка на стыке штыря и рамы.",
  },
  {
    key: "saddleMount",
    label: "Верх седла с подседелом",
    color: "#eab308",
    hint: "Верх седла РОВНО НАД линией подседельного штыря — точка, где линия трубы/штыря пересекает верх седла. Высота седла (SH) меряется от центра каретки до этой точки ВДОЛЬ трубы.",
    antiHint: "Не нос и не зад седла (у сёдел разная толщина набивки — мерять по ним нельзя) и не кромка штыря — именно верх седла над штырём.",
  },
  {
    key: "htTop",
    label: "Верх рулевого стакана",
    color: "#22c55e",
    hint: "ВЕРХ СТАКАНА РАМЫ — верхний торец самой рулевой трубы рамы, её верхняя кромка. Stack и Reach считаются именно до этой точки. Точка на торце трубы, где она заканчивается.",
    antiHint: "НЕ ставь на руль, тормозную ручку, крышку рулевой или вынос — они выше трубы. Именно верхний торец рулевой трубы самой рамы.",
  },
  {
    key: "htBottom",
    label: "Низ рулевого стакана",
    color: "#3b82f6",
    hint: "НИЗ стакана РАМЫ = КОРОНА ВИЛКИ. Это стык: рулевая труба рамы → нижний подшипник → корона вилки. На фото сбоку — точка стыка короны вилки с низом стакана рамы.",
    antiHint: "Не опускай точку на перья вилки или на ось — только на стык короны вилки с рамой.",
  },
  {
    key: "htTopCap",
    label: "Крышка рулевой",
    color: "#10b981",
    hint: "TOP CAP — верхняя крышка рулевой колонки с болтом star-nut. Это самая верхняя точка рулевой трубы (над выносом). Нужна для расчёта посадки райдера — определяет, куда водитель тянется к рулю.",
    antiHint: "Это отдельная точка от HT верх. HT верх — верхний торец рулевой трубы рамы (ниже), а top cap — выше, на самой верхней кромке крышки с болтом.",
  },
  {
    key: "rearAxle",
    label: "Ось заднего колеса",
    color: "#a855f7",
    hint: "Центр оси заднего колеса — точно по центру втулки. Если ось/сквозная — точка на видимой торцевой гайке.",
  },
  {
    key: "frontAxle",
    label: "Ось переднего колеса",
    color: "#ec4899",
    hint: "Центр оси переднего колеса — точно по центру втулки. Если ось/сквозная — точка на видимой торцевой гайке.",
  },
  {
    key: "rearWheelTop",
    label: "Верх заднего колеса",
    color: "#7c3aed",
    hint: "ОПЦИОНАЛЬНО: видимая верхняя точка покрышки заднего колеса — самая верхняя кромка резины над осью. Нужна для dual scale (компенсация перспективы по двум колёсам).",
    antiHint: "Не ставь на седло или раму — только на верх покрышки.",
    optional: true,
  },
  {
    key: "frontWheelTop",
    label: "Верх переднего колеса",
    color: "#be185d",
    hint: "ОПЦИОНАЛЬНО: видимая верхняя точка покрышки переднего колеса — самая верхняя кромка резины над осью. Нужна для dual scale.",
    antiHint: "Не ставь на тормозной диск или крыло — только на верх покрышки.",
    optional: true,
  },
];

export function InteractivePhoto({
  photoUrl,
  keyPoints,
  onPointsChange,
  loading = false,
  placementMode = false,
  placementPointKey = null,
}: InteractivePhotoProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [draggingKey, setDraggingKey] = useState<keyof BikeKeyPoints | null>(
    null
  );
  const [showLabels, setShowLabels] = useState(true);
  // Позиция курсора в SVG-координатах (для лупы)
  const [cursorSvg, setCursorSvg] = useState<{ x: number; y: number } | null>(null);

  // Загрузка реальных размеров изображения
  useEffect(() => {
    if (!photoUrl) {
      setImgSize({ w: 0, h: 0 });
      return;
    }
    const img = new Image();
    img.onload = () => {
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => setImgSize({ w: 0, h: 0 });
    img.src = photoUrl;
  }, [photoUrl]);

  // Конвертировать [0..1] нормализованные → SVG-координаты (натуральные пиксели)
  const toSvg = useCallback(
    (pt: NullablePoint): { x: number; y: number } => {
      return {
        x: (pt.x ?? 0) * imgSize.w,
        y: (pt.y ?? 0) * imgSize.h,
      };
    },
    [imgSize]
  );

  // Конвертировать экран (clientX/Y) → SVG-координаты через getScreenCTM
  const screenToSvg = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const svg = svgRef.current;
      if (!svg || imgSize.w === 0) return { x: 0, y: 0 };
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const transformed = pt.matrixTransform(ctm.inverse());
      return { x: transformed.x, y: transformed.y };
    },
    [imgSize]
  );

  // Конвертировать экран → [0..1] нормализованные
  const toNormalized = useCallback(
    (clientX: number, clientY: number): PixelPoint => {
      const svgP = screenToSvg(clientX, clientY);
      return {
        x: imgSize.w > 0 ? Math.max(0, Math.min(1, svgP.x / imgSize.w)) : 0.5,
        y: imgSize.h > 0 ? Math.max(0, Math.min(1, svgP.y / imgSize.h)) : 0.5,
      };
    },
    [screenToSvg, imgSize]
  );

  // Начало перетаскивания
  const handlePointerDown = useCallback(
    (e: React.PointerEvent, key: keyof BikeKeyPoints) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      setDraggingKey(key);
    },
    []
  );

  // Перетаскивание
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Обновляем позицию курсора для лупы (всегда, даже если не драгаем)
      const svgP = screenToSvg(e.clientX, e.clientY);
      setCursorSvg(svgP);

      if (!draggingKey || !keyPoints) return;
      e.preventDefault();
      const newPt = toNormalized(e.clientX, e.clientY);
      const newPoints = { ...keyPoints, [draggingKey]: newPt };
      onPointsChange(newPoints);
    },
    [draggingKey, keyPoints, toNormalized, onPointsChange, screenToSvg]
  );

  // Конец перетаскивания
  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (draggingKey) {
        try {
          (e.target as Element).releasePointerCapture(e.pointerId);
        } catch {}
      }
      setDraggingKey(null);
      setCursorSvg(null);
    },
    [draggingKey]
  );

  // Клик по фото — если в режиме разметки, размещаем выбранную точку (с snap к рёбрам)
  const handleSvgPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!placementMode || !placementPointKey) return;
      if (!keyPoints) return;
      e.preventDefault();
      const pt = toNormalized(e.clientX, e.clientY);
      onPointsChange({ ...keyPoints, [placementPointKey]: pt });
    },
    [placementMode, placementPointKey, keyPoints, toNormalized, onPointsChange]
  );

  const hasImage = imgSize.w > 0 && imgSize.h > 0;

  // Радиус точки в единицах viewBox (натуральные пиксели)
  // Чтобы кружок был ~44px на экране при любом масштабе:
  // Берём ~2.2% от ширины изображения (минимум 12, максимум 40 px в SVG-юнитах)
  const pointRadius = hasImage
    ? Math.max(12, Math.min(40, imgSize.w * 0.022))
    : 18;
  const strokeWidth = Math.max(2, pointRadius * 0.3);
  const lineStrokeWidth = Math.max(2, pointRadius * 0.25);
  const fontSize = Math.max(10, pointRadius * 0.8);

  return (
    <div className="space-y-2">
      {/* Подсказка с описанием текущей точки в режиме разметки */}
      {placementMode && placementPointKey && (() => {
        const cfg = POINT_CONFIG.find((p) => p.key === placementPointKey);
        if (!cfg) return null;
        const stepIdx = POINT_CONFIG.findIndex((p) => p.key === placementPointKey) + 1;
        return (
          <div
            className="rounded-lg border-l-4 p-3 space-y-1.5 bg-white dark:bg-background shadow-sm"
            style={{ borderColor: cfg.color }}
          >
            <div className="flex items-center gap-2">
              <span
                className="size-3 rounded-full border-2 shrink-0"
                style={{
                  borderColor: cfg.color,
                  background: cfg.color,
                }}
              />
              <span className="text-sm font-bold">
                {stepIdx}/{POINT_CONFIG.length}. {pointFullLabel(cfg.key)}
              </span>
            </div>
            <p className="text-xs text-foreground leading-relaxed">{cfg.hint}</p>
            {cfg.antiHint && (
              <p className="text-[11px] text-rose-600 dark:text-rose-400 leading-relaxed">
                ⚠ {cfg.antiHint}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Кликни по фото, чтобы поставить точку
            </p>
          </div>
        );
      })()}

      <div
        className="relative w-full overflow-hidden rounded-xl border bg-black"
        style={{ touchAction: "none" }}
      >
        {hasImage ? (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
            preserveAspectRatio="xMidYMid meet"
            className="block w-full h-auto"
            style={{
              maxHeight: "70vh",
              touchAction: "none",
              cursor: placementMode ? "crosshair" : "default",
            }}
            onPointerDown={handleSvgPointerDown}
          >
            {/* Сама картинка внутри SVG — гарантированно совпадает с координатами */}
            <image
              href={photoUrl}
              x={0}
              y={0}
              width={imgSize.w}
              height={imgSize.h}
              preserveAspectRatio="xMidYMid meet"
            />

            {/* Линии между BB и каждой точкой */}
            {keyPoints &&
              POINT_CONFIG.map(({ key, color }) => {
                if (key === "bb") return null;
                const pt = keyPoints[key];
                if (!pt || pt.x == null || pt.y == null) return null;
                const bb = keyPoints.bb;
                if (!bb || bb.x == null || bb.y == null) return null;
                const p1 = toSvg(bb);
                const p2 = toSvg(pt);
                return (
                  <line
                    key={`line-${key}`}
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke={color}
                    strokeWidth={lineStrokeWidth}
                    strokeDasharray={`${lineStrokeWidth * 2.5} ${
                      lineStrokeWidth * 2
                    }`}
                    opacity={0.7}
                    strokeLinecap="round"
                  />
                );
              })}

            {/* Линия колёсной базы rear → front */}
            {keyPoints &&
              keyPoints.rearAxle &&
              keyPoints.frontAxle &&
              keyPoints.rearAxle.x != null &&
              keyPoints.frontAxle.x != null &&
              (() => {
                const r = toSvg(keyPoints.rearAxle);
                const f = toSvg(keyPoints.frontAxle);
                return (
                  <line
                    x1={r.x}
                    y1={r.y}
                    x2={f.x}
                    y2={f.y}
                    stroke="#06b6d4"
                    strokeWidth={lineStrokeWidth}
                    strokeDasharray={`${lineStrokeWidth * 2.5} ${
                      lineStrokeWidth * 2
                    }`}
                    opacity={0.6}
                    strokeLinecap="round"
                  />
                );
              })()}

            {/* Точки (кружки) + подписи */}
            {keyPoints &&
              POINT_CONFIG.map(({ key, label, color, hint, antiHint }) => {
                const pt = keyPoints[key];
                if (!pt || pt.x == null || pt.y == null) return null;
                const p = toSvg(pt);
                const isDragging = draggingKey === key;
                const isPlacementTarget =
                  placementMode && placementPointKey === key;
                return (
                  <g
                    key={`pt-${key}`}
                    style={{
                      cursor: isDragging
                        ? "grabbing"
                        : placementMode
                        ? "default"
                        : "grab",
                      pointerEvents: placementMode ? "none" : "all",
                    }}
                    onPointerDown={(e) => handlePointerDown(e, key)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                  >
                    {/* Нативный tooltip при наведении (полное название + описание точки) */}
                    <title>{`${pointFullLabel(key)}\n\n${hint}${antiHint ? "\n\n⚠ " + antiHint : ""}`}</title>
                    {/* Пульсирующее кольцо для активной точки в режиме разметки */}
                    {isPlacementTarget && (
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={pointRadius * 1.5}
                        fill="none"
                        stroke={color}
                        strokeWidth={strokeWidth * 0.8}
                        opacity={0.6}
                      >
                        <animate
                          attributeName="r"
                          values={`${pointRadius * 1.3};${pointRadius * 1.8};${pointRadius * 1.3}`}
                          dur="1.5s"
                          repeatCount="indefinite"
                        />
                        <animate
                          attributeName="opacity"
                          values="0.6;0.2;0.6"
                          dur="1.5s"
                          repeatCount="indefinite"
                        />
                      </circle>
                    )}
                    {/* Внешний ореол для видимости на тёмном фоне */}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={pointRadius + 4}
                      fill="rgba(0,0,0,0.25)"
                    />
                    {/* Белый кружок с цветным ободком */}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={pointRadius}
                      fill="rgba(255,255,255,0.95)"
                      stroke={color}
                      strokeWidth={strokeWidth}
                    />
                    {/* Внутренняя точка для точности */}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={strokeWidth * 0.6}
                      fill={color}
                    />
                    {/* Подпись */}
                    {showLabels && (
                      <g pointerEvents="none">
                        <text
                          x={p.x}
                          y={p.y + pointRadius + fontSize + 2}
                          textAnchor="middle"
                          fontSize={fontSize}
                          fontWeight="bold"
                          fill={color}
                          stroke="black"
                          strokeWidth={fontSize * 0.18}
                          paintOrder="stroke"
                        >
                          {label}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

            {/* ===== ЛУПА (Magnifier) =====
                Показывается при перетаскивании точки.
                Радиус лупы — 6% от ширины фото (видимая область ~12% от ширины).
                Зум 2.5x: показываем уменьшенную копию фото в 2.5x масштабе,
                обрезанную по кругу.
            */}
            {draggingKey && cursorSvg && hasImage && (() => {
              const magRadius = Math.max(50, imgSize.w * 0.06);
              const zoom = 2.5;
              // Лупа справа-сверху от курсора, не выходя за пределы фото
              const offsetX = magRadius * 1.3;
              const offsetY = -magRadius * 1.3;
              let magCx = cursorSvg.x + offsetX;
              let magCy = cursorSvg.y + offsetY;
              // Если вылезает за правый край — слева от курсора
              if (magCx + magRadius > imgSize.w) magCx = cursorSvg.x - offsetX;
              // Если вылезает за верхний край — снизу от курсора
              if (magCy - magRadius < 0) magCy = cursorSvg.y - offsetY;

              return (
                <g pointerEvents="none">
                  {/* Тень под лупой */}
                  <circle
                    cx={magCx}
                    cy={magCy}
                    r={magRadius + 4}
                    fill="rgba(0,0,0,0.4)"
                  />
                  {/* Белый фон */}
                  <circle
                    cx={magCx}
                    cy={magCy}
                    r={magRadius + 2}
                    fill="white"
                  />
                  {/* Картинка в круге (zoom 2.5x) */}
                  <clipPath id="mag-clip">
                    <circle cx={magCx} cy={magCy} r={magRadius} />
                  </clipPath>
                  <g clipPath="url(#mag-clip)">
                    <image
                      href={photoUrl}
                      x={magCx - cursorSvg.x * zoom}
                      y={magCy - cursorSvg.y * zoom}
                      width={imgSize.w * zoom}
                      height={imgSize.h * zoom}
                      preserveAspectRatio="xMidYMid meet"
                    />
                  </g>
                  {/* Ободок лупы */}
                  <circle
                    cx={magCx}
                    cy={magCy}
                    r={magRadius}
                    fill="none"
                    stroke="#0ea5e9"
                    strokeWidth={Math.max(2, magRadius * 0.05)}
                  />
                  {/* Перекрестие в центре лупы */}
                  <line
                    x1={magCx - 10}
                    y1={magCy}
                    x2={magCx + 10}
                    y2={magCy}
                    stroke="#ef4444"
                    strokeWidth={2}
                  />
                  <line
                    x1={magCx}
                    y1={magCy - 10}
                    x2={magCx}
                    y2={magCy + 10}
                    stroke="#ef4444"
                    strokeWidth={2}
                  />
                  <circle
                    cx={magCx}
                    cy={magCy}
                    r={2}
                    fill="#ef4444"
                  />
                </g>
              );
            })()}
          </svg>
        ) : (
          // Скелетон пока размеры не загрузились
          <div className="flex aspect-[3/2] w-full items-center justify-center">
            <img
              ref={imgRef}
              src={photoUrl}
              alt="Фото велосипеда"
              className="hidden"
              onLoad={(e) => {
                const t = e.currentTarget;
                setImgSize({ w: t.naturalWidth, h: t.naturalHeight });
              }}
            />
            <Loader2 className="size-8 animate-spin text-emerald-400" />
          </div>
        )}

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3 text-white">
              <Loader2 className="size-10 animate-spin text-emerald-400" />
              <p className="text-sm font-medium">Определяю ключевые точки...</p>
            </div>
          </div>
        )}
      </div>

      {/* Подсказка + переключатели */}
      {keyPoints && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Move className="size-3" />
            Тяните точки мышкой — показывается лупа 2.5× для точности
          </p>
          <button
            onClick={() => setShowLabels(!showLabels)}
            className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline shrink-0"
          >
            {showLabels ? "Скрыть подписи" : "Показать подписи"}
          </button>
        </div>
      )}
    </div>
  );
}
