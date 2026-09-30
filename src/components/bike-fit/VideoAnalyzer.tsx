"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, ScanLine, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

interface VideoAnalyzerProps {
  videoUrl: string;
  onAnalyze: (video: HTMLVideoElement) => void;
  analyzing: boolean;
  hasResults: boolean;
  /** Координаты keypoints в нормализованных координатах [0..1] для отрисовки скелета */
  landmarksToDraw?: Array<{ x: number; y: number; visibility?: number }> | null;
  /** Связи между точками для отрисовки скелета */
  connections?: Array<[number, number]>;
  /** Ключевые углы, которые нужно подсветить на кадре */
  highlightAngles?: Array<{
    a: { x: number; y: number };
    b: { x: number; y: number };
    c: { x: number; y: number };
    color: string;
    label: string;
  }>;
}

export function VideoAnalyzer({
  videoUrl,
  onAnalyze,
  analyzing,
  hasResults,
  landmarksToDraw,
  connections,
  highlightAngles,
}: VideoAnalyzerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Подгрузка метаданных
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onLoaded = () => {
      setDuration(v.duration || 0);
    };
    const onTime = () => setCurrentTime(v.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);

    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
    };
  }, [videoUrl]);

  // Отрисовка overlay
  const drawOverlay = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);

    if (!landmarksToDraw || landmarksToDraw.length === 0) return;

    // Линии скелета
    if (connections && connections.length > 0) {
      ctx.lineWidth = Math.max(3, w / 300);
      ctx.strokeStyle = "rgba(249, 115, 22, 0.85)";
      ctx.lineCap = "round";

      for (const [a, b] of connections) {
        const pa = landmarksToDraw[a];
        const pb = landmarksToDraw[b];
        if (!pa || !pb) continue;
        if ((pa.visibility ?? 1) < 0.3 || (pb.visibility ?? 1) < 0.3) continue;
        ctx.beginPath();
        ctx.moveTo(pa.x * w, pa.y * h);
        ctx.lineTo(pb.x * w, pb.y * h);
        ctx.stroke();
      }
    }

    // Точки keypoints
    const pointRadius = Math.max(4, w / 200);
    for (const lm of landmarksToDraw) {
      if ((lm.visibility ?? 1) < 0.3) continue;
      ctx.beginPath();
      ctx.arc(lm.x * w, lm.y * h, pointRadius, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.fill();
      ctx.strokeStyle = "rgba(249, 115, 22, 1)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Подсветка углов
    if (highlightAngles && highlightAngles.length > 0) {
      for (const ha of highlightAngles) {
        ctx.lineWidth = Math.max(5, w / 200);
        ctx.strokeStyle = ha.color;
        ctx.beginPath();
        ctx.moveTo(ha.a.x * w, ha.a.y * h);
        ctx.lineTo(ha.b.x * w, ha.b.y * h);
        ctx.lineTo(ha.c.x * w, ha.c.y * h);
        ctx.stroke();

        // Дуга угла
        const a1 = Math.atan2(ha.a.y * h - ha.b.y * h, ha.a.x * w - ha.b.x * w);
        const a2 = Math.atan2(ha.c.y * h - ha.b.y * h, ha.c.x * w - ha.b.x * w);
        ctx.beginPath();
        const radius = Math.max(30, w / 25);
        let start = a1;
        let end = a2;
        // Рисуем кратчайшую дугу
        let diff = end - start;
        if (diff > Math.PI) diff -= 2 * Math.PI;
        if (diff < -Math.PI) diff += 2 * Math.PI;
        ctx.arc(ha.b.x * w, ha.b.y * h, radius, start, start + diff, diff < 0);
        ctx.lineWidth = 3;
        ctx.stroke();

        // Подпись угла
        const midAngle = start + diff / 2;
        const labelX = ha.b.x * w + Math.cos(midAngle) * (radius + 20);
        const labelY = ha.b.y * h + Math.sin(midAngle) * (radius + 20);
        ctx.font = `bold ${Math.max(14, w / 60)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const padX = 8;
        const padY = 4;
        const metrics = ctx.measureText(ha.label);
        const textW = metrics.width + padX * 2;
        const textH = Math.max(14, w / 60) + padY * 2;
        ctx.fillStyle = ha.color;
        ctx.fillRect(labelX - textW / 2, labelY - textH / 2, textW, textH);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(ha.label, labelX, labelY);
      }
    }
  }, [landmarksToDraw, connections, highlightAngles]);

  // Перерисовка при изменении данных
  useEffect(() => {
    drawOverlay();
  }, [drawOverlay, currentTime]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
    } else {
      v.pause();
    }
  };

  const seek = (time: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(time, duration || 0));
  };

  const formatTime = (s: number) => {
    if (!isFinite(s)) return "0:00";
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${min}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-4">
      <div className="relative w-full overflow-hidden rounded-xl border bg-black">
        <div className="relative aspect-video w-full">
          <video
            ref={videoRef}
            src={videoUrl}
            className="absolute inset-0 size-full object-contain"
            playsInline
            crossOrigin="anonymous"
          />
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0 size-full object-contain"
          />
          {analyzing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3 text-white">
                <Loader2 className="size-10 animate-spin text-orange-400" />
                <p className="text-sm font-medium">Анализ позы...</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Контролы */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => seek(currentTime - 1)}
            disabled={!duration}
            title="Назад на 1 секунду"
          >
            <SkipBack className="size-4" />
          </Button>
          <Button
            variant="default"
            size="icon"
            onClick={togglePlay}
            disabled={!duration}
            className="bg-orange-500 hover:bg-orange-600 text-white"
            title={isPlaying ? "Пауза" : "Воспроизвести"}
          >
            {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => seek(currentTime + 1)}
            disabled={!duration}
            title="Вперёд на 1 секунду"
          >
            <SkipForward className="size-4" />
          </Button>
          <span className="ml-2 font-mono text-sm tabular-nums text-muted-foreground">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        <Slider
          value={[currentTime]}
          min={0}
          max={duration || 100}
          step={0.01}
          onValueChange={(v) => seek(v[0])}
          disabled={!duration}
          className={cn(!duration && "opacity-50")}
        />

        <div className="flex flex-col gap-2">
          <Button
            onClick={() => videoRef.current && onAnalyze(videoRef.current)}
            disabled={analyzing || !duration}
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
                ? "Пересчитать позу на этом кадре"
                : "Анализировать позу на этом кадре"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Совет: выберите кадр, где педаль в самой нижней точке (НМТ) —
            нога почти прямая
          </p>
        </div>
      </div>
    </div>
  );
}
