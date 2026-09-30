# CHANGELOG — BikeFit AI

Все заметные изменения проекта документируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версионирование следует [SemVer](https://semver.org/lang/ru/).

---

## [Unreleased] — Hardening + UX improvements

### Добавлено
- **CHANGELOG.md** — этот файл. Теперь все изменения ведутся централизованно.
- **`src/lib/bike-perspective.ts`** (новый файл):
  - `WHEEL_SIZES` — 8 типоразмеров колёс (20″/24″/26″/27.5″/29″/650b/700c/650c)
  - `findWheelSize()` — поиск по id или ближайшему радиусу
  - `ensureWheelTops()` — авто-расчёт верха колёс если пользователь не отметил
  - `getLocalScale()` — линейная интерполяция масштаба по X
  - `getPerspectiveDistanceMm/Horizontal/Vertical` — расчёт через локальный масштаб
  - `safeCalculateBikeGeometry` — НИКОГДА не возвращает null, всегда числа + warnings
- **`src/lib/use-onboarding-context.ts`** (новый файл):
  - Безопасный хук с `SAFE_DEFAULTS` для SSR (window undefined)
  - Defensive try-catch: если Zustand недоступен — defaults вместо throw
  - Derived поля: `hasStartedOnboarding`, `isOnboardingComplete`
  - Convenience hooks: `useIsOnboardingComplete()`, `useHasStartedOnboarding()`
- **Tooltip-описания ко всем полям ввода**:
  - Параметры велосипеда: SH, ETT, Stem, α, CR, BBH, WB — каждый с подробным "как измерить"
  - Параметры тела: Рост, Inseam, Длина стопы, Длина руки, Длина туловища (через `BODY_FIELD_INFO` словарь)
  - Гибкость спины: 5 уровней с практическими описаниями + badge "X/5"
- **Info-тултипы в OnboardingContext**:
  - У заголовков секций (Тип велосипеда / Цель посадки / Жалобы)
  - У каждой цели (Комфорт/Спорт/Гонки) — подробности с углом спины, длиной выноса
  - У каждой жалобы — причины и как проверить
- **Лупа 2.5×** при перетаскивании точек в `InteractivePhoto` — SVG overlay с clipPath
- **Dual Scale** (`bike-dual-scale.ts`) — компенсация перспективы по двум колёсам
- **Confidence Score** (`bike-confidence.ts`) — вместо `null` валидации: всегда возвращает числа с уровнем уверенности `high|medium|low`
- **Wheel Size Dropdown** в `BikeParametersForm` — 8 типоразмеров с радиусами покрышек

### Изменено
- **bike-store.ts** — добавлен `wheelSizeId: string` state + `setWheelSizeId` action (persist в localStorage)
- **SH (Высота седла)** — переписана методика: измеряется до **верхней поверхности седла** (не до хомута рельсов)
- **ETT** — переписана методика: горизонталь от **top cap до оси подседельного штыря** (не от ST верха до HT верха)
- **Математика ETT** (`bike-geometry-math.ts`): теперь считает от `htTopCap` если отмечен, иначе от `htTop`
- **ТОЛЬКО 2 обязательных поля** вместо 7:
  - **SH** (Высота седла) — для проверки положения ног
  - **WB** (Колёсная база) — масштаб для алгоритма (пиксели → мм)
  - Остальные (ETT, Stem, α, CR, BBH) — опциональны, алгоритм высчитает по фото
- **`isStepAccessible`** в `page.tsx` упрощён — порог только SH + WB
- **`use-pose-landmarker.ts`** усилен cleanup:
  - `isMountedRef` для race condition protection во время загрузки модели
  - `animFrameIdRef` + `animFrameId` state для отслеживания активного `requestAnimationFrame`
  - `scheduleDetect()` и `cancelScheduledDetect()` методы для real-time детекции
  - Cleanup: отменяет rAF → закрывает landmarker → nullifies refs → сбрасывает state, всё в try-catch
- **`calibrate-bike-photo/route.ts`** — добавлена Zod валидация:
  - `ImageFileSchema` — валидация файла (size >0, ≤20MB, mime type jpeg/png/webp)
  - `VlmResponseSchema` — валидация структуры ответа VLM (7 точек с x/y)
  - VLM вызов обёрнут в try-catch (502 Bad Gateway с `details`)
  - JSON.parse обёрнут в try-catch с извлечением JSON из markdown fallback
  - `formatError()` для безопасного форматирования неизвестных ошибок
  - Возвращает 400/502 с подробной информацией об ошибке
- **`bike-geometry-math.ts`** — добавлены безопасные утилиты:
  - `Point2D` интерфейс для не-null точек (для позы райдера)
  - `clamp(value, min, max)` — защита от NaN в Math.acos/asin
  - `calculateDistance(p1, p2)` — для не-null точек
  - `calculateJointAngle(p1, vertex, p2)` — теорема косинусов с clamp защитой, возвращает 0 при совпадении точек
  - `safeAcos()`, `safeAsin()`, `safeDivide()` обёртки
- **BikeParametersForm**:
  - `bg-transparent` → `bg-background text-foreground` во всех `<select>` и `<option>`
  - Статусы: оранжевый "● Обязательное поле" / зелёный "✓ Обязательное заполнено" / "Дополнительно"
  - Карточка "Типоразмер колеса" с dropdown внизу страницы параметров
- **OnboardingBody**:
  - `BODY_FIELD_INFO` словарь с 5 параметрами тела (what + howTo)
  - Info-тултипы у Рост/Inseam в карточке райдера
  - Шкала гибкости с 5 уровнями описаний

### Удалено
- **Поле «Радиус колеса WH»** полностью убрано из формы — радиус берётся из dropdown типоразмера
- **`applyPerspectiveCorrection`** — мутация точек удалена. Точки остаются на местах, перспектива компенсируется в расчётах
- **`autoAlignBikeHorizon`** — поворот точек удалён (фатально ломал Y координаты при перспективе)
- **AI/VLM детекция точек** — кнопка и хендлер удалены (слишком неточно)
- **Кнопка "Применить коррекцию перспективы"** — заменена на информационный блок без кнопки

### Исправлено
- **Dropdown select текст** — был белый на белом фоне в тёмной теме:
  - Заменил `bg-transparent` на `bg-background text-foreground` во всех `<select>` и `<option>`
  - Добавил агрессивный CSS в `globals.css` с `!important` для всех `option` состояний
  - Использует CSS variables (var(--background), var(--foreground)) для адаптации под тему
  - Проверено: BikeType select, WheelSize select — оба теперь видимы
- **Placement bug** — после 8 основных точек не ставились верх колёс:
  - Расширил `order` массив с 8 до 10 точек (добавил `rearWheelTop`, `frontWheelTop`)
- **`onPhotoChange` echo bug** — parent re-render сбрасывал `placementMode`:
  - Добавил `lastEmittedRef` для отслеживания собственных эмитов
- **htTopCap постоянно терялся** — добавлен во все 5 мест: `BikeKeyPoints` interface, `POINT_CONFIG`, `startManualPlacement`, `order[]`, кнопки выбора точки
- **Точки слишком маленькие** — увеличил радиус в 2 раза (0.011 → 0.022 от ширины фото)

### Безопасность
- **Zod валидация** в `/api/calibrate-bike-photo`:
  - `ImageFileSchema` — проверка файла (size, mime type)
  - `VlmResponseSchema` — проверка структуры ответа VLM
  - Возвращает 400/502 с подробной информацией об ошибке
- **Безопасная математика** в `bike-geometry-math.ts`:
  - `clamp()` для защиты `Math.acos`/`asin` от NaN
  - `calculateJointAngle()` с защитой от деления на 0
  - `safeAcos()`, `safeAsin()`, `safeDivide()` обёртки
- **Cleanup в `use-pose-landmarker`**:
  - `isMountedRef` для race condition protection
  - `animFrameIdRef` для отслеживания `requestAnimationFrame`
  - Defensive cleanup: cancel rAF + close landmarker + nullify refs

---

## [0.1.0] — 2026-09-21

### Добавлено
- Первоначальный MVP на Next.js 16 + TypeScript + Tailwind 4 + shadcn/ui
- **MediaPipe PoseLandmarker** для анализа позы с 3 ракурсов (сбоку/сзади/спереди)
- 6 ключевых метрик: угол колена, бедра, спины, голеностопа, плеча, KOPS
- Тёмная/светлая тема, мобильная адаптация
- API route `/api/calibrate-bike-photo` с VLM через z-ai-web-dev-sdk
- 5-шаговый wizard: Контекст → Тело → Велосипед → Сводка → Анализ
- CAD-схема велосипеда с размерными линиями и угловыми дугами
- 13 параметров с международными аббревиатурами (ETT, Reach, Stack, STA, HTA, etc.)
- Карточки райдеров и велосипедов — независимое хранение в localStorage
- Photo-калибратор с 8 ключевыми точками велосипеда

---

## Соглашения

### Версионирование
- **MAJOR** — breaking changes в архитектуре
- **MINOR** — новые фичи, обратно совместимые
- **PATCH** — bugfixes, мелкие улучшения

### Категории
- **Добавлено** — новые функции
- **Изменено** — изменения в существующем функционале
- **Удалено** — убранные функции
- **Исправлено** — bugfixes
- **Безопасность** — уязвимости и защиты

---

## [Unreleased.1] — 2026-09-29 — Fix wheelTop placement + scale=0 bug

### Исправлено
- **Верх колёс не ставился**: `order` массив в `handlePointsChange` содержал только 8 точек
  (без `rearWheelTop`/`frontWheelTop`). Расширил до 10 точек. После передней оси теперь
  автоматически переходит к `rearWheelTop`, потом к `frontWheelTop`.
- **Масштаб: 0.000 мм/пикс**: `computeParamsFromPhoto` вызывался БЕЗ `imgSize`, из-за чего
  функция сразу возвращала `scale: 0` и все параметры `null`.
  Теперь `imgSize` передаётся: `computeParamsFromPhoto(pts, finalScale, knownKey, imgSize)`.
  → После этого `handleCalibrate` ("Вычислить все параметры") разблокируется и работает.
  → После этого `handleApplyAveraged` ("Применить усреднённые значения") тоже работает,
    т.к. `comparisons` массив перестаёт быть пустым.

### НЕ тронуто (как просил пользователь)
- "Мульти-калибровка" — обсудим позже
- "Выровнять по осям колёс" — обсудим позже
- BikeSchemaDiagram — не трогать

### Backup для отката
- .backup/BikePhotoCalibrator.tsx.before-fix
- .backup/InteractivePhoto.tsx.before-fix

---

## [Unreleased.2] — 2026-09-29 — Remove multi-calibration + auto-align (new approach)

### Удалено
- **Мульти-калибровка (чекбокс)** — убран из UI полностью
  - Старая логика: усредняла масштаб по SH+ETT+WB, что математически некорректно с dual scale
  - Заменена на авто-выбор primary параметра (см. ниже)
- **Кнопка «Выровнять по осям колёс»** — убрана полностью
  - Поворот точек вокруг BB фатально ломал геометрию при перспективе (точки «уплывали» с железа)
  - Заменена на математическую компенсацию через tiltAngleRad

### Добавлено
- **`src/lib/bike-calibration-helper.ts`** (новый файл):
  - `calculateAutoFitCalibration()` — авто-выбор primary параметра по наибольшему px-расстоянию
  - `tiltAngleRad` — математический угол наклона горизонта (БЕЗ поворота точек)
  - Скрытая валидация: если расхождение масштабов >12% → warning
  - `calculateAdjustedSeatAngle()` — расчёт угла с учётом tiltAngleRad
  - `correctedHorizontalProjection()` / `correctedVerticalProjection()` — корректировка проекций

### Изменено
- `runCalibration` теперь использует `calculateAutoFitCalibration` для:
  - Авто-выбора primary параметра (SH/ETT/WB) с наибольшим px-расстоянием
  - Расчёта `tiltAngleRad` (математический офсет, БЕЗ поворота точек)
  - Скрытой валидации остальных параметров (>12% → warning)
- Новый UI блок «Авто-калибровка» показывает:
  - Primary параметр (например WB)
  - scale (мм/пикс)
  - Наклон горизонта (в градусах)
  - Результат валидации (✓ пройдена / ⚠ расхождение)
- Удалены: useMultiCalibration, multiCalibration, autoAlignApplied, autoAlignSafety, handleAutoAlign, handleResetAutoAlign
- Удалены импорты: ScanLine (lucide-react), autoAlignBikeHorizon, isAutoAlignSafe, calibrateScaleMulti, MultiCalibrationResult

### Принципы новой логики
1. Точки на фото НЕ двигаются — остаются там, где их поставил пользователь
2. Наклон горизонта компенсируется математически через `tiltAngleRad`
3. Primary параметр выбирается автоматически (наибольшее px-расстояние = минимальная погрешность)
4. Остальные параметры — только для скрытой валидации (расхождение >12% → warning)

### Backup для отката
- .backup/BikePhotoCalibrator.tsx.before-multicalib
- .backup/bike-geometry-math.ts.before-multicalib

---

## [Naming] — Запланировано

### Варианты названий проекта
Пользователь предоставил список названий для будущего выбора:

**Короткие/динамичные:**
- FitSnap / BikeSnap — «идеальная посадка в один клик / по одному снимку»
- EasyFit / BikeEasyFit — простота без сложной теории
- SmartBikeFit — умный ИИ-алгоритм за простой картинкой
- FitExpress — быстрая экспресс-примерка в магазине

**Акцент на точность/комфорт:**
- ExactFit — «точная посадка»
- RideRight — «Катайся правильно»
- PerfectRide — «Идеальная поездка»
- BikeSizing / SizeMyBike — «Подбери размер моего байка»

**Русскоязычные:**
- БайкФит Экспресс
- ВелоПримерка / ВелоПосадка
- ТочныйБайк

### Фавориты пользователя
- **ВелоПримерка** — для России (русский рынок)
- **BikeSnap** — для английского рынка

### Слоганы
- FitSnap: «Идеальная посадка по одному фото»
- EasyBikeFit: «Простой подбор велосипеда за 1 минуту»

### Статус
Решение отложено — пользователь сказал «потом выберем».

---

## [Unreleased.3] — 2026-09-29 — CRITICAL: Fix scale units mismatch (626032 → 626 mm)

### Исправлено (КРИТИЧЕСКИЙ БАГ)
- **SH = 626032 мм вместо ~626 мм** — масштаб был завышен в ~1000 раз.
- **Причина**: `computeRigorousBikeParams` использовал `toPx()` для конвертации нормализованных [0..1] координат в пиксели, но `scale` из `calibrateScale` был в **мм/норм.ед.** (не мм/пиксель).
- Результат: `пиксели × (мм/норм.ед.) = норм.ед. × imgSize × мм/норм.ед. = мм × imgSize` ← перебор ~1200x.
- **Решение**: переписал `computeRigorousBikeParams` — теперь работает с **нормализованными** координатами [0..1] напрямую (без `toPx()`).
  - `normDist(a, b)` — Евклидово расстояние в норм.ед.
  - `normH(a, b)` — горизонталь в норм.ед.
  - `normV(a, b)` — вертикаль в норм.ед.
  - `normPerp(p, lineA, lineB)` — перпендикуляр в норм.ед.
  - `pxDist = normDist × safeScale = норм.ед. × (мм/норм.ед.) = мм` ✓
- Углы STA/HTA не пострадали (atan2 масштабо-независим), но `_imgSize` теперь неиспользуется (помечен как `_`).
- Параметр `imgSize` в `computeParamsFromPhoto` по-прежнему нужен (передаётся для проверки и future use).
