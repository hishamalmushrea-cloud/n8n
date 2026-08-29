#!/usr/bin/env bash
# strix-docker.sh — الوضع الحقيقي: شغّل Strix الفعلي داخل Docker، ثم استورد نتائجه إلى الناقل.
# لا مفاتيح API خارجية: الموديل من Ollama على نفس الجهاز (LLM_API_BASE=http://host.docker.internal:11434).
#
#   ARENA_TARGET=/path/to/app | http://localhost:8090
#   STRIX_LLM=ollama/qwen3-vl   (أو openai/local-model مع LM Studio/vLLM)
#   DOCKER=1 إذا أردت إنشاء حاوية بدل CLI المثبّت
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ARENA="$ROOT/arena/bin/arena"
export ARENA_BUS="${ARENA_BUS:-$ROOT/arena/bus}"

ID="${1:?usage: strix-docker.sh <JOB_ID>}"
TARGET="$($ARENA status "$ID" --field target)"
MODE="$($ARENA status "$ID" --field mode)"
INSTR_FILE="$ROOT/arena/tasks/$ID.brief.md"

case "$MODE" in quick) SCAN=quick ;; retest) SCAN=quick ;; compliance) SCAN=deep ;; *) SCAN=standard ;; esac

if ! command -v docker >/dev/null 2>&1; then
  echo "[strix] docker غير متوفر هنا — لن يعمل Strix الحقيقي (يحتاج حاوية معزولة)." >&2
  echo "[strix] استخدم STRIX_MODE=agent: الوكيل ينفّذ نفس المنهجية ويكتب النتائج بالصيغة نفسها." >&2
  $ARENA hold "$ID" --reason "no-docker: switch STRIX_MODE=agent" || true
  exit 3
fi

[ -f "$INSTR_FILE" ] || python3 "$HERE/make-brief.py" <($ARENA show "$ID") "$INSTR_FILE" 2>/dev/null || true

cd "$ROOT" || exit 1
mkdir -p strix_runs
echo "[strix] strix --target $TARGET --scan-mode $SCAN --non-interactive"
$ARENA note "$ID" "launching real Strix (scan-mode=$SCAN)"

set +e
if command -v strix >/dev/null 2>&1; then
  STRIX_LLM="${STRIX_LLM:-ollama/qwen3-vl}" \
  LLM_API_BASE="${LLM_API_BASE:-http://localhost:11434}" \
  LLM_API_KEY="${LLM_API_KEY:-local-no-key}" \
    strix --target "$TARGET" --scan-mode "$SCAN" --non-interactive \
          ${INSTR_FILE:+--instruction-file "$INSTR_FILE"}
else
  docker run --rm -v "$PWD/strix_runs:/app/strix_runs" \
    -e STRIX_LLM="${STRIX_LLM:-ollama/qwen3-vl}" \
    -e LLM_API_BASE="${LLM_API_BASE:-http://host.docker.internal:11434}" \
    -e LLM_API_KEY="${LLM_API_KEY:-local-no-key}" \
    ghcr.io/usestrix/strix:latest \
    --target "$TARGET" --scan-mode "$SCAN" --non-interactive
fi
STRIX_EXIT=$?
set -e
echo "[strix] exit=$STRIX_EXIT (0=نظيف، 2=ثغرات، 1=خطأ)"

python3 "$HERE/import-strix.py" "$ID" "$ROOT/strix_runs" --strix-exit "$STRIX_EXIT"
$ARENA complete "$ID" --summary "Strix scan-mode=$SCAN exit=$STRIX_EXIT"
