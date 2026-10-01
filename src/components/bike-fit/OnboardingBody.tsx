"use client";

import { useState, useEffect, useCallback } from "react";
import { User, Plus, Trash2, Ruler, Activity, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useBikeStore } from "@/lib/bike-store";
import { calcSaddleHeightLeMond, type BodyMeasurements } from "@/lib/bike-calculations";
import {
  getRiders,
  createRider,
  deleteRider,
  setActiveRider,
  getActiveRider,
  updateRider,
  type Rider,
} from "@/lib/bike-storage";

// ============================================================
// СПРАВКА ПО ПАРАМЕТРАМ ТЕЛА
// ============================================================
const BODY_FIELD_INFO: Record<string, { what: string; howTo: string }> = {
  height: {
    what: "Рост стоя, без обуви. От пола до макушки.",
    howTo: "Сними обувь, встань спиной к стене (пятки касаются стены). Прямая осанка, смотри вперёд. Попроси кого-нибудь приложить книгу/линейку к макушке параллельно полу и отметь на стене. Измерь рулеткой от пола до отметки в см.",
  },
  inseam: {
    what: "Внутренний шов ноги — расстояние от паха до пола по внутренней стороне ноги. Главное измерение для байк-фита (от него считается высота седла по LeMond).",
    howTo: "Сними обувь и встань ровно, ноги на ширине плеч. Возьми книгу в твёрдом переплёте, прижми корешок ВПЛОТНУЮ к паху (как седло на велосипеде). Измерь рулеткой от верхнего края книги строго вертикально до пола. Повтори 2-3 раза и возьми среднее — точность критична. Типичные значения: 70-90 см.",
  },
  footLength: {
    what: "Длина стопы от пятки до кончика самого длинного пальца. Нужна для расчёта положения шипов и длины шатуна.",
    howTo: "Сними обувь и носок. Поставь стопу на лист бумаги, обведи пятку и самый длинный палец. Измерь расстояние между этими двумя точками в см. Стандартная мужская 42-43 ≈ 27 см, 45 ≈ 29 см.",
  },
  armLength: {
    what: "Длина руки от акромиона (выступающая косточка плеча) до косточки запястья (шиловидного отростка лучевой). Влияет на расчёт выноса руля и посадки.",
    howTo: "Стоя прямо, рука опущена вдоль туловища. Найди акромион — костный выступ плечевого сустава. Найди запястную косточку со стороны мизинца. Измерь между ними в см. Типичные значения 55-65 см.",
  },
  torsoLength: {
    what: "Длина туловища от акромиона (плечо) до вертлюга бедра (тазовая косточка). Влияет на Reach и посадку.",
    howTo: "Стоя прямо. Найди акромион (костный выступ плеча). Найди большой вертел бедра (выступающая косточка на боковой поверхности таза). Измерь между ними по прямой вертикали в см. Типичные значения 50-58 см.",
  },
};

/**
 * Заметная ⓘ-иконка с подсказкой «что это / как измерить».
 * Единый размер (size-4 = 16px) и фирменный sky-цвет — видна и на телефоне.
 */
function InfoTip({
  what,
  howTo,
  contentClassName,
}: {
  what: string;
  howTo: string;
  contentClassName?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Подсказка: что это и как измерить"
          className="inline-flex size-6 items-center justify-center rounded-full text-sky-500 transition-colors hover:text-sky-600 dark:text-sky-400 dark:hover:text-sky-300"
        >
          <Info className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className={cn("max-w-xs", contentClassName)}>
        <div className="space-y-1">
          <p className="text-xs font-medium">{what}</p>
          <p className="text-[11px] text-muted-foreground">{howTo}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function OnboardingBody() {
  const { body, setBody } = useBikeStore();
  const [riders, setRiders] = useState<Rider[]>([]);
  const [activeRider, setActiveRiderState] = useState<Rider | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newHeight, setNewHeight] = useState("");
  const [newInseam, setNewInseam] = useState("");

  const reload = useCallback(() => {
    const all = getRiders();
    setRiders(all);
    const active = getActiveRider();
    setActiveRiderState(active);
    if (active) {
      setBody(active.body);
    }
  }, [setBody]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleCreate = () => {
    if (!newName.trim()) return;
    const h = parseFloat(newHeight) || 0;
    const i = parseFloat(newInseam) || 0;
    const newBody: BodyMeasurements = {
      height: h,
      inseam: i,
      footLength: undefined,
      armLength: undefined,
      torsoLength: undefined,
      flexibility: 3,
    };
    const rider = createRider(newName.trim(), newBody);
    setBody(newBody);
    setRiders(getRiders());
    setActiveRiderState(rider);
    setShowNew(false);
    setNewName("");
    setNewHeight("");
    setNewInseam("");
  };

  const handleSelect = (rider: Rider) => {
    setActiveRider(rider.id);
    setActiveRiderState(rider);
    setBody(rider.body);
  };

  const handleDelete = (id: string) => {
    if (!confirm("Удалить райдера?")) return;
    deleteRider(id);
    const remaining = getRiders();
    setRiders(remaining);
    if (activeRider?.id === id) {
      const newActive = remaining[0] ?? null;
      setActiveRiderState(newActive);
      if (newActive) {
        setActiveRider(newActive.id);
        setBody(newActive.body);
      }
    }
  };

  const handleUpdateBody = (updates: Partial<typeof body>) => {
    const newBody: BodyMeasurements = {
      height: body.height,
      inseam: body.inseam,
      footLength: body.footLength,
      armLength: body.armLength,
      torsoLength: body.torsoLength,
      flexibility: body.flexibility,
      ...updates,
    };
    setBody(newBody);
    if (activeRider) {
      updateRider(activeRider.id, newBody);
      setActiveRiderState({ ...activeRider, body: newBody });
      setRiders(getRiders());
    }
  };

  const lemondSaddleHeight =
    body.inseam > 0 ? calcSaddleHeightLeMond(body.inseam) : null;

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-4">
      {/* Заголовок */}
      <div className="flex items-center gap-2">
        <User className="size-5 text-orange-500" />
        <h2 className="text-lg font-bold">Райдеры</h2>
        <span className="text-xs text-muted-foreground">
          Выбери райдера или создай нового
        </span>
      </div>

      {/* Сетка карточек райдеров */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {riders.map((rider) => {
          const isActive = activeRider?.id === rider.id;
          return (
            <Card
              key={rider.id}
              className={cn(
                "relative overflow-hidden cursor-pointer transition-all",
                isActive
                  ? "border-sky-400 ring-2 ring-sky-400/30 shadow-md"
                  : "border-border hover:border-sky-300 hover:shadow-sm"
              )}
              onClick={() => handleSelect(rider)}
            >
              {/* Цветная полоска */}
              <div className={cn(
                "absolute left-0 top-0 bottom-0 w-1.5",
                isActive ? "bg-sky-500" : "bg-muted-foreground/20"
              )} />
              <CardContent className="p-4 pl-5 space-y-3">
                {/* Имя + удаление */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "flex size-8 items-center justify-center rounded-full text-sm font-bold",
                      isActive ? "bg-sky-500 text-white" : "bg-muted text-muted-foreground"
                    )}>
                      {rider.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-semibold">{rider.name}</span>
                    {isActive && (
                      <Badge className="bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400 text-[10px]">
                        активен
                      </Badge>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(rider.id);
                    }}
                    className="text-rose-400 hover:text-rose-600 p-1"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                {/* Параметры (только у активного — редактируемые) */}
                {isActive ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        Рост
                        <InfoTip
                          what={BODY_FIELD_INFO.height.what}
                          howTo={BODY_FIELD_INFO.height.howTo}
                        />
                      </Label>
                      <Input
                        type="number"
                        value={rider.body.height || ""}
                        onChange={(e) => handleUpdateBody({ height: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-sm font-bold"
                        placeholder="178"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        Inseam
                        <InfoTip
                          what={BODY_FIELD_INFO.inseam.what}
                          howTo={BODY_FIELD_INFO.inseam.howTo}
                        />
                      </Label>
                      <Input
                        type="number"
                        value={rider.body.inseam || ""}
                        onChange={(e) => handleUpdateBody({ inseam: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-sm font-bold"
                        placeholder="82"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>📏 {rider.body.height} см</span>
                    <span>🦵 {rider.body.inseam} см</span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {/* Карточка "Добавить райдера" */}
        {showNew ? (
          <Card className="border-sky-300 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/20">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Plus className="size-4 text-sky-500" />
                <span className="text-sm font-semibold text-sky-700 dark:text-sky-400">
                  Новый райдер
                </span>
              </div>
              <Input
                placeholder="Имя"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-8 text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                    Рост (см)
                    <InfoTip
                      what={BODY_FIELD_INFO.height.what}
                      howTo={BODY_FIELD_INFO.height.howTo}
                    />
                  </Label>
                  <Input
                    type="number"
                    placeholder="178"
                    value={newHeight}
                    onChange={(e) => setNewHeight(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                    Inseam (см)
                    <InfoTip
                      what={BODY_FIELD_INFO.inseam.what}
                      howTo={BODY_FIELD_INFO.inseam.howTo}
                    />
                  </Label>
                  <Input
                    type="number"
                    placeholder="82"
                    value={newInseam}
                    onChange={(e) => setNewInseam(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
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
            className="border-dashed border-sky-300 dark:border-sky-800 hover:bg-sky-50/50 dark:hover:bg-sky-950/20 cursor-pointer transition-colors"
            onClick={() => setShowNew(true)}
          >
            <CardContent className="p-4 flex flex-col items-center justify-center min-h-[120px]">
              <Plus className="size-8 text-sky-400 mb-1" />
              <span className="text-xs text-sky-600 dark:text-sky-400 font-medium">
                Добавить райдера
              </span>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Дополнительные параметры тела (для активного райдера) */}
      {activeRider && (
        <Card className="border-orange-200 dark:border-orange-900">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Ruler className="size-4 text-orange-500" />
                <span className="text-sm font-semibold">
                  Дополнительные параметры: {activeRider.name}
                </span>
              </div>
              <InfoTip
                what="Зачем нужны дополнительные параметры?"
                howTo="Эти параметры необязательны, но повышают точность рекомендаций. Длина стопы влияет на расчёт длины шатуна и положения шипов. Длина руки и туловища — на расчёт длины выноса и Reach. Гибкость спины — на угол наклона корпуса. Чем больше данных — тем точнее индивидуальная подгонка."
                contentClassName="max-w-sm"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-xs text-muted-foreground flex items-center gap-0.5">
                  Длина стопы (см)
                  <InfoTip
                    what={BODY_FIELD_INFO.footLength.what}
                    howTo={BODY_FIELD_INFO.footLength.howTo}
                  />
                </Label>
                <Input
                  type="number"
                  value={body.footLength ?? ""}
                  onChange={(e) => handleUpdateBody({ footLength: parseFloat(e.target.value) || undefined })}
                  placeholder="27"
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground flex items-center gap-0.5">
                  Длина руки (см)
                  <InfoTip
                    what={BODY_FIELD_INFO.armLength.what}
                    howTo={BODY_FIELD_INFO.armLength.howTo}
                  />
                </Label>
                <Input
                  type="number"
                  value={body.armLength ?? ""}
                  onChange={(e) => handleUpdateBody({ armLength: parseFloat(e.target.value) || undefined })}
                  placeholder="62"
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground flex items-center gap-0.5">
                  Длина туловища (см)
                  <InfoTip
                    what={BODY_FIELD_INFO.torsoLength.what}
                    howTo={BODY_FIELD_INFO.torsoLength.howTo}
                  />
                </Label>
                <Input
                  type="number"
                  value={body.torsoLength ?? ""}
                  onChange={(e) => handleUpdateBody({ torsoLength: parseFloat(e.target.value) || undefined })}
                  placeholder="55"
                  className="h-9"
                />
              </div>
            </div>
            {/* Гибкость */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Гибкость спины</Label>
                <span className="text-[10px] font-semibold text-orange-600 dark:text-orange-400 tabular-nums">
                  {body.flexibility ?? 3}/5
                </span>
              </div>
              <Slider
                value={[body.flexibility ?? 3]}
                min={1}
                max={5}
                step={1}
                onValueChange={(v) => handleUpdateBody({ flexibility: v[0] })}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>1 Плохо</span>
                <span>3 Средне</span>
                <span>5 Отлично</span>
              </div>
              {/* Подробное описание шкалы */}
              <div className="rounded-md border border-orange-200 dark:border-orange-900 bg-orange-50/40 dark:bg-orange-950/20 p-2 text-[10px] space-y-1">
                <p className="text-orange-700 dark:text-orange-400 font-semibold">Как оценить свою гибкость:</p>
                <ul className="text-muted-foreground space-y-0.5">
                  <li><b>1</b> — Спина «деревянная», не могу дотянуться до носков с прямыми ногами, боль в пояснице при наклонах.</li>
                  <li><b>2</b> — Достаю до щиколоток с трудом, спина круглая, есть дискомфорт в пояснице.</li>
                  <li><b>3</b> — Средне. Достаю до стоп, спина умеренно прямая, без боли.</li>
                  <li><b>4</b> — Легко касаюсь пола кончиками пальцев с прямыми ногами, спина прямая.</li>
                  <li><b>5</b> — Ладони полностью на полу с прямыми ногами, спина идеально прямая (спортсмен/йога).</li>
                </ul>
                <p className="text-muted-foreground pt-1 border-t border-orange-200/50 dark:border-orange-900/50">
                  💡 Чем выше гибкость, тем более агрессивную (низкую) посадку можно рекомендовать без боли в пояснице и шее.
                </p>
              </div>
            </div>
            {/* LeMond */}
            {lemondSaddleHeight && (
              <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="size-4 text-orange-500" />
                  <span className="text-xs font-semibold text-orange-700 dark:text-orange-400">
                    Целевая высота седла (LeMond)
                  </span>
                </div>
                <p className="text-2xl font-bold tabular-nums text-orange-600 dark:text-orange-300">
                  {lemondSaddleHeight} <span className="text-sm font-normal text-muted-foreground">мм</span>
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  inseam × 0.883 = {body.inseam} × 0.883 = {lemondSaddleHeight} мм
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
    </TooltipProvider>
  );
}
