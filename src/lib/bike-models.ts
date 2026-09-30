/**
 * Мини-база моделей велосипедов для подбора рамы.
 *
 * ВАЖНО:
 * - База содержит только геометрические параметры (Stack, Reach, ETT и т.д.)
 * - НЕ содержит цены, отзывы, рейтинги качества
 * - НЕ содержит рекомендаций "купи эту" — только нейтральная информация
 * - Бренд/модель/год указаны для идентификации пользователем в Google
 *
 * Источники геометрии — официальные geometry charts производителей
 * (в основном для версий 2020-2023 годов). Геометрия может
 * незначительно отличаться от года к году.
 *
 * Цель базы: помочь пользователю понять, какие рамы подходят под его
 * параметры тела и цель. После этого он сам ищет их в Google и
 * принимает решение о покупке.
 */

import type { BikeType } from "./bike-params";

export type BikeCategory =
  | "race" // гоночный шоссейник
  | "endurance" // эндюранс (комфортное шоссе)
  | "aero" // аэро
  | "gravel" // грэвел
  | "xc" // кросс-кантри
  | "trail" // трейл
  | "hybrid" // гибрид
  | "urban"; // городской

export interface BikeModelSize {
  /** Название размера: "S", "M", "L", "54", "56" и т.д. */
  size: string;
  /** Stack в мм (вертикаль от BB до центра рулевой трубы) */
  stack: number;
  /** Reach в мм (горизонталь от BB до центра рулевой трубы) */
  reach: number;
  /** Эффективная верхняя труба в мм (опционально) */
  ett?: number;
  /** Угол подседельной трубы, ° (опционально) */
  sta?: number;
  /** Угол рулевой трубы, ° (опционально) */
  hta?: number;
  /** Колёсная база в мм (опционально) */
  wb?: number;
  /** BB Drop в мм (опционально) */
  bbDrop?: number;
  /** Длина подседельной трубы C-T, мм (опционально) */
  stLength?: number;
}

export interface BikeModel {
  /** Уникальный ID модели */
  id: string;
  /** Бренд (Specialized, Trek и т.д.) */
  brand: string;
  /** Модель (Tarmac SL7, Émonda SLR и т.д.) */
  model: string;
  /** Год начала выпуска (для идентификации в поиске) */
  yearFrom: number;
  /** Тип велосипеда */
  type: BikeType;
  /** Категория (race, endurance, gravel, xc, trail, hybrid, urban, aero) */
  category: BikeCategory;
  /** Доступные размеры с геометрией */
  sizes: BikeModelSize[];
  /** Краткое описание категории (для справки, без рекомендаций) */
  description: string;
}

// ============================================================
// БАЗА МОДЕЛЕЙ (~30 моделей)
// ============================================================

export const BIKE_MODELS: BikeModel[] = [
  // ============ ШОССЕЙНЫЕ RACE (гоночные) ============
  {
    id: "spec-tarmac-sl7",
    brand: "Specialized",
    model: "Tarmac SL7",
    yearFrom: 2020,
    type: "road",
    category: "race",
    description: "Универсальная гоночная рама, используется на Tour de France",
    sizes: [
      { size: "49", stack: 504, reach: 367, ett: 514, sta: 74.25, hta: 73.5, wb: 969, bbDrop: 73 },
      { size: "52", stack: 524, reach: 378, ett: 534, sta: 74.0, hta: 73.5, wb: 979, bbDrop: 73 },
      { size: "54", stack: 539, reach: 386, ett: 555, sta: 73.5, hta: 73.5, wb: 990, bbDrop: 73 },
      { size: "56", stack: 565, reach: 388, ett: 575, sta: 73.0, hta: 73.5, wb: 1005, bbDrop: 73 },
      { size: "58", stack: 586, reach: 400, ett: 595, sta: 72.5, hta: 73.5, wb: 1027, bbDrop: 73 },
    ],
  },
  {
    id: "trek-emonda-slr",
    brand: "Trek",
    model: "Émonda SLR",
    yearFrom: 2020,
    type: "road",
    category: "race",
    description: "Лёгкая гоночная рама для подъёмов",
    sizes: [
      { size: "47", stack: 499, reach: 360, ett: 507, sta: 74.5, hta: 72.5, wb: 963, bbDrop: 72 },
      { size: "50", stack: 514, reach: 372, ett: 522, sta: 74.0, hta: 72.7, wb: 974, bbDrop: 72 },
      { size: "52", stack: 534, reach: 373, ett: 538, sta: 73.5, hta: 73.0, wb: 979, bbDrop: 72 },
      { size: "54", stack: 547, reach: 382, ett: 555, sta: 73.5, hta: 73.5, wb: 982, bbDrop: 72 },
      { size: "56", stack: 565, reach: 388, ett: 575, sta: 73.0, hta: 73.5, wb: 1000, bbDrop: 72 },
      { size: "58", stack: 584, reach: 396, ett: 593, sta: 72.5, hta: 73.5, wb: 1009, bbDrop: 72 },
    ],
  },
  {
    id: "giant-tcr-adv",
    brand: "Giant",
    model: "TCR Advanced",
    yearFrom: 2019,
    type: "road",
    category: "race",
    description: "Компактная гоночная рама",
    sizes: [
      { size: "XS", stack: 498, reach: 372, ett: 521, sta: 74.5, hta: 72.5, wb: 966, bbDrop: 70 },
      { size: "S", stack: 516, reach: 374, ett: 538, sta: 74.0, hta: 73.0, wb: 975, bbDrop: 70 },
      { size: "M", stack: 534, reach: 378, ett: 555, sta: 73.5, hta: 73.0, wb: 977, bbDrop: 70 },
      { size: "ML", stack: 550, reach: 382, ett: 570, sta: 73.0, hta: 73.0, wb: 988, bbDrop: 70 },
      { size: "L", stack: 566, reach: 386, ett: 580, sta: 73.0, hta: 73.5, wb: 1000, bbDrop: 70 },
      { size: "XL", stack: 586, reach: 392, ett: 595, sta: 72.5, hta: 73.5, wb: 1012, bbDrop: 70 },
    ],
  },
  {
    id: "cannondale-supersix-evo",
    brand: "Cannondale",
    model: "SuperSix EVO",
    yearFrom: 2019,
    type: "road",
    category: "race",
    description: "Лёгкая универсальная гоночная рама",
    sizes: [
      { size: "48", stack: 487, reach: 374, ett: 511, sta: 74.0, hta: 71.0, wb: 963, bbDrop: 72 },
      { size: "51", stack: 514, reach: 378, ett: 535, sta: 73.5, hta: 72.0, wb: 974, bbDrop: 72 },
      { size: "54", stack: 539, reach: 382, ett: 555, sta: 73.0, hta: 73.0, wb: 985, bbDrop: 72 },
      { size: "56", stack: 564, reach: 386, ett: 575, sta: 72.5, hta: 73.5, wb: 1000, bbDrop: 72 },
      { size: "58", stack: 583, reach: 394, ett: 590, sta: 72.0, hta: 73.5, wb: 1013, bbDrop: 72 },
    ],
  },
  {
    id: "canyon-aeroad-cf",
    brand: "Canyon",
    model: "Aeroad CF",
    yearFrom: 2021,
    type: "road",
    category: "aero",
    description: "Аэродинамическая гоночная рама",
    sizes: [
      { size: "2XS", stack: 486, reach: 363, ett: 506, sta: 74.5, hta: 72.0, wb: 968, bbDrop: 72 },
      { size: "XS", stack: 505, reach: 370, ett: 523, sta: 74.0, hta: 72.5, wb: 974, bbDrop: 72 },
      { size: "S", stack: 522, reach: 376, ett: 540, sta: 74.0, hta: 73.0, wb: 980, bbDrop: 72 },
      { size: "M", stack: 542, reach: 381, ett: 557, sta: 73.5, hta: 73.0, wb: 985, bbDrop: 72 },
      { size: "L", stack: 564, reach: 387, ett: 577, sta: 73.0, hta: 73.5, wb: 1002, bbDrop: 72 },
      { size: "XL", stack: 585, reach: 396, ett: 596, sta: 72.5, hta: 73.5, wb: 1013, bbDrop: 72 },
    ],
  },
  {
    id: "merida-reacto",
    brand: "Merida",
    model: "Reacto",
    yearFrom: 2021,
    type: "road",
    category: "aero",
    description: "Аэро-гоночная рама",
    sizes: [
      { size: "XS", stack: 502, reach: 372, ett: 522, sta: 74.5, hta: 72.5, wb: 977, bbDrop: 70 },
      { size: "S", stack: 519, reach: 376, ett: 540, sta: 74.0, hta: 72.5, wb: 985, bbDrop: 70 },
      { size: "SM", stack: 534, reach: 380, ett: 555, sta: 73.5, hta: 73.0, wb: 990, bbDrop: 70 },
      { size: "M", stack: 552, reach: 384, ett: 572, sta: 73.0, hta: 73.0, wb: 1000, bbDrop: 70 },
      { size: "ML", stack: 567, reach: 388, ett: 582, sta: 73.0, hta: 73.5, wb: 1010, bbDrop: 70 },
      { size: "L", stack: 583, reach: 392, ett: 595, sta: 72.5, hta: 73.5, wb: 1022, bbDrop: 70 },
    ],
  },
  {
    id: "cervelo-r5",
    brand: "Cervélo",
    model: "R5",
    yearFrom: 2020,
    type: "road",
    category: "race",
    description: "Лёгкая рама для горных этапов",
    sizes: [
      { size: "48", stack: 494, reach: 367, ett: 514, sta: 74.5, hta: 71.0, wb: 966, bbDrop: 73 },
      { size: "51", stack: 519, reach: 375, ett: 535, sta: 73.5, hta: 72.0, wb: 976, bbDrop: 73 },
      { size: "54", stack: 542, reach: 382, ett: 555, sta: 73.0, hta: 73.0, wb: 986, bbDrop: 73 },
      { size: "56", stack: 567, reach: 386, ett: 575, sta: 72.5, hta: 73.5, wb: 1000, bbDrop: 73 },
      { size: "58", stack: 586, reach: 394, ett: 593, sta: 72.0, hta: 73.5, wb: 1013, bbDrop: 73 },
    ],
  },
  {
    id: "pinarello-dogma-f",
    brand: "Pinarello",
    model: "Dogma F",
    yearFrom: 2021,
    type: "road",
    category: "race",
    description: "Премиальная итальянская гоночная рама",
    sizes: [
      { size: "47", stack: 482, reach: 374, ett: 510, sta: 74.5, hta: 70.0, wb: 967, bbDrop: 71 },
      { size: "50", stack: 508, reach: 378, ett: 530, sta: 74.0, hta: 71.5, wb: 977, bbDrop: 71 },
      { size: "51.5", stack: 524, reach: 382, ett: 543, sta: 74.0, hta: 72.5, wb: 980, bbDrop: 71 },
      { size: "53", stack: 541, reach: 384, ett: 555, sta: 73.5, hta: 73.0, wb: 988, bbDrop: 71 },
      { size: "54.5", stack: 557, reach: 388, ett: 570, sta: 73.0, hta: 73.5, wb: 998, bbDrop: 71 },
      { size: "56", stack: 575, reach: 392, ett: 585, sta: 72.5, hta: 73.5, wb: 1010, bbDrop: 71 },
    ],
  },

  // ============ ШОССЕЙНЫЕ ENDURANCE (комфортные) ============
  {
    id: "spec-roubaix",
    brand: "Specialized",
    model: "Roubaix",
    yearFrom: 2019,
    type: "road",
    category: "endurance",
    description: "Эндюранс с амортизацией Future Shock",
    sizes: [
      { size: "49", stack: 537, reach: 360, ett: 514, sta: 74.5, hta: 72.0, wb: 973, bbDrop: 75 },
      { size: "52", stack: 557, reach: 372, ett: 534, sta: 74.0, hta: 72.5, wb: 984, bbDrop: 75 },
      { size: "54", stack: 572, reach: 380, ett: 555, sta: 73.5, hta: 73.0, wb: 994, bbDrop: 75 },
      { size: "56", stack: 598, reach: 384, ett: 575, sta: 73.0, hta: 73.5, wb: 1010, bbDrop: 75 },
      { size: "58", stack: 619, reach: 396, ett: 595, sta: 72.5, hta: 73.5, wb: 1031, bbDrop: 75 },
    ],
  },
  {
    id: "trek-domane-slr",
    brand: "Trek",
    model: "Domane SLR",
    yearFrom: 2020,
    type: "road",
    category: "endurance",
    description: "Эндюранс с амортизацией IsoSpeed",
    sizes: [
      { size: "47", stack: 532, reach: 363, ett: 507, sta: 75.0, hta: 71.0, wb: 973, bbDrop: 80 },
      { size: "50", stack: 547, reach: 372, ett: 522, sta: 74.5, hta: 71.5, wb: 984, bbDrop: 80 },
      { size: "52", stack: 567, reach: 374, ett: 538, sta: 74.0, hta: 72.0, wb: 990, bbDrop: 80 },
      { size: "54", stack: 580, reach: 382, ett: 555, sta: 73.5, hta: 72.5, wb: 997, bbDrop: 80 },
      { size: "56", stack: 598, reach: 388, ett: 575, sta: 73.0, hta: 73.0, wb: 1015, bbDrop: 80 },
      { size: "58", stack: 617, reach: 396, ett: 593, sta: 72.5, hta: 73.5, wb: 1024, bbDrop: 80 },
    ],
  },
  {
    id: "giant-defy-adv",
    brand: "Giant",
    model: "Defy Advanced",
    yearFrom: 2021,
    type: "road",
    category: "endurance",
    description: "Комфортное эндюранс-шоссе",
    sizes: [
      { size: "XS", stack: 527, reach: 373, ett: 525, sta: 74.5, hta: 71.0, wb: 977, bbDrop: 70 },
      { size: "S", stack: 545, reach: 375, ett: 543, sta: 74.0, hta: 71.5, wb: 985, bbDrop: 70 },
      { size: "M", stack: 563, reach: 379, ett: 560, sta: 73.5, hta: 72.0, wb: 995, bbDrop: 70 },
      { size: "ML", stack: 580, reach: 383, ett: 575, sta: 73.0, hta: 72.5, wb: 1007, bbDrop: 70 },
      { size: "L", stack: 597, reach: 387, ett: 585, sta: 72.5, hta: 73.0, wb: 1017, bbDrop: 70 },
      { size: "XL", stack: 617, reach: 393, ett: 600, sta: 72.0, hta: 73.5, wb: 1029, bbDrop: 70 },
    ],
  },
  {
    id: "cannondale-synapse",
    brand: "Cannondale",
    model: "Synapse",
    yearFrom: 2022,
    type: "road",
    category: "endurance",
    description: "Эндюранс с амортизацией",
    sizes: [
      { size: "48", stack: 526, reach: 373, ett: 514, sta: 75.0, hta: 71.0, wb: 975, bbDrop: 78 },
      { size: "51", stack: 551, reach: 378, ett: 535, sta: 74.0, hta: 71.5, wb: 984, bbDrop: 78 },
      { size: "54", stack: 574, reach: 382, ett: 555, sta: 73.5, hta: 72.5, wb: 995, bbDrop: 78 },
      { size: "56", stack: 596, reach: 386, ett: 575, sta: 73.0, hta: 73.0, wb: 1010, bbDrop: 78 },
      { size: "58", stack: 614, reach: 394, ett: 590, sta: 72.5, hta: 73.5, wb: 1022, bbDrop: 78 },
    ],
  },
  {
    id: "canyon-endurace-cf",
    brand: "Canyon",
    model: "Endurace CF",
    yearFrom: 2020,
    type: "road",
    category: "endurance",
    description: "Комфортное эндюранс-шоссе с прямой посадкой",
    sizes: [
      { size: "2XS", stack: 516, reach: 366, ett: 510, sta: 74.5, hta: 71.0, wb: 977, bbDrop: 70 },
      { size: "XS", stack: 535, reach: 372, ett: 527, sta: 74.0, hta: 71.5, wb: 984, bbDrop: 70 },
      { size: "S", stack: 553, reach: 376, ett: 543, sta: 73.5, hta: 72.0, wb: 991, bbDrop: 70 },
      { size: "M", stack: 568, reach: 381, ett: 560, sta: 73.0, hta: 72.5, wb: 1000, bbDrop: 70 },
      { size: "L", stack: 590, reach: 386, ett: 580, sta: 72.5, hta: 73.0, wb: 1015, bbDrop: 70 },
      { size: "XL", stack: 611, reach: 394, ett: 595, sta: 72.0, hta: 73.5, wb: 1030, bbDrop: 70 },
    ],
  },
  {
    id: "cervelo-caledonia",
    brand: "Cervélo",
    model: "Caledonia",
    yearFrom: 2021,
    type: "road",
    category: "endurance",
    description: "Эндюранс с возможностью установки широких шин",
    sizes: [
      { size: "48", stack: 524, reach: 367, ett: 514, sta: 75.0, hta: 71.5, wb: 970, bbDrop: 75 },
      { size: "51", stack: 549, reach: 375, ett: 535, sta: 74.0, hta: 72.0, wb: 982, bbDrop: 75 },
      { size: "54", stack: 572, reach: 382, ett: 555, sta: 73.5, hta: 72.5, wb: 995, bbDrop: 75 },
      { size: "56", stack: 597, reach: 386, ett: 575, sta: 73.0, hta: 73.0, wb: 1010, bbDrop: 75 },
      { size: "58", stack: 616, reach: 394, ett: 590, sta: 72.5, hta: 73.5, wb: 1022, bbDrop: 75 },
    ],
  },

  // ============ ГРЭВЕЛ ============
  {
    id: "spec-diverge",
    brand: "Specialized",
    model: "Diverge",
    yearFrom: 2020,
    type: "gravel",
    category: "gravel",
    description: "Универсальный грэвел с Future Shock",
    sizes: [
      { size: "49", stack: 537, reach: 365, ett: 519, sta: 75.0, hta: 71.0, wb: 1000, bbDrop: 80 },
      { size: "52", stack: 557, reach: 373, ett: 539, sta: 74.5, hta: 71.5, wb: 1012, bbDrop: 80 },
      { size: "54", stack: 572, reach: 380, ett: 559, sta: 74.0, hta: 72.0, wb: 1024, bbDrop: 80 },
      { size: "56", stack: 598, reach: 384, ett: 579, sta: 73.5, hta: 72.5, wb: 1040, bbDrop: 80 },
      { size: "58", stack: 619, reach: 396, ett: 599, sta: 73.0, hta: 73.0, wb: 1056, bbDrop: 80 },
    ],
  },
  {
    id: "trek-checkpoint",
    brand: "Trek",
    model: "Checkpoint",
    yearFrom: 2020,
    type: "gravel",
    category: "gravel",
    description: "Грэвел с множеством креплений",
    sizes: [
      { size: "49", stack: 532, reach: 363, ett: 515, sta: 75.0, hta: 70.5, wb: 997, bbDrop: 80 },
      { size: "52", stack: 547, reach: 372, ett: 530, sta: 74.5, hta: 71.0, wb: 1009, bbDrop: 80 },
      { size: "54", stack: 567, reach: 374, ett: 546, sta: 74.0, hta: 71.5, wb: 1020, bbDrop: 80 },
      { size: "56", stack: 585, reach: 382, ett: 566, sta: 73.5, hta: 72.0, wb: 1035, bbDrop: 80 },
      { size: "58", stack: 604, reach: 390, ett: 584, sta: 73.0, hta: 72.5, wb: 1046, bbDrop: 80 },
    ],
  },
  {
    id: "giant-revolt",
    brand: "Giant",
    model: "Revolt",
    yearFrom: 2021,
    type: "gravel",
    category: "gravel",
    description: "Грэвел с длинной колесной базой",
    sizes: [
      { size: "XS", stack: 527, reach: 373, ett: 525, sta: 74.5, hta: 70.5, wb: 1004, bbDrop: 70 },
      { size: "S", stack: 545, reach: 375, ett: 543, sta: 74.0, hta: 71.0, wb: 1017, bbDrop: 70 },
      { size: "M", stack: 563, reach: 379, ett: 560, sta: 73.5, hta: 71.5, wb: 1027, bbDrop: 70 },
      { size: "ML", stack: 580, reach: 383, ett: 575, sta: 73.0, hta: 72.0, wb: 1040, bbDrop: 70 },
      { size: "L", stack: 597, reach: 387, ett: 585, sta: 72.5, hta: 72.5, wb: 1050, bbDrop: 70 },
      { size: "XL", stack: 617, reach: 393, ett: 600, sta: 72.0, hta: 73.0, wb: 1062, bbDrop: 70 },
    ],
  },
  {
    id: "cannondale-topstone",
    brand: "Cannondale",
    model: "Topstone",
    yearFrom: 2019,
    type: "gravel",
    category: "gravel",
    description: "Грэвел с амортизацией Kingpin",
    sizes: [
      { size: "48", stack: 526, reach: 373, ett: 514, sta: 75.0, hta: 70.5, wb: 1010, bbDrop: 80 },
      { size: "51", stack: 551, reach: 378, ett: 535, sta: 74.0, hta: 71.0, wb: 1024, bbDrop: 80 },
      { size: "54", stack: 574, reach: 382, ett: 555, sta: 73.5, hta: 71.5, wb: 1035, bbDrop: 80 },
      { size: "56", stack: 596, reach: 386, ett: 575, sta: 73.0, hta: 72.0, wb: 1050, bbDrop: 80 },
      { size: "58", stack: 614, reach: 394, ett: 590, sta: 72.5, hta: 72.5, wb: 1062, bbDrop: 80 },
    ],
  },
  {
    id: "canyon-grail",
    brand: "Canyon",
    model: "Grail",
    yearFrom: 2020,
    type: "gravel",
    category: "gravel",
    description: "Грэвел с двойным выносом Hover Bar",
    sizes: [
      { size: "2XS", stack: 516, reach: 366, ett: 510, sta: 75.0, hta: 70.0, wb: 1004, bbDrop: 75 },
      { size: "XS", stack: 535, reach: 372, ett: 527, sta: 74.5, hta: 70.5, wb: 1017, bbDrop: 75 },
      { size: "S", stack: 553, reach: 376, ett: 543, sta: 74.0, hta: 71.0, wb: 1029, bbDrop: 75 },
      { size: "M", stack: 568, reach: 381, ett: 560, sta: 73.5, hta: 71.5, wb: 1041, bbDrop: 75 },
      { size: "L", stack: 590, reach: 386, ett: 580, sta: 73.0, hta: 72.0, wb: 1056, bbDrop: 75 },
      { size: "XL", stack: 611, reach: 394, ett: 595, sta: 72.5, hta: 72.5, wb: 1071, bbDrop: 75 },
    ],
  },
  {
    id: "cervelo-aspero",
    brand: "Cervélo",
    model: "Áspero",
    yearFrom: 2020,
    type: "gravel",
    category: "gravel",
    description: "Гоночный грэвел",
    sizes: [
      { size: "48", stack: 514, reach: 372, ett: 514, sta: 75.0, hta: 71.0, wb: 1005, bbDrop: 75 },
      { size: "51", stack: 539, reach: 378, ett: 535, sta: 74.0, hta: 71.5, wb: 1018, bbDrop: 75 },
      { size: "54", stack: 562, reach: 384, ett: 555, sta: 73.5, hta: 72.0, wb: 1031, bbDrop: 75 },
      { size: "56", stack: 587, reach: 388, ett: 575, sta: 73.0, hta: 72.5, wb: 1044, bbDrop: 75 },
      { size: "58", stack: 606, reach: 396, ett: 590, sta: 72.5, hta: 73.0, wb: 1057, bbDrop: 75 },
    ],
  },
  {
    id: "merida-silex",
    brand: "Merida",
    model: "Silex",
    yearFrom: 2020,
    type: "gravel",
    category: "gravel",
    description: "Грэвел с прямой посадкой",
    sizes: [
      { size: "XS", stack: 560, reach: 372, ett: 525, sta: 75.5, hta: 71.0, wb: 1020, bbDrop: 80 },
      { size: "S", stack: 580, reach: 376, ett: 540, sta: 75.0, hta: 71.0, wb: 1030, bbDrop: 80 },
      { size: "SM", stack: 595, reach: 380, ett: 555, sta: 74.5, hta: 71.5, wb: 1040, bbDrop: 80 },
      { size: "M", stack: 610, reach: 384, ett: 570, sta: 74.0, hta: 72.0, wb: 1050, bbDrop: 80 },
      { size: "ML", stack: 625, reach: 388, ett: 585, sta: 73.5, hta: 72.5, wb: 1060, bbDrop: 80 },
      { size: "L", stack: 640, reach: 392, ett: 600, sta: 73.0, hta: 73.0, wb: 1070, bbDrop: 80 },
    ],
  },
  {
    id: "pinarello-grevil",
    brand: "Pinarello",
    model: "Grevil",
    yearFrom: 2019,
    type: "gravel",
    category: "gravel",
    description: "Премиальный итальянский грэвел",
    sizes: [
      { size: "47", stack: 532, reach: 374, ett: 514, sta: 75.0, hta: 70.5, wb: 1014, bbDrop: 75 },
      { size: "50", stack: 558, reach: 378, ett: 535, sta: 74.5, hta: 71.0, wb: 1024, bbDrop: 75 },
      { size: "51.5", stack: 574, reach: 382, ett: 548, sta: 74.0, hta: 71.5, wb: 1030, bbDrop: 75 },
      { size: "53", stack: 591, reach: 384, ett: 560, sta: 73.5, hta: 72.0, wb: 1038, bbDrop: 75 },
      { size: "54.5", stack: 607, reach: 388, ett: 575, sta: 73.0, hta: 72.5, wb: 1046, bbDrop: 75 },
      { size: "56", stack: 625, reach: 392, ett: 585, sta: 72.5, hta: 73.0, wb: 1054, bbDrop: 75 },
    ],
  },

  // ============ MTB ХАРДТЕЙЛ (XC) ============
  {
    id: "spec-epic-ht",
    brand: "Specialized",
    model: "Epic HT",
    yearFrom: 2021,
    type: "mtb",
    category: "xc",
    description: "Гоночный XC-хардтейл",
    sizes: [
      { size: "S", stack: 555, reach: 405, sta: 74.0, hta: 68.5, wb: 1056, bbDrop: 70 },
      { size: "M", stack: 580, reach: 425, sta: 73.5, hta: 68.5, wb: 1090, bbDrop: 70 },
      { size: "L", stack: 605, reach: 445, sta: 73.0, hta: 68.5, wb: 1124, bbDrop: 70 },
      { size: "XL", stack: 630, reach: 465, sta: 73.0, hta: 68.5, wb: 1158, bbDrop: 70 },
    ],
  },
  {
    id: "trek-procaliber",
    brand: "Trek",
    model: "Procaliber",
    yearFrom: 2020,
    type: "mtb",
    category: "xc",
    description: "XC-хардтейл с IsoSpeed",
    sizes: [
      { size: "S", stack: 560, reach: 405, sta: 74.0, hta: 68.5, wb: 1058, bbDrop: 70 },
      { size: "M", stack: 580, reach: 425, sta: 73.5, hta: 68.5, wb: 1090, bbDrop: 70 },
      { size: "ML", stack: 600, reach: 435, sta: 73.5, hta: 68.5, wb: 1107, bbDrop: 70 },
      { size: "L", stack: 615, reach: 445, sta: 73.0, hta: 68.5, wb: 1124, bbDrop: 70 },
      { size: "XL", stack: 635, reach: 465, sta: 73.0, hta: 68.5, wb: 1158, bbDrop: 70 },
    ],
  },
  {
    id: "giant-xtc-adv",
    brand: "Giant",
    model: "XTC Advanced",
    yearFrom: 2020,
    type: "mtb",
    category: "xc",
    description: "Карбоновый XC-хардтейл",
    sizes: [
      { size: "S", stack: 555, reach: 415, sta: 74.0, hta: 69.0, wb: 1062, bbDrop: 65 },
      { size: "M", stack: 580, reach: 430, sta: 73.5, hta: 69.0, wb: 1090, bbDrop: 65 },
      { size: "L", stack: 605, reach: 450, sta: 73.0, hta: 69.0, wb: 1124, bbDrop: 65 },
      { size: "XL", stack: 630, reach: 470, sta: 73.0, hta: 69.0, wb: 1158, bbDrop: 65 },
    ],
  },
  {
    id: "cannondale-fsi",
    brand: "Cannondale",
    model: "F-Si",
    yearFrom: 2020,
    type: "mtb",
    category: "xc",
    description: "Лёгкий карбоновый XC-хардтейл",
    sizes: [
      { size: "S", stack: 555, reach: 410, sta: 74.5, hta: 69.0, wb: 1058, bbDrop: 70 },
      { size: "M", stack: 575, reach: 425, sta: 74.0, hta: 69.5, wb: 1086, bbDrop: 70 },
      { size: "L", stack: 595, reach: 445, sta: 73.5, hta: 69.5, wb: 1120, bbDrop: 70 },
      { size: "XL", stack: 620, reach: 465, sta: 73.0, hta: 70.0, wb: 1156, bbDrop: 70 },
    ],
  },
  {
    id: "canyon-grand-canyon",
    brand: "Canyon",
    model: "Grand Canyon",
    yearFrom: 2020,
    type: "mtb",
    category: "xc",
    description: "Универсальный хардтейл",
    sizes: [
      { size: "S", stack: 565, reach: 415, sta: 73.5, hta: 68.5, wb: 1070, bbDrop: 70 },
      { size: "M", stack: 585, reach: 430, sta: 73.5, hta: 68.5, wb: 1098, bbDrop: 70 },
      { size: "L", stack: 605, reach: 450, sta: 73.0, hta: 68.5, wb: 1132, bbDrop: 70 },
      { size: "XL", stack: 630, reach: 470, sta: 73.0, hta: 68.5, wb: 1166, bbDrop: 70 },
    ],
  },

  // ============ MTB ДВУПОДВЕС (TRAIL) ============
  {
    id: "spec-stumpjumper",
    brand: "Specialized",
    model: "Stumpjumper",
    yearFrom: 2021,
    type: "mtb",
    category: "trail",
    description: "Универсальный трейл-двуподвес",
    sizes: [
      { size: "S", stack: 580, reach: 425, sta: 76.0, hta: 66.5, wb: 1180, bbDrop: 30 },
      { size: "M", stack: 600, reach: 445, sta: 76.0, hta: 66.5, wb: 1212, bbDrop: 30 },
      { size: "L", stack: 620, reach: 465, sta: 76.0, hta: 66.5, wb: 1244, bbDrop: 30 },
      { size: "XL", stack: 640, reach: 485, sta: 76.0, hta: 66.5, wb: 1276, bbDrop: 30 },
    ],
  },
  {
    id: "trek-fuel-ex",
    brand: "Trek",
    model: "Fuel EX",
    yearFrom: 2020,
    type: "mtb",
    category: "trail",
    description: "Универсальный трейл-двуподвес",
    sizes: [
      { size: "S", stack: 590, reach: 425, sta: 76.5, hta: 66.5, wb: 1178, bbDrop: 30 },
      { size: "M", stack: 610, reach: 445, sta: 76.5, hta: 66.5, wb: 1210, bbDrop: 30 },
      { size: "ML", stack: 625, reach: 455, sta: 76.5, hta: 66.5, wb: 1227, bbDrop: 30 },
      { size: "L", stack: 640, reach: 470, sta: 76.5, hta: 66.5, wb: 1244, bbDrop: 30 },
      { size: "XL", stack: 660, reach: 490, sta: 76.5, hta: 66.5, wb: 1276, bbDrop: 30 },
    ],
  },
  {
    id: "giant-trance",
    brand: "Giant",
    model: "Trance",
    yearFrom: 2021,
    type: "mtb",
    category: "trail",
    description: "Трейл-двуподвес с ходом 140/115",
    sizes: [
      { size: "S", stack: 580, reach: 430, sta: 76.0, hta: 66.5, wb: 1186, bbDrop: 30 },
      { size: "M", stack: 605, reach: 450, sta: 76.0, hta: 66.5, wb: 1218, bbDrop: 30 },
      { size: "L", stack: 625, reach: 470, sta: 76.0, hta: 66.5, wb: 1250, bbDrop: 30 },
      { size: "XL", stack: 650, reach: 490, sta: 76.0, hta: 66.5, wb: 1282, bbDrop: 30 },
    ],
  },

  // ============ ГОРОДСКИЕ / ГИБРИДЫ ============
  {
    id: "spec-sirrus",
    brand: "Specialized",
    model: "Sirrus",
    yearFrom: 2020,
    type: "hybrid",
    category: "hybrid",
    description: "Спортивный гибрид с прямой посадкой",
    sizes: [
      { size: "XS", stack: 540, reach: 370, sta: 73.0, hta: 70.0, wb: 990, bbDrop: 70 },
      { size: "S", stack: 565, reach: 380, sta: 73.0, hta: 70.5, wb: 1010, bbDrop: 70 },
      { size: "M", stack: 590, reach: 385, sta: 73.0, hta: 71.0, wb: 1030, bbDrop: 70 },
      { size: "L", stack: 615, reach: 395, sta: 72.5, hta: 71.0, wb: 1050, bbDrop: 70 },
      { size: "XL", stack: 640, reach: 405, sta: 72.0, hta: 71.5, wb: 1070, bbDrop: 70 },
    ],
  },
  {
    id: "trek-fx",
    brand: "Trek",
    model: "FX",
    yearFrom: 2020,
    type: "hybrid",
    category: "hybrid",
    description: "Универсальный фитнес-гибрид",
    sizes: [
      { size: "S", stack: 555, reach: 380, sta: 73.5, hta: 70.5, wb: 1004, bbDrop: 75 },
      { size: "M", stack: 580, reach: 385, sta: 73.0, hta: 71.0, wb: 1024, bbDrop: 75 },
      { size: "ML", stack: 595, reach: 395, sta: 73.0, hta: 71.0, wb: 1041, bbDrop: 75 },
      { size: "L", stack: 615, reach: 405, sta: 72.5, hta: 71.5, wb: 1058, bbDrop: 75 },
      { size: "XL", stack: 640, reach: 415, sta: 72.0, hta: 71.5, wb: 1075, bbDrop: 75 },
    ],
  },
  {
    id: "giant-escape",
    brand: "Giant",
    model: "Escape",
    yearFrom: 2020,
    type: "city",
    category: "urban",
    description: "Городской гибрид",
    sizes: [
      { size: "S", stack: 555, reach: 380, sta: 73.0, hta: 70.5, wb: 1010, bbDrop: 70 },
      { size: "M", stack: 580, reach: 390, sta: 73.0, hta: 71.0, wb: 1030, bbDrop: 70 },
      { size: "ML", stack: 595, reach: 400, sta: 72.5, hta: 71.0, wb: 1047, bbDrop: 70 },
      { size: "L", stack: 615, reach: 410, sta: 72.5, hta: 71.5, wb: 1064, bbDrop: 70 },
      { size: "XL", stack: 640, reach: 420, sta: 72.0, hta: 71.5, wb: 1081, bbDrop: 70 },
    ],
  },
  {
    id: "cannondale-quick",
    brand: "Cannondale",
    model: "Quick",
    yearFrom: 2020,
    type: "hybrid",
    category: "hybrid",
    description: "Городской гибрид с прямой посадкой",
    sizes: [
      { size: "XS", stack: 545, reach: 375, sta: 73.5, hta: 70.0, wb: 1000, bbDrop: 75 },
      { size: "S", stack: 570, reach: 380, sta: 73.0, hta: 70.5, wb: 1020, bbDrop: 75 },
      { size: "M", stack: 590, reach: 385, sta: 73.0, hta: 71.0, wb: 1040, bbDrop: 75 },
      { size: "L", stack: 610, reach: 395, sta: 72.5, hta: 71.5, wb: 1060, bbDrop: 75 },
      { size: "XL", stack: 635, reach: 405, sta: 72.0, hta: 71.5, wb: 1080, bbDrop: 75 },
    ],
  },
];

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Получить список брендов из базы.
 */
export function getBrands(): string[] {
  return Array.from(new Set(BIKE_MODELS.map((m) => m.brand))).sort();
}

/**
 * Получить все модели указанного типа.
 */
export function getModelsByType(type: BikeType): BikeModel[] {
  return BIKE_MODELS.filter((m) => m.type === type);
}

/**
 * Получить уникальные размеры (строки) для модели.
 */
export function getModelSizes(model: BikeModel): string[] {
  return model.sizes.map((s) => s.size);
}

/**
 * Найти размер модели, ближайший к целевым параметрам.
 */
export function findClosestSize(
  model: BikeModel,
  targetStack: number,
  targetReach: number
): { size: BikeModelSize; distance: number } | null {
  if (model.sizes.length === 0) return null;
  let best = model.sizes[0];
  let bestDist = Math.sqrt(
    Math.pow(best.stack - targetStack, 2) +
      Math.pow(best.reach - targetReach, 2)
  );
  for (const s of model.sizes) {
    const d = Math.sqrt(
      Math.pow(s.stack - targetStack, 2) +
        Math.pow(s.reach - targetReach, 2)
    );
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return { size: best, distance: bestDist };
}

/**
 * Рассчитать оценку соответствия модели целевым параметрам.
 *
 * Возвращает количество звёзд (1-5):
 * - 5 ★: distance < 10 мм — идеальное соответствие
 * - 4 ★: distance < 20 мм — очень хорошее
 * - 3 ★: distance < 30 мм — хорошее
 * - 2 ★: distance < 50 мм — приемлемое
 * - 1 ★: distance >= 50 мм — плохое
 */
export function calculateFitScore(
  distance: number
): 1 | 2 | 3 | 4 | 5 {
  if (distance < 10) return 5;
  if (distance < 20) return 4;
  if (distance < 30) return 3;
  if (distance < 50) return 2;
  return 1;
}

/**
 * Найти модели, подходящие под целевые параметры и тип велосипеда.
 *
 * Возвращает массив с closest size и score для каждой модели.
 * Отсортировано по убыванию соответствия (наилучшие — первыми).
 */
export interface ModelMatchResult {
  model: BikeModel;
  closestSize: BikeModelSize;
  distance: number;
  score: 1 | 2 | 3 | 4 | 5;
  stackDelta: number; // фактический - целевой (положительный = выше)
  reachDelta: number; // фактический - целевой (положительный = длиннее)
}

export function findMatchingModels(
  type: BikeType,
  targetStack: number,
  targetReach: number
): ModelMatchResult[] {
  const models = getModelsByType(type);
  const results: ModelMatchResult[] = [];

  for (const model of models) {
    const closest = findClosestSize(model, targetStack, targetReach);
    if (!closest) continue;
    results.push({
      model,
      closestSize: closest.size,
      distance: closest.distance,
      score: calculateFitScore(closest.distance),
      stackDelta: closest.size.stack - targetStack,
      reachDelta: closest.size.reach - targetReach,
    });
  }

  // Сортируем: сначала лучшие (наибольший score, наименьшее distance)
  return results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.distance - b.distance;
  });
}

/**
 * Сгенерировать URL для поиска модели в Google.
 *
 * Пример: "Specialized Tarmac SL7 54" →
 * "https://www.google.com/search?q=Specialized+Tarmac+SL7+54+geometry"
 */
export function getGoogleSearchUrl(
  brand: string,
  model: string,
  yearFrom: number,
  size: string
): string {
  const query = `${brand} ${model} ${yearFrom} ${size} geometry`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/**
 * Подсчитать количество моделей по типам.
 */
export function getModelCountByType(): Record<BikeType, number> {
  const counts: Record<BikeType, number> = {
    road: 0,
    gravel: 0,
    mtb: 0,
    hybrid: 0,
    city: 0,
  };
  for (const m of BIKE_MODELS) {
    counts[m.type]++;
  }
  return counts;
}
