"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, Image as ImageIcon, AlertCircle, X, Smartphone, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CaptureMeta } from "@/lib/fit-report";
import { useDeviceOrientation, ensureOrientationPermission } from "@/hooks/use-device-orientation";
import { CameraCapture } from "@/components/bike-fit/CameraCapture";

interface PhotoUploaderProps {
  /** meta — гироскоп в момент спуска (есть только у кадров из камеры) */
  onPhotoSelected: (file: File, url: string, meta?: CaptureMeta) => void;
  currentPhotoUrl: string | null;
  onClear: () => void;
  /** Заголовок зоны загрузки */
  label?: string;
}

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/gif",
];
const MAX_SIZE_MB = 20;

export function PhotoUploader({
  onPhotoSelected,
  currentPhotoUrl,
  onClear,
  label = "Перетащите фото сюда или нажмите для выбора",
}: PhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const { isLevel, supported: gyroSupported } = useDeviceOrientation();

  const validate = useCallback((file: File): string | null => {
    const isAccepted =
      ACCEPTED_TYPES.includes(file.type) ||
      file.name.match(/\.(jpe?g|png|webp|bmp|gif)$/i);
    if (!isAccepted) {
      return "Поддерживаются только изображения JPG, PNG, WebP, BMP, GIF";
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return `Размер файла превышает ${MAX_SIZE_MB} МБ`;
    }
    return null;
  }, []);

  const applyFile = useCallback(
    (file: File, meta?: CaptureMeta) => {
      const err = validate(file);
      if (err) {
        setError(err);
        return;
      }
      setError(null);
      if (currentPhotoUrl) {
        URL.revokeObjectURL(currentPhotoUrl);
      }
      const url = URL.createObjectURL(file);
      onPhotoSelected(file, url, meta);
    },
    [validate, onPhotoSelected, currentPhotoUrl]
  );

  const handleFile = useCallback(
    (file: File, meta?: CaptureMeta) => applyFile(file, meta),
    [applyFile]
  );

  // Открытие камеры: на iOS запрос разрешения на гироскоп обязан идти
  // из жеста пользователя — поэтому вызываем его прямо в обработчике клика
  const openCamera = useCallback(() => {
    void ensureOrientationPermission().catch(() => false);
    setCameraOpen(true);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = "";
    },
    [handleFile]
  );

  if (currentPhotoUrl) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3">
        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 min-w-0">
          <ImageIcon className="size-4 shrink-0" />
          <span className="text-sm font-medium truncate">Фото загружено</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <X className="size-4" />
          Удалить
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={cn(
          "group relative flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-all",
          dragging
            ? "border-orange-400 bg-orange-50 dark:bg-orange-950/30 scale-[1.01]"
            : "border-border hover:border-orange-300 hover:bg-accent/50"
        )}
      >
        <div
          className={cn(
            "flex size-12 items-center justify-center rounded-full transition-colors",
            dragging
              ? "bg-orange-500 text-white"
              : "bg-muted text-muted-foreground group-hover:bg-orange-100 group-hover:text-orange-600 dark:group-hover:bg-orange-950/50"
          )}
        >
          <Upload className="size-5" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">
            JPG, PNG, WebP · до {MAX_SIZE_MB} МБ
          </p>
          {/* Уровень гироскопа — только когда датчик реально отдаёт данные */}
          {gyroSupported && (
            <div className={cn(
              "mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold",
              isLevel
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
            )}>
              <Smartphone className="size-3" />
              {isLevel ? "✓ Телефон ровно" : "⚠ Выровняйте телефон"}
            </div>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          onChange={onInputChange}
          className="sr-only"
        />
      </div>

      {/* Камера с помощником ракурса: детектор находит колёса в видоискателе,
          дорисовывает их и подсказывает, когда ракурс строго сбоку */}
      <Button
        type="button"
        variant="outline"
        onClick={openCamera}
        className="w-full border-orange-300 text-orange-600 hover:bg-orange-50 hover:text-orange-700 dark:border-orange-800 dark:text-orange-400 dark:hover:bg-orange-950/40"
      >
        <Camera className="size-4" />
        Снять фото с помощником ракурса
      </Button>

      <CameraCapture
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onCapture={handleFile}
        label={label}
      />

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
