#!/usr/bin/env python3
"""E2E-тест релея отчётов: POST /api/report-upload (как это делает телефон)
→ проверка issue и файлов на GitHub → уборка (закрыть issue, удалить файлы).
Запуск: python scripts/e2e-report-upload.py
"""

import io
import json
import os
import time
import urllib.request

BASE_URL = os.environ.get("BIKESNAP_URL", "http://localhost:3000")
ENV = "/home/z/my-project/.env"
REPO_API = "https://api.github.com/repos/agent-slon-lab/BikeSnap"


def load_token() -> str:
    with open(ENV, encoding="utf-8") as f:
        for line in f:
            if line.startswith("GITHUB_TOKEN="):
                return line.strip().split("=", 1)[1]
    raise SystemExit("нет GITHUB_TOKEN в .env")


def gh(path: str, method: str = "GET", payload: dict | None = None):
    req = urllib.request.Request(
        f"{REPO_API}{path}",
        method=method,
        headers={
            "Authorization": f"Bearer {load_token()}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        },
        data=json.dumps(payload).encode() if payload else None,
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
    return json.loads(raw) if raw else {}


def tiny_jpeg_data_url() -> str:
    try:
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (8, 8), (200, 60, 30)).save(buf, "JPEG", quality=80)
        import base64
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    except ImportError:
        # минимальный валидный JPEG 1x1
        return "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k="


def main() -> None:
    stamp = time.strftime("%Y-%m-%dT%H-%M-%S")
    filename = f"bikesnap-report-v1.14.15-E2E-{stamp}.json"
    report = {
        "meta": {
            "app": "BikeSnap",
            "version": "v1.14.15",
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S+07:00"),
            "userAgent": "e2e-test/1.0 (pipeline check)",
            "screen": "100x100",
            "viewport": "100x100",
            "orientation": "portrait",
            "language": "ru",
        },
        "context": {"bikeType": "road", "goal": "e2e", "complaints": ["тест"]},
        "views": [
            {
                "view": "e2e-photo",
                "analyzed": False,
                "error": "E2E: проверка релея отчётов — можно игнорировать",
                "landmarksCount": 0,
                "landmarks": None,
                "analysis": None,
                "captureMeta": {"pitch": 82, "roll": -2, "gyroSupported": True, "timestamp": int(time.time() * 1000)},
                "photo": tiny_jpeg_data_url(),
            },
            {
                "view": "e2e-nophoto",
                "analyzed": False,
                "error": None,
                "landmarksCount": 3,
                "landmarks": [{"x": 0.1, "y": 0.2}, {"x": 0.3, "y": 0.4}, {"x": 0.5, "y": 0.6}],
                "analysis": None,
                "captureMeta": None,
                "photo": None,
            },
        ],
        # v1.14.15: калибровка шага 2 — фото велика + точки разметки
        "bikeCalibration": {
            "photo": tiny_jpeg_data_url(),
            "photoFile": None,
            "points": {
                "bb": {"x": 0.42, "y": 0.71},
                "stTop": {"x": 0.47, "y": 0.35},
                "saddleMount": {"x": 0.49, "y": 0.28},
                "htTop": {"x": 0.63, "y": 0.38},
                "htBottom": {"x": 0.66, "y": 0.47},
                "htTopCap": {"x": 0.62, "y": 0.34},
                "rearAxle": {"x": 0.27, "y": 0.72},
                "frontAxle": {"x": 0.72, "y": 0.72},
                "rearWheelTop": None,
                "frontWheelTop": None,
            },
        },
    }

    print("=== POST /api/report-upload ===")
    req = urllib.request.Request(
        f"{BASE_URL}/api/report-upload",
        method="POST",
        headers={"Content-Type": "application/json"},
        data=json.dumps({"report": report, "filename": filename}).encode(),
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        out = json.loads(r.read().decode())
    print(f"issue #{out['issueNumber']}: {out['issueUrl']}")
    for f in out["files"]:
        print(f"  файл: {f}")

    print("=== проверка на GitHub ===")
    issue = gh(f"/issues/{out['issueNumber']}")
    assert issue["state"] == "open", "issue не открыт"
    labels = [l["name"] for l in issue["labels"]]
    assert "Калибровка (шаг 2)" in issue["body"], "в issue нет строки калибровки"
    print(f"  issue открыт, метки: {labels}, калибровка в сводке: OK")
    for f in out["files"]:
        code = urllib.request.Request(
            f"{REPO_API}/contents/{f}",
            headers={"Authorization": f"Bearer {load_token()}"},
        )
        with urllib.request.urlopen(code, timeout=30) as r2:
            print(f"  {f}: HTTP {r2.status}")

    print("=== уборка ===")
    gh(f"/issues/{out['issueNumber']}", "PATCH", {"state": "closed", "state_reason": "completed"})
    print(f"  issue #{out['issueNumber']} закрыт")
    date_dir = out["files"][0].split("/")[1]
    for f in out["files"]:
        meta = gh(f"/contents/{f}")
        gh(f"/contents/{f}", "DELETE", {"message": "cleanup e2e test", "sha": meta["sha"]})
        print(f"  удалён {f}")

    print("E2E_OK")


if __name__ == "__main__":
    main()
