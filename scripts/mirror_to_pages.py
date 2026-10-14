#!/usr/bin/env python3
"""
BikeSnap: зеркалирование продакшена (Vercel) на GitHub Pages — ЗАМЫКАНИЕМ.

Алгоритм:
  1. Скачать "/" → index.html (сравнение с зеркалом делается по корню "/",
     НЕ по "/index.html": Vercel на прямой путь отдаёт 404).
  2. Выцепить все /_next/static/* из HTML (script/link/preload).
  3. Скачать их; просканировать каждый JS/CSS регуляркой на НОВЫЕ пути
     чанков/шрифтов/медиа → докачать → повторять до стабилизации.
  4. Явно скачать корневые файлы: sw.js, manifest.webmanifest, version.json,
     иконки, favicon-заглушки, схемы, robots.txt и самохостинг MediaPipe.
  5. Положить .nojekyll в корень — ОБЯЗАТЕЛЬНО, иначе Jekyll выкинет каталог
     _next. Сгенерировать README.

Зеркало байт-в-байт повторяет продакшен (никаких переписываний URL):
сверка с продом идёт по sha256 (scripts/verify-mirror.py).

Использование:
  python3 scripts/mirror_to_pages.py \
      --src https://bike-snap.vercel.app --out /home/z/my-project/mirror

Выход: 0 — ок; 1 — критичный файл не скачался.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request

# Пути ассетов в HTML/JS/CSS, в т.ч. экранированные "\\/_next\\/static\/..."
NEXT_RE = re.compile(
    r"\\?/_next/static/[A-Za-z0-9._\-/]+\.(?:js|css|woff2?|png|jpe?g|svg|webp|avif|mp4|json|ico|txt)"
)

# Корневые файлы продакшена (public/), которые замыкание по HTML может не найти
ROOT_FILES = [
    "sw.js",
    "manifest.webmanifest",
    "version.json",
    "robots.txt",
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-512.png",
    "apple-touch-icon.png",
    "logo.svg",
    "bike-schema.png",
    "bike-schema-source.svg",
    "test-schema.svg",
    # Самохостинг MediaPipe (обязателен для офлайна/зеркала — внешний CDN
    # в офлайне недоступен, а из РФ часть CDN тоже может быть недоступна)
    "cdn/mediapipe/wasm/vision_wasm_internal.js",
    "cdn/mediapipe/wasm/vision_wasm_internal.wasm",
    "cdn/mediapipe/wasm/vision_wasm_nosimd_internal.js",
    "cdn/mediapipe/wasm/vision_wasm_nosimd_internal.wasm",
    "cdn/mediapipe/models/pose_landmarker_lite.task",
]

# Критичные файлы: без них зеркало считается несостоявшимся
REQUIRED = ["/", "sw.js", "manifest.webmanifest", "version.json"]

UA = "bikesnap-mirror/1.0 (+https://github.com/agent-slon-lab/BikeSnap)"

README = """# BikeSnap — зеркало продакшена

Это автоматическое зеркало https://bike-snap.vercel.app/ (PWA «BikeSnap» —
подбор велосипедной посадки по фото), публикуемое для доступа из сетей,
где зона *.vercel.app заблокирована по SNI.

- Обновляется автоматически при каждом пуше в main основного репо
  (GitHub Action `mirror-to-pages`).
- Контент байт-в-байт повторяет продакшен (сверка по SHA-256).
- Полностью статичен: сервис-воркер, офлайн-режим и данные живут в браузере.

Репозиторий приложения: https://github.com/agent-slon-lab/BikeSnap
Этот репозиторий используется ТОЛЬКО под зеркало Pages.
"""


def fetch(src: str, path: str) -> tuple[bytes | None, str]:
    """GET src+path → (body, content_type); None при любой ошибке."""
    url = f"{src}{path}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read(), resp.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        print(f"  ! {path} -> HTTP {e.code}", flush=True)
        return None, ""
    except Exception as e:  # noqa: BLE001
        print(f"  ! {path} -> {type(e).__name__}: {e}", flush=True)
        return None, ""


def safe_path(out: str, path: str) -> str:
    """Путь файла внутри out без выходов за корень и без query."""
    path = path.split("?")[0].split("#")[0]
    rel = path.lstrip("/")
    rel = os.path.normpath(rel)
    if rel in ("", ".", "/"):
        rel = "index.html"  # корень "/" сохраняем как index.html
    if rel.startswith("..") or os.path.isabs(rel):
        raise ValueError(f"опасный путь из HTML: {path!r}")
    return os.path.join(out, rel)


def scan_text(data: bytes) -> set[str]:
    """Новые /_next/static/* пути в тексте (JS/CSS, экранирование учтено)."""
    found = set()
    for m in NEXT_RE.finditer(data.decode("utf-8", errors="replace")):
        clean = m.group(0).replace("\\", "")
        found.add(clean)
    return found


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="https://bike-snap.vercel.app")
    ap.add_argument("--out", default="/home/z/my-project/mirror")
    ap.add_argument("--max-files", type=int, default=600)
    args = ap.parse_args()

    src, out = args.src.rstrip("/"), args.out
    os.makedirs(out, exist_ok=True)

    queue: list[str] = ["/"] + [f"/{p}" for p in ROOT_FILES]
    seen: set[str] = set()
    ok_files: list[str] = []
    failed: list[str] = []
    total_bytes = 0
    queue.extend([])  # noqa — читаемость

    i = 0
    while i < len(queue) and len(seen) < args.max_files:
        path = queue[i]
        i += 1
        if path in seen:
            continue
        seen.add(path)

        data, ctype = fetch(src, path)
        if data is None:
            # необязательные корневые могут отсутствовать — не фатально
            if path not in [f"/{r}" for r in REQUIRED]:
                failed.append(path)
            continue

        fp = safe_path(out, path)
        os.makedirs(os.path.dirname(fp), exist_ok=True)
        with open(fp, "wb") as f:
            f.write(data)
        total_bytes += len(data)
        ok_files.append(path)
        print(f"  + {path} ({len(data)} B)", flush=True)

        # замыкание: из HTML/JS/CSS вытаскиваем новые /_next/static/*
        lower = path.lower()
        if lower.endswith((".html", ".js", ".css")) or "html" in ctype or "javascript" in ctype or "css" in ctype:
            for np in scan_text(data):
                if np not in seen:
                    queue.append(np)

    # .nojekyll — ОБЯЗАТЕЛЬНО: без него Jekyll выкинет каталог _next
    open(os.path.join(out, ".nojekyll"), "w").close()
    with open(os.path.join(out, "README.md"), "w", encoding="utf-8") as f:
        f.write(README)

    # проверка критичных
    missing = []
    for r in REQUIRED:
        rp = safe_path(out, r)
        if not os.path.isfile(rp) or os.path.getsize(rp) == 0:
            missing.append(r)

    index_fp = os.path.join(out, "index.html")
    index_sha = (
        hashlib.sha256(open(index_fp, "rb").read()).hexdigest()
        if os.path.isfile(index_fp)
        else "нет"
    )

    summary = {
        "files": len(ok_files),
        "bytes": total_bytes,
        "failed_optional": failed,
        "missing_required": missing,
        "index_sha256": index_sha,
    }
    with open(os.path.join(out, "mirror-manifest.json"), "w") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if missing:
        print(f"ОШИБКА: не скачаны критичные файлы: {missing}", file=sys.stderr)
        return 1
    print(f"OK: {len(ok_files)} файлов, {total_bytes / 1e6:.1f} МБ → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
