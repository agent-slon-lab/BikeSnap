#!/usr/bin/env python3
"""
BikeSnap: сборка офлайн-пакета (страховка «нет интернета вообще»).

Состав zip:
  mirror/            — зеркало продакшена (уже собрано mirror_to_pages.py)
  start.bat          — Windows: python -m http.server 8642 --bind 127.0.0.1
                       в каталоге mirror + авто-открытие браузера (фолбэк py -3)
  start.sh           — macOS/Linux: то же самое
  README-офлайн.txt  — инструкция (порт НЕ менять: кэш SW привязан к origin)

localhost/127.0.0.1 = безопасный контекст → service worker работает.
Zip прикладывается к GitHub Release (из РФ качается без VPN).

Использование:
  python3 scripts/build-offline-zip.py \
      --mirror /home/z/my-project/mirror \
      --out /home/z/my-project/download/BikeSnap-offline-v1.14.33.zip
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import zipfile

PORT = 8642  # порт менять нельзя: Service Worker-кэш привязан к origin

START_BAT = "\r\n".join(
    [
        "@echo off",
        "chcp 65001 >nul",
        "setlocal",
        'cd /d "%~dp0"',
        'if not exist "mirror\\" (',
        "  echo Katalog mirror ne nayden — raspakuyte arkhiv CELIKOM.",
        "  pause",
        "  exit /b 1",
        ")",
        "where python >nul 2>nul",
        "if %errorlevel%==0 (set PYCMD=python) else (set PYCMD=py -3)",
        'cd mirror',
        f'start "BikeSnap offline" cmd /c "%PYCMD% -m http.server {PORT} --bind 127.0.0.1"',
        "timeout /t 2 /nobreak >nul",
        f'start "" "http://127.0.0.1:{PORT}/"',
        "echo BikeSnap zapushchen: http://127.0.0.1:{PORT}/".replace("{PORT}", str(PORT)),
        "echo NE zakryvayte eto okno, poka polzuetes prilozheniem.",
        "echo (Server: %PYCMD% -m http.server " + str(PORT) + " --bind 127.0.0.1)",
        "pause",
        "",
    ]
)

START_SH = """#!/usr/bin/env bash
# BikeSnap офлайн-пакет: локальный сервер + браузер.
# Порт менять нельзя: Service Worker-кэш привязан к origin.
set -e
cd "$(dirname "$0")/mirror"
PORT=__PORT__
echo "BikeSnap: http://127.0.0.1:$PORT/  (Ctrl+C — остановить)"
(
  sleep 2
  xdg-open "http://127.0.0.1:$PORT/" 2>/dev/null \\
    || open "http://127.0.0.1:$PORT/" 2>/dev/null \\
    || true
) &
python3 -m http.server "$PORT" --bind 127.0.0.1
""".replace("__PORT__", str(PORT))

README = f"""BikeSnap — офлайн-пакет (v-зеркала см. mirror/version.json)
=============================================================

Запуск БЕЗ интернета:
  1. Распакуйте архив ЦЕЛИКОМ в любую папку (внутри должны быть
     mirror/, start.bat, start.sh).
  2. Windows: двойной клик по start.bat   (нужен Python 3: python.org)
     macOS/Linux: в терминале  sh start.sh
  3. Откроется браузер на http://127.0.0.1:{PORT}/

ВАЖНО:
- Порт {PORT} менять нельзя: данные (localStorage) и офлайн-кэш
  привязаны к адресу (origin) http://127.0.0.1:{PORT}.
- localhost/127.0.0.1 — безопасный контекст, service worker работает,
  поэтому при повторных запусках приложение открывается мгновенно.
- Анализ посадки по фото и ИИ-распознавание поз работают полностью
  офлайн (MediaPipe в комплекте, каталог mirror/cdn/mediapipe/).
- Отправка отладочных отчётов («Отладка») требует интернета.
- Данные хранятся в браузере на этом компьютере. Перенос между
  устройствами/браузерами — только вручную (экспорт/импорт, если
  реализован в вашей версии).

Стоп-сервер: закройте чёрное окно сервера (Windows) или Ctrl+C (macOS/Linux).
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mirror", default="/home/z/my-project/mirror")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    mirror = args.mirror
    index = os.path.join(mirror, "index.html")
    if not os.path.isfile(index):
        print(f"ОШИБКА: в {mirror} нет index.html — сначала mirror_to_pages.py", file=sys.stderr)
        return 1

    out = args.out
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if os.path.exists(out):
        os.remove(out)

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        # все файлы зеркала
        for root, _dirs, files in os.walk(mirror):
            for name in files:
                fp = os.path.join(root, name)
                arc = os.path.join("mirror", os.path.relpath(fp, mirror))
                z.write(fp, arc)
        z.writestr("start.bat", START_BAT)
        sh = zipfile.ZipInfo("start.sh", (2026, 10, 15, 0, 0, 0))
        sh.external_attr = 0o755 << 16
        z.writestr(sh, START_SH)
        z.writestr("README-офлайн.txt", README)

    size = os.path.getsize(out)
    print(f"OK: {out} ({size / 1e6:.1f} МБ)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
