"""Прогон MediaPipe pose-детектора приложения на фото пользователя из user-reports.

Проверяем:
- фото вела (bike-side): core score должен быть <= 0.7, иначе ложное
  «На фото обнаружен человек» (v1.14.34, ТЗ п. 5.3);
- фото райдера (side): core score должен быть >= 0.5, иначе блок
  «Человек не найден на фото» (ТЗ п. 5.2); плюс виз. ближней ноги >= 0.5.
"""
import http.server
import json
import socketserver
import threading
from playwright.sync_api import sync_playwright

ROOT = "/home/z/my-project"
PORT = 8931

PHOTOS = [
    ("bike_0629", "/user-reports/2026-10-14/bikesnap-report-v1.14.30-2026-10-14T06-29-55-photo-bike-side.jpg"),
    ("bike_0629_07", "/user-reports/2026-10-14/bikesnap-report-v1.14.30-2026-10-14T06-29-07-photo-bike-side.jpg"),
    ("bike_0551", "/user-reports/2026-10-14/bikesnap-report-v1.14.30-2026-10-14T05-51-06-photo-bike-side.jpg"),
    ("bike_0550", "/user-reports/2026-10-14/bikesnap-report-v1.14.30-2026-10-14T05-50-09-photo-bike-side.jpg"),
    ("bike_0511", "/user-reports/2026-10-14/bikesnap-report-v1.14.29-2026-10-14T05-11-37-photo-bike-side.jpg"),
    ("bike_0433", "/user-reports/2026-10-14/bikesnap-report-v1.14.28-2026-10-14T04-33-42-photo-bike-side.jpg"),
    ("rider_0629", "/user-reports/2026-10-14/bikesnap-report-v1.14.30-2026-10-14T06-29-55-photo-side.jpg"),
    ("rider_0629_07", "/user-reports/2026-10-14/bikesnap-report-v1.14.30-2026-10-14T06-29-07-photo-side.jpg"),
    ("rider_0551", "/user-reports/2026-10-14/bikesnap-report-v1.14.30-2026-10-14T05-51-06-photo-side.jpg"),
    ("rider_0511", "/user-reports/2026-10-14/bikesnap-report-v1.14.29-2026-10-14T05-11-37-photo-side.jpg"),
    ("rider_1003", "/user-reports/2026-10-03/bikesnap-report-v1.14.13-2026-10-03T03-53-55-photo-side.jpg"),
]


def serve():
    handler = http.server.SimpleHTTPRequestHandler
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler, bind_and_activate=True)
    import os
    os.chdir(ROOT)
    httpd.serve_forever()


def main():
    t = threading.Thread(target=serve, daemon=True)
    t.start()

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.goto(f"http://127.0.0.1:{PORT}/scripts/pose-eval/index.html")
        # Прокинуть список фото в страницу до загрузки модуля
        photos_js = json.dumps([[n, u] for n, u in PHOTOS])
        page.evaluate(f"() => {{ window.__PHOTOS = {photos_js}; }}")
        # Если модуль уже стартовал раньше __PHOTOS — перезагрузим с уже выставленным списком
        page.evaluate(f"() => {{ if (!window.__PHOTOS) window.__PHOTOS = {photos_js}; }}")
        page.reload()
        page.evaluate(f"() => {{ window.__PHOTOS = {photos_js}; }}")
        page.wait_for_function("() => window.__RESULTS !== undefined", timeout=180000)
        results = page.evaluate("() => window.__RESULTS")
        browser.close()

    print(json.dumps(results, ensure_ascii=False, indent=2))
    print("\n=== ВЕРДИКТ ===")
    for name, _ in PHOTOS:
        r = results.get(name, {"error": "нет результата"})
        if "error" in r or "fatal" in r:
            print(f"{name}: ОШИБКА {r}")
            continue
        kind = "BIKE" if name.startswith("bike") else "RIDER"
        if kind == "BIKE":
            bad = r.get("coreScore", 0) > 0.7
            verdict = "!!! ЛОЖНОЕ «НА ФОТО ОБНАРУЖЕН ЧЕЛОВЕК»" if bad else "ok (человек не обнаружен)"
            print(f"{name} [{kind}]: core={r.get('coreScore')} -> {verdict}")
        else:
            core = r.get("coreScore", 0)
            leg = r.get("activeLegScore", 0)
            problems = []
            if core < 0.5:
                problems.append("БЛОК «Человек не найден» (score<0.5)")
            if leg < 0.5:
                problems.append("ошибка ближней ноги (leg<0.5)")
            v = "; ".join(problems) if problems else "ok"
            print(f"{name} [{kind}]: core={core} leg({r.get('activeSide')})={leg} toe={r.get('toeVis')} -> {v}")


if __name__ == "__main__":
    main()
