"use client";

/**
 * ИНТЕРАКТИВНОЕ ФОТО ВЕЛИКА (v3.1.0 — лупа с просветом, v1.14.16)
 * ===========================================================================
 * Разметка ключевых точек велосипеда на фото. v3.0.0 (v1.14.15) — переработка
 * взаимодействия: зум щипком, экранно-постоянные размеры, двухфазная установка.
 *
 * v3.1.0 (v1.14.16) — фикс по обратной связи: «лупа/зум в принципе хорошо,
 * но её надо сместить — я нажимаю на точку, и в этой же точке центр лупы».
 *   • Просвет: нижний край лупы теперь на LOUPE_GAP_SCREEN = 76 экранных px
 *     ВЫШЕ точки касания (в v3.0.0 было 0.45·R ≈ 25–38 px — подушечка пальца
 *     перекрывала круг). Центр лупы = R + 76 px над пальцем.
 *   • У верхнего края фото лупа переворачивается ПОД палец с тем же просветом.
 *   • Направляющая линия от перекрестия лупы к точке касания — видно связь.
 *   • Фикс декора: ободок/тень/перекрестие лупы считались через px() (делит
 *     на view.scale — для элементов внутри зум-группы), а лупа снаружи → при
 *     зуме 8× ободок становился волосным. Теперь loupePx() без view.scale.
 *
 * Что изменилось (все размеры теперь в ЭКРАННЫХ пикселях, а не в пикселях
 * исходного фото — на телефоне кружки из старой версии были ~9 px):
 *   1. ЗУМ: щипок двумя пальцами (1×..8×), панорама одним пальцем по пустому
 *      месту при зуме, колесо мыши на десктопе, кнопки +/−/сброс.
 *   2. ЛУПА: фиксированный экран размер (до 84 px радиус), зум 2.5× ПОВЕРХ
 *      текущего вида, и главное — висит НАД ПАЛЬЦЕМ (под ним только если
 *      упёрлись в верхний край), палец её не перекрывает.
 *   3. УСТАНОВКА ТОЧКИ двухфазная: прижал палец → виден призрак-перекрестие
 *      и лупа над пальцем → подвёл → отпустил → точка встала. Тап мышью
 *      работает так же (down+up мгновенно).
 *   4. Точки: видимый кружок 26 px, хит-зона ≥48 px, подписи 11 px —
 *      одинаково на телефоне и десктопе при любом разрешении фото.
 *
 * Координатная модель: viewBox SVG = натуральные пиксели фото. Пан/зум —
 * transform-группа (view.x/y/scale). Экранные размеры конвертируются в
 * единицы viewBox через getScreenCTM().a (учитывает letterbox от maxHeight).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Move, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import type { BikeKeyPoints, PixelPoint } from "@/lib/bike-photo-scale";
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
    hint: "ВЕРХ СТАКАНА РАМЫ — верхний торец самой рулевой трубы рамы, её верхняя кромка. Нужен для HTA, длины рулевой и ETT. Stack и Reach считаются НЕ до этой точки — они идут до крышки рулевой (топкапа).",
    antiHint: "НЕ ставь на руль, тормозную ручку, крышку рулевой или вынос — они выше трубы. Для Stack/Reach есть отдельная точка «Крышка рулевой» — эта точка только торец трубы рамы.",
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
    hint: "TOP CAP — верхняя крышка рулевой колонки с болтом star-nut. Самая верхняя точка рулевой (над выносом). ИМЕННО ДО ЭТОЙ ТОЧКИ считаются Stack и Reach — опорная точка посадки: куда райдер тянется к рулю.",
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

/** Границы зума: 1× (весь кадр) .. 8× (детали втулки). */
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

/** Просвет между точкой касания и НИЖНИМ краем лупы (экранные px).
 *  Подушечка пальца при нажатии ~30 px, плюс запас — палец не достаёт до круга. */
const LOUPE_GAP_SCREEN = 76;

interface ViewState {
  x: number;
  y: number;
  scale: number;
}

export function InteractivePhoto({
  photoUrl,
  keyPoints,
  onPointsChange,
  loading = false,
  placementMode = false,
  placementPointKey = null,
}: InteractivePhotoProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [containerW, setContainerW] = useState(0);
  // Версия рендера — триггер пересчёта pxPerUnit при ресайзе контейнера
  const [renderTick, setRenderTick] = useState(0);
  const [draggingKey, setDraggingKey] = useState<keyof BikeKeyPoints | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, scale: 1 });
  // Позиция курсора/пальца в координатах viewBox (для лупы)
  const [cursorVb, setCursorVb] = useState<{ x: number; y: number } | null>(null);
  // Призрак точки при двухфазной установке (placementMode): позиция в image-координатах
  const [aimImg, setAimImg] = useState<PixelPoint | null>(null);

  // ===== refs-зеркала для обработчиков жестов (свежие значения без ре-мемоизации) =====
  const viewRef = useRef(view);
  viewRef.current = view;
  const keyPointsRef = useRef(keyPoints);
  keyPointsRef.current = keyPoints;
  const placementRef = useRef({ mode: placementMode, key: placementPointKey });
  placementRef.current = { mode: placementMode, key: placementPointKey };
  const imgSizeRef = useRef(imgSize);
  imgSizeRef.current = imgSize;

  // Активные указатели (для щипка)
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  // Состояние жеста одним пальцем
  const dragRef = useRef<{ key: keyof BikeKeyPoints } | null>(null);
  const aimRef = useRef<{ key: keyof BikeKeyPoints } | null>(null);
  const panRef = useRef<{ last: { x: number; y: number } } | null>(null);
  // Состояние щипка
  const pinchRef = useRef<{
    startDist: number;
    startScale: number;
    midImg: { x: number; y: number };
  } | null>(null);

  // Загрузка реальных размеров изображения
  useEffect(() => {
    if (!photoUrl) {
      setImgSize({ w: 0, h: 0 });
      setView({ x: 0, y: 0, scale: 1 });
      return;
    }
    const img = new Image();
    img.onload = () => {
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
      setView({ x: 0, y: 0, scale: 1 });
    };
    img.onerror = () => setImgSize({ w: 0, h: 0 });
    img.src = photoUrl;
  }, [photoUrl]);

  // Ресайз контейнера → пересчёт экранных масштабов
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setContainerW(w);
      setRenderTick((t) => t + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Экран → координаты viewBox SVG (с учётом letterbox от maxHeight). */
  const screenToVb = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg || imgSizeRef.current.w === 0) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const t = pt.matrixTransform(ctm.inverse());
    return { x: t.x, y: t.y };
  }, []);

  /** Экран → image-координаты (прошедшие через пан/зум). */
  const screenToImg = useCallback(
    (clientX: number, clientY: number) => {
      const vb = screenToVb(clientX, clientY);
      const v = viewRef.current;
      return {
        x: (vb.x - v.x) / v.scale,
        y: (vb.y - v.y) / v.scale,
      };
    },
    [screenToVb]
  );

  /** image → viewBox-координаты (куда ставить маркер внутри zoom-группы). */
  const imgToVb = useCallback((img: { x: number; y: number }) => {
    const v = viewRef.current;
    return { x: img.x * v.scale + v.x, y: img.y * v.scale + v.y };
  }, []);

  /** Удержать пан в границах: при scale ≥ 1 картинка не отрывается от краёв. */
  const clampView = useCallback((v: ViewState): ViewState => {
    const { w, h } = imgSizeRef.current;
    if (!w || !h) return v;
    const minX = w * (1 - v.scale);
    const minY = h * (1 - v.scale);
    return {
      ...v,
      x: Math.min(0, Math.max(minX, v.x)),
      y: Math.min(0, Math.max(minY, v.y)),
    };
  }, []);

  /** Экранный масштаб: сколько экранных пикселей в 1 единице viewBox. */
  const pxPerUnit = useMemo(() => {
    void renderTick;
    const ctm = svgRef.current?.getScreenCTM();
    if (ctm && ctm.a > 0 && Number.isFinite(ctm.a)) return ctm.a;
    if (containerW > 0 && imgSize.w > 0) return containerW / imgSize.w;
    return 0;
  }, [renderTick, containerW, imgSize.w]);

  /** Сколько экранных пикселей в 1 пикселе ИЗОБРАЖЕНИЯ (с зумом). */
  const screenScale = pxPerUnit > 0 ? pxPerUnit * view.scale : 0;

  /** image px → экранные px → image-единицы: круг радиуса screenPx. */
  const px = useCallback(
    (screenPx: number) => (screenScale > 0 ? screenPx / screenScale : screenPx * 0.02),
    [screenScale]
  );

  /** Зум к точке экрана (щипок/колесо/кнопки). */
  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const v0 = viewRef.current;
      const s1 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v0.scale * factor));
      if (s1 === v0.scale) return;
      const vb = screenToVb(clientX, clientY);
      const img = { x: (vb.x - v0.x) / v0.scale, y: (vb.y - v0.y) / v0.scale };
      setView(clampView({ x: vb.x - img.x * s1, y: vb.y - img.y * s1, scale: s1 }));
    },
    [screenToVb, clampView]
  );

  // Колесо мыши — нативный слушатель (React onWheel пассивен, preventDefault не работал бы)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (imgSizeRef.current.w === 0) return;
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.18 : 1 / 1.18);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // ===== указатели =====

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (imgSizeRef.current.w === 0) return;
      const { mode, key } = placementRef.current;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        svgRef.current?.setPointerCapture(e.pointerId);
      } catch {}

      // Второй палец — щипок: глушим aim/pan/drag
      if (pointersRef.current.size === 2) {
        const pts = [...pointersRef.current.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        pinchRef.current = {
          startDist: Math.max(1, dist),
          startScale: viewRef.current.scale,
          midImg: screenToImg(mid.x, mid.y),
        };
        dragRef.current = null;
        setDraggingKey(null);
        aimRef.current = null;
        setAimImg(null);
        panRef.current = null;
        setCursorVb(null);
        return;
      }

      if (mode && key) {
        // Двухфазная установка: прижал → прицеливаешься → отпустил
        aimRef.current = { key };
        setAimImg(screenToImg(e.clientX, e.clientY));
        setCursorVb(screenToVb(e.clientX, e.clientY));
        return;
      }

      // Панорама пустого места при зуме (drag точек перехватывается на <g>)
      if (viewRef.current.scale > 1) {
        panRef.current = { last: screenToVb(e.clientX, e.clientY) };
      }
    },
    [screenToImg, screenToVb]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (imgSizeRef.current.w === 0) return;
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      // Щипок
      if (pinchRef.current && pointersRef.current.size >= 2) {
        const pts = [...pointersRef.current.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        const p = pinchRef.current;
        const s1 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, p.startScale * (dist / p.startDist)));
        const vbMid = screenToVb(mid.x, mid.y);
        setView(
          clampView({ x: vbMid.x - p.midImg.x * s1, y: vbMid.y - p.midImg.y * s1, scale: s1 })
        );
        return;
      }

      // Драг существующей точки
      if (dragRef.current && keyPointsRef.current) {
        const imgPt = screenToImg(e.clientX, e.clientY);
        const norm: PixelPoint = {
          x: Math.max(0, Math.min(1, imgPt.x / imgSizeRef.current.w)),
          y: Math.max(0, Math.min(1, imgPt.y / imgSizeRef.current.h)),
        };
        setCursorVb(screenToVb(e.clientX, e.clientY));
        onPointsChange({ ...keyPointsRef.current, [dragRef.current.key]: norm });
        return;
      }

      // Прицеливание новой точки (лупа над пальцем + призрак)
      if (aimRef.current) {
        setAimImg(screenToImg(e.clientX, e.clientY));
        setCursorVb(screenToVb(e.clientX, e.clientY));
        return;
      }

      // Панорама
      if (panRef.current) {
        const vb = screenToVb(e.clientX, e.clientY);
        const v = viewRef.current;
        setView(
          clampView({ ...v, x: v.x + (vb.x - panRef.current.last.x), y: v.y + (vb.y - panRef.current.last.y) })
        );
        panRef.current = { last: vb };
      }
    },
    [screenToImg, screenToVb, onPointsChange, clampView]
  );

  const endPointer = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      pointersRef.current.delete(e.pointerId);
      try {
        svgRef.current?.releasePointerCapture(e.pointerId);
      } catch {}

      // Коммит прицелинной точки — В МОМЕНТ ОТПУСКАНИЯ пальца
      if (aimRef.current && keyPointsRef.current) {
        const key = aimRef.current.key;
        const imgPt = screenToImg(e.clientX, e.clientY);
        const norm: PixelPoint = {
          x: Math.max(0, Math.min(1, imgPt.x / imgSizeRef.current.w)),
          y: Math.max(0, Math.min(1, imgPt.y / imgSizeRef.current.h)),
        };
        aimRef.current = null;
        setAimImg(null);
        setCursorVb(null);
        onPointsChange({ ...keyPointsRef.current, [key]: norm });
        return;
      }

      if (dragRef.current) {
        dragRef.current = null;
        setDraggingKey(null);
        setCursorVb(null);
        return;
      }

      panRef.current = null;

      // После щипка остался один палец → мягко переходим в панораму
      if (pointersRef.current.size === 1 && viewRef.current.scale > 1) {
        const rest = [...pointersRef.current.values()][0];
        panRef.current = { last: screenToVb(rest.x, rest.y) };
        pinchRef.current = null;
        return;
      }
      if (pointersRef.current.size === 0) {
        pinchRef.current = null;
        setCursorVb(null);
      }
    },
    [screenToImg, screenToVb, onPointsChange]
  );

  // ===== начало перетаскивания существующей точки (с <g>) =====
  const startPointDrag = useCallback(
    (e: React.PointerEvent, key: keyof BikeKeyPoints) => {
      e.preventDefault();
      e.stopPropagation(); // не даём root'у начать pan/aim
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        svgRef.current?.setPointerCapture(e.pointerId);
      } catch {}
      dragRef.current = { key };
      setDraggingKey(key);
      setCursorVb(screenToVb(e.clientX, e.clientY));
    },
    [screenToVb]
  );

  const hasImage = imgSize.w > 0 && imgSize.h > 0;

  // Экранно-постоянные размеры (в единицах изображения)
  const pointR = px(13); // видимый кружок: диаметр 26 px
  const hitR = Math.max(pointR * 1.9, px(24)); // хит-зона ≥48 px диаметр
  const haloR = pointR + px(4);
  const strokeWidth = Math.max(pointR * 0.28, px(2));
  const lineW = Math.max(pointR * 0.22, px(1.5));
  const fontSize = Math.max(pointR * 0.95, px(11));

  // Параметры лупы (экранные размеры → viewBox)
  const magRScreen = Math.min(84, Math.max(56, (containerW || 360) * 0.22));
  const magR = pxPerUnit > 0 ? magRScreen / pxPerUnit : px(70);
  const magZoom = view.scale * 2.5;
  /** Экранные px → единицы viewBox БЕЗ зума (лупа снаружи зум-группы).
   *  px() делит ещё и на view.scale — он для элементов внутри группы. */
  const loupePx = useCallback(
    (screenPx: number) => (pxPerUnit > 0 ? screenPx / pxPerUnit : screenPx * 0.02),
    [pxPerUnit]
  );

  // Лупа видна при драге точки или прицеливании
  const loupeCursor =
    (draggingKey || aimRef.current) && cursorVb && hasImage
      ? {
          img: {
            x: (cursorVb.x - view.x) / view.scale,
            y: (cursorVb.y - view.y) / view.scale,
          },
          vb: cursorVb,
        }
      : null;

  const loupe = (() => {
    if (!loupeCursor) return null;
    // v3.1.0: центр лупы на (R + 76px) НАД точкой касания — нижний край круга
    // на 76 px выше пальца, подушечка его не перекрывает. У верхнего края фото
    // лупа переворачивается ПОД палец с тем же просветом; иначе кламп в фото.
    const off = magR + loupePx(LOUPE_GAP_SCREEN);
    let magCx = loupeCursor.vb.x;
    let magCy = loupeCursor.vb.y - off;
    if (magCy - magR < 0) magCy = loupeCursor.vb.y + off;
    magCx = Math.max(magR, Math.min(imgSize.w - magR, magCx));
    magCy = Math.max(magR, Math.min(imgSize.h - magR, magCy));
    const cross = loupePx(11);
    return { cx: magCx, cy: magCy, cross, zoom: magZoom, cursorImg: loupeCursor.img };
  })();

  const aimColor = aimRef.current
    ? POINT_CONFIG.find((c) => c.key === aimRef.current?.key)?.color ?? "#0ea5e9"
    : "#0ea5e9";

  const resetZoom = useCallback(() => setView({ x: 0, y: 0, scale: 1 }), []);
  const zoomButton = useCallback(
    (factor: number) => {
      const el = wrapRef.current;
      const r = el?.getBoundingClientRect();
      zoomAt(r ? r.left + r.width / 2 : 0, r ? r.top + r.height / 2 : 0, factor);
    },
    [zoomAt]
  );

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
              Прижми палец — в лупе ВЫШЕ пальца видно место с перекрестием. Подвини и отпусти — точка встанет туда, где перекрестие. Можно приблизить щипком.
            </p>
          </div>
        );
      })()}

      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden rounded-xl border bg-black select-none"
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
              cursor: placementMode ? "crosshair" : "grab",
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
          >
            <defs>
              <clipPath id="mag-clip">
                {loupe && <circle cx={loupe.cx} cy={loupe.cy} r={magR} />}
              </clipPath>
            </defs>

            {/* ===== ПАН/ЗУМ-ГРУППА ===== */}
            <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
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
                  return (
                    <line
                      key={`line-${key}`}
                      x1={bb.x * imgSize.w}
                      y1={bb.y * imgSize.h}
                      x2={pt.x * imgSize.w}
                      y2={pt.y * imgSize.h}
                      stroke={color}
                      strokeWidth={lineW}
                      strokeDasharray={`${lineW * 2.5} ${lineW * 2}`}
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
                  return (
                    <line
                      x1={keyPoints.rearAxle!.x! * imgSize.w}
                      y1={keyPoints.rearAxle!.y! * imgSize.h}
                      x2={keyPoints.frontAxle!.x! * imgSize.w}
                      y2={keyPoints.frontAxle!.y! * imgSize.h}
                      stroke="#06b6d4"
                      strokeWidth={lineW}
                      strokeDasharray={`${lineW * 2.5} ${lineW * 2}`}
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
                  const cx = pt.x * imgSize.w;
                  const cy = pt.y * imgSize.h;
                  const isDragging = draggingKey === key;
                  const isPlacementTarget =
                    placementMode && placementPointKey === key;
                  return (
                    <g
                      key={`pt-${key}`}
                      style={{
                        cursor: isDragging ? "grabbing" : "grab",
                        // В режиме разметки существующие точки не мешают прицеливанию
                        pointerEvents: placementMode ? "none" : "all",
                      }}
                      onPointerDown={(e) => startPointDrag(e, key)}
                    >
                      {/* Нативный tooltip при наведении (полное название + описание точки) */}
                      <title>{`${pointFullLabel(key)}\n\n${hint}${antiHint ? "\n\n⚠ " + antiHint : ""}`}</title>
                      {/* Пульсирующее кольцо для активной точки в режиме разметки */}
                      {isPlacementTarget && (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={pointR * 1.5}
                          fill="none"
                          stroke={color}
                          strokeWidth={strokeWidth * 0.8}
                          opacity={0.6}
                        >
                          <animate
                            attributeName="r"
                            values={`${pointR * 1.3};${pointR * 1.8};${pointR * 1.3}`}
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
                      {/* Невидимая хит-зона ≥48px — палец попадает с первого раза */}
                      <circle cx={cx} cy={cy} r={hitR} fill="transparent" />
                      {/* Внешний ореол для видимости на тёмном фоне */}
                      <circle cx={cx} cy={cy} r={haloR} fill="rgba(0,0,0,0.25)" />
                      {/* Белый кружок с цветным ободком */}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={pointR}
                        fill="rgba(255,255,255,0.95)"
                        stroke={color}
                        strokeWidth={strokeWidth}
                      />
                      {/* Внутренняя точка для точности */}
                      <circle cx={cx} cy={cy} r={strokeWidth * 0.6} fill={color} />
                      {/* Подпись */}
                      {showLabels && (
                        <g pointerEvents="none">
                          <text
                            x={cx}
                            y={cy + pointR + fontSize + px(2)}
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

              {/* Призрак-перекрестие при двухфазной установке точки */}
              {aimImg &&
                placementMode &&
                (() => {
                  const cx = aimImg.x;
                  const cy = aimImg.y;
                  const r = px(14);
                  return (
                    <g pointerEvents="none">
                      <circle cx={cx} cy={cy} r={r} fill="none" stroke={aimColor} strokeWidth={px(2.5)} opacity={0.9} />
                      <line x1={cx - r * 1.5} y1={cy} x2={cx + r * 1.5} y2={cy} stroke={aimColor} strokeWidth={px(2)} opacity={0.9} />
                      <line x1={cx} y1={cy - r * 1.5} x2={cx} y2={cy + r * 1.5} stroke={aimColor} strokeWidth={px(2)} opacity={0.9} />
                      <circle cx={cx} cy={cy} r={px(2)} fill={aimColor} />
                    </g>
                  );
                })()}
            </g>

            {/* ===== ЛУПА (вне зум-группы — постоянный экранный размер) =====
                Радиус 56–84 ЭКРАННЫХ px, зум 2.5× поверх текущего вида,
                центр на R+76 px НАД пальцем — нижний край круга далеко выше
                подушечки. Все декоры через loupePx (без view.scale). */}
            {loupe && loupeCursor && (() => {
              // Направляющая линия: перекрестие лупы ↔ точка касания
              const dx = loupeCursor.vb.x - loupe.cx;
              const dy = loupeCursor.vb.y - loupe.cy;
              const len = Math.hypot(dx, dy) || 1;
              const lx1 = loupe.cx + (dx / len) * (magR + loupePx(3));
              const ly1 = loupe.cy + (dy / len) * (magR + loupePx(3));
              return (
                <g pointerEvents="none">
                  {/* Направляющая от края лупы к пальцу */}
                  <line
                    x1={lx1}
                    y1={ly1}
                    x2={loupeCursor.vb.x}
                    y2={loupeCursor.vb.y}
                    stroke="#0ea5e9"
                    strokeWidth={loupePx(1.5)}
                    strokeDasharray={`${loupePx(5)} ${loupePx(4)}`}
                    opacity={0.55}
                    strokeLinecap="round"
                  />
                  {/* Тень под лупой */}
                  <circle cx={loupe.cx} cy={loupe.cy} r={magR + loupePx(4)} fill="rgba(0,0,0,0.4)" />
                  {/* Белый фон */}
                  <circle cx={loupe.cx} cy={loupe.cy} r={magR + loupePx(2)} fill="white" />
                  {/* Картинка в круге (зум поверх вида) */}
                  <g clipPath="url(#mag-clip)">
                    <image
                      href={photoUrl}
                      x={loupe.cx - loupe.cursorImg.x * loupe.zoom}
                      y={loupe.cy - loupe.cursorImg.y * loupe.zoom}
                      width={imgSize.w * loupe.zoom}
                      height={imgSize.h * loupe.zoom}
                      preserveAspectRatio="xMidYMid meet"
                    />
                  </g>
                  {/* Ободок лупы */}
                  <circle
                    cx={loupe.cx}
                    cy={loupe.cy}
                    r={magR}
                    fill="none"
                    stroke="#0ea5e9"
                    strokeWidth={loupePx(2.5)}
                  />
                  {/* Перекрестие в центре лупы = куда встанет точка */}
                  <line
                    x1={loupe.cx - loupe.cross}
                    y1={loupe.cy}
                    x2={loupe.cx + loupe.cross}
                    y2={loupe.cy}
                    stroke="#ef4444"
                    strokeWidth={loupePx(2)}
                  />
                  <line
                    x1={loupe.cx}
                    y1={loupe.cy - loupe.cross}
                    x2={loupe.cx}
                    y2={loupe.cy + loupe.cross}
                    stroke="#ef4444"
                    strokeWidth={loupePx(2)}
                  />
                  <circle cx={loupe.cx} cy={loupe.cy} r={loupePx(2)} fill="#ef4444" />
                </g>
              );
            })()}
          </svg>
        ) : (
          // Скелетон пока размеры не загрузились
          <div className="flex aspect-[3/2] w-full items-center justify-center">
            <Loader2 className="size-8 animate-spin text-emerald-400" />
          </div>
        )}

        {/* Кнопки зума (поверх фото, справа сверху) */}
        {hasImage && (
          <div className="absolute right-2 top-2 flex flex-col gap-1.5">
            <button
              type="button"
              aria-label="Приблизить"
              onClick={() => zoomButton(1.4)}
              className="flex size-9 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-sm active:bg-black/75"
            >
              <ZoomIn className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Отдалить"
              onClick={() => zoomButton(1 / 1.4)}
              className="flex size-9 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-sm active:bg-black/75"
            >
              <ZoomOut className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Сбросить зум"
              onClick={resetZoom}
              className="flex size-9 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-sm active:bg-black/75"
            >
              <Maximize className="size-5" />
            </button>
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
            <Move className="size-3 shrink-0" />
            Щипок — зум · палец по пустому — панорама · лупа выше пальца
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
