# BikeSnap — Worklog

Проект: PWA расчёта геометрии велосипеда по фото (`/home/z/my-project`).
Прод: https://bike-snap.vercel.app/ · Репозиторий: agent-slon-lab/BikeSnap (main).
Файл пересоздан 2026-10-12 (воркспейс пересобирался, старый лог утерян — полная
история в git log и CHANGELOG.md).

Хронология версий (кратко, из git log):
- v1.14.15–16 (Task ~22–23): InteractivePhoto v3.0/3.1 — зум щипком, двухфазная
  установка точек, лупа «над пальцем» с просветом 76 px.
- v1.14.17: самолечение белого экрана (chunk-error-recovery + SW-фолбэк).
- v1.14.18: пуш 3274888.
- v1.14.19 (Task 23): CameraCapture v1.8.0 «статичный трафарет» (пуш 5271665).
- v1.14.20 (Task 24): круги трафарета крупнее (0.14→0.18) + гибрид с живыми
  эллипсами (EMA 0.3, TTL 700 мс) (пуш be967e6).
- v1.14.21 (Task 25): InfoHint — тап-переключатель ⓘ вместо hover-тултипа;
  OnboardingBody, BikeParametersForm, ModelSelectionWizard переведены
  (пуш 12869e2; живая проверка на iPhone-эмуляции пройдена).
- v1.14.22 (Task 26): ТЗ «Pose Metrics Normalization & Joint Angle Fixes» —
  новый `src/lib/poseMetricsEngine.ts` (JOINT_NORMS: колено 140–150°
  разгибание / сгиб 30–40°, бедро 95–105°, торс 35–45°, голеностоп 90–110°);
  bike-fit.ts переведён на стандарт 180°=выпрямлен, sanity только <130°,
  торс-тексты расинвертированы (>45° вертикально / <35° горизонтально);
  cross-ref: склейка задвоенных советов по седлу (дельта LeMond >20 мм прячет
  микро-советы 2–3 мм); complaints: кросс-валидация «жалобы на руки + торс>50°»
  — «низкий руль» понижен, «седло вперёд / длинный вынос» повышен;
  `scripts/test-pose-norms.ts` 26 OK. Пуш de5a72b, деплой подтверждён.

---
Task ID: 27
Agent: main (Super Z)
Task: «там еще поправь- при редактировании/выставлении точек на фото, чтобы
всегда зум кружка был смещен от пальца/центра!!» — лупа разметки никогда
не должна оказываться под пальцем.

Work Log:
- Разрулил расхождение git (воркспейс пересобрался: локальный e3e1b57 дублировал
  запушенный de5a72b + нёс 3 несвязанных файла): `git reset --soft origin/main`,
  заготовки онбординг-тура (use-onboarding-context.ts, app-tour.tsx,
  OnboardingContext.tsx — нигде не подключены, WIP) закоммичены отдельно
  (3c0d42c).
- Диагноз бага: в InteractivePhoto v3.1.0 смещение лупы было только вертикальным
  (центр = R + 76 px над пальцем), а клампы `max/min(...)` возвращали круг в
  границы фото. Кадр с велосипедом почти всегда ландшафтный: 4:3 при контейнере
  390 px даёт высоту ~292 экранных px при радиусе лупы 84 px — вертикальному
  смещению (160 px + 84 px) места нет. Кламп ужимал отступ до 34–62 px от центра
  пальца при радиусе 84 px → палец ВНУТРИ круга, перекрестие под подушечкой.
- Решение: чистая экспортируемая функция `placeLoupeCenter()` (InteractivePhoto
  v3.2.0): перебор 8 направлений, центр круга на расстоянии R + просвет от
  пальца; порядок — вверх, вниз, бок в сторону большего простора + его
  диагонали, затем другая сторона; уровни просвета 76 px → 44 px; если ничего
  не помещается — дальний угол внутренней области (математический максимум
  просвета: дальняя точка выпуклого прямоугольника — угол).
- Тест `scripts/test-loupe-place.ts`: сетка 7×5 позиций пальца × 6 сценариев
  фото (4:3, 3:2, 16:9, портрет, десктоп, маленький телефон) — 211 проверок
  «круг внутри фото + палец вне круга»: 211 OK, 0 FAIL; регресс-кейс центра
  4:3@390 — просвет 43 px (было «палец внутри круга»).
- Обновлены тексты подсказок: «лупа смещена от пальца» вместо «лупа выше
  пальца» (блок установки, футер, docblock, комменты).
- Bump v1.14.23: app-version.ts, package.json, sw.js (CACHE bikesnap-v1.14.23),
  whats-new.ts (новая запись 2026-10-12), CHANGELOG.md (секция 1.14.23).
- `npx tsc --noEmit` OK; `npx next build` OK.
- Пуш ec9637b; `git ls-remote origin main` == HEAD ✓; prod sw.js отдаёт
  bikesnap-v1.14.23 ✓; живая проверка (iPhone 14 эмуляция): страница грузится,
  ошибок консоли нет.

Stage Summary:
- Прод = v1.14.23 (пуш ec9637b). Лупа при редактировании/выставлении точек
  всегда смещена от пальца (8 направлений × просвет 76/44 px + дальний угол),
  поведение покрыто юнит-тестом 211 OK.
- InteractivePhoto используется и в шаге 2 калибровки (BikePhotoCalibrator) —
  фикс закрывает оба сценария.
- Отложено: points=0 во всех view JSON отчётов (issue #4); подключение
  онбординг-тура (3 заготовки в репо, WIP).
- Следующая версия: v1.14.24.

---
Task ID: 28
Agent: main (Super Z)
Task: «на компе. допустим был велик сохранен и параметры. я закрыл вкладку.
или ф5. то потом фото вела не грузится. все параметры на месте. но фото
черный экран и не может загрузить!!!»

Work Log:
- Диагноз: BikePhotoCalibrator держал дисплейный blob: URL в state, а коммит
  точек разметки эмитил в onPhotoChange именно state-URL → blob перезаписывал
  photoData в bikefit-bikes (dataURL, сохранённый при выборе фото, терялся).
  После F5 blob мёртв → InteractivePhoto не декодирует → чёрный контейнер.
  Параметры целы (персистятся отдельно). Доп. фактор: photoUrl не было в deps
  колбэка — мог эмититься устаревший blob от предыдущего фото.
- Фикс 4 слоя: (1) savedPhotoDataRef в калибраторе — коммит точек эмитит
  персистентный dataURL (синхронизируется при выборе/очистке/смене велика);
  (2) guard в bike-storage.updateBikePhoto — blob: никогда не персистится,
  точки сохраняются; (3) getBikes самолечит испорченные записи (blob-photoData
  удаляется при первом чтении, keyPointsData цел — точки в нормированных
  координатах подходят к повторно загруженному фото); (4) InteractivePhoto:
  при imgError — панель «Фото не загрузилось» вместо чёрного экрана.
- Бонус: save() bike-storage в try/catch — квота не роняет сохранение.
- Тест scripts/test-bike-photo-persist.ts (мок localStorage): 10 OK — guard,
  самолечение, неприкосновенность валидных dataURL, квота.
- Bump v1.14.24 в 5 файлах; tsc + build OK; пуш 6b3ce16, ls-remote==HEAD ✓;
  prod sw.js = bikesnap-v1.14.24 ✓.
- Живая проверка на проде (agent-browser): подложил испорченную запись
  (photoData=blob:...), прошёл онбординг до шага 2 → запись вылечена
  (photoData удалён, точки целы), зона загрузки фото вместо чёрного экрана,
  консоль чистая. Тестовые данные из localStorage удалены.

Stage Summary:
- Прод = v1.14.24 (пуш 6b3ce16). Фото велика переживает F5; старые битые
  карточки лечатся автоматически при первом открытии шага 2.
- Следующая версия: v1.14.25.

---
Task ID: 29
Agent: main (Super Z)
Task: «УБЕРИ 1 вычислить все параметры. и 2 ниже записать в парам велика.
ЭТО ВСЕ ДОЛЖНО САМО И СРАЗУ И записываться/сохраняться и вычисляться!!!!
по тому что известно»

Work Log:
- Удалены ОБЕ кнопки из BikePhotoCalibrator («Вычислить все параметры» и
  «Записать в параметры велика») + обработчики handleCalibrate /
  handleApplyAveraged + авто-скролл к результатам (resultsRef).
- АВТО-РАСЧЁТ: один useEffect по [keyPoints, imgSize, knownValue, knownKey]
  запускает runCalibration, когда все 7 обязательных точек на месте (+imgSize
  +хотя бы один калибровочный размер). Разрозненные прямые вызовы удалены:
  драг точек, завершение разметки, onBlur полей калибровки, «сделать primary»,
  применение подсказок — теперь расчёт принадлежит одному эффекту.
- АВТО-ЗАПИСЬ: один useEffect после успешного расчёта (нет physicsViolations)
  сам вызывает onAveraged: Reach, Stack, STA, HTA, FC, RC, ST, BB Drop;
  WB — правило формы «только в пустое поле» сохранено.
- КРИТИЧНО: пишутся ФОТО-значения, НЕ усреднённые — усреднение в авто-режиме
  даёт дрейф avg(m,c)→m′→avg(m′,c)→… и бесконечные перезаписи. Reach/Stack и
  справочная геометрия в форме не вводятся — ручной ввод не перезаписывается.
- Guards: already-there (нет лишних записей на F5-восстановлении), sig-ref
  lastAutoAppliedRef (нет циклов), дебаунс 400 мс с cleanup (драг не создаёт
  setBike-шторм на каждый pointermove), ref обновляется ВНУТРИ таймера
  (отменённый таймер не теряет запись), сброс ref при новом фото/«Очистить»
  (повторная идентичная разметка в очищенную карточку записывается).
- lastAutoAppliedRef объявлен ВЫШЕ колбэков, которые его сбрасывают (TDZ).
- Тексты: подсказка «⚙️ Расчёт выполняется автоматически…» в панели,
  блокатор физики «запишется само после исправления», лог «после авто-расчёта»;
  комментарии bike-calculations.ts / BikeParametersForm.tsx обновлены.
- Bump v1.14.25 в 5 файлах + CHANGELOG; tsc + build OK.
- Пуш 4312df3, ls-remote==HEAD ✓, prod sw.js = bikesnap-v1.14.25 ✓.
- Живая проверка (agent-browser, десктоп 1440x900): сгенерировано тестовое
  фото велика 900x600 с точной геометрией (SH=700мм ⇔ 350px, WB 540px,
  скрипт scripts/make-test-bike-photo.py); райдер+велик созданы, фото
  загружено через upload, SH=700 в поле калибровки, 10 точек поставлены
  mouse-кликами по SVG-маппингу. РЕЗУЛЬТАТ: сравнение появилось БЕЗ кнопок,
  localStorage bikefit-bikes: reach 503, stack 371, sta 73.1, hta 72.7,
  wb 1080 (дозаполнен), fc 646, rc 444, st 601, bbDrop 69 — все совпадают
  с расчётными. F5: фото восстановлено (dataURL), расчёт сам пересчитался.
  Драг задней оси: RC 444→570, Reach 503→512 обновились в карточке сами.
  Консоль чистая. Тестовые данные localStorage удалены.

Stage Summary:
- Прод = v1.14.25 (пуш 4312df3). Обе кнопки удалены: расчёт запускается сам
  при достаточной разметке и известном размере, результаты сразу пишутся в
  карточку и автосохраняются. Правки точек/размеров пересчитывают всё мгновенно.
- Следующая версия: v1.14.26.

---
Task ID: 30
Agent: main (Super Z)
Task: «фото вела. наверное доавь еще кнопку : развернуть на весь экран.
пусть будет большое фото. и внем тоже и зум и прочее. иначе фото оч мелкое»

Work Log:
- InteractivePhoto v3.3.0: режим «на весь экран» — fixed inset-0 z-[90]
  оверлей (не нативный Fullscreen API — не работает в Safari iPhone).
  Все жесты работают как есть: тот же компонент, контейнер = весь вьюпорт.
- Кнопка Maximize2 в колонке зума (справа сверху, только вне фулскрина);
  в фулскрине вместо неё первой — зелёная Minimize2 «Выйти из полного
  экрана (Esc)».
- В фулскрине SVG absolute inset-0 w-full h-full (проценты высоты
  разрешаются всегда), preserveAspectRatio центрирует кадр; обёртка
  flex-1 min-h-0, подсказка точки и нижняя строка — shrink-0.
- Esc закрывает; на время фулскрина body overflow hidden (восстанавливается);
  role="dialog" aria-modal; состояние зума/панорамы сохраняется между
  режимами; ResizeObserver автоматически пересчитывает экранно-постоянные
  размеры (точки/лупа) при входе/выходе.
- Подсказки: в хинте разметки + «кнопка справа сверху развернёт фото
  на весь экран», в строке под фото — «кнопка справа сверху — весь экран»;
  aria-label/title на обеих кнопках.
- Bump v1.14.26 в 5 файлах + CHANGELOG; tsc чисто, next build OK.
- Пуш e380343, ls-remote==HEAD ✓, prod sw.js = bikesnap-v1.14.26 ✓.
- Живая проверка (agent-browser): десктоп 1440x900 — обычное фото
  1164x630 → фулскрин SVG 1416x860 (кадр ~1290x860), оверлей fixed z-90
  1440x884, body overflow hidden, зум-кнопка scale 1→1.4 с центрированием,
  Esc закрывает (expand-кнопка вернулась, скролл разблокирован), повторное
  открытие + закрытие по Minimize2 — ок. iPhone 16 (393x852): фулскрин
  открывается, SVG 377x820, кадр центрирован letterbox'ом. Консоль чистая.
  Тестовые райдер/велик из localStorage удалены.

Stage Summary:
- Прод = v1.14.26 (пуш e380343). Фото велика разворачивается на весь экран
  кнопкой справа сверху; внутри работают зум, панорама, точки и лупа;
  выход — зелёная кнопка или Esc.
- Следующая версия: v1.14.27.

---
Task ID: 31
Agent: main (Super Z)
Task: «что за бред? я реально ввел 680 а он пишет 68» — красный баннер
«Калибровка заблокирована: SH = 68 мм — вне физического диапазона» висел,
хотя в поле 680 и расчёт по логу прошёл успешно.

Work Log:
- Диагноз: авто-расчёт (v1.14.25) срабатывает на каждое изменение knownValue,
  включая ПРОМЕЖУТОЧНЫЕ при наборе «6»→«68»→«680»: на «68» прогон успел
  заблокироваться и поставить setError(...); прогон с «680» прошёл успешно,
  но runCalibration никогда не очищал прошлую ошибку → баннер вечный.
  Проверено по коду: setError(null) был только в обработчиках фото/очистки.
- Фикс 1: runCalibration в начале каждого прогона вызывает setError(null)
  (рядом с setAppliedSummary(null)); если текущее значение тоже мусорное —
  баннер ставится заново тем же кодом guard-а.
- Фикс 2: дебаунс 400 мс в эффекте авто-расчёта — промежуточные «6»/«68»
  при обычном наборе не доходят до ядра; драг точек не считает геометрию
  на каждый pointermove. Остановка набора на мусоре честно блокируется.
- Попутно: протухший комментарий «см» → «мм» в BikeMeasurements.saddleHeight
  (форма хранит мм: лейбл «впиши число в мм», placeholder 730) — проверено,
  юнит-бага нет.
- Bump v1.14.27 в 5 файлах + CHANGELOG; tsc чисто, next build OK.
- Пуш fe4d16f, ls-remote==HEAD ✓, prod sw.js = bikesnap-v1.14.27 ✓.
- Живая проверка (agent-browser, прод, 1440x900): сидирован велик с фото
  (dataURL 300x200) + 10 точек из лога пользователя. Нюансы воспроизведения:
  (1) при валидном SH в карточке/сторе формы guard по дизайну делает fallback
  на карточку — баннер НЕ ставится (лог «в поле калибровки: 68»), тест
  блокировки требует пустых SH и в карточке (bikefit-bikes), и в сторе
  формы (bikefit-storage.state.bike); (2) агентский fill делает blur →
  onBlur-лечилка мгновенно чинит поле — ввод только через native setter +
  input event без blur. ИТОГ: «68» → баннер 1-в-1 с скриншотом пользователя;
  «680» → баннер ИСЧЕЗ, расчёт прошёл (knownValue = 680 мм), результаты на
  месте. До фикса баннер остался бы навсегда. Консоль чистая, тестовые
  данные localStorage удалены.

Stage Summary:
- Прод = v1.14.27 (пуш fe4d16f). Ложный вечный баннер «SH = 68 мм» устранён:
  новый прогон снимает прошлую блокировку, набор 680 больше не оставляет
  баннер от промежуточного 68. Честная блокировка реального мусора сохранена.
- Следующая версия: v1.14.28.

---
Task ID: 32
Agent: main
Task: Баг-репорт «советы конченные и противоречащие сами себе» — фикс кросс-валидации рекомендаций (v1.14.28)

Work Log:
- Диагноз по дампу UI пользователя (SH=680, цель 759, колено 166.7°, спина 76.3°, плечо 41.5°, бедро 150.8°, Reach 339/411, Stack 648/595):
  (1) bike-cross-ref секция SH писала «седло выше нормы на 79» при 680 < 759 — знак дельты игнорировался;
  (2) советы генерировались изолированно → «опустите руль» (Stack) соседствовал с «поднимите руль» (плечо), «сократите дистанцию» (бедро) — при вертикальном корпусе;
  (3) подпись «Бедро» на фото висела на линии плечо→бедро (корпус);
  (4) KOPS (у.е.) рендерился с ложным «°»; направление сдвига по KOPS угадывалось по модулю;
  (5) опечатка «Слишком высокий седл».
- bike-cross-ref.ts: секция SH переписана — знак из дельты; при противофазе угла колена и SH (>5 мм) — конфликт-карточка (conflict: true) «Седло не трогайте, проверьте НМТ/разметку/SH; при верном кадре ориентируйтесь на угол колена, а не формулу». Новая кросс-проверка «руль вверх/вниз»: backAngle>45 && shoulder<70 → карточка «Опустите руль» заменяется конфликтной с приоритетом длины посадки (сначала Reach). KOPS берёт знак из signedValue.
- bike-fit.ts: AngleResult += unit?, signedValue?; makeResult(unit); kops передаёт «мм»/«у.е.» и знак. Новые экспорты: applyCrossMetricLogic() (при backAngle>45: плечу «поднимать руль нельзя», бедру «посадка НЕ растянута»; идемпотентен, не мутирует) и applySaddleHeightContext(analysis, SH, target) (колено ↔ LeMond противофаза → честный текст). analyzeBikeFit возвращает applyCrossMetricLogic(...).
- PhotoAnalysisSection.tsx: sideAnalysis = applySaddleHeightContext(applyCrossMetricLogic(raw), SH, calc.recommendedSaddleHeight) в useMemo — патчит и СТАРЫЕ анализы из localStorage без пересъёмки. Оверлей: бедро→колено «Бедро», колено→лодыжка «Колено» (новая линия), плечо→бедро «Корпус»; цвет линии = статус метрики (hex-маппинг good/warning/bad).
- CrossRefRecommendations.tsx: бейдж «⚠️ Противоречие данных» (AlertTriangle, amber) на конфликтных карточках.
- Recommendations.tsx + ResultsPanel.tsx: единица из метрики (unit ?? "°") — KOPS «0.5 у.е.» без градуса.
- bike-complaints.ts: «Слишком высокий седл» → «Слишком высокое седло».
- Тест scripts/test-crossref-v1428.ts (npx tsx, чистые импорты — bike-complaints тянет bike-store только типами): 14/14 проверок на точных числах жалобы — конфликт-карточка «седло НИЖЕ целевой на 79», нет «Опустите седло на 79», нет ложного «выше нормы», рулевая карточка заменена, «Увеличьте Reach» сохранён, KOPS «назад» при отрицательном знаке, идемпотентность, отсутствие мутаций.
- Видео-путь (poseMetricsEngine) проверен: конфликтов внутри метрик нет (нет метрики плеча) — не трогал.
- tsc --noEmit чисто (кроме несборочного examples/), next build успешно. Bump v1.14.28 в 5 файлах + CHANGELOG + whats-new.
- Коммит 2031491, пуш, verify: git ls-remote == HEAD (2031491). Прод: sw.js CACHE = bikesnap-v1.14.28, футер v1.14.28, HTTP 200, консоль/ошибки чистые (agent-browser smoke 1440×900).

Stage Summary:
- Прод = v1.14.28. Взаимоисключающие советы устранены на двух уровнях (движок комплексных карточек + тексты метрик), противоречия данных теперь честно помечаются бейджем «⚠️ Противоречие данных» с разбором вероятных причин.
- Подписи оверлея фото приведены в соответствие сегментам скелета; KOPS показывается в своей единице, направление сдвига седла — по знаку.
- Следующая версия: v1.14.29.

---
Task ID: 33
Agent: main (Super Z)
Task: Спека «Refactoring Spec & Enhanced Debug Telemetry (Issue #6 Fixes)» —
(А) модуль позы: нормы 180°, тексты наклона корпуса без инверсии, иерархия
советов по седлу с порогом 15 мм; (Б) телеметрия отчёта отладки: сырые
2D-точки суставов, флаги калибровки масштаба, датчики устройства, версии.

Work Log:
- Аудит: нормы 180° уже в JOINT_NORMS с v1.14.22 (knee 140–150 / hip 95–105 /
  torso 35–45 / ankle 90–110) — зафиксировал тестом; реальные тексты живут в
  bike-fit.ts analyzeBikeFit (analyzeRiderPose — эталон), микро-совет «2–3 мм»
  — bike-cross-ref.ts секция 7, порог склейки был 20 мм.
- poseMetricsEngine.ts: POSE_ENGINE_VERSION="pose-engine@2.1.0",
  SADDLE_HIERARCHY_THRESHOLD_MM=15 (единый источник); тексты корпуса
  дословно по ТЗ со значением угла: >45° «слишком ВЕРТИКАЛЬНО (комфортная
  посадка) — N°. Для аэродинамики опустите вынос», <35° «слишком
  ГОРИЗОНТАЛЬНО (агрессивная посадка) — N°. Для снятия нагрузки с поясницы
  поднимите вынос»; колено: «(176.3° при норме 140–150°)» прямо в тексте.
- bike-fit.ts: те же тексты в боевом analyzeBikeFit; новый
  extractPoseKeypoints(landmarks, side?) → {shoulder,hip,knee,ankle,toe}
  (фолбэк лево→право, null если ни одна сторона не видна).
- bike-cross-ref.ts: порог 20→15 через импорт константы; новая карточка 1b —
  дельта >15 мм при ОПТИМАЛЬНОМ колене → крупная правка «Опустите/Поднимите
  седло на N мм» с conflict:true (честно: проверь кадр НМТ и inseam),
  микро-советы подавлены (lemondDominates).
- bike-storage.ts: BikeRecord.photoCalib {scaleMmPerPx, scaleSource,
  frameTiltDeg} + updateBikePhotoScale(id, info|null).
- BikePhotoCalibrator.tsx: проп onScaleInfo, вызовы во всех 6 точках
  (успех движка / замена фото / очистка / старт разметки / сбой ядра /
  смена велика) через onScaleInfoRef (без ломки deps).
- BikeParametersForm.tsx: onScaleInfo → updateBikePhotoScale.
- fit-report.ts: FitReportTelemetry (appVersion, engineVersion, userAgent,
  viewportSize, screen, language, device.deviceRoll/devicePitch/
  isOrientationSupported, calibration.scaleSource/scaleKind/scaleMmPerPx/
  frameTiltDeg, poseKeypoints per view: normalized 0..1 + pixels по размеру
  приложенного фото + photoSize); BikeCalibrationInput += scale?;
  normalizeScaleKind() → USER_SADDLE_HEIGHT / USER_OVERRIDE / CONSENSUS /
  FALLBACK_WB / UNKNOWN; buildFitReport(views, context, calibration, device?).
- DebugReportCard.tsx: useDeviceOrientation(true) — живой гироскоп в момент
  отправки; scale из activeBike.photoCalib в calibration-вход.
- report-upload.ts: телеметрия в теле issue (масштаб+kind+мм/px+наклон,
  датчики, наличие точек суставов по ракурсам, движок/среда).
- Тесты: scripts/verify-v1429.ts — 46 OK / 0 FAIL (нормы; тексты корпуса и
  колена в эталоне и в боевом анализаторе; иерархия 79/16/14 мм; регресс
  противоречия v1.14.28 — ровно одна priority-1 карточка по седлу;
  extractPoseKeypoints; normalizeScaleKind). Регрессы: test-crossref-v1428.ts
  — все OK; test-pose-norms.ts — 27 OK (ассерт «низко»→«ГОРИЗОНТАЛЬНО» по ТЗ).
- tsc --noEmit чисто (кроме несборочного examples/), eslint по изменённым
  файлам чист (13 старых react-hooks/refs в нетронутом InteractivePhoto.tsx),
  next build OK; смоук: / → 200, POST /api/report-upload без meta → 400
  (валидация жива); в бандле v1.14.29 + pose-engine@2.1.0.
- Bump v1.14.29: app-version.ts, package.json, sw.js (CACHE bikesnap-v1.14.29),
  whats-new.ts, CHANGELOG.md. Пуш: pull --rebase (remote ушёл вперёд на
  авто-отчёты user-reports) → коммит 3baec56.
- Прод-проверка: bike-snap.vercel.app → HTTP 200; чанк
  4883548f73d676c5.js содержит v1.14.29 и pose-engine@2.1.0 — деплой живой.

Stage Summary:
- Прод = v1.14.29. Спека Issue #6 закрыта полностью: (А) тексты корпуса/колена
  дословно по ТЗ в обоих слоях, порог иерархии 15 мм с крупной карточкой
  правки и подавлением микро-советов; (Б) отчёт отладки несёт сырые точки
  суставов (норм.+пикс.), флаги калибровки масштаба, датчики и версии —
  и в JSON, и в теле issue.
- Следующая версия: v1.14.30.

---
Task ID: 34
Agent: main (Super Z)
Task: ТЗ «Critical Fix Spec: State Leakage, Joint Angles & Text Inversion» —
устранение протечки данных между профилями велосипедов (SH=800 от Bike_A
налагался на Bike_B), плюс гарантии A/B/C из ТЗ.

Work Log:
- Диагноз: 3 пути протечки. (1) useBikeStore.setBike = merge {...state.bike,
  ...b}: handleSelect грузил неполные measurements — поля, которых у Bike_B
  нет, оставались от Bike_A; (2) автосейв 800 мс писал заражённый черновик
  в запись Bike_B насовсем; (3) bikefit-photo-analysis (фото/анализы шага 4)
  был глобальным без bikeId — отчёт Bike_B собирался из углов Bike_A; бонус:
  wheelSizeId не синхронизировался при смене вела (фолбэк радиуса
  калибратора от другого вела).
- bike-store.ts: loadBikeData(m) — ПОЛНАЯ замена черновика (каждый известный
  ключ = значение|undefined; NaN/мусор/неизвестные ключи фильтруются; спреда
  state.bike нет) + resetDraftState() — сброс bike+wheelSizeId без атрибутов
  райдера. Merge-семантика setBike сохранена для патчей формы (тест C).
- bike-storage.ts: ACTIVE_BIKE_CHANGED_EVENT="bikesnap:active-bike-changed";
  диспатч из setActiveBike (только при реальной смене) и deleteBike (при
  удалении активного). notify защищён typeof window.
- hooks/use-active-bike-id.ts (новый): реактивный id (событие + cross-tab
  storage), ленивая инициализация — без двойного маунта шагов.
- page.tsx: шаги bike/summary/analysis рендерятся с key={activeBikeId} —
  React принудительно размонтирует старые компоненты при смене велика
  (ТЗ п. A.1).
- photo-analysis-store.ts: персистится bikeId; syncBikeId(id): тот же id —
  идемпотентный no-op, другой — жёсткий сброс ВСЕХ ракурсов (ТЗ п. A.2:
  калибровка Bike_A запрещена в отчёте Bike_B; нет SH — вводить заново).
- PhotoAnalysisSection.tsx: syncBikeId(activeBikeId) через useLayoutEffect —
  очистка ДО отрисовки, кадр прежнего вела не мелькает.
- BikeParametersForm.tsx: reload/handleSelect/handleCreate/handleDelete →
  resetDraftState + loadBikeData (без merge); wheelSizeId из WH карточки
  (findWheelSize); lastSavedJsonRef синхронизирован (автосейв не пишет
  старый JSON).
- fit-report.ts: FitReportContext += activeBikeId/activeBikeName;
  DebugReportCard.tsx передаёт их — по отчёту видно, какой вел
  анализировался (диагностика «смешанных» репортов).
- B/C из ТЗ (углы 180°, тексты корпуса, иерархия 15 мм) — уже закрыты в
  v1.14.29, подтверждено регрессами.
- Бисект ложного eslint-срабатывания react-hooks/preserve-manual-memoization
  в BikeParametersForm (шаги: деструктуризация OK, handleSelect OK, reload+
  create+delete OK) — итоговая версия чиста; попытки «селекторы»/«getState»
  откачены, финал — деструктуризация новых действий вверху компонента.
- Тест scripts/test-stale-state-v1430.ts (npx tsx, localStorage-полифил до
  импортов): 42 OK / 0 FAIL — A1–A10 (loadBikeData без merge, NaN/мусор),
  B1–B6 (resetDraftState бережёт тело/цель/жалобы), C1–C3 (setBike merge
  жив для патчей), D1–D8 (syncBikeId wipe/idempotent/null), E1–E4
  (findWheelSize), F1–F10 (E2E: create→switch→autosave — в записи Bike_B
  ноль полей от Bike_A; возврат на A восстанавливает карточку полностью),
  G1 (константа события).
- Регрессы: verify-v1429.ts 46/0; test-crossref-v1428.ts все OK;
  test-pose-norms.ts 27/0. tsc чисто (кроме несборочного examples/), eslint
  всех изменённых файлов чист, next build OK.
- Bump v1.14.30: app-version.ts, package.json, sw.js (bikesnap-v1.14.30),
  whats-new.ts, CHANGELOG.md. Коммит d30516f; push отклонён (remote ушёл на
  авто-отчёты) → pull --rebase → 5faffa9; ls-remote == HEAD.
- Прод: HTTP 200; sw.js CACHE bikesnap-v1.14.30; чанк 6059a15659d07b67.js
  содержит 1.14.30 ×2, active-bike-changed, pose-engine@2.1.0; agent-browser
  смоук: стартовый экран рендерится, ошибок консоли нет.

Stage Summary:
- Прод = v1.14.30. Протечка состояния между великами устранена на всех трёх
  путях: полная замена черновика (никаких merge-остатков), ремоунт шагов по
  key={activeBikeId}, привязка фото/анализов шага 4 к велику с жёстким
  сбросом при смене. Автосейв больше не может записать чужие параметры в
  новую карточку. В телеметрии отчёта — id/имя активного велика.
- Следующая версия: v1.14.31.

---
Task ID: 35
Agent: main (Super Z)
Task: ТЗ «Critical Fix Spec: Multi-Bike State Isolation & Pose Metrics
Normalization» — буквальное выполнение п. A.1: жёсткая привязка калибровки
к bikeId в точке расчёта LeMond-разницы.

Work Log:
- Аудит v1.14.30: п. A.1 не был выполнен буквально — SH в черновике был
  «голым» числом без proof of ownership; applySaddleHeightContext принимал
  числа без проверки принадлежности. Найден РЕАЛЬНЫЙ оставшийся путь
  протечки: cross-tab — вкладка 1 держит черновик Bike_A в памяти,
  вкладка 2 переключает вел; activeBikeId обновляется через storage-событие,
  но draft-стор НЕ перезагружается (loadBikeData жил только в
  BikeParametersForm) → шаг 4 анализирует фото Bike_B с SH=800 от Bike_A.
- bike-store.ts: поле `bikeId` в черновике (proof of ownership; ставится
  ТОЛЬКО loadBikeData(m, bikeId); без id — null консервативно;
  resetDraftState/reset стирают; setBike-патчи не трогают; персист с
  санитизацией — legacy-бэкапы → null).
- bike-store.ts: heal-черновика — подписка на ACTIVE_BIKE_CHANGED_EVENT
  (same-tab) + storage (cross-tab, фильтр по ключу bikefit-active-bike —
  autosave соседней вкладки heal не запускает) + мгновенный heal при
  загрузке модуля. Карточка ищется СТРОГО по id (без fallback bikes[0]).
  Правила: id совпал → no-op (несохранённые правки живы); чужой/недоказан
  → полная замена из карточки; активного нет → сброс только «осиротевшего»
  черновика. Цикла импортов нет: bike-storage импортирует bike-store
  только типами.
- bike-storage.ts: ACTIVE_BIKE_KEY экспортирован (для cross-tab фильтра).
- poseMetricsEngine.ts: CalibrationOwnership {calibBikeId, currentBikeId} +
  isCalibrationOwnershipValid() — строгий матч ненулевых id; undefined
  ownership → true (обратная совместимость вызовов/тестов).
- bike-fit.ts: applySaddleHeightContext(..., ownership?) — гвард в точке
  расчёта: {A,B} или {null,B} → LeMond-контекст запрещён (буквальный
  `if (calibration.bikeId !== currentBike.id) return;` из ТЗ).
- bike-cross-ref.ts: generateCrossReferences(..., ownership?) — при чужой
  калибровке запрещены ВСЕ SH-секции: дельта LeMond (shDeltaAbs=null →
  lemondDominates=false), SH↔колено (секция 1) и микро-совет голеностопа
  (секция 7 — раньше строил «седло слишком высоко» на чужом SH).
- PhotoAnalysisSection.tsx: bikeId из стора + activeBikeId → ownership в
  sideAnalysis-memo (deps дополнены). CrossRefRecommendations.tsx: то же
  в generateCrossReferences.
- BikeParametersForm.tsx: bikeId карточки во все 4 точки loadBikeData
  (reload/handleCreate/handleSelect/handleDelete).
- Тест scripts/test-calib-ownership-v1431.ts: 30 OK / 0 FAIL — гвард
  ({A,B}→запрещено, {B,B}→как раньше, {null,B}→запрещено), отсутствие
  saddle-карточек при чужой калибровке, bikeId-семантика (D1–D8), E2E
  баг-репорта (SH=800 от A не даёт «Опустите седло на 41 мм»). Файл —
  модуль (export {}), типы через erased import type (polyfill-гарантия).
- Регрессы: test-stale-state-v1430 42/0; verify-v1429 46/0;
  test-crossref-v1428 OK; test-pose-norms 27/0; test-bike-photo-persist 10/0.
- tsc --noEmit чисто (кроме несборочного examples/); eslint изменённых
  файлов чист; next build OK.
- Bump v1.14.31: app-version.ts, package.json, sw.js (bikesnap-v1.14.31),
  whats-new.ts, CHANGELOG.md. Коммит 17f3fab → пуш отклонён (remote ушёл
  вперёд) → pull --rebase → 4d794e6; ls-remote == HEAD.
- Прод: HTTP 200; sw.js CACHE = bikesnap-v1.14.31; чанк
  59dd5e3fcbf220a8.js: 1.14.31 ×2, calibBikeId ×4, active-bike-changed,
  bikefit-active-bike. Смоук 1440x900: рендер, консоль/ошибки чисты.
- Живая проверка heal на проде: seeded bikefit-storage (bikeId="bike_A" +
  SH=800) при активном bike_B → reload → bikefit-storage:
  bikeId="bike_B", SH/WB стёрты. Тестовые данные localStorage удалены.

Stage Summary:
- Прод = v1.14.31. П. A.1 ТЗ выполнен буквально: калибровка несёт bikeId,
  в точке расчёта LeMond-разницы владение проверяется, чужая SH запрещена
  и в applySaddleHeightContext, и во всех SH-секциях кросс-рекомендаций.
  Закрыт последний путь протечки (cross-tab) через heal-подписку стора.
- Нормы углов (колено 140–150, бедро 95–105, торс 35–45 + тексты без
  инверсии) и иерархия 15 мм — подтверждены регрессами (B/C ТЗ).
- Следующая версия: v1.14.32.

---
Task ID: 34
Agent: Super Z (main)
Task: Bugfix Spec — MediaPipe Occlusion, Side Selection & Ankle Alignment (v1.14.32)

Work Log:
- Прочитан код: bike-fit.ts (side-selection по сумме visibility), PhotoAnalyzer/VideoAnalyzer (отрисовка POSE_CONNECTIONS), PhotoAnalysisSection (analyzePhoto/overlay), use-pose-landmarker.
- bike-fit.ts: добавлены FOOT_MIN_VISIBILITY=0.65, LEG_MIN_VISIBILITY=0.5, FOOT_SANITY_WARNING, FOOTWEAR_WARNING; getCleanRiderKeypoints() — средняя visibility (Hip/Knee/Ankle) для LEFT/RIGHT, строго одна сторона, отказ при <0.5 с текстом для UI; isCrossLegConnection() — запрет LEFT↔RIGHT при участии колена/лодыжки/пятки/носка (линия таза [23,24] и плеч [11,12] легитимны — первый вариант с хипами в сете дал бы ложный запрет таза, поймано вериф-скриптом); legConnectionSide(); AnalyzeFitOptions.pedalAxis; BikeFitAnalysis.warnings? (опционально — старые localStorage-анализы без поля); analyzeBikeFit переведён на getCleanRiderKeypoints + 4 уровня достоверности стопы (MediaPipe toe → pedalAxis → heel → unreliable с warning-статусом, не зелёной нормой) + санитарная проверка ankle.y < toe.y; VIEW_LABELS.side дополнен FOOTWEAR_WARNING.
- PhotoAnalyzer: props activeSide; скелет — пропуск isCrossLegConnection, на виде «сбоку» нога/точки рисуются ТОЛЬКО выбранной стороны (баг двойного отрицания в фильтре точек найден и исправлен).
- PhotoAnalysisSection: ранняя проверка getCleanRiderKeypoints для side (специфичная ошибка вместо общей); warnings-блок «Замечания по качеству кадра» над рекомендациями; FOOTWEAR_WARNING в карточке инструкций; activeSide проброшен через ViewSection.
- VideoAnalyzer: кросс-ноги запрещены в отрисовке.
- Версия v1.14.32: app-version.ts, package.json, whats-new.ts, CHANGELOG.md.
- Верификация: scripts/verify-v1432.ts — 33/33 (side selection, отказ, кросс-запрет, стопа-y, pedalAxis, heel fallback, чистый кадр). Регрессы: verify-v1429 46 OK, test-crossref-v1428 OK, test-calib-ownership-v1431 30 OK, test-pose-norms 27 OK, test-stale-state-v1430 42 OK. tsc чисто; next build OK.

Stage Summary:
- Дальняя нога больше не попадает в углы: строго одна сторона по средней visibility; «паутина» перекрёстных линий запрещена на уровне drawing guard.
- Стопа: сланцы/фантомы (toe/heel < 0.65 или ankle ниже toe) → предупреждение в UI, ложный совет по голеностопу подавлен; при разметке велосипеда доступна проекция на ось педали.
- Обувь: подсказка в инструкциях съёмки.
- Прод задеплоен (v1.14.32). Следующая версия: v1.14.33.

---
Task ID: 35
Agent: Super Z (main)
Task: Офлайн-режим + зеркало GitHub Pages (SNI-блокировка *.vercel.app в РФ), v1.14.33

Work Log:
- Разведка: PAT (ghp_, scope repo) работает через push-URL/credential store; deploy-ключей в песочнице нет (контейнер пересобран); прод v1.14.32; SW v1.14.31 с skipWaiting на install.
- ШАГ 0: / — статическая, /api/* — 3 serverless-релея (анализ/калибровка/отчёты) — на зеркале деградируют штатно (SW их пропускает); регистрация SW уже срабатывает при document.readyState === "complete", идемпотентна.
- public/sw.js (v1.14.33): навигация и /version.json — network-first; /_next/static/* и /cdn/mediapipe/* — cache-first; install БЕЗ skipWaiting; message SKIP_WAITING (строка и {type}); activate — чистка старых bikesnap-* кэшей, clients.claim, фоновой префетч замыкания /_next/static/* из HTML (скан JS/CSS до 400 файлов) + ИИ-ассетов; легаси-CDN (jsdelivr/googleapis) — runtime cache-first.
- Самохостинг MediaPipe: public/cdn/mediapipe/wasm/* из node_modules/@mediapipe/tasks-vision@1.0.1 (vision_wasm_internal + nosimd; module_internal выброшен — не используется в 1.0.1) + pose_landmarker_lite.task (5.8 МБ); use-pose-landmarker.ts переключён на /cdn/mediapipe/* — офлайн-анализ поз без внешнего CDN.
- UpdateBanner.tsx (баннер «Обновить/Позже», SKIP_WAITING по кнопке + страховочный reload 1.5с); register-sw.tsx шлёт bikesnap-sw-update при reg.waiting+controller; смонтирован в layout.tsx.
- public/version.json {"version":"v1.14.33"} — точка поллинга CI.
- scripts/mirror_to_pages.py: замыкание («/» → /_next/static/* → скан JS/CSS → стабилизация), корневые файлы, .nojekyll, README, mirror-manifest.json; фикс: «/» → index.html (IsADirectoryError в CI).
- agent-slon-lab.github.io: создан (public), Pages main=/ (409=уже), deploy-ключ bikesnap-pages-mirror (WRITE), секрет PAGES_DEPLOY_KEY в BikeSnap через sealed box + pynacl (PublicKey base64-decode вручную — API pynacl без encoding-параметра).
- Грабли ключей: эта сборка cryptography не читает OpenSSH-PEM (roundtrip fail) → PKCS8 хранение; paramiko Ed25519Key не читает PKCS8 → локальные копии конвертированы в OpenSSH-формат (пара не менялась); секрет перезалит с OpenSSH+trailing newline (ssh CLI: «invalid format» на PKCS8).
- .github/workflows/mirror-to-pages.yml: push main + workflow_dispatch, concurrency mirror-to-pages, timeout-minutes 10 на JOB (workflow-level = «Unexpected value» + прогон без джобов — поймано dispatch-ом), поллинг Vercel 60с..4мин, python зеркалирование, публикация: ключ из секрета → ~/.ssh/id_ed25519 (600), ssh-keyscan ed25519, git init -b main, force-push одним коммитом.
- Грабли пуша workflow-файла: PAT без workflow-scope отвергнут (ожидаемо по ТЗ); SSH deploy-ключ BikeSnap (новый, git-helpers/deploy_key) пушит workflow-файлы УСПЕШНО — pushurl переключён на git@github.com (paramiko-ssh).
- Пуши: 29aa261 (v1.14.33 приложение), 33fe857 (workflow), 0aaa7ff (timeout-minutes fix), d0e37d2 (mirror safe_path fix), 3cc695b (setup PKCS8 fix). Ушедший «error: failed to push some refs» после строки успеха — косметика paramiko-стрима, ls-remote подтверждает.
- CI-прогоны: 38655227435 SUCCESS (полный цикл с публикацией), 38655783145 SUCCESS (после fix-пушей); деплой-ключ триггерит Actions — подтверждено.
- Верификация зеркала (scripts/verify-mirror.py): sha256 «/» (по корню, не /index.html), sw.js, manifest.webmanifest, version.json — MATCH прод; _next-чанк 200, .nojekyll 200, wasm/model 200, version.json=v1.14.33.
- Офлайн-пакет: scripts/build-offline-zip.py → download/BikeSnap-offline-v1.14.33.zip (30.6 МБ, mirror/ + start.bat + start.sh + README-офлайн.txt, порт 8642 зафиксирован); Release v1.14.33 создан, asset uploaded (201).
- E2E agent-browser: 127.0.0.1:8642 — SW registered+active, кэш bikesnap-v1.14.33 = 26 файлов (вкл. wasm и .task); set offline on → reload → приложение работает (online:false, controlled:true, UI рендерится, errors пуст); agent-slon-lab.github.io — SW active, offline reload → работает.

Stage Summary:
- Три уровня входа готовы: https://bike-snap.vercel.app/ (весь мир) → https://agent-slon-lab.github.io/ (РФ без VPN, byte-identical, автосинк Action-ом при каждом пуше) → офлайн (PWA-кэш после первого визита / zip из Release v1.14.33).
- Обновления по кнопке: install без skipWaiting → баннер → SKIP_WAITING → controllerchange → один reload.
- Полный офлайн после первой загрузки: префетч замыкания чанков + самохостинг MediaPipe.
- Нюансы задокументированы в README офлайн-пакета: localStorage привязан к origin; PWA с vercel.app обновляется только с vercel.app; CDN GH Pages держит HTML/sw.js ~10 мин; /api/* на зеркале недоступны (релеи деградируют).
- Следующая версия: v1.14.34.

---
Task ID: 36
Agent: Super Z (main)
Task: Консолидированное ТЗ «BikeSnap Architecture, Geometry Engine & Pose
Validation Refactoring» — геометрическое ядро (ось ETT), тихое выравнивание,
валидация фото (человек/пропорции), кнопки пересъёмки и Re-fit Loop с
сравнением «Было ➔ Стало» (v1.14.34).

Work Log:
- Разведка: разделы 1 (изоляция) и 3/4 (MediaPipe-фильтры, нормы) уже
  закрыты в v1.14.30–32 — подтверждено регрессами, нового кода не требовали.
- Ядро v2.3 (bike-geometry-engine.ts): ось ETT по ТЗ п. 2.3 — горизонталь
  от htTop до пересечения с линией bb → saddleMount (длинная база «каретка—
  седло» менее чувствительна к промаху верхней точки); фолбэки bb → stTop
  (saddleMount вырожден, с warning) и горизонталь ST→HT (обе вырождены).
  Поворот-first и строгий override — без изменений, инвариантность поворота
  4° подтверждена численно (ETT/Stack/SH байт-в-байт).
- ТЗ п. 2.4: из UI калибратора удалены карточки «Dual Scale активен» (%
  перспективы) и «Отметь верх колёс для dual scale» (+ стейты
  perspectiveInfo/dualScale); вместо них — плашка «✓ Горизонт кадра
  автоматически выровнен» (при успешном расчёте без физ-нарушений).
  ΔY/радианы — только в свёрнутом debug-логе. Подсказки WH/верхов колёс
  переформулированы без «вопросов про перспективу».
- Person Score (bike-fit.ts): getPoseVisibilityScore (средняя visibility
  8 ядерных суставов), PERSON_MIN_SCORE=0.5, PERSON_BIKE_PHOTO_MAX_SCORE=0.7.
  Шаг 1 (PhotoAnalysisSection.analyzePhoto): score<0.5 → расчёт заблокирован
  + модалка «Человек не найден на фото. Загрузите снимок верхом на
  велосипеде» (Dialog). Шаг 2 (BikePhotoCalibrator): каждое фото прогоняется
  через usePoseLandmarker; score>0.7 → амбер-предупреждение «На фото
  обнаружен человек…» (не блокер, ref-гвард от повторных прогонов).
- Bike Match Validation (новый src/lib/bike-wheel-ratio.ts): ratio =
  pxWheelbase/pxWheelDiameter; фото вела — по разметке (оси+верха колёс,
  computeWheelRatioFromKeypoints), фото райдера — авто-детектор колёс
  (computeWheelRatioFromFrame, кадр 480px, нужно ОБА колеса); расхождение
  >12% (isBikeMismatch) → предупреждение о двух разных велосипедах.
  wheelRatio в photoCalib карточки вела (updateBikePhotoScale расширен),
  riderPhotoWheelRatio в photo-analysis-store; оба стираются при смене
  вела (syncBikeId).
- ТЗ п. 5.1: PhotoUploader при загруженном фото рендерит группу
  [📷 Переснять][📁 Из галереи][🗑️ Удалить] + CameraCapture и скрытый input —
  работает на всех этапах (3 ракурса, калибратор, сравнение до/после).
- Re-fit Loop (ТЗ п. 6): кнопка «Измерить новую посадку» на шаге 4
  (геометрия рамы НЕ сбрасывается); ReFitFeedbackModal.tsx (новый) — чекбоксы
  «Изменил высоту седла (+/- мм)» / «Сдвинул седло / поменял вынос» /
  «Настройки не менял» + комфорт [лучше/без изменений/боль]; ComparisonReport.tsx
  (новый) — таблица «Было ➔ Стало»: Метрика | Прогон #1 (зачёркнуто) |
  Прогон #2 (жирно) | Δ | Статус (Норма ✅ / Вне нормы ⚠️) по колену, корпусу,
  бедру, голеностопу + сводка анкеты. photo-analysis-store: previousRun
  (фото+метрики целиком), refitMeta, startRefit/cancelRefit (отмена
  возвращает прогон полностью), syncBikeId стирает артефакты Re-fit.
- Тест scripts/verify-v1434.ts: 34 OK / 0 FAIL — ось ETT (коллинеарный
  saddleMount = классике; смещённый = линии bb→saddleMount; override ETT
  строгий; поворот 4° инвариантен), person-пороги, wheel-ratio math + 12%,
  Re-fit store (архив/отмена/смена вела), photoCalib.wheelRatio. По ходу
  чинены 2 старые ошибки самого скрипта (направление изменения ETT при
  наклоне седла; поворот не той фикстуры).
- Регрессии: verify-engine-v2 обновлён (ETT 625; формула
  ETT = Reach + Stack·cot(оси седла); физ-гейт «Верх седла НИЖЕ» теперь
  честно проверяется в physicsViolations — старый чек искал текст в
  warnings и падал ВСЕГДА ещё до v1.14.34); verify-v1429 46/0,
  verify-v1432 33/0, test-crossref-v1428 OK, test-calib-ownership-v1431 30/0,
  test-stale-state-v1430 42/0, test-pose-norms 27/0, test-scale-guard OK,
  test-bike-photo-persist 10/0. tsc чисто, eslint изменённых чист,
  next build OK.
- Bump v1.14.34: app-version.ts, package.json, sw.js (bikesnap-v1.14.34),
  version.json, whats-new.ts (7 пунктов), CHANGELOG.md.
- Пуш 44353bc (pushurl paramiko-ssh; «failed to push» после строки успеха —
  косметика стрима, ls-remote == HEAD).
- Прод: version.json = v1.14.34; чанк f7b8da6a138d89fb.js содержит 1.14.34 ×2;
  sw.js VERSION v1.14.34. Зеркало agent-slon-lab.github.io: sha256 «/», sw.js,
  version.json — MATCH прод; чанк с 1.14.34 присутствует (авто-синк workflow).
- Смоук agent-browser: стартовый экран и «Что нового» с записью 1.14.34 —
  чисто; шаг «Анализ» (seeded localStorage) рендерится, MediaPipe
  инициализируется, ошибок консоли нет; тестовый localStorage удалён.

Stage Summary:
- Прод = v1.14.34 (Vercel + зеркало GitHub Pages байт-в-байт).
- ТЗ выполнено: п.1 (регресс-подтверждение), п.2 (ось ETT по bb→saddleMount,
  тихая плашка выравнивания), п.3 (регресс), п.4 (регресс), п.5 (кнопки
  пересъёмки, person-валидация 0.5/0.7, Bike Match 12%), п.6 (полный Re-fit
  Loop: анкета, архив прогона, «Было ➔ Стало»), п.7 (семантика эталонного
  analyzeRiderPose покрыта связкой poseMetricsEngine + applySaddleHeightContext
  + bike-cross-ref — подтверждено тестами v1.14.29/31).
- Следующая версия: v1.14.35.

---
Task ID: 37
Agent: Super Z (main)
Task: Ответ на вопрос пользователя «почему в футере v1.14.32?» (дисклеймер + версия)

Work Log:
- git: origin/main == HEAD, 0 непушенных коммитов; package.json и APP_VERSION = 1.14.34.
- curl прод: https://bike-snap.vercel.app/version.json → {"version":"v1.14.34"}.
- curl зеркало: https://agent-slon-lab.github.io/version.json → {"version":"v1.14.34"} (bikesnap/路径 404 — зеркало живёт в корне user-site, это норма).
- Диагноз: пользователь сидит на SW-кэше сборки v1.14.32. Баннер «Доступна новая версия» (update-banner.tsx) появился только в v1.14.33, а старая сборка его не содержит → waiting-SW ничем не подтверждается → версия не применяется. Одноразовый миграционный затык, кодом не лечится (в старый бандл новый код не доставить).
- Рецепт пользователю: закрыть ВСЕ вкладки сайта → открыть заново; либо Ctrl+Shift+R; либо DevTools → Application → Service Workers → Unregister + reload. После попадания на ≥1.14.33 баннер работает во всех последующих обновлениях.
- Дисклеймер «рекомендательный характер…» — постоянная строчка футера (page.tsx:486), к версии не привязана.

Stage Summary:
- Прод и зеркало = v1.14.34; отображаемая v1.14.32 — устаревший service-worker-кэш у пользователя, обновление подтверждается вручную (один раз).
- Код не менялся; следующая версия — v1.14.35.

---
Task ID: 38
Agent: Super Z (main)
Task: «я поменял фото велика — ИИ не смог это понять»: диагностика + v1.14.35

Work Log:
- Диагностика: новых user-reports за 2026-10-15 нет; git fetch — репо на 9135625 (v1.14.34).
- Стенд scripts/pose-eval (playwright + @mediapipe/tasks-vision из node_modules + lite-модель):
  все 6 фото вела из отчётов → landmarks НЕ найдены (score 0, ложного «человек обнаружен» нет);
  все 5 фото райдера → core 0.83–0.90, ближняя нога 0.98 — все пороги v1.14.34 проходят.
  Вывод: сбой — на НОВОМ фото пользователя; в коде найден реальный баг-гонка.
- БАГ (Шаг 2, BikePhotoCalibrator): эффект person-проверки не ждал готовности WASM-модели —
  detect() до инициализации возвращал null → score 0 → проверка молча пропускалась навсегда.
- v1.14.35 (коммит 825fcc5, НЕ запушен):
  1) эффект ждёт poseLandmarker и перезапускается по готовности;
  2) предупреждение «На фото обнаружен человек» отклоняемое («Всё равно разметить это фото»),
     сброс при замене/удалении фото; текст уточнён (не блокирует разметку);
  3) «два разных велосипеда» + подсказка «сменил велик — пересними Шаг 1»;
  4) телеметрия: photoPersonScore в карточке вела (updateBikePhotoPersonScore,
     чистится в updateBikePhoto) и calibration.personScore/wheelRatio в отчёте отладки;
  5) whats-new 1.14.35 + CHANGELOG + бамп версии (app-version/package/sw.js/version.json).
- Проверки: next build OK; verify-v1434.ts 34/0 OK; смоук playwright (футер 1.14.35,
  «Что нового», консоль чистая) OK. Стенд и смоук: scripts/pose-eval/.
- Деплой-блокер: воркспейс пересобран — git-helpers/deploy_key и ~/.ssh утеряны
  (git-restore.sh → «КЛЮЧА НЕТ НИГДЕ»). scripts/rotate-deploy-key.py упал (нет paramiko) —
  написан scripts/gen-deploy-key.py (чистая cryptography), paramiko 5.0.0 поставлен через uv
  в /home/z/.venv (для scripts/paramiko-ssh). core.sshCommand настроен.
  Публичный ключ выдан пользователю для GitHub → Deploy keys (Allow write); после добавления
  — git push origin main и verify прод/зеркала.

Stage Summary:
- v1.14.35 готова локально (825fcc5): фикс гонки person-check + отклоняемое предупреждение +
  подсказка при смене вела + вердикт ИИ в отчёте. Не запушено: ждёт deploy-ключ от пользователя.
- Пользователю: добавить pubkey в GitHub Deploy keys; при повторе жалобы — отчёт из приложения
  (теперь несёт personScore).
- Следующая версия после пуша: v1.14.36.

---
Task ID: 39
Agent: Super Z (main)
Task: «лей» — деплой v1.14.35 по PAT-токену пользователя (deploy-ключ так и не добавлен)

Work Log:
- Пользователь прислал GitHub PAT (ghp_lx98…jUFA) с командой «лей» вместо добавления deploy-ключа.
- git remote: fetch https, push git@ (SSH) — SSH-ключ в воркспейсе утерян (см. Task 38).
- Проверка консистентности: package.json / app-version.ts / sw.js — все 1.14.35 ✓.
- Пуш одной командой без сохранения токена в конфиге:
  git push https://<PAT>@github.com/agent-slon-lab/BikeSnap.git main → 9135625..c844162 (4 коммита).
- Верификация деплоя: vercel version.json → v1.14.35 ✓ (~75 с после пуша);
  зеркало github.io version.json → сначала v1.14.34, через ~90 с автосинк → v1.14.35 ✓;
  прод sw.js → VERSION v1.14.35, CACHE bikesnap-v1.14.35 ✓.
- Токен в git config/файлах проекта НЕ сохранялся (только разовая URL-авторизация в команде пуша);
  в worklog токен замаскирован.

Stage Summary:
- Прод (Vercel) и зеркало (GitHub Pages) = v1.14.35, SW-кэш bikesnap-v1.14.35.
- Пуш выполнен PAT-токеном; рекомендация на будущее: токен в конфиге не хранится — при следующем
  «лей» снова понадобится свежий токен либо добавленный deploy-ключ (pubkey из Task 38).
- Следующая версия: v1.14.36.

---
Task ID: 40
Agent: Super Z (main)
Task: «на шаге 2 был один велик, в шаге 4 другой подсунул — ИИ не увидел» → v1.14.36

Work Log:
- Диагноз: Bike Match Validation (v1.14.34) сравнивала пропорции ТОЛЬКО когда
  авто-детектор находил ОБА колеса на фото райдера. При неудаче детекции
  (нога закрывает колесо — частый случай) ratio = null → «не сверено» молча
  выглядело как «совпадает» → подмена вела проходила незамеченной.
- Попутно найдены 2 доп. бага: (а) Stale Ratio — при замене фото райдера
  старая пропорция жила в сторе до конца новой детекции (маскирует подмену);
  (б) personScore из v1.14.35 передавался в buildFitReport, но терялся при
  сборке JSON (calibOut строился заново без поля).
- Фиксы:
  1) bike-wheel-ratio.ts: bikeMatchVerdict() → "match"/"mismatch"/"unknown";
  2) photo-analysis-store.ts: riderWheelCheck ("pending"|"ok"|"notFound"),
     сброс ratio+статуса в setViewPhoto/clearView для side, при смене вела,
     Re-fit; санитизация при гидрации;
  3) PhotoAnalysisSection.tsx: 3-состояний UI — янтарь mismatch (было),
     янтарь «Не удалось автоматически сверить велосипеды» (новое),
     зелёная «Велосипеды сверены» с Δ% (новое); статус ставится в
     handlePhotoSelected вместе с ratio;
  4) fit-report.ts: telemetry.calibration += bikeWheelRatio/personScore/
     bikeMatch; bikeCalibration += personScore (фикс потери) + bikeMatch;
     тип FitReportTelemetry.calibration расширен;
  5) DebugReportCard.tsx: собирает bikeMatch из стора + карточки вела.
- Тесты: scripts/test-bike-match.ts (15 проверок: match/mismatch/unknown,
  границы 11.9/12.1%, мусорные значения) — 15 OK / 0 FAIL.
  Замечание: ровно 12.0% в float даёт 12.00000000000001 → mismatch
  (строгое >), в тесте зафиксированы практические границы.
- Проверки: tsc --noEmit — src/ чист (ошибки в test-stale-state-v1430.ts /
  verify-v1434.ts ДО-существующие, на чистом HEAD те же); next build OK;
  смоук: страница 200, version.json v1.14.36, sw.js v1.14.36, бандл с версией.
- Бамп: app-version/package/sw.js/version.json/whats-new/CHANGELOG.

Stage Summary:
- v1.14.36: защита от подмены вела стала честной — «не сверено» больше не
  приравнивается к «совпадает», пользователь видит янтарную плашку;
  при совпадении — зелёное подтверждение с Δ%; отчёт отладки несёт
  bikeMatch + починенный personScore.
- Следующая версия: v1.14.37.

---
Task ID: 41
Agent: Super Z (main)
Task: «проверяй гит — отправил отчёты, ИИ не видит что я подменил велики» → v1.14.37

Work Log:
- Разбор отчётов из user-reports/2026-10-15 (issues #12, #13, оба v1.14.36):
  r1 = карточка белый MTB (SH 680, wheelRatio 1.509) + фото райдера на
  ЧЁРНОМ ГИБРИДЕ; r2 = зеркально (гибрид SH 800, райдер на MTB). Свап
  реальный, в обоих riderWheelCheck: "pending" — детекция НЕ ЗАПУСКАЛАСЬ.
- Стенд scripts/test-wheel-detect-reports.ts (sharp + detectWheels): на
  реальных фото 0–1 колеса из 2 (серая дверь/кирпич/гараж убивают
  ray-voting детектор). bikeRatio велов 1.509 vs 1.546 (Δ2.4%) —
  пропорциональная сверка при пороге 12% этот свап не ловит даже с
  рабочей детекцией. Нужен детерминированный сигнал.
- Корневые причины невыполнения детекции:
  1) гонка в handlePhotoSelected: guard «cur !== url» отбрасывал результат
     img.onload, проснувшегося ПОСЛЕ сжатия blob→dataURL (законная замена);
  2) для persist-фото прошлых сессий handlePhotoSelected не вызывается —
     детекция не запускалась никогда.
- v1.14.37 (коммит, пуш по PAT):
  1) НОВОЕ — Photo Provenance (src/lib/photo-fingerprint.ts): djb2-пара-хеш
     сжатого dataURL; стор photo-analysis-store: photoProvenance
     (кросс-веловая история, persist, ≤200 фото × 20 записей) +
     provenanceConflict + registerViewPhoto/clearProvenanceConflict.
     То же фото под другим велом → КРАСНАЯ плашка в Шаге 4. Ловит свап
     существующих файлов детерминированно, независимо от фото.
  2) Race fix: guard следит за актуальным значением в замыкании
     (latestPhotoData: blob → dataURL не считается заменой).
  3) Mount Detection: useEffect досматривает сверку для persist-фото
     (photoData есть + "pending" → одна попытка; onerror молчит).
  4) Телеметрия: bikeMatch.provenance в bikeCalibration и
     telemetry.calibration отчёта (fit-report.ts + DebugReportCard.tsx).
  5) Реестр переживает смену вела/Re-fit; флаг конфликта сбрасывается при
     замене/удалении фото; санитизация при гидрации.
  6) Тест scripts/test-photo-provenance.ts: 13 OK / 0 FAIL (детерминизм,
     различимость, все ветки pickProvenanceConflict).
- Проверки: tsc --noEmit (src/ чист), next build OK, смоук: страница 200,
  version.json/sw.js = v1.14.37. Бамп всех 4 файлов + whats-new + CHANGELOG.
- Остаточный слепой пятно (документировано в CHANGELOG): свап НОВЫХ фото,
  никогда не загружавшихся под другим велом, provenance не видит — нужен
  визуальный матчинг (не в этом релизе).

Stage Summary:
- v1.14.37: подмена фото между карточками велов ловится по фингерпринту
  (красная плашка) + починена невыполнение детекции колёс (гонка + persist).
- Пользователю: повторить тест подмены тех же файлов — должна загореться
  красная плашка. Свап уникальных фото пока не ловится (осознанный предел).
- Следующая версия: v1.14.38.

---
Task ID: 42
Agent: Super Z (main)
Task: «почему без VPN загрузилась офлайн старая версия, обновы не видел?»
→ v1.14.38 офлайн-бейдж

Work Log:
- Верификация площадок: обе (Vercel + github.io) = v1.14.37, remote == HEAD.
  Деплой НЕ виноват — виновата механика офлайн-кэша.
- Диагноз: vercel-домен без VPN недоступен (SNI-блокировка), SW по дизайну
  офлайн-режима v2 отдаёт закэшированную оболочку прошлой версии — выглядит
  как рабочий сайт, но это «заморозка». Детектор обновлений молчит: sw.js и
  version.json лежат на том же недоступном домене → баннер «Обновить» не
  показывается. Пользователь путает офлайн-копию vercel-ориджина с зеркалом
  github.io (разные origin — у каждого свой SW и свой кэш).
- v1.14.38:
  1) sw.js: офлайн-фолбэк /version.json помечается заголовком
     X-BikeSnap-From-Cache: 1 — страница отличает «свежее из сети» от
     «из кэша, потому что сервер недоступен».
  2) НОВЫЙ OfflineBadge (src/components/pwa/offline-badge.tsx, mount в
     layout рядом с UpdateBanner): опрос /version.json (старт, 1 мин,
     событие online); маркер/сетевая ошибка → янтарная плашка «Нет связи
     с сайтом — показана сохранённая копия {версия}» + подсказка
     (VPN / зеркало agent-slon-lab.github.io). Связь вернулась — плашка
     уходит сама. UpdateBanner (z-100) при конфликте перекрывает бейдж
     (z-99) — приоритет у кнопки «Обновить».
  3) Ограничение зафиксировано в CHANGELOG: бейдж виден только на
     ≥ 1.14.38; старые офлайн-копии обновятся по старинке (закрыть все
     вкладки → открыть зеркало) — изнутри старого кода не исправить.
- Бамп 1.14.38: package.json / app-version.ts / sw.js / version.json /
  whats-new.ts (запись 1.14.38) / CHANGELOG.md.
- Проверки: tsc --noEmit чисто (без до-существующих ошибок scripts/),
  next build OK, смоук next start :3311 — страница 200, version.json и
  sw.js = v1.14.38, маркер X-BikeSnap-From-Cache присутствует в чанке
  286f2ef12b4607d1.js и в sw.js.

Stage Summary:
- v1.14.38: офлайн-копия больше не маскируется под рабочий сайт — янтарная
  плашка честно говорит «нет связи» и подсказывает зеркало/VPN.
- Пользователю: открыть agent-slon-lab.github.io (закрыв все прежние
  вкладки), обновиться до 1.14.38, затем повторить тест подмены велов
  (v1.14.37 красная плашка по фингерпринту).
- Следующая версия: v1.14.39.

---
Task ID: 43
Agent: Super Z (main)
Task: «что непонятного в слове зеркало? если vercel недоступен — идём на
ГХ, там новая версия сразу подгружается. И только потом если эти два
варианта сдохли (инета нет) — офлайн загружаемся» → v1.14.39

Work Log:
- Спека пользователя принята как требование: авто-фейловер на зеркало
  ДО офлайн-кэша (офлайн — последнее средство, только без интернета).
- v1.14.39 (офлайн-режим v3):
  1) sw.js, обработчик навигации — лестница: (1) сеть origin;
     (2) сетевая ошибка → зонд зеркала probeAlive() (no-cors fetch,
     таймаут 3.5 с, opaque-ответ = жив) → живое → ИНЛАЙНОВЫЙ HTML-
     редиректор (meta refresh + location.replace; путь+query 1:1,
     зеркало в корне github.io); (3) зеркало мертво → офлайн-кэш.
  2) HTTP !ok (503/404 окно пропагации) — БЕЗ редиректа, старый кэш:
     зеркало несёт то же содержимое, редирект только при СЕТЕВОЙ ошибке.
  3) Защита от цикла: origin == MIRROR_ORIGIN → редиректа нет.
  4) HTML-редиректор вместо Response.redirect(): не зависит от поддержки
     редиректов respondWith для навигаций во всех браузерах;
     location.replace убирает мёртвый origin из истории.
  5) OfflineBadge v2: зонд зеркала → кнопка «Открыть зеркало» (для табы,
     открытой до блокировки; навигации SW уводит сам).
- Тест scripts/test-mirror-failover.ts: vm-песочница исполняет sw.js
  (fetch-секвенсор: строковый аргумент = зонд зеркала, Request-объект =
  навигация). 14 проверок: редирект при блокировке, path+query 1:1,
  оба мертвы → кэш, кэш пуст → error, 503 → кэш без редиректа, живой
  origin → passthrough, цикл-guard зеркала, mirrorUrlFor, probeAlive
  таймаут/успех. 14 OK / 0 FAIL. (Первая итерация упала: запрос сценария
  7 шёл на vercel при origin зеркала — честно не перехватывался;
  исправлено параметром origin.)
- Бамп 1.14.39: package.json / app-version.ts / sw.js / version.json /
  whats-new.ts / CHANGELOG.md. tsc чисто, next build OK, смоук :3312 —
  страница 200, version.json и sw.js = v1.14.39, MIRROR_ORIGIN в sw.js.
- Ограничение зафиксировано: localStorage раздельный по origin — велики,
  сохранённые на vercel-версии, на зеркале не видны; перенос невозможен,
  пока vercel заблокирован (это и есть условие фейловера).

Stage Summary:
- v1.14.39: лестница vercel → ГХ-зеркало → офлайн-кэш работает
  автоматически, офлайн — только когда оба мертвы.
- Пользователю: обновиться до 1.14.39 (синий баннер «Обновить» на
  зеркале), далее открывать как обычно — при блокировке vercel сам
  перебросит на зеркало. Велы с vercel-хранилища на зеркале не видны
  (раздельные localStorage).
- Следующая версия: v1.14.40.

---
Task ID: 44
Agent: Super Z (main)
Task: «с чего это данные лежат на верцель? у нас оффлайн прил. все данные
на тел или компе локально, это очевидно!!!» → объяснение + мост между
ящиками localStorage (v1.14.40 экспорт/импорт)

Work Log:
- Верифицировал хвост предыдущей сессии: v1.14.39 (de7bddd) была
  запушена и задеплоена — remote main == HEAD, SW v1.14.39 на vercel и
  на зеркале (worklog Task 43 обрывался до пуша). «ahead 15» оказался
  протухшим tracking-ref'ом: пуш по PAT-in-URL не обновляет origin/main;
  git fetch восстановил синхронизацию.
- Объяснение пользователю: данные И правда лежат только на устройстве,
  на сервер vercel ничего не отправляется; «сохранённые на vercel» —
  это «в ящике localStorage домена bike-snap.vercel.app». Браузеры
  изолируют localStorage по origin — два ящика на одном устройстве
  (vercel и github.io), приложение с одного домена не видит ящик
  другого. Это политика Chrome/Safari/Firefox, не BikeSnap.
- v1.14.40 — файловый мост между ящиками:
  1) bike-storage.ts: readSnapshot() (riders+bikes+activeRiderId/
     activeBikeId) и mergeSnapshot() — вливание по id, существующие
     не перезаписываются (безопасный повтор), кривые записи
     пропускаются, blob:-фото режутся, активный вел/райдер
     восстанавливается только при существовании записи
     (+ ACTIVE_BIKE_CHANGED_EVENT).
  2) src/lib/data-transfer.ts: buildTransferPayload (self-describing
     JSON app/kind/schema=1/fromVersion/exportedAt), downloadDataFile
     (Blob → bikesnap-data-ГГГГ-ММ-ДД.json), importDataFile (валидация,
     понятные ошибки на чужие/битые файлы).
  3) page.tsx Header: кнопки «Экспорт»/«Импорт» (Download/Upload,
     скрытый file input) на всех экранах; тосты с количествами,
     авто-reload через 1.4 с после реального добавления, destructive
     на ошибки. Фото (base64) и точки калибровки едут в файле.
- Бамп 1.14.40: package.json / app-version.ts / sw.js / version.json /
  whats-new.ts (запись с памяткой миграции) / CHANGELOG.md
  (+исправление опечатки «счего»).
- Проверки: tsc чисто (фильтр до-существующих scripts/*), next build
  OK, смоук :3313 — страница 200, version.json и sw.js = v1.14.40,
  строка «Экспорт данных в файл» в чанке 6b7ed3506e4c3c6b.js,
  регресс scripts/test-mirror-failover.ts — 14 OK / 0 FAIL.

Stage Summary:
- v1.14.40: перенос данных файлом закрыл главный практический вопрос
  фейловера — велики с vercel-ящика переносятся на зеркало за 2 минуты
  (VPN → «Экспорт» → зеркало → «Импорт»).
- Формулировка «данные на vercel» признана неудачной: данные всегда на
  устройстве; разделяются только ящики localStorage по доменам.
- Следующая версия: v1.14.41.

---
Task ID: 45
Agent: Super Z (main)
Task: ТЗ «Cross-Origin Storage Sync & Strict Bike-Matching Validation» —
(A) бесшовный мост postMessage+iframe между vercel и зеркалом,
(B) фильтр ближней ноги по отчётам #10/#11 (колено 167°, бедро 151°)
+ жёсткий чек-поинт совпадения велов → v1.14.41

Work Log:
- A. Cross-Domain Bridge:
  1) public/sync-bridge.html — служебная страница-мост: слушает
     postMessage, READ отдаёт снапшот четырёх ключей bikefit-* СВОЕГО
     origin, WRITE пишет те же ключи. Отклонение от черновика ТЗ
     («bikesnap_store» одним ключом): реальное хранилище — четыре
     ключа bikefit-*; одиночный ключ синхронизировал бы пустоту.
     Безопасность: whitelist из двух origin, только window.parent,
     ответ строго в event.origin (без «*»).
  2) src/lib/syncBridge.ts — взаимный pull: на зеркале скрытый iframe
     → /sync-bridge.html vercel, на vercel → зеркало; снапшот
     валидируется (кривой → reject) и вливается mergeSnapshot
     (additive по id — циклы невозможны, в peer ничего не пишем).
     Задержка старта 2.5 с, таймаут 8 с → vercel заблокирован без VPN
     = тихий no-op (SOP при блокировке физически не обходится; мост
     работает, когда обе площадки доступны — VPN). Экспорт/импорт
     файла v1.14.40 остаётся ручным резервом.
  3) sync-bridge-init.tsx в layout: точка запуска, тост при
     реальном добавлении (+велы/+райдеры).
  4) mergeSnapshot доработан: активный вел/райдер восстанавливается
     ТОЛЬКО на пустом/битом локальном активе — синк не перебрасывает
     актив у работающего пользователя.
- B. Нейросеть:
  1) bike-fit.ts: getCleanRiderKeypoints v2 — суммарный балл
     видимости по 5 суставам (Hip/Knee/Ankle/Heel/FootIndex) вместо
     среднего из 3 (legVisibilityScore): фантомная дальняя нога в
     #10/#11 держала высокий confidence на б/к/л, но глючила на
     пятке/носке; геометрическая санитария legChainSane — вырожденные
     цепочки (колено приклеено к бедру, нога схлопнулась в точку)
     не проходят даже при высоких visibility; sideScores в результате
     для телеметрии; getBestLegSide() — сторона отрисовки при провале
     анализа (раньше activeSide=null рисовал обе ноги — «паутина»
     возвращалась). Строгость сохранена: победитель по баллу не
     заменяется молча другой стороной.
  2) bike-wheel-ratio.ts: WHEEL_RATIO_MISMATCH_PCT 12% → 10%.
  3) PhotoAnalysisSection: mismatch >10% → ХАРД-БЛОК автоматического
     сравнения с рамой: модалка с текстом ТЗ + красный баннер;
     блокируются CrossRefRecommendations (геометрия↔поза) и
     ComparisonReport («Было ➔ Стало»); разблокировка — явное
     «Это тот же велосипед — продолжить», override сбрасывается при
     смене фото/вела; модалка переоткрывается на каждом анализе и на
     кэшированных анализах.
- Тест scripts/test-leg-selection.ts: 23 проверки — воспроизведён
  сценарий #10/#11 (фантом дальней ноги выигрывает по СТАРОЙ логике
  среднего из 3, v2 выбирает ближнюю), сквозной analyzeBikeFit даёт
  живые углы ближней ноги (не 167°/151°), дегенеративные цепочки
  отсекаются, тай-брейк, порог 10% (9% match / 11% mismatch).
  23 OK / 0 FAIL. (2 первых FAIL — ошибки синтетики теста:
  нереалистичный плечевой угол и неверные ожидаемые проценты —
  исправлены в тесте, не в проде.)
- Бамп 1.14.41: package.json / app-version.ts / sw.js / version.json /
  whats-new.ts / CHANGELOG.md. tsc чисто (касты в payloadToSnapshot —
  валидация записей внутри mergeSnapshot), next build OK, смоук :3314 —
  страница 200, version.json и sw.js = v1.14.41, sync-bridge.html
  отдаётся с whitelist'ом origin, регресс test-mirror-failover.ts
  14 OK / 0 FAIL.

Stage Summary:
- v1.14.41: (A) данные сами перетекают между vercel и зеркалом, когда
  обе площадки доступны; (B) фантомный скелет дальней ноги отсекается
  суммой видимости по 5 суставам + геометрией; расхождение велов >10%
  блокирует сравнение с рамой до явного подтверждения.
- Пользователю: обновиться до 1.14.41; сценарий #10/#11 повторить —
  если фантом снова пролезет, sideScores придут в отчёт отладки.
- Следующая версия: v1.14.42.

---
Task ID: 45-b (аддон)
Agent: Super Z (main)
Task: верификация v1.14.41 на площадках + фикс отсутствия sync-bridge.html на зеркале

Work Log:
- Vercel: version.json/sw.js = v1.14.41, sync-bridge.html живой — OK.
- Зеркало: version.json/sw.js = v1.14.41, но sync-bridge.html = 404-страница
  GH Pages: файл не упоминается в HTML/JS, замыкание mirror_to_pages.py его
  не находит. Фикс: "sync-bridge.html" добавлен в ROOT_FILES
  (scripts/mirror_to_pages.py), коммит 27d8de8, пуш → workflow пере-зеркалил.
- Финал: sync-bridge.html живой на ОБОИХ origin'ах (проверено grep'ом
  BIKESNAP_READ_STORAGE), версии совпадают — v1.14.41.

Stage Summary:
- Зеркальный конвейер дополнен новым обязательным файлом; при будущих
  служебных страницах в public/ — не забывать ROOT_FILES.

---
Task ID: 46
Agent: Super Z (main)
Task: вопрос «есть бесплатные нейронки для анализа вела/посадки?» →
решение «делай обе»: (1) BlazePose lite→full + z-тай-брейк, (2) AI-разбор
посадки на бесплатном тире Google Gemini → v1.14.42

Work Log:
- A. BlazePose full + z-тай-брейк:
  1) pose_landmarker_full.task (float16, 9.4 МБ) скачан в
     public/cdn/mediapipe/models (self-hosted, офлайн); use-pose-landmarker
     дефолт → full; lite остался как запас (откат = одна строка).
  2) sw.js: AI_ASSETS префетчит full, VERSION v1.14.42.
  3) bike-fit.ts: Point.z (глубина MediaPipe, меньше = ближе) — приходит
     из result.landmarks автоматически, персистится; legZScore (колено+
     лодыжка, Infinity если z нет); chooseLegSide — единый выбор стороны:
     балл 5 суставов (v1.14.41), спорная зона |Δ|<0.3 + |Δz|≥0.02 →
     тай-брейк по z (ближняя нога); вне зоны балл решает сам (z шумный,
     явного победителя не перебивает). getCleanRiderKeypoints v3 и
     getBestLegSide через один chooseLegSide — расчёт = отрисовка.
     Телеметрия zScores/zUsed.
- B. AI-разбор посадки (Gemini free tier, BYO-ключ):
  1) src/lib/ai-consult.ts: buildAiConsultPrompt (чистая: антропометрия,
     вся геометрия вела, углы с нормами/статусами, KOPS со ЗНАКОМ,
     цель, жалобы по-русски, имя райдера НЕ утекает); system — роль
     байкфиттера, запрет выдумывать измерения/диагнозы, «1-2 параметра
     за раз», markdown ≤400 слов; requestAiConsult — generateContent
     v1beta, ключ в x-goog-api-key, таймаут 60с + отмена, человекочитаемые
     ошибки 400/403/404/429/пустой ответ/блок. Настройки в localStorage
     (bikefit-ai-key / bikefit-ai-model), дефолт gemini-2.0-flash
     (макс. бесплатный дневной лимит), 2.5-flash / 2.5-flash-lite в списке.
     Приватность: ТОЛЬКО числа (без фото), ключ пользовательский,
     напрямую в Google без промежуточных серверов.
  2) AiConsultCard.tsx: карточка «AI-разбор посадки» (после рекомендаций
     по жалобам, при готовом боковом анализе) + диалог: ссылка на
     aistudio.google.com/apikey, поле ключа с маской, выбор модели,
     спиннер, markdown-результат, копирование, повторный прогон,
     отмена при закрытии. Подключена в PhotoAnalysisSection
     (aiInput: имя вела из карточки, жалобы из store, saddleHeightMm).
- Тесты: test-leg-selection.ts +9 z-сцен → 32 OK / 0 FAIL;
  test-ai-consult.ts (новый) — 31 OK / 0 FAIL (первый прогон 1 FAIL —
  кривая синтетика теста: measurements с saddleHeight не пустая;
  исправлено в тесте); регресс test-mirror-failover.ts 14 OK / 0 FAIL.
- tsc чисто (AiConsultCard: убран бессмысленный phase-сравнение в
  done-ветке), next build OK, смоук :3314 — страница 200, version.json /
  sw.js = v1.14.42, full-модель 9.4 МБ отдаётся, sync-bridge.html жив.
- Бамп 1.14.42: package.json / sw.js / version.json / app-version.ts /
  whats-new.ts / CHANGELOG.md.

Stage Summary:
- v1.14.42: офлайн-позодетект точнее (full + z-тай-брейк — окончательное
  оружие против фантомных ног), плюс кнопка «Спросить AI» — пошаговый
  разбор посадки от Gemini по числам без фото.
- Пользователю: обновиться, для AI-разбора вставить бесплатный ключ
  Google AI Studio в настройках кнопки (aistudio.google.com/apikey).
- Следующая версия: v1.14.43.

---
Task ID: 46-b
Agent: main (Super Z)
Task: Верификация релиза v1.14.42 (коммит 56617e7) на обеих площадках.

Work Log:
- Пре-флайт: рабочее дерево чистое, версия 1.14.42 подтверждена во всех
  6 точках (package.json / sw.js VERSION / version.json / app-version.ts /
  whats-new.ts / CHANGELOG.md).
- Пуш 56617e7 → origin/main (fce36d4..56617e7) по токену пользователя.
- Vercel: version.json = v1.14.42 ✓, sw.js const VERSION = "v1.14.42" ✓.
- Workflow «Mirror to GitHub Pages» на 56617e7: completed / success ✓.
- Зеркало: первая проверка — 404 (self-made ошибка верификатора: поллил
  https://agent-slon-lab.github.io/BikeSnap/... — это НЕ тот путь; зеркало
  деплоится в корень agent-slon-lab.github.io, отдельный репо, push -f main
  по SSH deploy key). scripts/verify-v1442.sh исправить в следующий раз.
- Правильная проверка https://agent-slon-lab.github.io/ (корень):
  version.json = v1.14.42 ✓, sw.js VERSION = "v1.14.42" ✓,
  index title «BikeSnap — Анализ посадки на велосипеде» ✓.

Stage Summary:
- РЕЛИЗ v1.14.42 ВЕРИФИЦИРОВАН на обеих площадках: Vercel и зеркало.
- Урок для верификаторов: зеркало живёт в КОРНЕ agent-slon-lab.github.io
  (URL без /BikeSnap).
- Следующая версия: v1.14.43.

---
Task ID: 47
Agent: main (Super Z)
Task: v1.14.43 — ТЗ «Защита от дурака»: multi-factor сверка велов
(4 фактора вместо одного) + модалка несоответствия с причинами.

Work Log:
- Разведка: существующая сверка = один фактор (пропорции колёс,
  bike-wheel-ratio.ts, хард-блок 10% v1.14.41). На Шаге 1 разметки рамы
  нет — факторы ТЗ (top tube slope, BB-цвет) адаптированы к измеримому:
  детектор колёс + BlazePose + разметка Шага 2 + тип вела из карточки
  (BikeType есть в BikeRecord).
- src/lib/bike-match-validator.ts (новый): F1 proportions (интеграция
  bikeMatchVerdict), F2 frameColor (медиана: Шаг 2 — середина подседельной
  трубы BB→saddleMount, фоллбэк BB; Шаг 1 — зона верхней трубы 0.26–0.58 R
  над осями из колёс детектора; порог ΔC > 90 по ТЗ), F3 riderScale
  ((axleMidY − таз/седло)/радиус, допуск 25%), F4 gripType (кисти vs плечи
  норм. на торс vs BikeType: road/gravel — кисти не выше плеч на 15%
  торса; mtb/city/hybrid — не ниже на 50%). Вердикты: block (≥2 fail
  ИЛИ F1), warn (1), ok, unknown. reasons[] для UI.
- src/lib/frame-color-sample.ts (новый): медианный RGB из HTMLImageElement
  (окно в оригинальном разрешении) и из RawFrame детектора (без второго
  canvas). medianRgbFromPixels устойчив к выбросам (нога/тень в окне).
- bike-wheel-ratio.ts: computeWheelFrameMeta() — ratio + норм. оси + радиус
  за один проход детектора.
- photo-analysis-store.ts: riderWheelMeta + setRiderWheelMeta — персист
  рядом с riderPhotoWheelRatio, те же сбросы (setViewPhoto side, clearView
  side, startRefit, syncBikeId), partialize + санитизация в merge.
- PhotoAnalysisSection.tsx: обе точки детекции (новое фото + mount-effect
  для persist-фото) считают meta+цвет; bikeCardData/bikeCardSignals из
  keyPointsData+type; bikeBbColor effect (Image → семпел подседельной);
  multiMatch = validateBikeMatch(...); bikeMatchBlocking =
  verdict==="block" && !override (хард-блок F1 сохранён); плашки block/
  warn/ok/unknown переписаны (block и warn показывают reasons[]), модалка:
  «Обнаружено несоответствие велосипедов!» + причины + кнопки
  «📷 Переснять фото с этим же велосипедом» / «Всё равно продолжить (на
  свой страх и риск)» (по ТЗ). Задействован bikeMatchVerdict (F1) остался
  для деталей; computeTopTubeSlopeDeg — телеметрия/будущее (Factor B ТЗ
  на Шаге 1 не измерим — документировано в докблоках).
- Тесты: scripts/test-bike-match-validator.ts (новый) 46 OK / 0 FAIL;
  scripts/test-bike-match.ts — починен устаревший кейс границы порога
  (11.9/12.1% под старый порог 12% → 9.9/10.1% под v1.14.41=10%):
  15 OK / 0 FAIL (FAIL существовал и на HEAD до моих правок).
- tsc чисто (2 до-существующих фильтруемых скрипта), next build OK,
  смоук :3315 — 200 / version.json v1.14.43 / sw VERSION v1.14.43 /
  full-модель 9.4 МБ / sync-bridge 200.
- Бамп 1.14.43: package.json / sw.js / version.json / app-version.ts /
  whats-new.ts (новая запись) / CHANGELOG.md (секция с контекстом).

Stage Summary:
- v1.14.43: сверка велов 4-факторная; подмена ловится даже при совпадении
  пропорций (цвет/масштаб посадки/хват); блокировка с перечнем причин,
  warn — без блокировки; старый хард-блок пропорций не ослаблен.
- Следующая версия: v1.14.44.
