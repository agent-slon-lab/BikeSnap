"use client";

import { useState, useEffect, useCallback } from "react";
import { Bike, Plus, Trash2, Save, Lock, LockOpen, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBikeStore } from "@/lib/bike-store";
import { BikeSchemaDiagram } from "./BikeSchemaDiagram";
import { BikePhotoCalibrator } from "./BikePhotoCalibrator";
import {
  getBikes,
  createBike,
  deleteBike,
  setActiveBike,
  getActiveBike,
  updateBike,
  updateBikePhoto,
  type BikeRecord,
} from "@/lib/bike-storage";
import type { BikeType } from "@/lib/bike-params";
import type { BikeKeyPoints } from "@/lib/bike-photo-scale";
import { WHEEL_SIZES, findWheelSize } from "@/lib/bike-perspective";

interface ParamField {
  key: string;
  label: string;
  abbr: string;
  unit: string;
  placeholder: string;
  color: string;
  icon: string;
  tooltip: string;
  howToMeasure: string;
  step?: string;
  min?: number;
  max?: number;
  /** Обязательное поле для прохода на следующий шаг (summary/analysis) */
  required?: boolean;
}

// ТОЛЬКО 2 обязательных поля: SH (Высота седла) + WB (Колёсная база).
// Остальные (ETT, Stem, α, CR, BBH) — опциональны, алгоритм высчитает сам по фото.
// Поле WH (Радиус колеса) убрано — радиус берётся из dropdown типоразмера ниже.
const PARAM_FIELDS: ParamField[] = [
  {
    key: "saddleHeight", label: "Высота седла", abbr: "SH", unit: "мм", placeholder: "730", color: "#ef4444", icon: "🚲",
    required: true,
    tooltip: "Расстояние по прямой от центра каретки (BB) до ВЕРХНЕЙ ПОВЕРХНОСТИ седла (вдоль оси подседельного штыря). НЕ до хомута рельсов — именно до поверхности седла, на которой сидит райдер. Зачем: проверка текущего положения ног и коленных суставов.",
    howToMeasure: "1) Поставь велосипед на ровную горизонтальную поверхность. 2) Протяни рулетку от центра оси каретки (где крепятся шатуны) по прямой до верха седла. 3) Зафиксируй значение в мм. Важно: НЕ измеряй до хомута, который зажимает рельсы седла — это не учитывает высоту профиля седла.",
  },
  {
    key: "wheelbase", label: "Колёсная база", abbr: "WB", unit: "мм", placeholder: "1080", color: "#a855f7", icon: "📐",
    required: true,
    tooltip: "Колёсная база. Расстояние между центрами осей заднего и переднего колёс. Зачем: идеальный масштаб для алгоритма — зная реальную WB, программа переводит пиксели с фото в точные миллиметры всех остальных размеров (ETT, Reach, Stack, углы).",
    howToMeasure: "Измерь рулеткой от центра оси заднего колеса до центра оси переднего колеса. Можно измерять по прямой (не обязательно горизонтально). Обычно указана в спецификации велосипеда. Типичные значения: 970-1030 мм шоссе, 1080-1180 мм MTB.",
  },
  // ===== Опциональные поля (алгоритм высчитает сам по фото) =====
  {
    key: "ett", label: "Эфф. верхняя труба", abbr: "ETT", unit: "мм", placeholder: "545", color: "#f97316", icon: "📏",
    tooltip: "Строго горизонтальное расстояние (параллельно земле) от центра верхнего среза рулевой трубы (top cap) до пересечения с осью подседельного штыря. Если не введёшь — алгоритм посчитает по фото.",
    howToMeasure: "1) Поставь велосипед ровно. 2) Найди точку A — центр верхнего среза рулевой трубы (под выносом). 3) Приложи строительный уровень к точке A и направь строго горизонтально в сторону седла. 4) Найди точку B — пересечение с ОСЬЮ подседельного ШТЫРЯ (не рамы!). 5) Измерь по горизонтали между A и B в мм.",
  },
  {
    key: "stem", label: "Вынос", abbr: "Stem", unit: "мм", placeholder: "100", color: "#22c55e", icon: "🔧",
    tooltip: "Длина выноса руля. Расстояние по оси выноса от центра рулевой трубы до центра крепления руля.",
    howToMeasure: "Измерь от центра зажима на рулевой трубе (где вынос крепится к раме) до центра зажима руля. Длина обычно выбита на выносе: 80, 90, 100, 110, 120 мм.",
  },
  {
    key: "stemAngle", label: "Угол выноса", abbr: "α", unit: "°", placeholder: "6", color: "#3b82f6", icon: "📐",
    tooltip: "Угол наклона выноса относительно рулевой трубы. Положительный = вверх, отрицательный = вниз.",
    howToMeasure: "Посмотри на вынос — угол часто выбит сбоку: ±6°, ±8°, ±17°. Если не указан — измерь транспортиром угол между осью выноса и осью рулевой трубы. Штатный обычно +6° или +8°.",
  },
  {
    key: "crank", label: "Шатун", abbr: "CR", unit: "мм", placeholder: "172.5", step: "0.5", color: "#eab308", icon: "⚙️",
    tooltip: "Длина шатуна. Расстояние от центра оси каретки до центра оси педали.",
    howToMeasure: "Сними один шатун. Измерь от центра отверстия под ось каретки до центра отверстия под педаль. Стандартные размеры: 165, 167.5, 170, 172.5, 175 мм. Длина выбита на внутренней стороне шатуна.",
  },
  {
    key: "bbHeight", label: "Высота каретки", abbr: "BBH", unit: "мм", placeholder: "265", color: "#ec4899", icon: "📍",
    tooltip: "Высота центра каретки от земли. Влияет на BB Drop (насколько каретка ниже оси колеса).",
    howToMeasure: "Поставь велосипед ровно на землю. Измерь от пола до центра оси каретки (центр вала, где шатуны крепятся к раме). Обычно 260-280 мм для шоссе, 280-340 для MTB.",
  },
];

export function BikeParametersForm() {
  const { bike, setBike, toggleLock, isLocked, wheelSizeId, setWheelSizeId } = useBikeStore();
  const [bikes, setBikes] = useState<BikeRecord[]>([]);
  const [activeBike, setActiveBikeState] = useState<BikeRecord | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<BikeType>("road");
  const [saved, setSaved] = useState(false);
  // Гарантированный сброс BikePhotoCalibrator при смене/создании велика
  const [calibratorKey, setCalibratorKey] = useState(0);

  const reload = useCallback(() => {
    const all = getBikes();
    setBikes(all);
    const active = getActiveBike();
    setActiveBikeState(active);
    if (active) {
      setBike(active.measurements);
    }
  }, [setBike]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleCreate = () => {
    if (!newName.trim()) return;
    const bike = createBike(newName.trim(), newType, {});
    setBike({});
    // Сбрасываем все замки при создании нового велика
    useBikeStore.setState({ lockedFields: [] });
    setBikes(getBikes());
    setActiveBikeState(bike);
    setCalibratorKey(k => k + 1);
    setShowNew(false);
    setNewName("");
  };

  const handleSelect = (bike: BikeRecord) => {
    setActiveBike(bike.id);
    setActiveBikeState(bike);
    setBike(bike.measurements);
    // Сбрасываем замки при выборе другого велика
    useBikeStore.setState({ lockedFields: [] });
    setCalibratorKey(k => k + 1);
  };

  const handleDelete = (id: string) => {
    if (!confirm("Удалить велосипед?")) return;
    deleteBike(id);
    const remaining = getBikes();
    setBikes(remaining);
    if (activeBike?.id === id) {
      const newActive = remaining[0] ?? null;
      setActiveBikeState(newActive);
      if (newActive) {
        setActiveBike(newActive.id);
        setBike(newActive.measurements);
      } else {
        setBike({});
      }
      setCalibratorKey(k => k + 1);
    }
  };

  const handleSave = () => {
    if (!activeBike) return;
    updateBike(activeBike.id, bike);
    setBikes(getBikes());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Заголовок */}
      <div className="flex items-center gap-2">
        <Bike className="size-5 text-orange-500" />
        <h2 className="text-lg font-bold">Велосипеды</h2>
        <span className="text-xs text-muted-foreground">
          Выбери велик или создай новый
        </span>
      </div>

      {/* Сетка карточек великов */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {bikes.map((b) => {
          const isActive = activeBike?.id === b.id;
          const filledCount = Object.values(b.measurements).filter((v) => v != null && v > 0).length;
          return (
            <Card
              key={b.id}
              className={cn(
                "relative overflow-hidden cursor-pointer transition-all",
                isActive
                  ? "border-emerald-400 ring-2 ring-emerald-400/30 shadow-md"
                  : "border-border hover:border-emerald-300 hover:shadow-sm"
              )}
              onClick={() => handleSelect(b)}
            >
              <div className={cn(
                "absolute left-0 top-0 bottom-0 w-1.5",
                isActive ? "bg-emerald-500" : "bg-muted-foreground/20"
              )} />
              <CardContent className="p-3 pl-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "flex size-7 items-center justify-center rounded text-xs font-bold",
                      isActive ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
                    )}>
                      🚲
                    </div>
                    <span className="font-semibold text-sm">{b.name}</span>
                    {isActive && (
                      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 text-[10px]">
                        активен
                      </Badge>
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(b.id); }}
                    className="text-rose-400 hover:text-rose-600 p-1"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{b.type}</span>
                  <span>{filledCount}/8 параметров</span>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* Карточка "Добавить велик" */}
        {showNew ? (
          <Card className="border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Plus className="size-4 text-emerald-500" />
                <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  Новый велик
                </span>
              </div>
              <Input
                placeholder="Название (напр. «Шоссейник»)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-8 text-sm"
              />
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as BikeType)}
                className="flex h-8 w-full rounded-md border border-input bg-background text-foreground px-2 text-sm"
              >
                <option value="road">🚴 Шоссе</option>
                <option value="gravel">🚵 Грэвел</option>
                <option value="mtb">🚵‍♂️ MTB</option>
                <option value="hybrid">🚲 Гибрид</option>
                <option value="city">🚲 Городской</option>
              </select>
              <div className="flex gap-1">
                <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleCreate} disabled={!newName.trim()}>
                  <Plus className="size-3" /> Создать
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setShowNew(false); setNewName(""); }}>
                  Отмена
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card
            className="border-dashed border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 cursor-pointer transition-colors"
            onClick={() => setShowNew(true)}
          >
            <CardContent className="p-4 flex flex-col items-center justify-center min-h-[80px]">
              <Plus className="size-8 text-emerald-400 mb-1" />
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                Добавить велик
              </span>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Если выбран велик — показываем параметры */}
      {activeBike && (
        <>
          {/* Кнопка сохранения */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              🚲 {activeBike.name} — параметры
            </h3>
            <Button
              size="sm"
              variant={saved ? "default" : "outline"}
              className={saved ? "bg-emerald-500 text-white" : ""}
              onClick={handleSave}
            >
              <Save className="size-3.5" />
              {saved ? "✓ Сохранено!" : "💾 Сохранить"}
            </Button>
          </div>

          {/* Фото-калибратор — key=activeBike.id сбрасывает state при смене велика */}
          <BikePhotoCalibrator
            key={calibratorKey}
            measured={bike}
            initialPhotoUrl={activeBike.photoData}
            initialKeyPoints={activeBike.keyPointsData ? JSON.parse(activeBike.keyPointsData) : null}
            onPhotoChange={(photoData, keyPoints) => {
              updateBikePhoto(
                activeBike.id,
                photoData ?? undefined,
                keyPoints ? JSON.stringify(keyPoints) : undefined
              );
              // Обновляем локальный стейт карточки
              setBikes(getBikes());
              const updated = getActiveBike();
              if (updated) setActiveBikeState(updated);
            }}
            onAveraged={(avg) => {
              if (avg.reach != null && !isLocked("reach")) setBike({ reach: avg.reach });
              if (avg.stack != null && !isLocked("stack")) setBike({ stack: avg.stack });
              if (avg.wheelbase != null && !isLocked("wheelbase")) setBike({ wheelbase: avg.wheelbase });
            }}
          />

          {/* Схема велосипеда */}
          <Card>
            <CardContent className="pt-4">
              <BikeSchemaDiagram values={bike} />
            </CardContent>
          </Card>

          {/* Карточки параметров */}
          <TooltipProvider delayDuration={200}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {PARAM_FIELDS.map((p) => {
              const value = bike[p.key as keyof typeof bike] as number | undefined;
              const isFilled = value != null && value > 0;
              const locked = isLocked(p.key);

              return (
                <Card key={p.key} className={cn(
                  "relative overflow-hidden transition-all",
                  isFilled
                    ? "border-emerald-300 dark:border-emerald-800 shadow-sm"
                    : "border-border"
                )}>
                  <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: p.color }} />
                  <CardContent className="p-3 pl-4 space-y-1.5">
                    {/* Заголовок + замок + подсказка */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">{p.icon}</span>
                        <span className="text-xs font-semibold">{p.label}</span>
                        <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono">{p.abbr}</Badge>
                      </div>
                      <div className="flex items-center gap-0.5">
                        {/* Подсказка «как измерить» */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button" className="text-muted-foreground hover:text-foreground p-0.5">
                              <Info className="size-3" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs">
                            <div className="space-y-1">
                              <p className="text-xs font-medium">{p.tooltip}</p>
                              <p className="text-[11px] text-muted-foreground">{p.howToMeasure}</p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                        {/* Замок */}
                        <button
                          onClick={() => toggleLock(p.key)}
                          className={cn(
                            "transition-colors p-0.5",
                            locked ? "text-emerald-500" : "text-muted-foreground/30 hover:text-muted-foreground"
                          )}
                          title={locked ? "Разблокировать" : "Зафиксировать (значение не будет перезаписано)"}
                        >
                          {locked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
                        </button>
                      </div>
                    </div>
                    {/* Поле ввода */}
                    <div className="relative">
                      <Input
                        type="number"
                        step={p.step ?? "1"}
                        min={p.min}
                        max={p.max}
                        value={value ?? ""}
                        onChange={(e) => setBike({ [p.key]: e.target.value === "" ? undefined : parseFloat(e.target.value) } as any)}
                        placeholder={p.placeholder}
                        className={cn(
                          "pr-10 h-9",
                          isFilled ? "font-bold" : "font-normal text-muted-foreground",
                          locked && "bg-emerald-50 dark:bg-emerald-950/30"
                        )}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">
                        {p.unit}
                      </span>
                    </div>
                    {/* Статус — разный для обязательных/необязательных полей */}
                    {isFilled ? (
                      <div className="flex items-center gap-1 text-[9px] text-emerald-600 dark:text-emerald-400">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        {locked ? "Зафиксировано" : p.required ? "✓ Обязательное заполнено" : "Заполнено"}
                      </div>
                    ) : p.required ? (
                      <div className="flex items-center gap-1 text-[9px] text-orange-600 dark:text-orange-400 font-medium">
                        <span className="size-1.5 rounded-full bg-orange-500" />
                        ● Обязательное поле
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-[9px] text-muted-foreground/50">
                        <span className="size-1.5 rounded-full bg-muted-foreground/30" />
                        Дополнительно
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          </TooltipProvider>

          {/* Типоразмер колеса — для dual scale (компенсация перспективы по двум колёсам) */}
          <Card className={cn(
            "relative overflow-hidden transition-all border-cyan-300 dark:border-cyan-800"
          )}>
            <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: "#06b6d4" }} />
            <CardContent className="p-3 pl-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">⭕</span>
                  <span className="text-xs font-semibold">Типоразмер колеса</span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono">⌀</Badge>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-foreground p-0.5">
                      <Info className="size-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="space-y-1">
                      <p className="text-xs font-medium">
                        Стандартный размер обода. Используется для dual scale — компенсации
                        перспективы при фото-калибровке.
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Если фото снято под углом — переднее и заднее колеса выглядят разного размера.
                        Dual scale считает отдельный масштаб по каждому колесу. Выбери типоразмер —
                        система сама подставит примерный радиус покрышки.
                      </p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </div>
              <select
                value={wheelSizeId}
                onChange={(e) => setWheelSizeId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-cyan-300 bg-background text-foreground px-3 py-1 text-sm"
              >
                {WHEEL_SIZES.map((w) => (
                  <option key={w.id} value={w.id} className="bg-background text-foreground">
                    {w.label} ({w.tireDescription}, R≈{w.radiusMm} мм)
                  </option>
                ))}
              </select>
              {(() => {
                const sel = findWheelSize(wheelSizeId, null);
                if (!sel) return null;
                return (
                  <div className="flex items-center gap-1 text-[9px] text-cyan-600 dark:text-cyan-400">
                    <span className="size-1.5 rounded-full bg-cyan-500" />
                    Радиус: {sel.radiusMm} мм · {sel.tireDescription}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
