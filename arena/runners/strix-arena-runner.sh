#!/usr/bin/env bash
# strix-arena-runner.sh — نفّذ مهمة من الناقل.
#   STRIX_MODE=agent  (افتراضي) → أكتب "بريف" لوكيل Arena (أنا) وينتظر النتائج من `arena`.
#   STRIX_MODE=local  → أشغّل Strix الحقيقي (Docker) بموديل محلّي (يتطلب Docker أو `pip install strix-agent`)
#                       بموديل محلّي (Ollama) — بلا API خارجي أيضاً.
# الاستخدام:  arena/runners/strix-arena-runner.sh <JOB_ID>
# أو طابور كامل: arena/runners/strix-arena-runner.sh --drain
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
export ARENA_BUS="${ARENA_BUS:-$ROOT/arena/bus}"
ARENA="$ROOT/arena/bin/arena"
MODE="${STRIX_MODE:-agent}"
OUT="${ARENA_OUT:-$ROOT/arena/tasks}"
mkdir -p "$OUT"

target_of() { $ARENA status "$1" --field target; }

run_one() {
  local ID="$1" TARGET BRIEF
  TARGET="$(target_of "$ID")"
  BRIEF="$OUT/$ID.brief.md"

  # 1) تأمين المهمة (يفشل بأدب إن كان أحد آخر سحبها)
  if ! $ARENA claim "$ID" --worker "strix-arena-runner:$MODE" >/dev/null; then
    echo "[runner] $ID ليس في قائمة الانتظار — تخطّي"; return 1
  fi
  echo "[runner] claimed $ID → target: $TARGET (mode=$MODE)"

  # 2) البريف — المصدر الوحيد للتعليمات، يولّد من ملف المهمة نفسها
  $ARENA show "$ID" > "$OUT/$ID.job.json"
  python3 "$HERE/make-brief.py" "$OUT/$ID.job.json" "$BRIEF"

  case "$MODE" in
    agent)
      $ARENA note "$ID" "brief ready: arena/tasks/$ID.brief.md — بانتظار Arena agent"
      cat >&2 <<EOM

  ┌─ $ID جاهز للتنفيذ بواسطة Arena Agent Mode ─────────────────
  │  1) افتح جلسة معي في Arena وقل:  "نفّذ $ID"
  │     (أو أرسل البريف: $(basename "$BRIEF"))
  │  2) سأنفّذ منهجية Strix وأكتب النتائج في الناقل.
  │  3) rجيع النتائج يوقظ n8n تلقائياً إذا كان --notify مضبوطاً.
  └──────────────────────────────────────────────────────────
EOM
      ;;
    local)
      echo "[runner] local Strix (Docker + model محلي)"
      bash "$HERE/strix-docker.sh" "$ID" || echo "[runner] strix run ended with $?"
      ;;
    *) echo "[runner] unknown STRIX_MODE=$MODE (agent|local)" ;;
  esac
}

drain() {
  local ids
  ids="$($ARENA list --state queued --json | python3 -c 'import json,sys;[print(j["id"]) for j in json.load(sys.stdin)]')"
  if [ -z "$ids" ]; then echo "[runner] الطابور فارغ"; return 0; fi
  for id in $ids; do run_one "$id"; done
}

case "${1:-}" in
  --drain) drain ;;
  ""|help|-h|--help) sed -n '1,12p' "$0"; echo "usage: $0 <JOB_ID> | $0 --drain"; ;;
  *) run_one "$1" ;;
esac
