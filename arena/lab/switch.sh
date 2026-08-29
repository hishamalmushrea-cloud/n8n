#!/usr/bin/env bash
# switch.sh — بدّل تطبيق المعمل بين النسخة الضعيفة والمؤمَّنة على نفس المنفذ،
# حتى يستطيع `arena retest` أن يُثبت الفرق على نفس الهدف (نفس الـ allowlist).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8090}"
VARIANT="${1:-secured}"           # secured | vulnerable
PIDF="$HERE/.$VARIANT.pid"

pkill -f "vuln-app/server.*--port $PORT" 2>/dev/null || true
sleep 0.6
case "$VARIANT" in
  secured)    nohup node "$HERE/vuln-app/server.secured.mjs" --port "$PORT" > "$HERE/.lab.log" 2>&1 & echo $! > "$PIDF" ;;
  vulnerable) nohup node "$HERE/vuln-app/server.mjs" --port "$PORT" > "$HERE/.lab.log" 2>&1 & echo $! > "$PIDF" ;;
  *) echo "usage: $0 [secured|vulnerable]"; exit 1 ;;
esac
sleep 0.8
code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/health")
echo "lab=$VARIANT on :$PORT  health=$code  pid=$(cat "$PIDF")"
