#!/usr/bin/env python3
"""Генерация deploy-ключа BikeSnap без paramiko (только cryptography).

Пишет:
  git-helpers/deploy_key      — приватный OpenSSH-PEM
  git-helpers/deploy_key.pub  — публичный ssh-ed25519 (для GitHub Deploy keys)
  ~/.ssh/id_ed25519           — fallback-путь
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

if os.path.exists(KEY_PROJ):
    bak = f"{KEY_PROJ}.dead-{TS}"
    shutil.copy2(KEY_PROJ, bak)
    print(f"[keygen] старый ключ сохранён как {os.path.basename(bak)}")

key = Ed25519PrivateKey.generate()
priv = key.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.OpenSSH,
    serialization.NoEncryption(),
).decode()
pub = key.public_key().public_bytes(
    serialization.Encoding.OpenSSH,
    serialization.PublicFormat.OpenSSH,
).decode()

os.makedirs(os.path.dirname(KEY_PROJ), exist_ok=True)
with open(KEY_PROJ, "w") as f:
    f.write(priv)
os.chmod(KEY_PROJ, 0o600)

with open(PUB_NOTE, "w") as f:
    f.write(f"{pub} bikesnap-deploy\n")

os.makedirs(os.path.dirname(KEY_SSH), exist_ok=True)
with open(KEY_SSH, "w") as f:
    f.write(priv)
os.chmod(KEY_SSH, 0o600)
os.chmod(os.path.dirname(KEY_SSH), 0o700)

print("[keygen] OK")
print("[keygen] PUBKEY:")
print(f"{pub} bikesnap-deploy")
