#!/usr/bin/env python3
"""BikeSnap: мониторинг авто-отчётов из приложения (Task: «ты гит мониторишь,
скачиваешь и анализируешь»).

Что делает:
  1. Список ОТКРЫТЫХ issue с меткой auto-report (номер, дата, заголовок, ссылка).
  2. Синхронизация user-reports/ из репозитория в локальную папку: скачивает
     все report-*.json и фото, которых ещё нет локально.

Токен: GITHUB_TOKEN из /home/z/my-project/.env.
Запуск: python scripts/check-reports.py
"""

import base64
import json
import os
import sys
import urllib.request

BASE = "/home/z/my-project"
REPO = "agent-slon-lab/BikeSnap"
API = f"https://api.github.com/repos/{REPO}"
LOCAL = os.path.join(BASE, "user-reports")


def load_token() -> str:
    env_path = os.path.join(BASE, ".env")
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("GITHUB_TOKEN="):
                return line.strip().split("=", 1)[1]
    sys.exit("[check-reports] GITHUB_TOKEN не найден в .env")


def api(path: str, token: str):
    req = urllib.request.Request(
        f"{API}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def download_file(path: str, token: str) -> bool:
    """Скачивает файл репозитория в локальную папку. True — скачали."""
    dest = os.path.join(LOCAL, path.split("user-reports/", 1)[-1])
    if os.path.exists(dest):
        return False
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    data = api(f"/contents/{path}", token)
    blob = base64.b64decode(data["content"])
    with open(dest, "wb") as f:
        f.write(blob)
    print(f"  ↓ {path} ({len(blob)} байт)")
    return True


def main() -> None:
    token = load_token()

    print("=== Открытые auto-report issue ===")
    issues = api("/issues?state=open&per_page=100&sort=created&direction=desc", token)
    # Метку токен назначить не может (нет права) — фильтруем по заголовку,
    # который генерирует приложение: «Отчёт vX.Y.Z — …». PR исключаем.
    reports = [
        it
        for it in issues
        if "pull_request" not in it and it["title"].startswith("Отчёт")
    ]
    if not reports:
        print("  (нет открытых — всё разобрано)")
    for it in reports:
        print(f"  #{it['number']}  {it['created_at'][:16]}  {it['title']}")
        print(f"      {it['html_url']}")

    print("=== Синхронизация user-reports/ ===")
    if not os.path.isdir(LOCAL):
        os.makedirs(LOCAL)
    total = 0
    stack = ["user-reports"]
    while stack:
        d = stack.pop()
        items = api(f"/contents/{d}", token)
        for item in items:
            if item["type"] == "dir":
                stack.append(item["path"])
            elif item["name"].endswith((".json", ".jpg", ".jpeg", ".png")):
                if download_file(item["path"], token):
                    total += 1
    if total == 0:
        print("  (новых файлов нет)")
    else:
        print(f"  скачано новых файлов: {total}")


if __name__ == "__main__":
    main()
