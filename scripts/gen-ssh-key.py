"""Генерация ed25519 SSH-ключа для деплой-ключа GitHub (push доступа в песочнице нет)."""
import os
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

KEY_PATH = os.path.expanduser("~/.ssh/id_ed25519")

key = Ed25519PrivateKey.generate()

priv_pem = key.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.OpenSSH,
    serialization.NoEncryption(),
)
pub_ssh = key.public_key().public_bytes(
    serialization.Encoding.OpenSSH,
    serialization.PublicFormat.OpenSSH,
)

os.makedirs(os.path.dirname(KEY_PATH), exist_ok=True)
with open(KEY_PATH, "wb") as f:
    os.chmod(KEY_PATH, 0o600)
    f.write(priv_pem)
with open(KEY_PATH + ".pub", "wb") as f:
    f.write(pub_ssh + b" bikesnap-sandbox\n")
os.chmod(KEY_PATH + ".pub", 0o644)

print(pub_ssh.decode())
