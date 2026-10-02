#!/usr/bin/env python3
"""BikeSnap: роторация deploy-ключа GitHub (Plan B из scripts/git-restore.sh).
Старый ключ GitHub отклоняет (удалён из Repo → Settings → Deploy keys).
Генерирует НОВУЮ пару ed25519, кладёт приватник в git-helpers/deploy_key
(постоянное хранилище внутри воркспейса) и ~/.ssh/id_ed25519 (fallback).
Старый ключ бэкапится в git-helpers/deploy_key.dead-<ts>.
"""
import os
import shutil
import time
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

BASE = "/home/z/my-project"
KEY_PROJ = os.path.join(BASE, "git-helpers", "deploy_key")
PUB_NOTE = os.path.join(BASE, "git-helpers", "deploy_key.pub")
KEY_SSH = os.path.expanduser("~/.ssh/id_ed25519")
TS = time.strftime("%Y%m%d-%H%M%S")

# 1. Бэкап старого ключа (если есть)
for path in (KEY_PROJ,):
    if os.path.exists(path):
        bak = f"{path}.dead-{TS}"
        shutil.copy2(path, bak)
        print(f"[rotate] старый ключ сохранён как {os.path.basename(bak)}")

# 2. Новая пара
key = Ed25519PrivateKey.generate()
priv_pem = key.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.OpenSSH,
    serialization.NoEncryption(),
)
pub_openssh = key.public_key().public_bytes(
    serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH
).decode()

# 3. Запись в постоянное хранилище + fallback-путь
os.makedirs(os.path.dirname(KEY_PROJ), exist_ok=True)
with open(KEY_PROJ, "wb") as f:
    f.write(priv_pem)
os.chmod(KEY_PROJ, 0o600)
os.makedirs(os.path.dirname(KEY_SSH), exist_ok=True)
shutil.copy2(KEY_PROJ, KEY_SSH)
os.chmod(KEY_SSH, 0o700 if os.path.isdir(KEY_SSH) else 0o600)
os.chmod(KEY_SSH, 0o600)

# 4. Публичный ключ для пользователя
with open(PUB_NOTE, "w") as f:
    f.write(f"{pub_openssh} bikesnap-deploy-{TS}\n")
os.chmod(PUB_NOTE, 0o644)

# 5. Проверка: paramiko должен подхватить новый приватник
import paramiko, warnings
warnings.filterwarnings("ignore")
k = paramiko.Ed25519Key.from_private_key_file(KEY_PROJ)
print(f"[rotate] OK: новая пара сгенерирована и разложена ({KEY_PROJ}, {KEY_SSH})")
print("[rotate] PUBKEY ДЛЯ GITHUB (Repo → Settings → Deploy keys → Add deploy key, Allow write access):")
print(pub_openssh)
