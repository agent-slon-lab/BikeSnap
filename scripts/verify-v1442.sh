#!/bin/bash
# Верификация релиза v1.14.42 на обеих площадках:
#  1) Vercel  (https://bike-snap.vercel.app)
#  2) Зеркало GitHub Pages (https://agent-slon-lab.github.io/BikeSnap)
# Поллинг version.json (ожидаем v1.14.42) + sw.js (ожидаем bikesnap-v1.14.42).

EXPECTED="v1.14.42"
EXPECTED_SW="bikesnap-v1.14.42"

check_site() {
  local label="$1"; local base="$2"; local sw_path="$3"; local timeout_min="$4"
  echo "=== [$label] $base ==="
  local deadline=$(( $(date +%s) + timeout_min * 60 ))
  local ver_ok=0 sw_ok=0
  while [ "$(date +%s)" -lt "$deadline" ]; do
    ver=$(curl -sS -m 15 "$base/version.json?cb=$RANDOM" 2>/dev/null | tr -d ' \n')
    if [ "$ver" = "{\"version\":\"$EXPECTED\"}" ]; then ver_ok=1; fi
    if [ "$ver_ok" = "1" ]; then
      sw=$(curl -sS -m 15 "$base$sw_path?cb=$RANDOM" 2>/dev/null | grep -m1 -o 'bikesnap-v[0-9.]*' | head -1)
      if [ "$sw" = "$EXPECTED_SW" ]; then sw_ok=1; fi
    fi
    echo "  version.json='$ver' | sw='$sw' | ver_ok=$ver_ok sw_ok=$sw_ok"
    if [ "$ver_ok" = "1" ] && [ "$sw_ok" = "1" ]; then
      echo "  [$label] OK — $EXPECTED живой ✓"
      return 0
    fi
    sleep 20
  done
  echo "  [$label] TIMEOUT — не дождались $EXPECTED за $timeout_min мин"
  return 1
}

FAIL=0
check_site "Vercel" "https://bike-snap.vercel.app" "/sw.js" 8 || FAIL=1
check_site "Mirror" "https://agent-slon-lab.github.io/BikeSnap" "/sw.js" 10 || FAIL=1

echo
if [ "$FAIL" = "0" ]; then
  echo "VERDICT: обе площадки = $EXPECTED ✓"
else
  echo "VERDICT: есть провалы (см. выше)"
fi
exit $FAIL
