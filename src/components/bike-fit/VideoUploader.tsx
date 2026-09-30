"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, Film, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface VideoUploaderProps {
  onVideoSelected: (file: File, url: string) => void;
  currentVideoUrl: string | null;
  onClear: () => void;
}

const ACCEPTED_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/ogg"];
const MAX_SIZE_MB = 100;

export function VideoUploader({
  onVideoSelected,
  currentVideoUrl,
  onClear,
}: VideoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = useCallback((file: File): string | null => {
    const isAccepted =
      ACCEPTED_TYPES.includes(file.type) || file.name.match(/\.(mp4|webm|mov|ogg)$/i);
    if (!isAccepted) {
      return "Поддерживаются только видеоформаты MP4, WebM, MOV, OGG";
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return `Размер файла превышает ${MAX_SIZE_MB} МБ`;
    }
    return null;
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      const err = validate(file);
      if (err) {
        setError(err);
        return;
      }
      setError(null);
      if (currentVideoUrl) {
        URL.revokeObjectURL(currentVideoUrl);
      }
      const url = URL.createObjectURL(file);
      onVideoSelected(file, url);
    },
    [validate, onVideoSelected, currentVideoUrl]
  );

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

  if (currentVideoUrl) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <Film className="size-4" />
            <span className="text-sm font-medium">Видео загружено</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
            Удалить
          </Button>
        </div>
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
          "group relative flex min-h-64 cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-8 text-center transition-all",
          dragging
            ? "border-orange-400 bg-orange-50 dark:bg-orange-950/30 scale-[1.01]"
            : "border-border hover:border-orange-300 hover:bg-accent/50"
        )}
      >
        <div
          className={cn(
            "flex size-16 items-center justify-center rounded-full transition-colors",
            dragging
              ? "bg-orange-500 text-white"
              : "bg-muted text-muted-foreground group-hover:bg-orange-100 group-hover:text-orange-600 dark:group-hover:bg-orange-950/50"
          )}
        >
          <Upload className="size-7" />
        </div>
        <div className="space-y-1">
          <p className="text-base font-medium">
            Перетащите видео сюда или нажмите для выбора
          </p>
          <p className="text-sm text-muted-foreground">
            MP4, WebM, MOV, OGG · до {MAX_SIZE_MB} МБ
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          onChange={onInputChange}
          className="sr-only"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
