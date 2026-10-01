#!/usr/bin/env python3
"""Генерация PWA-иконок BikeSnap: тёмный скруглённый квадрат + белый велосипед-пиктограмма.

Выход (public/):
  icon-192.png            — any, 192x192
  icon-512.png            — any, 512x512
  icon-maskable-512.png   — maskable, 512x512 (пиктограмма в безопасной зоне 66%)
  apple-touch-icon.png    — 180x180, без альфы (iOS)

Пиктограмма рисуется в системе координат 100x100 с суперсэмплингом 16x
и скруглениями-«капсулами» на концах штрихов.
"""
from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public"
OUT.mkdir(exist_ok=True)

BG = (18, 18, 20, 255)        # почти чёрный, как --primary oklch(0.205 0 0)
FG = (255, 255, 255, 255)     # белый штрих
ACCENT = (16, 185, 129, 255)  # emerald-500 — точки-втулки
SS = 16                       # суперсэмплинг
BASE = 1024                   # базовый размер в пикселях (100 единиц координат => масштаб)
SCALE = BASE * SS // 100


def P(x: float, y: float) -> tuple[float, float]:
    return (x * SCALE, y * SCALE)


def stroke(d: ImageDraw.ImageDraw, pts: list[tuple[float, float]], w: float, color) -> None:
    """Ломаная с круглыми суставами и концами (капсульный штрих)."""
    rw = w * SCALE / 2.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        d.line([P(x1, y1), P(x2, y2)], fill=color, width=int(rw * 2))
    for (x, y) in pts:
        cx, cy = P(x, y)
        d.ellipse([cx - rw, cy - rw, cx + rw, cy + rw], fill=color)


def circle(d: ImageDraw.ImageDraw, c: tuple[float, float], r: float, w: float, color) -> None:
    cx, cy = P(*c)
    rr = r * SCALE
    rw = w * SCALE / 2.0
    d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=color, width=int(rw * 2))


def dot(d: ImageDraw.ImageDraw, c: tuple[float, float], r: float, color) -> None:
    cx, cy = P(*c)
    rr = r * SCALE
    d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=color)


def draw_bike(size_px: int, art_scale: float, rounded: bool, flatten_alpha: bool = False) -> Image.Image:
    """art_scale < 1 — отступ для maskable (безопасная зона)."""
    img = Image.new("RGBA", (BASE * SS, BASE * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Фон: скруглённый квадрат (для maskable — полная заливка без углов)
    if rounded:
        margin = (1 - art_scale) / 2 * BASE * SS
        side = BASE * SS - 2 * margin
        d.rounded_rectangle([margin, margin, margin + side, margin + side],
                            radius=side // 5, fill=BG)
    else:
        d.rectangle([0, 0, BASE * SS, BASE * SS], fill=BG)

    # --- Велосипед в координатах 100x100, центр артборда (50,50) ---
    # Сжатие вокруг центра под art_scale
    k = art_scale

    def sc(p: tuple[float, float]) -> tuple[float, float]:
        return (50 + (p[0] - 50) * k, 50 + (p[1] - 50) * k)

    A = sc((24, 63))    # заднее колесо
    B = sc((76, 63))    # переднее колесо
    BB = sc((50, 64))   # каретка
    SCT = sc((40, 32.5))  # подседельный узел
    HD = sc((64, 34.5))   # рулевой узел
    sw = 5.6 * k        # толщина штриха рамы
    wr = 15.5 * k       # радиус колёс
    ww = 4.6 * k        # толщина обода

    stroke(d, [A, BB], sw, FG)               # перо (нижнее)
    stroke(d, [BB, SCT], sw, FG)             # подседельная труба
    stroke(d, [A, SCT], sw, FG)              # верхние перья
    stroke(d, [BB, HD], sw, FG)              # труба вниз (нижняя)
    stroke(d, [SCT, HD], sw, FG)             # верхняя труба
    stroke(d, [HD, B], sw, FG)               # вилка
    stroke(d, [sc((33, 29.5)), sc((45, 29.5))], 4.2 * k, FG)   # седло
    stroke(d, [sc((59, 30.0)), sc((70, 30.0))], 4.2 * k, FG)   # руль

    circle(d, A, wr, ww, FG)                 # обод задний
    circle(d, B, wr, ww, FG)                 # обод передний
    dot(d, A, 3.4 * k, ACCENT)               # втулка задняя (изумруд)
    dot(d, B, 3.4 * k, ACCENT)               # втулка передняя

    return img.resize((size_px, size_px), Image.LANCZOS)


def save_png(img: Image.Image, name: str) -> None:
    img.save(OUT / name, "PNG", optimize=True)
    print(f"{name}: {img.size[0]}x{img.size[1]}")


# 1) Обычные иконки (rounded square с прозрачными углами)
save_png(draw_bike(192, 1.0, rounded=True), "icon-192.png")
save_png(draw_bike(512, 1.0, rounded=True), "icon-512.png")

# 2) Maskable: полная заливка + арт в безопасной зоне (внутренние ~72%)
maskable = draw_bike(512, 0.72, rounded=False)
save_png(maskable, "icon-maskable-512.png")

# 3) Apple touch: 180x180, без альфы (iOS сам скругляет), полная заливка
apple = draw_bike(180, 0.92, rounded=False, flatten_alpha=True).convert("RGB")
apple.save(OUT / "apple-touch-icon.png", "PNG", optimize=True)
print("apple-touch-icon.png: 180x180 (RGB, без альфы)")

print("Готово:", OUT)
