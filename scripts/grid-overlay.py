"""Наложение координатной сетки на bike-schema.png для точной E2E-разметки."""
from PIL import Image, ImageDraw, ImageFont

SRC = "/home/z/my-project/public/bike-schema.png"
DST = "/home/z/my-project/scripts/grid-bike-schema.png"

im = Image.open(SRC).convert("RGB")
W, H = im.size
d = ImageDraw.Draw(im)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
except Exception:
    font = ImageFont.load_default()

STEP = 100
# Вертикальные линии
for x in range(0, W, STEP):
    color = (255, 0, 0) if x % 500 == 0 else (0, 160, 255)
    d.line([(x, 0), (x, H)], fill=color, width=2 if x % 500 == 0 else 1)
    d.text((x + 3, 3), str(x), fill=(255, 0, 0), font=font)
    d.text((x + 3, H - 22), str(x), fill=(255, 0, 0), font=font)
# Горизонтальные линии
for y in range(0, H, STEP):
    color = (255, 0, 0) if y % 500 == 0 else (0, 160, 255)
    d.line([(0, y), (W, y)], fill=color, width=2 if y % 500 == 0 else 1)
    d.text((3, y + 3), str(y), fill=(255, 0, 0), font=font)
    d.text((W - 60, y + 3), str(y), fill=(255, 0, 0), font=font)

im.save(DST)
print(f"saved {DST} size={im.size}")
