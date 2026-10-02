#!/bin/bash
# BikeSnap: восстановление git-push после пересборки контейнера.
# Запуск: bash /home/z/my-project/scripts/git-restore.sh
# Идемпотентен: можно запускать в любой момент, ничего не ломает.
set -u
cd /home/z/my-project

KEY_PROJ=/home/z/my-project/git-helpers/deploy_key
KEY_SSH="$HOME/.ssh/id_ed25519"
PUB_NOTE=/home/z/my-project/git-helpers/deploy_key.pub

# 1. Ключ: если в проекте нет, а в ~/.ssh уцелел — копируем в проект
if [ ! -f "$KEY_PROJ" ] && [ -f "$KEY_SSH" ]; then
  mkdir -p git-helpers
  cp "$KEY_SSH" "$KEY_PROJ"
  chmod 600 "$KEY_PROJ"
  echo "[restore] ключ скопирован из ~/.ssh в git-helpers/ (постоянное хранилище)"
fi

if [ ! -f "$KEY_PROJ" ]; then
  echo "[restore] КЛЮЧА НЕТ НИГДЕ — воркспейс удалён целиком."
  echo "[restore] План Б: сгенерируй новый ed25519, покажи пользователю pubkey,"
  echo "[restore] пользователь добавит его в GitHub → Repo → Settings → Deploy keys."
  exit 1
fi

# 2. ~/.ssh (fallback-путь для paramiko-ssh и старых сценариев)
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
cp "$KEY_PROJ" "$KEY_SSH" && chmod 600 "$KEY_SSH"

# 3. Публичный ключ рядом (для справки, в gitignore)
if [ ! -f "$PUB_NOTE" ]; then
  /home/z/.venv/bin/python - <<'PY' 2>/dev/null || true
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
import base64
from paramiko.ed25519key import Ed25519Key
k = Ed25519Key.from_private_key_file('/home/z/my-project/git-helpers/deploy_key')
raw = k.get_public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
import struct
blob = b'\x00\x00\x00\x0bssh-ed25519' + struct.pack('>I', len(raw)) + raw
b64 = base64.b64encode(blob).decode()
open('/home/z/my-project/git-helpers/deploy_key.pub', 'w').write(f'ssh-ed25519 {b64} bikesnap-deploy\n')
PY
fi

# 4. git config: sshCommand + push URL (переживают пересборку в .git/, но на всякий случай)
git config core.sshCommand /home/z/my-project/scripts/paramiko-ssh
git remote set-url --push origin git@github.com:agent-slon-lab/BikeSnap.git

# 5. Проверка доступа
if git ls-remote origin main >/dev/null 2>&1; then
  echo "[restore] OK: доступ к GitHub есть, push готов."
  git status -sb | head -1
else
  echo "[restore] FAIL: GitHub не принял ключ."
  echo "[restore] Ключ в git-helpers/ есть, но GitHub его не знает (старый deploy-ключ удалён?)."
  echo "[restore] Pubkey для пользователя:"; cat "$PUB_NOTE" 2>/dev/null
  exit 1
fi
