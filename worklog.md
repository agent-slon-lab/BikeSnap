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
