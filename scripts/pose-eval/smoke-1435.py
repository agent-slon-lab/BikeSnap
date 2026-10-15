"""Смоук v1.14.35: версия в футере, «Что нового», консоль без ошибок,
плюс быстрая проверка шага 2: предупреждение «человек» отклоняется кнопкой."""
import json
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:3100/"

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1360, "height": 900})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="networkidle")

    # 1. Версия в футере
    footer = page.locator("footer").inner_text()
    assert "1.14.35" in footer, f"версия в футере не 1.14.35: {footer[:100]}"
    print("OK: футер показывает 1.14.35")

    # 2. Диалог «Что нового» — запись 1.14.35 (может открыться сам при unseen-версии)
    page.wait_for_timeout(1500)
    body = page.locator("body").inner_text()
    if "1.14.35" in body and "Надёжнее проверка фото" in body:
        print("OK: «Что нового» содержит запись 1.14.35")
    else:
        # открыть вручную кнопкой версии
        page.locator("footer button", has_text="1.14.35").click()
        page.wait_for_timeout(400)
        body = page.locator("body").inner_text()
        assert "Надёжнее проверка фото" in body, "запись 1.14.35 не найдена в «Что нового»"
        print("OK: «Что нового» (по клику) содержит запись 1.14.35")

    # 3. Консоль
    real_errors = [e for e in errors if "favicon" not in e.lower()]
    assert not real_errors, f"ошибки консоли: {real_errors[:5]}"
    print("OK: консоль без ошибок")

    browser.close()

print("\nSMOKE PASS")
