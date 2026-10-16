#!/bin/bash
# Верификация релиза v1.14.43: Vercel + зеркало (КОРЕНЬ agent-slon-lab.github.io!)
EXPECTED_VER='"version":"v1.14.43"'
EXPECTED_SW='const VERSION = "v1.14.43";'

check() {
  local label="$1"; local url="$2"; local want="$3"
  got=$(curl -sSL -m 20 "$url" 2>/dev/null | tr -d ' \n')
  if echo "$got" | grep -q "$want"; then echo "  [$label] OK ✓"; return 0; else
    echo "  [$label] ждём ($got)"; return 1; fi
}

for base in "https://bike-snap.vercel.app" "https://agent-slon-lab.github.io"; do
  echo "=== $base ==="
  ok=0
  for i in $(seq 1 40); do
    v=$(curl -sSL -m 20 "$base/version.json?cb=$RANDOM" 2>/dev/null | tr -d ' \n')
    if [ "$v" = "{$EXPECTED_VER}" ]; then
      sw=$(curl -sSL -m 20 "$base/sw.js?cb=$RANDOM" 2>/dev/null | grep -m1 'const VERSION')
      if [ "$sw" = "$EXPECTED_SW" ]; then echo "  OK ✓ version.json + sw.js = v1.14.43"; ok=1; break; fi
    fi
    sleep 15
  done
  [ "$ok" = "1" ] || echo "  TIMEOUT после 10 мин"
done
echo "=== done ==="
