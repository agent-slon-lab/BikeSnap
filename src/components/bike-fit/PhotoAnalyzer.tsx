"use client";

import { useEffect, useRef, useState } from "react";
import { ScanLine, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  POSE_CONNECTIONS,
  type Point,
  type ViewType,
} from "@/lib/bike-fit";

interface PhotoAnalyzerProps {
  photoUrl: string;
  viewType: ViewType;
  onAnalyze: (img: HTMLImageElement) => void;
  analyzing: boolean;
  hasResults: boolean;
  landmarks: Point[] | null;
  /** Дополнительные overlay-элементы (линии симметрии для back/front) */
  overlayLines?: Array<{
    a: Point;
    b: Point;
    color: string;
    label?: string;
    dashed?: boolean;
  }>;
}

export function PhotoAnalyzer({
  photoUrl,
  viewType,
  onAnalyze,
  analyzing,
  hasResults,
  landmarks,
  overlayLines,
}: PhotoAnalyzerProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // key={photoUrl} на <img> перерендерит тег при смене URL,
  // что автоматически сбросит состояние загрузки
  return (
    <div className="space-y-4">
      <div className="relative w-full overflow-hidden rounded-xl border bg-black">
        <div className="relative w-full">
          <PhotoWithOverlay
            key={photoUrl}
            photoUrl={photoUrl}
            viewType={viewType}
            landmarks={landmarks}
            overlayLines={overlayLines}
            imgRef={imgRef}
            canvasRef={canvasRef}
          />
          {analyzing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3 text-white">
                <Loader2 className="size-10 animate-spin text-orange-400" />
                <p className="text-sm font-medium">Анализ позы...</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          onClick={() => imgRef.current && onAnalyze(imgRef.current)}
          disabled={analyzing}
          size="lg"
          className={cn(
            "w-full",
            hasResults
              ? "bg-emerald-600 hover:bg-emerald-700"
              : "bg-orange-500 hover:bg-orange-600"
          )}
        >
          <ScanLine className="size-4" />
          {analyzing
            ? "Анализирую..."
            : hasResults
              ? "Пересчитать позу"
              : "Анализировать позу"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Внутренний компонент — отображает фото + canvas overlay.
 * Использует useState для loaded, что безопасно (вызывается onLoad — это событие, не эффект).
 */
function PhotoWithOverlay({
  photoUrl,
  viewType,
  landmarks,
  overlayLines,
  imgRef,
  canvasRef,
}: {
  photoUrl: string;
  viewType: ViewType;
  landmarks: Point[] | null;
  overlayLines?: Array<{ a: Point; b: Point; color: string; label?: string; dashed?: boolean }>;
  imgRef: React.RefObject<HTMLImageElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  const [loaded, setLoaded] = useState(false);

  // Отрисовка overlay (скелет + линии симметрии)
  useEffect(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !loaded) return;

    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return;

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);

    if (!landmarks || landmarks.length === 0) return;

    // 1. Скелет
    ctx.lineWidth = Math.max(3, w / 400);
    ctx.strokeStyle = "rgba(249, 115, 22, 0.9)";
    ctx.lineCap = "round";

    for (const [a, b] of POSE_CONNECTIONS) {
      const pa = landmarks[a];
      const pb = landmarks[b];
      if (!pa || !pb) continue;
      if ((pa.visibility ?? 1) < 0.3 || (pb.visibility ?? 1) < 0.3) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x * w, pa.y * h);
      ctx.lineTo(pb.x * w, pb.y * h);
      ctx.stroke();
    }

    // 2. Точки keypoints
    const r = Math.max(5, w / 250);
    for (const lm of landmarks) {
      if (!lm || (lm.visibility ?? 1) < 0.3) continue;
      ctx.beginPath();
      ctx.arc(lm.x * w, lm.y * h, r, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.fill();
      ctx.strokeStyle = "rgba(249, 115, 22, 1)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 3. Дополнительные линии (симметрия для back/front)
    if (overlayLines && overlayLines.length > 0) {
      for (const line of overlayLines) {
        ctx.beginPath();
        ctx.lineWidth = Math.max(4, w / 300);
        ctx.strokeStyle = line.color;
        if (line.dashed) {
          ctx.setLineDash([12, 6]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.moveTo(line.a.x * w, line.a.y * h);
        ctx.lineTo(line.b.x * w, line.b.y * h);
        ctx.stroke();
        ctx.setLineDash([]);

        if (line.label) {
          const midX = ((line.a.x + line.b.x) / 2) * w;
          const midY = ((line.a.y + line.b.y) / 2) * h;
          ctx.font = `bold ${Math.max(14, w / 50)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const metrics = ctx.measureText(line.label);
          const padX = 8;
          const padY = 4;
          const textW = metrics.width + padX * 2;
          const textH = Math.max(14, w / 50) + padY * 2;
          ctx.fillStyle = line.color;
          ctx.fillRect(midX - textW / 2, midY - textH / 2, textW, textH);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(line.label, midX, midY);
        }
      }
    }
  }, [landmarks, overlayLines, loaded, imgRef, canvasRef]);

  return (
    <div className="relative w-full">
      <img
        ref={imgRef}
        src={photoUrl}
        alt={`Фото велосипедиста — вид ${viewType}`}
        onLoad={() => setLoaded(true)}
        className="block w-full h-auto max-h-[60vh] object-contain"
        crossOrigin="anonymous"
      />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 w-full h-full object-contain"
      />
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <div className="flex flex-col items-center gap-2 text-white">
            <Loader2 className="size-6 animate-spin" />
            <p className="text-xs">Загрузка фото...</p>
          </div>
        </div>
      )}
    </div>
  );
}


