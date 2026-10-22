#!/usr/bin/env python3
"""
BikeSnap: зеркалирование продакшена (Vercel) на GitHub Pages PROJECT PAGE
https://agent-slon-lab.github.io/BikeSnap/ (ветка gh-pages ЭТОГО репозитория).

Почему проектная страница, а не корень agent-slon-lab.github.io: корень теперь
общая витрина приложений (Slon Lab), а «война двух ботов» за корень закончилась
тем, что приложения затирали друг друга. Зеркало BikeSnap переезжает на свою
«полку» /BikeSnap/ — как и /fart-counter/ у соседнего приложения.

Поэтому каждый текстовый файл зеркала получает переписывание корневых
абсолютных путей в под-путь /BikeSnap/:
  - HTML-атрибуты (src|href|content|poster|action="/..."),
  - CSS url(/...),
  - строки "/_next/...", "/cdn/mediapipe/...", "/sw.js", "/version.json",
    "/manifest.webmanifest", иконки и схемы в JS/RSC-полезной нагрузке,
  - sw.js (kind=sw): кэш-ключи SHELL/«/», литералы pathname-проверок,
    ASSET_RE (поиск чанков) получает необязательный префикс BikeSnap,
    MIRROR_ORIGIN → «...github.io/BikeSnap»; при этом два кросс-доменных
    concat ТОЧНО РЕВЕРТИРУЮТСЯ: зонд версии origin+"/version.json?t=" и
    HTML-качка обновы source.origin+"/" (у обеих половин origin уже верный).
  - manifest.webmanifest: id/start_url/scope + иконки.

СОЗНАТЕЛЬНО не переписываем "/sync-bridge.html": адрес sync-моста строится
как peer + "/sync-bridge.html", где peer — КОРЕНЬ чужого origin
(agent-slon-lab.github.io <-> bike-snap.vercel.app, см. src/lib/syncBridge.ts).
Префикс сломал бы мост в обе стороны; сам файл просто лежит на полке.

Замыкание: "/" -> все /_next/static/* (вкл. экранированные "\\/_next\\/static\\/")
-> скан JS/CSS на вложенные пути -> повтор до стабилизации. Корневые файлы
public/ тащим явно (ROOT_FILES). Побайтовая сверка с продом больше не имеет
смысла (контент переписан); актуальность зеркала проверяется по version.json
(см. workflow). .nojekyll обязателен — иначе Jekyll съест каталог _next.

Использование:
  python3 scripts/mirror_to_pages.py \\
      --src https://bike-snap.vercel.app --out ~/mirror --subpath /BikeSnap

Выход: 0 — ок; 1 — не скачался критичный файл (REQUIRED).
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

DEFAULT_SRC = "https://bike-snap.vercel.app"
# Проектная страница репо BikeSnap. Регистр ВАЖЕН: URL = имя репозитория.
DEFAULT_SUBPATH = "/BikeSnap"

# Пути ассетов в HTML/JS/CSS — и обычные "/_next/static/...", и экранированные
# "\\/_next\\/static\\/..." (Next экранирует каждый слеш в RSC-полезной нагрузке).
NEXT_RE = re.compile(
    r"\\?/_next\\?/static\\?/[A-Za-z0-9._\-/\\]+?\.(?:js|css|woff2?|png|jpe?g|svg|webp|avif|mp4|json|ico|txt)"
)

# Корневые файлы продакшена (public/), которые замыкание по HTML может не найти.
ROOT_FILES = [
    "sw.js",
    "manifest.webmanifest",
    "version.json",
    "sync-bridge.html",
    "robots.txt",
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-512.png",
    "apple-touch-icon.png",
    "logo.svg",
    "bike-schema.png",
    "bike-schema-source.svg",
    "test-schema.svg",
    # Самохостинг MediaPipe (обязателен для офлайна/зеркала: анализ поз
    # работает на клиенте, внешний CDN в офлайне недоступен).
    "cdn/mediapipe/wasm/vision_wasm_internal.js",
    "cdn/mediapipe/wasm/vision_wasm_internal.wasm",
    "cdn/mediapipe/wasm/vision_wasm_nosimd_internal.js",
    "cdn/mediapipe/wasm/vision_wasm_nosimd_internal.wasm",
    "cdn/mediapipe/models/pose_landmarker_full.task",
    "cdn/mediapipe/models/pose_landmarker_lite.task",
]

# Критичные файлы: без них зеркало считается несостоявшимся.
REQUIRED = ["/", "sw.js", "manifest.webmanifest", "version.json"]

UA = "bikesnap-mirror/2.0 (+https://github.com/agent-slon-lab/BikeSnap)"

README = """# BikeSnap — зеркало продакшена (проектная страница)

Автоматическое зеркало https://bike-snap.vercel.app/ (PWA «BikeSnap» —
подбор велосипедной посадки по фото), публикуемое для доступа из сетей,
где зона *.vercel.app заблокирована по SNI.

- Адрес зеркала: https://agent-slon-lab.github.io/BikeSnap/
- Обновляется автоматически при каждом пуше в main основного репо
  (GitHub Action `mirror-to-pages` публикует ветку gh-pages ЭТОГО репо).
- Корневые абсолютные пути продакшена переписаны в под-путь /BikeSnap/,
  поэтому контент осознанно НЕ совпадает с продом побайтово.
- Полностью статичен: сервис-воркер, офлайн-режим и данные живут в браузере.
- Корень agent-slon-lab.github.io — витрина приложений (Slon Lab),
  он больше не используется под зеркало.

Репозиторий приложения: https://github.com/agent-slon-lab/BikeSnap
"""


# ---------------------------------------------------------------------------
# Переписывание путей (перенесено с проверенного скрипта fart-counter
# и адаптировано под BikeSnap: cdn/mediapipe, sw.js-загрузчик обновы, manifest).
# ---------------------------------------------------------------------------

class Rewriter:
    def __init__(self, subpath: str):
        self.sub = "/" + subpath.strip("/")  # "/BikeSnap"
        self.sp = self.sub.strip("/")        # "BikeSnap"
        # Корневые пути в кавычках, которым нужен префикс полки.
        # БЕЗ sync-bridge.html (см. докстринг модуля) и БЕЗ api/ (на полке
        # релеев нет в любом виде — 404 обрабатывается приложением мягко).
        quoted = [
            r"_next/",
            r"cdn/mediapipe/",
            r"sw\.js",
            r"manifest\.webmanifest",
            r"version\.json",
            r"icon-",
            r"apple-touch-icon\.png",
            r"logo\.svg",
            r"bike-schema",
            r"test-schema\.svg",
            r"robots\.txt",
        ]
        self.quoted_re = re.compile(r'(["\'])/(' + "|".join(quoted) + r')')
        self.attr_re = re.compile(r'((?:src|href|content|poster|action)="/)(?!/)')
        self.url_css_re = re.compile(r'url\(\s*["\']?/(?!/)')
        self.url_css_unq_re = re.compile(r"url\(\s*/(?!/)")
        self.scope_re = re.compile(r'(scope\s*:\s*)"/"')
        self.root_only_re = re.compile(r'"/"')

    def _prefix_quoted(self, m):
        return m.group(1) + self.sub + "/" + m.group(2)

    def text(self, text: str, kind: str = "text") -> str:
        """Переписать корневые-абсолютные пути в под-путь /BikeSnap/."""
        # 1) HTML-атрибуты: src="/...", href="/...", content="/..." (не "//...").
        text = self.attr_re.sub(lambda m: m.group(1) + self.sp + "/", text)
        # 2) CSS url(/...).
        text = self.url_css_re.sub("url(" + self.sub + "/", text)
        text = self.url_css_unq_re.sub("url(" + self.sub + "/", text)
        # 3) Корневые пути в кавычках (JS-строки, RSC, HTML, pathname-литералы).
        text = self.quoted_re.sub(self._prefix_quoted, text)
        # 4) scope:"/" в JS-регистрациях SW (если появится).
        text = self.scope_re.sub(r'\g<1>"' + self.sub + '/"', text)
        if kind == "sw":
            text = self.sw(text)
        return text

    def sw(self, text: str) -> str:
        """Специфика sw.js BikeSnap (v1.14.47, офлайн-загрузчик обновы)."""
        sub, sp = self.sub, self.sp
        # 5) Одиночные "/" — это кэш-ключи и корень ПОЛКИ:
        #    SHELL[0], caches.match("/"), cache.put("/", ...), queue ["/", ...].
        text = self.root_only_re.sub('"' + sub + '/"', text)
        # 6) ASSET_RE (поиск чанков в HTML/JS): необязательный префикс BikeSnap,
        #    чтобы находить и "/BikeSnap/_next/...", и "\\/BikeSnap\\/_next\\...".
        text = text.replace(
            r'\\?_next\\?\/static',
            r'(?:' + sp + r'\\?\/)?\\?_next\\?\/static',
        )
        # 7) Зеркало для фоновой загрузки обновы: корень больше не наш.
        text = text.replace(
            '"https://agent-slon-lab.github.io"',
            '"https://agent-slon-lab.github.io' + sub + '"',
        )
        # 8) Точечные реверты кросс-доменных concat (шаг 3/5 их тронули):
        #    зонд версии origin+"/version.json?t=" годится ОБЕИМ половинам
        #    (прод — корень, зеркало — origin уже с полкой);
        #    HTML-качка обновы source.origin+"/" — по той же причине.
        text = text.replace(
            'origin + "' + sub + '/version.json?t="', 'origin + "/version.json?t="'
        )
        text = text.replace(
            'source.origin + "' + sub + '/"', 'source.origin + "/"'
        )
        return text

    def manifest(self, text: str) -> str:
        """manifest.webmanifest: id/start_url/scope + иконки."""
        for key in ("start_url", "scope", "id"):
            text = text.replace('"%s": "/"' % key, '"%s": "%s/"' % (key, self.sub))
        text = self.quoted_re.sub(self._prefix_quoted, text)
        return text


# ---------------------------------------------------------------------------
# Загрузка и сохранение
# ---------------------------------------------------------------------------

def fetch(src: str, path: str) -> tuple[bytes | None, str]:
    """GET src+path -> (body, content_type); None при любой ошибке."""
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


def scan_next(data: bytes) -> set[str]:
    """Новые /_next/static/* пути в тексте (обычные и экранированные)."""
    found = set()
    text = data.decode("utf-8", errors="replace")
    for m in NEXT_RE.finditer(text):
        found.add(m.group(0).replace("\\", ""))
    return found


# ---------------------------------------------------------------------------
# Замыкание
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--out", default=os.path.expanduser("~/mirror"))
    ap.add_argument("--subpath", default=DEFAULT_SUBPATH)
    ap.add_argument("--max-files", type=int, default=600)
    args = ap.parse_args()

    src = args.src.rstrip("/")
    out = args.out
    sub = "/" + args.subpath.strip("/")
    if sub == "/":
        print("ОШИБКА: --subpath не должен быть корнем (зеркало живёт на /BikeSnap/)", file=sys.stderr)
        return 2
    rw = Rewriter(sub)
    os.makedirs(out, exist_ok=True)
    print(f"src={src} out={out} subpath={sub}")

    todo: list[str] = ["/"] + [f"/{p}" for p in ROOT_FILES]
    seen: set[str] = set()
    ok_files: list[str] = []
    failed: list[str] = []
    total_bytes = 0

    i = 0
    while i < len(todo) and len(seen) < args.max_files:
        path = todo[i]
        i += 1
        if path in seen:
            continue
        seen.add(path)

        data, ctype = fetch(src, path)
        if data is None:
            failed.append(path)
            continue

        # Переписывание текстовых файлов (MediaPipe-рантайм не трогаем: он
        # самодостаточен и грузится относительно собственного URL).
        lower = path.lower()
        if path == "/manifest.webmanifest":
            data = rw.manifest(data.decode("utf-8", "replace")).encode("utf-8")
        elif path == "/" or lower.endswith((".html", ".js", ".css", ".txt", ".json")):
            if not path.startswith("/cdn/mediapipe/"):
                kind = "sw" if path == "/sw.js" else "text"
                data = rw.text(data.decode("utf-8", "replace"), kind).encode("utf-8")

        fp = safe_path(out, path)
        os.makedirs(os.path.dirname(fp), exist_ok=True)
        with open(fp, "wb") as f:
            f.write(data)
        total_bytes += len(data)
        ok_files.append(path)
        print(f"  + {path} ({len(data)} B)", flush=True)

        # Замыкание: из HTML/JS/CSS вытаскиваем новые /_next/static/*.
        if path == "/" or lower.endswith((".html", ".js", ".css")):
            for np in scan_next(data):
                if np not in seen:
                    todo.append(np)

    # .nojekyll — ОБЯЗАТЕЛЬНО: без него Jekyll выкинет каталог _next.
    open(os.path.join(out, ".nojekyll"), "w").close()
    with open(os.path.join(out, "README.md"), "w", encoding="utf-8") as f:
        f.write(README)

    # Критичные файлы.
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
        "subpath": sub,
        "failed_optional": failed,
        "missing_required": missing,
        "index_sha256_after_rewrite": index_sha,
    }
    with open(os.path.join(out, "mirror-manifest.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if missing:
        print(f"ОШИБКА: не скачаны критичные файлы: {missing}", file=sys.stderr)
        return 1
    print(f"OK: {len(ok_files)} файлов, {total_bytes / 1e6:.1f} МБ (пути переписаны в {sub}/) -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
