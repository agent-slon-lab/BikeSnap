#!/usr/bin/env python3
"""
BikeSnap: верификация зеркала GitHub Pages против продакшена.

Сверки (ШАГ 4 ТЗ):
  - sha256 байт-в-байт: index.html (по корню "/", НЕ по "/index.html" —
    Vercel на прямой путь отдаёт 404), sw.js, manifest.webmanifest,
    version.json;
  - /_next/* ассеты на зеркале = 200 (.nojekyll работает);
  - version.json зеркала = ожидаемая версия;
  - age ответов зеркала (CDN GH Pages) — informational.

Использование:
  python3 scripts/verify-mirror.py --expected v1.14.33 [--retries 10]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.request

PROD = "https://bike-snap.vercel.app"
MIRROR = "https://agent-slon-lab.github.io"
UA = "bikesnap-verify/1.0"


def get(url: str) -> tuple[int, bytes, dict]:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)
    except Exception as e:  # noqa: BLE001
        return 0, str(e).encode(), {}


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()[:16]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--expected", default=None, help="ожидаемая версия, напр. v1.14.33")
    ap.add_argument("--retries", type=int, default=10)
    args = ap.parse_args()

    if not args.expected:
        st, body, _ = get(f"{PROD}/version.json")
        if st == 200:
            args.expected = json.loads(body).get("version")
    if not args.expected:
        print("не удалось определить ожидаемую версию", file=sys.stderr)
        return 1
    print(f"ожидаемая версия: {args.expected}\n")

    results: list[tuple[str, bool, str]] = []

    # 1. Байт-в-байт сверка (с ретраями: CDN зеркала обновляется до ~10 мин)
    for path in ["/", "/sw.js", "/manifest.webmanifest", "/version.json"]:
        st_p, body_p, _ = get(f"{PROD}{path}")
        match, note = False, ""
        for attempt in range(1, args.retries + 1):
            st_m, body_m, hdr = get(f"{MIRROR}{path}")
            if st_m == 200 and body_m == body_p:
                match = True
                note = f"sha {sha(body_p)} (попытка {attempt})"
                break
            note = f"prod={st_p}/{sha(body_p)} mirror={st_m}/{sha(body_m)} (попытка {attempt})"
            time.sleep(30)
        results.append((f"sha256 {path}", match, note))

    # 2. version.json зеркала = ожидаемая версия
    st_m, body_m, _ = get(f"{MIRROR}/version.json")
    try:
        ver = json.loads(body_m).get("version")
    except Exception:  # noqa: BLE001
        ver = None
    results.append(("version.json = ожидаемой", ver == args.expected, f"got={ver}"))

    # 3. _next ассет на зеркале = 200
    st_p, body_p, _ = get(f"{PROD}/")
    import re

    chunks = re.findall(rb'/_next/static/[A-Za-z0-9._\-/]+\.js', body_p)
    ok_chunk = False
    note = "нет чанков в index.html"
    if chunks:
        sample = chunks[0].decode()
        st_m, _, _ = get(f"{MIRROR}{sample}")
        ok_chunk = st_m == 200
        note = f"{sample} → {st_m}"
    results.append(("_next ассет = 200", ok_chunk, note))

    # 4. .nojekyll существует
    st_m, _, _ = get(f"{MIRROR}/.nojekyll")
    results.append((".nojekyll = 200", st_m == 200, f"got={st_m}"))

    # 5. SW-ассеты ИИ на зеркале
    for path in [
        "/cdn/mediapipe/wasm/vision_wasm_internal.wasm",
        "/cdn/mediapipe/models/pose_landmarker_lite.task",
    ]:
        st_m, _, hdr = get(f"{MIRROR}{path}")
        results.append((f"asset {path.split('/')[-1]}", st_m == 200, f"got={st_m}"))

    print(f"{'ПРОВЕРКА':48} {'OK/FAIL':8} ДЕТАЛИ")
    fails = 0
    for name, ok, note in results:
        print(f"{name:48} {'OK' if ok else 'FAIL':8} {note}")
        fails += 0 if ok else 1

    print()
    if fails:
        print(f"ИТОГ: {fails} провал(ов) из {len(results)}. "
              f"Если это только sha256 — CDN GH Pages мог не обновиться (~10 мин), перезапустите позже.")
        return 1
    print("ИТОГ: все проверки пройдены — зеркало идентично продакшену.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
