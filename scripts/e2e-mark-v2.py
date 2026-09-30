#!/usr/bin/env python3
"""E2E разметка 8 точек с пересчётом bbox SVG перед каждым кликом.
Причина динамического bbox: подсказка текущей точки над фото меняет высоту
и сдвигает SVG. Поэтому: click на кнопку точки (selectPointForPlacement),
затем измеряем bbox заново, затем клик."""
import json
import subprocess
import time

AB = "agent-browser"
# Порядок кнопок в панели разметки (после 8 основных — выход из режима)
POINTS = [
    ("bb", 708, 658),
    ("stTop", 602, 248),
    ("saddleMount", 548, 95),
    ("htTop", 1050, 192),
    ("htBottom", 1082, 328),
    ("htTopCap", 1045, 150),
    ("rearAxle", 395, 590),
    ("frontAxle", 1225, 588),
]
VW, VH = 1664, 928


def ab(*args, timeout=30):
    r = subprocess.run([AB, *args], capture_output=True, text=True, timeout=timeout)
    out = (r.stdout or "").strip()
    if r.returncode != 0:
        raise RuntimeError(f"agent-browser {args}: rc={r.returncode} err={r.stderr} out={out}")
    return out


def ab_json(*args, timeout=30):
    out = ab(*args, timeout=timeout)
    # CLI печатает строку-JSON (eval) со статусными строками до неё
    for line in reversed(out.splitlines()):
        line = line.strip()
        if line.startswith(('"', "{", "[")):
            val = json.loads(line)
            if isinstance(val, str):  # двойное кодирование eval
                val = json.loads(val)
            return val
    raise RuntimeError(f"no JSON in: {out}")


def get_bbox():
    data = ab_json(
        "eval",
        "(() => { const svg = document.querySelector('svg[viewBox=\"0 0 1664 928\"]');"
        " const r = svg.getBoundingClientRect();"
        " return JSON.stringify({x: r.x, y: r.y, w: r.width, h: r.height}); })()",
    )
    return data


def main():
    # Кнопки точек в панели разметки — клик по кнопке выбирает точку
    btn_map = {
        "bb": "Каретка",
        "stTop": "Верх подседельной трубы",
        "saddleMount": "Зажим рельсов седла",
        "htTop": "Верх рулевого стакана",
        "htBottom": "Низ рулевого стакана",
        "htTopCap": "Крышка рулевой",
        "rearAxle": "Ось заднего колеса",
        "frontAxle": "Ось переднего колеса",
    }
    for name, px, py in POINTS:
        # 1) выбрать точку кнопкой (гарантирует placementPointKey)
        ab("find", "role", "button", "click", "--name", btn_map[name])
        time.sleep(0.25)
        # 1b) find скроллит к панели кнопок — возвращаем фото в центр вьюпорта
        ab(
            "eval",
            "(() => { const s = document.querySelector('svg[viewBox=\"0 0 1664 928\"]');"
            " if (s) s.scrollIntoView({block:'center'}); return 'ok'; })()",
        )
        time.sleep(0.4)
        # 2) измерить bbox ЗАНОВО (подсказка могла изменить высоту)
        b = get_bbox()
        if b["y"] < 0 or b["y"] + b["h"] > 600:
            raise RuntimeError(f"{name}: SVG вне вьюпорта bbox={b}")
        scale = min(b["w"] / VW, b["h"] / VH)
        fw, fh = VW * scale, VH * scale
        ox = (b["w"] - fw) / 2
        oy = (b["h"] - fh) / 2
        sx = round(b["x"] + ox + px * scale)
        sy = round(b["y"] + oy + py * scale)
        # 3) клик
        ab("mouse", "move", str(sx), str(sy))
        ab("mouse", "down", "left")
        ab("mouse", "up", "left")
        time.sleep(0.35)
        print(f"{name}: target=({px},{py}) screen=({sx},{sy}) bbox_y={b['y']:.1f} scale={scale:.4f}")

    # Финальная проверка координат кружков
    time.sleep(0.4)
    check = ab_json(
        "eval",
        "(() => { const svg = document.querySelector('svg[viewBox=\"0 0 1664 928\"]');"
        " const cs = [...svg.querySelectorAll('circle')].filter(c => +c.getAttribute('r') > 15 && +c.getAttribute('r') < 40);"
        " return JSON.stringify(cs.map(c => [Math.round(+c.getAttribute('cx')), Math.round(+c.getAttribute('cy'))])); })()",
    )
    print("CIRCLES:", json.dumps(check))


if __name__ == "__main__":
    main()
