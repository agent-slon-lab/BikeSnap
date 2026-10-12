"""Тестовое фото велика сбоку (900x600) с точной геометрией для живой проверки калибратора.

Координаты (px, y вниз):
  rearAxle (180, 400)  frontAxle (720, 400)   -> WB = 540 px
  bb (400, 435)                                     -> BBdrop 35 px
  stTop (312, 148)  saddleMount (298, 100)         -> SH = 350 px
  htTop (653, 262)  htBottom (668, 312)  htTopCap (651, 250)
  wheel radius 170 -> tops (180, 230), (720, 230)

При SH=700мм масштаб 2 мм/px: WB=1080, Reach(BB->htTopCap)=(651-400)=251px=502мм,
Stack=(435-250)=185px=370мм, STA=73°.
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

fig = plt.figure(figsize=(9, 6), dpi=100)
ax = fig.add_axes([0, 0, 1, 1])  # axes на ВЕСЬ холст — маппинг px точный
ax.set_xlim(0, 900)
ax.set_ylim(600, 0)  # y вниз, как в экранных координатах
ax.set_aspect("equal")
ax.axis("off")
fig.patch.set_facecolor("white")

R = 170
AXLE_Y = 400

# Колёса
for cx in (180, 720):
    ax.add_patch(mpatches.Circle((cx, AXLE_Y), R, fill=False, lw=6, ec="black"))
    ax.add_patch(mpatches.Circle((cx, AXLE_Y), 6, fc="black"))

# Земля
ax.plot([10, 890], [AXLE_Y + R, AXLE_Y + R], lw=3, color="#888")

# Рама: rearAxle -> bb -> stTop; bb -> htBottom; htTop -> htBottom
ax.plot([180, 400], [AXLE_Y, 435], lw=8, color="#1f6feb")   # перья к BB
ax.plot([400, 312], [435, 148], lw=8, color="#1f6feb")      # подседельная
ax.plot([400, 668], [435, 312], lw=8, color="#1f6feb")      # нижняя труба
ax.plot([312, 653], [148, 262], lw=8, color="#1f6feb")      # верхняя труба
ax.plot([653, 668], [262, 312], lw=10, color="#1f6feb")     # рулевая
ax.plot([668, 720], [312, AXLE_Y], lw=6, color="#1f6feb")   # вилка

# Седло
ax.plot([258, 348], [100, 100], lw=10, color="black")

# Руль
ax.plot([633, 673], [250, 250], lw=8, color="black")

fig.savefig("/home/z/my-project/scripts/test-bike-photo.png", facecolor="white")
print("saved /home/z/my-project/scripts/test-bike-photo.png")
