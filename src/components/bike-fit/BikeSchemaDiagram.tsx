import { cn } from "@/lib/utils";
import type { BikeMeasurements } from "@/lib/bike-calculations";
import { X, Camera } from "lucide-react";
import { useBikeStore } from "@/lib/bike-store";

interface BikeSchemaDiagramProps {
  className?: string;
  /** Текущие значения параметров велосипеда из формы */
  values?: BikeMeasurements;
  /** Показывать ли шапку с источником значений Reach/Stack */
  showSourceHint?: boolean;
}

export function BikeSchemaDiagram({ className, values, showSourceHint = true }: BikeSchemaDiagramProps) {
  const { setBike } = useBikeStore();

  // Форматирование значения для отображения на схеме
  const fmt = (v: number | undefined, unit: string): string => {
    if (v == null || v === 0) return "—";
    return unit === "°" ? `${v}°` : `${v}`;
  };

  // Значения из формы
  const v = values;

  // Источник Reach/Stack: они НЕ вводятся в форме, а только вычисляются из фото
  const hasPhotoComputed = (v?.reach != null && v.reach > 0) || (v?.stack != null && v.stack > 0);

  // Очистить Reach/Stack (значения из калибровки фото)
  const clearPhotoComputed = () => {
    setBike({ reach: undefined, stack: undefined, setback: undefined });
  };

  return (
    <div className={cn("w-full", className)}>
      {showSourceHint && hasPhotoComputed && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/30 px-3 py-2 text-xs">
          <Camera className="size-3.5 mt-0.5 shrink-0 text-sky-500" />
          <div className="flex-1">
            <span className="text-sky-700 dark:text-sky-400 font-medium">
              Reach и Stack вычислены из фото:
            </span>{" "}
            <span className="text-muted-foreground">
              Reach = <b>{v?.reach}</b>, Stack = <b>{v?.stack}</b>
              {(v?.setback != null && v.setback > 0) && <>, Setback = <b>{v?.setback}</b></>}
              . Эти значения не вводятся в форме — они берутся из карточки «Калибровка геометрии по фото» и сохраняются между сессиями.
            </span>
          </div>
          <button
            onClick={clearPhotoComputed}
            className="shrink-0 inline-flex items-center gap-1 rounded-md border border-sky-300 dark:border-sky-800 bg-white dark:bg-sky-950/50 hover:bg-sky-100 dark:hover:bg-sky-900/50 px-2 py-1 text-[11px] font-medium text-sky-700 dark:text-sky-400 transition-colors"
            title="Очистить Reach, Stack и Setback"
          >
            <X className="size-3" />
            Очистить
          </button>
        </div>
      )}
      <div className="flex justify-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="560 20 640 560"
        style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
        className="w-full h-auto"
        role="img"
        aria-label="Схема велосипеда с параметрами геометрии"
      >
        <defs>
          <marker id="arrow-end" markerWidth="10" markerHeight="10" refX="10" refY="5" orient="auto-start-reverse">
            <polyline points="2,2 10,5 2,8" fill="none" stroke="#333" strokeWidth="1.2" />
          </marker>
          <marker id="arrow-start" markerWidth="10" markerHeight="10" refX="0" refY="5" orient="auto-start-reverse">
            <polyline points="8,2 0,5 8,8" fill="none" stroke="#333" strokeWidth="1.2" />
          </marker>
          <linearGradient id="frameGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="40%" stopColor="#eaeaea" />
            <stop offset="100%" stopColor="#cccccc" />
          </linearGradient>
        </defs>

        <rect x="560" y="20" width="640" height="560" fill="#ffffff" />

        {/* 1. ВСПОМОГАТЕЛЬНЫЕ ОСИ */}
        <g stroke="#999" strokeWidth="0.8" strokeDasharray="6,4">
          <line x1="530" y1="508" x2="1180" y2="508" />
          <line x1="510" y1="355" x2="1180" y2="355" />
          <line x1="979" y1="38" x2="1121" y2="508" />
          <line x1="809" y1="68" x2="809" y2="438" />
          <line x1="700" y1="403" x2="924" y2="403" />
          <line x1="1000" y1="58" x2="1000" y2="118" />
          <line x1="604" y1="338" x2="604" y2="528" />
          <line x1="1099" y1="338" x2="1099" y2="528" />
          <line x1="1054" y1="60" x2="1054" y2="82" />
        </g>

        {/* 2. РАМА И ВИЛКА */}
        <g strokeLinejoin="round" strokeLinecap="round">
          <line x1="731" y1="143" x2="704" y2="58" stroke="#2a2a2a" strokeWidth="14" />
          <rect x="692" y="53" width="22" height="8" rx="2" fill="#111" />
          <path d="M 658 50 C 678 50 707 46 737 50 C 742 54 737 59 678 59 C 663 59 653 54 658 50" fill="#111" />
          <path d="M 999 93 L 1054 79 L 1045 96 L 999 110 Z" fill="#222" />
          <path d="M 724 142 L 989 107 L 1010 108 L 1034 188 L 1104 351
                   C 1106 356 1102 360 1097 359 C 1095 359 1093 357 1092 355
                   L 1014 198 C 999 198 994 203 984 213
                   L 829 400 C 830 416 814 427 800 420 C 794 417 790 410 789 403
                   L 607 363 C 601 365 596 360 597 354 C 597 351 599 349 602 348
                   L 734 233 L 724 142 Z"
            fill="url(#frameGrad)" stroke="#777" strokeWidth="1.5" />
          <path d="M 749 161 L 979 126 L 969 177 L 804 378 Z" fill="#ffffff" stroke="#777" strokeWidth="1.5" />
          <path d="M 620 354 L 790 383 C 785 373 785 363 780 353 L 750 246 Z" fill="#ffffff" stroke="#777" strokeWidth="1.5" />
          <circle cx="809" cy="403" r="16" fill="#222" />
          <circle cx="809" cy="403" r="7" fill="#fff" />
          <circle cx="1099" cy="355" r="6" fill="#333" />
          <circle cx="604" cy="355" r="5" fill="#333" />
        </g>

        {/* 3. РАЗМЕРНЫЕ ЛИНИИ */}
        <g stroke="#333" strokeWidth="0.8" fill="none">
          <line x1="809" y1="403" x2="731" y2="143" markerStart="url(#arrow-start)" markerEnd="url(#arrow-end)" />
          <line x1="694" y1="73" x2="1000" y2="73" markerStart="url(#arrow-start)" markerEnd="url(#arrow-end)" />
          <line x1="694" y1="140" x2="694" y2="63" strokeDasharray="4,3" stroke="#999" />
          {/* STA — дуга угла подседельной трубы (от горизонтали до оси ST, центр в BB) */}
          <path d="M 764 403 A 45 45 0 0 1 795 360" fill="none" stroke="#333" strokeWidth="0.8" markerEnd="url(#arrow-end)" />
          {/* α — дуга угла выноса.
              Пунктирная горизонталь на y=107 продлена до x=1100
              Дуга пересчитана из transform matrix(0,1,-1,0) с origin (1065,94):
              (1051,105)→(1076,108), (1079,83)→(1054,80)
              Идёт от горизонтального пунктира вверх к оси выноса */}
          <line x1="729" y1="107" x2="1100" y2="107" stroke="#999" strokeWidth="0.8" strokeDasharray="6,4" />
          <path d="M 1076 108 A 28 28 0 0 0 1054 80" fill="none" stroke="#333" strokeWidth="0.8" markerEnd="url(#arrow-end)" />
          <path d="M 1039 355 C 1039 329 1057 306 1082 298" markerEnd="url(#arrow-end)" />
          <line x1="810" y1="438" x2="1099" y2="438" markerStart="url(#arrow-start)" markerEnd="url(#arrow-end)" />
          <line x1="604" y1="438" x2="810" y2="438" markerStart="url(#arrow-start)" markerEnd="url(#arrow-end)" />
          <line x1="809" y1="403" x2="809" y2="508" markerStart="url(#arrow-start)" markerEnd="url(#arrow-end)" />
          <line x1="904" y1="354" x2="904" y2="402" markerStart="url(#arrow-start)" markerEnd="url(#arrow-end)" />
          <line x1="604" y1="478" x2="1099" y2="478" markerStart="url(#arrow-start)" markerEnd="url(#arrow-end)" />
          <line x1="809" y1="107" x2="809" y2="403" markerStart="url(#arrow-start)" markerEnd="url(#arrow-end)" />
          <line x1="809" y1="88" x2="1000" y2="88" markerStart="url(#arrow-start)" markerEnd="url(#arrow-end)" />
          <line x1="1001" y1="72" x2="1055" y2="72" markerStart="url(#arrow-start)" markerEnd="url(#arrow-end)" />
          <line x1="640" y1="75" x2="704" y2="58" strokeDasharray="6,4" stroke="#999" />
          <line x1="745" y1="420" x2="809" y2="403" strokeDasharray="6,4" stroke="#999" />
          <line x1="640" y1="75" x2="745" y2="420" markerStart="url(#arrow-start)" markerEnd="url(#arrow-end)" />
        </g>

        {/* 4. АББРЕВИАТУРЫ + ЗНАЧЕНИЯ */}
        <g
          fontSize="13"
          fontWeight="bold"
          fill="#333"
          textAnchor="middle"
          dominantBaseline="central"
          stroke="#fff"
          strokeWidth="4"
          paintOrder="stroke"
          strokeLinejoin="round"
        >
          {/* ST */}
          <text x="738" y="275">ST</text>
          {v?.seatTube != null && v.seatTube > 0 ? (
            <text x="738" y="295" fontSize="10" fontWeight="normal" fill="#0284c7">{v.seatTube}</text>
          ) : v?.saddleHeight != null && v.saddleHeight > 0 && (
            <text x="738" y="295" fontSize="10" fontWeight="normal" fill="#666">—</text>
          )}
          {/* ETT */}
          <text x="847" y="63">ETT</text>
          {v?.ett != null && v.ett > 0 && (
            <text x="847" y="48" fontSize="10" fontWeight="normal" fill="#0d8a4f">{v.ett}</text>
          )}
          {/* Stem */}
          <text x="1028" y="62">Stem</text>
          {v?.stem != null && v.stem > 0 && (
            <text x="1028" y="47" fontSize="10" fontWeight="normal" fill="#0d8a4f">{v.stem}</text>
          )}
          {/* α (угол выноса) — на (1055, 100) */}
          <text x="1055" y="100">α</text>
          {v?.stemAngle != null && (
            <text x="1055" y="115" fontSize="10" fontWeight="normal" fill="#0d8a4f">{v.stemAngle}°</text>
          )}
          {/* SH */}
          <text x="680" y="257">SH</text>
          {v?.saddleHeight != null && v.saddleHeight > 0 && (
            <text x="680" y="277" fontSize="10" fontWeight="normal" fill="#0d8a4f">{v.saddleHeight}</text>
          )}
          {/* STA */}
          <text x="755" y="370">STA</text>
          {v?.sta != null && v.sta > 0 && (
            <text x="755" y="385" fontSize="10" fontWeight="normal" fill="#0284c7">{v.sta}°</text>
          )}
          {/* Reach — вычислен из фото (синий цвет = фотоисточник) */}
          <text x="905" y="78">Reach</text>
          {v?.reach != null && v.reach > 0 && (
            <text x="905" y="63" fontSize="10" fontWeight="normal" fill="#0284c7">{v.reach}</text>
          )}
          {/* Stack — вычислен из фото (синий цвет = фотоисточник) */}
          <text x="838" y="255">Stack</text>
          {v?.stack != null && v.stack > 0 && (
            <text x="838" y="240" fontSize="10" fontWeight="normal" fill="#0284c7">{v.stack}</text>
          )}
          {/* HTA */}
          <text x="1051" y="307">HTA</text>
          {v?.hta != null && v.hta > 0 && (
            <text x="1051" y="322" fontSize="10" fontWeight="normal" fill="#0284c7">{v.hta}°</text>
          )}
          {/* FC */}
          <text x="955" y="430">FC</text>
          {v?.frontCenter != null && v.frontCenter > 0 && (
            <text x="955" y="445" fontSize="10" fontWeight="normal" fill="#0284c7">{v.frontCenter}</text>
          )}
          {/* RC */}
          <text x="707" y="427">RC</text>
          {v?.rearCenter != null && v.rearCenter > 0 && (
            <text x="707" y="442" fontSize="10" fontWeight="normal" fill="#0284c7">{v.rearCenter}</text>
          )}
          {/* BB Drop */}
          <text x="924" y="378">BB</text>
          {v?.bbDrop != null && v.bbDrop > 0 && (
            <text x="924" y="393" fontSize="10" fontWeight="normal" fill="#0284c7">{v.bbDrop}</text>
          )}
          {/* BBH */}
          <text x="789" y="455">BBH</text>
          {v?.bbHeight != null && v.bbHeight > 0 && (
            <text x="789" y="475" fontSize="10" fontWeight="normal" fill="#0d8a4f">{v.bbHeight}</text>
          )}
          {/* WB */}
          <text x="862" y="470">WB</text>
          {v?.wheelbase != null && v.wheelbase > 0 && (
            <text x="862" y="490" fontSize="10" fontWeight="normal" fill="#0d8a4f">{v.wheelbase}</text>
          )}
        </g>

      </svg>
      </div>
    </div>
  );
}
