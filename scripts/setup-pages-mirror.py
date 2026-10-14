#!/usr/bin/env python3
"""
BikeSnap: подготовка инфраструктуры зеркала GitHub Pages.

Делает (идемпотентно, через GitHub API):
  1. Создаёт ПУБЛИЧНЫЙ репо agent-slon-lab.github.io (user-site — Pages
     включится сам; репо используется ТОЛЬКО под зеркало).
  2. Включает Pages: branch=main, path=/ (409 = уже включено — ок).
  3. Генерирует ed25519-пару → git-helpers/pages_deploy_key(.pub) —
     постоянное хранилище ВНУТРИ воркспейса (не коммитится).
  4. Публичный ключ → WRITE deploy key репо agent-slon-lab.github.io
     (409/422 = уже добавлен — ок).
  5. Приватный ключ → Actions-секрет PAGES_DEPLOY_KEY основного репо
     (sealed box через API: берём public-key репо + pynacl.SealedBox).

Токен НЕ пишется в файлы/конфиги — читается из push-URL git remote
в память процесса. Запуск: python3 scripts/setup-pages-mirror.py
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys

import urllib.error
import urllib.request

OWNER = "agent-slon-lab"
APP_REPO = f"{OWNER}/BikeSnap"
PAGES_REPO = f"{OWNER}/{OWNER}.github.io"
KEY_DIR = "/home/z/my-project/git-helpers"
KEY_PATH = os.path.join(KEY_DIR, "pages_deploy_key")
SECRET_NAME = "PAGES_DEPLOY_KEY"

API = "https://api.github.com"


def get_token() -> str:
    """Токен из push-URL remote origin (в файлы не пишем)."""
    url = subprocess.run(
        ["git", "remote", "get-url", "--push", "origin"],
        cwd="/home/z/my-project",
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    # https://x-access-token:<token>@github.com/...
    if "@" not in url or "://" not in url:
        raise SystemExit("push-URL не содержит токен")
    token = url.split("://", 1)[1].split("@", 1)[0].split(":", 1)[-1]
    if not token:
        raise SystemExit("пустой токен в push-URL")
    return token


class GH:
    def __init__(self, token: str):
        self.token = token
        self.calls = 0

    def req(self, method: str, path: str, body: dict | None = None, ok=(200, 201, 204)):
        url = f"{API}{path}"
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={
                "Authorization": f"token {self.token}",
                "Accept": "application/vnd.github+json",
                "User-Agent": "bikesnap-setup/1.0",
            },
        )
        self.calls += 1
        try:
            with urllib.request.urlopen(r, timeout=30) as resp:
                raw = resp.read()
                return resp.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace")
            if e.code in ok:
                try:
                    return e.code, json.loads(raw)
                except Exception:  # noqa: BLE001
                    return e.code, {}
            print(f"  ! {method} {path} -> HTTP {e.code}: {raw[:300]}")
            return e.code, {}


def generate_keypair() -> tuple[str, str]:
    """ed25519 → (priv_pem, pub_openssh). Файлы в git-helpers (gitignored)."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    os.makedirs(KEY_DIR, exist_ok=True)
    if os.path.exists(KEY_PATH):
        print(f"[key] используем существующий {KEY_PATH}")
        priv_pem = open(KEY_PATH, "rb").read()
        key = serialization.load_pem_private_key(priv_pem, password=None)
        pub = key.public_key().public_bytes(
            serialization.Encoding.OpenSSH,
            serialization.PublicFormat.OpenSSH,
        ).decode()
        return priv_pem.decode(), pub

    key = Ed25519PrivateKey.generate()
    priv_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.OpenSSH,
        serialization.NoEncryption(),
    )
    pub = key.public_key().public_bytes(
        serialization.Encoding.OpenSSH,
        serialization.PublicFormat.OpenSSH,
    ).decode()

    with open(KEY_PATH, "wb") as f:
        f.write(priv_pem)
    os.chmod(KEY_PATH, 0o600)
    with open(KEY_PATH + ".pub", "w") as f:
        f.write(pub + " bikesnap-pages-mirror\n")
    os.chmod(KEY_PATH + ".pub", 0o644)
    print(f"[key] новая пара: {KEY_PATH}(.pub)")
    return priv_pem.decode(), pub


def put_secret(gh: GH, name: str, value: str) -> bool:
    """Секрет Actions через sealed box (pynacl)."""
    import nacl.public  # pynacl

    st, pk = gh.req("GET", f"/repos/{APP_REPO}/actions/secrets/public-key")
    if st != 200:
        print("  ! не получили public-key репо для секретов")
        return False
    key_id = pk["key_id"]
    sealed = nacl.public.SealedBox(
        nacl.public.PublicKey(pk["key"].encode("utf-8"))
    ).encrypt(value.encode("utf-8"))
    st, _ = gh.req(
        "PUT",
        f"/repos/{APP_REPO}/actions/secrets/{name}",
        {
            "encrypted_value": base64.b64encode(sealed).decode(),
            "key_id": key_id,
        },
    )
    print(f"[secret] {name} → {APP_REPO}: HTTP {st}")
    return st in (201, 204)


def main() -> int:
    token = get_token()
    gh = GH(token)

    # 1. Репо Pages
    st, repo = gh.req("GET", f"/repos/{PAGES_REPO}")
    if st == 200:
        print(f"[repo] {PAGES_REPO} уже существует (private={repo.get('private')})")
    else:
        st, repo = gh.req(
            "POST",
            "/user/repos",
            {
                "name": f"{OWNER}.github.io",
                "description": "Зеркало BikeSnap (PWA) для доступа из сетей, "
                "где *.vercel.app заблокирован по SNI",
                "private": False,
                "has_issues": False,
                "has_wiki": False,
                "has_projects": False,
                "auto_init": False,
            },
        )
        print(f"[repo] создан {PAGES_REPO}: HTTP {st}")

    # 2. Pages: branch=main, path=/
    st, _ = gh.req(
        "POST",
        f"/repos/{PAGES_REPO}/pages",
        {"source": {"branch": "main", "path": "/"}},
        ok=(200, 201, 204, 409, 422),
    )
    print(f"[pages] включение: HTTP {st} (409 = уже включено)")

    # 3. Ключ
    priv, pub = generate_keypair()

    # 4. Deploy key (WRITE) на Pages-репо
    st, keys = gh.req("GET", f"/repos/{PAGES_REPO}/keys")
    have = any(k.get("title") == "bikesnap-pages-mirror" for k in keys.get("keys", [])) if st == 200 else False
    if have:
        print("[deploy-key] уже добавлен")
    else:
        st, _ = gh.req(
            "POST",
            f"/repos/{PAGES_REPO}/keys",
            {"title": "bikesnap-pages-mirror", "key": pub, "read_only": False},
            ok=(200, 201, 422),
        )
        print(f"[deploy-key] добавление: HTTP {st} (422 = уже есть)")

    # 5. Секрет PAGES_DEPLOY_KEY в основном репо
    ok = put_secret(gh, SECRET_NAME, priv)
    if not ok:
        print("ОШИБКА: секрет не записан", file=sys.stderr)
        return 1

    print("\nГОТОВО:")
    print(f"  - репо:  https://github.com/{PAGES_REPO}")
    print(f"  - сайт:  https://{OWNER}.github.io/ (после первого пуша зеркала)")
    print(f"  - ключ:  {KEY_PATH} (+ .pub) — gitignored")
    print(f"  - секрет {SECRET_NAME} в {APP_REPO} — для workflow mirror-to-pages")
    return 0


if __name__ == "__main__":
    sys.exit(main())
