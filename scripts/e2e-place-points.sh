#!/bin/bash
# E2E: постановка 8 точек разметки на SVG-фото через координатные клики
set -e
# Bbox SVG (после scrollIntoView) и natural size
SVG_X=58; SVG_Y=86.875; SVG_W=1164; SVG_H=403.890625
VW=1664; VH=928
# xMidYMid meet
python3 - <<'EOF' > /tmp/ab-points.txt
svg_x, svg_y, svg_w, svg_h = 58, 86.875, 1164, 403.890625
vw, vh = 1664, 928
scale = min(svg_w / vw, svg_h / vh)
fw, fh = vw * scale, vh * scale
ox = (svg_w - fw) / 2
oy = (svg_h - fh) / 2
# Порядок разметки UI: bb, stTop, saddleMount, htTop, htBottom, htTopCap, rearAxle, frontAxle
pts = {
    "bb": (708, 658),
    "stTop": (602, 248),
    "saddleMount": (548, 95),
    "htTop": (1050, 192),
    "htBottom": (1082, 328),
    "htTopCap": (1045, 150),
    "rearAxle": (395, 590),
    "frontAxle": (1225, 588),
}
for name, (px, py) in pts.items():
    sx = svg_x + ox + px * scale
    sy = svg_y + oy + py * scale
    print(f"{name} {round(sx)} {round(sy)}")
EOF

while read -r name x y; do
  echo "=== placing $name at ($x, $y)"
  agent-browser mouse move "$x" "$y"
  agent-browser mouse down left
  agent-browser mouse up left
  sleep 0.4
done < /tmp/ab-points.txt
echo "ALL POINTS PLACED"
