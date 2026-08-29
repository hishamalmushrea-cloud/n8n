#!/usr/bin/env bash
# smoke.sh — اختبار ذاتي للناقل: دورة حياة كاملة في مجلد مؤقت، بلا لمس الطابور الحقيقي.
#   exit 0 = كل شيء سليم.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ARENA_M="$ROOT/arena/bin/arena.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export ARENA_BUS="$TMP/arena/bus"
A="node $ARENA_M"
fails=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; fails=$((fails+1)); }

echo "arena smoke test — bus: $ARENA_BUS"

$A init >/dev/null 2>&1 || { echo "init failed"; exit 1; }
[ -f "$ROOT/arena/config/engagement.json" ] || bad "engagement.json مفقود في المستودع"

# 1) رفض هدف غير مصرّح
$A submit --title "t" --target "https://someone-elses-app.com" --no-git >/dev/null 2>&1
[ $? -eq 3 ] && ok "رفض هدف خارج القائمة (exit 3)" || bad "لم يُرفض الهدف غير المصرّح"

# 2) رفض إجراء غير مسموح لنفس الهدف
mkdir -p "$ROOT/../.tmp-cfg" ; cp "$ROOT/arena/config/engagement.json" "$TMP/eng.json" 2>/dev/null || true
cat > "$(dirname "$ARENA_BUS")/config/engagement.json" <<'EOF'
{ "allowlist": [ { "target": "http://127.0.0.1:9", "kind": "url", "actions": ["passive"] } ],
  "redact": ["Authorization"], "requireApprovalFor": [], "maxDurationSeconds": 60 }
EOF
out="$($A submit --title "t2" --target http://127.0.0.1:9 --actions active --no-git 2>&1)"; rc=$?
[ $rc -eq 3 ] && ok "رفض إجراء خارج الصلاحيات (active ∉ [passive])" || bad "قبل إجراء غير مسموح: $out"

# 3) دورة كاملة
ID=$($A submit --title "smoke" --target http://127.0.0.1:9 --actions passive --mode quick --no-git --json | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id')
$A claim "$ID" --worker smoke >/dev/null 2>&1 && ok "claim" || bad "claim فشل"
[ "$($A status "$ID" --field state)" = "active" ] && ok "state=active" || bad "state خاطئ"

echo '{"title":"bad finding"}' | $A add-finding "$ID" --stdin >/dev/null 2>&1
[ $? -ne 0 ] && ok "مخطط النتائج يرفض نتيجة بلا PoC" || bad "قبل نتيجة غير مكتملة"

cat <<'F' | $A add-finding "$ID" --stdin >/dev/null 2>&1
{"title":"open debug endpoint leaks credentials","severity":"high","cvss":8.1,"cwe":"200","owasp":"A01",
 "description":"GET /debug returns users with passwords without authentication.",
 "reproduction":{"steps":["curl http://127.0.0.1:9/debug"]},
 "remediation":{"summary":"remove the endpoint in production"},"verified":true}
F
[ "$(wc -l < "$ARENA_BUS/jobs/active/$ID/findings.ndjson")" = "1" ] && ok "add-finding كتب نتيجة واحدة" || bad "findings غير صحيحة"

printf 'Authorization: Bearer abcdef1234567890abc\npassword=hunter2\n' | $A evidence "$ID" e.txt --stdin >/dev/null
grep -q "REDACTED" "$ARENA_BUS/jobs/active/$ID/evidence/e.txt" && ok "حجب الأسرار في الأدلة" || bad "الأدلة غير منقّاة"

$A complete "$ID" --no-git >/dev/null 2>&1
[ "$($A status "$ID" --field verdict)" = "FAIL" ] && ok "verdict=FAIL عند وجود عالية" || bad "verdict خاطئ"
[ -f "$ARENA_BUS/jobs/done/$ID/report.md" ] && ok "report.md أُنشئ" || bad "لا تقرير"
[ -f "$ARENA_BUS/jobs/done/$ID/report.json" ] && ok "report.json (schema arena.report/1)" || bad "لا report.json"

$A gate "$ID" --max-severity high >/dev/null 2>&1
[ $? -eq 1 ] && ok "بوابة CI ترفض (exit 1)" || bad "البوابة لم ترفض"

$A export "$ID" --out "$TMP/strix_runs/$ID" >/dev/null 2>&1
[ -f "$TMP/strix_runs/$ID/findings.json" ] && [ -f "$TMP/strix_runs/$ID/run.json" ] && ok "تصدير بشكل Strix" || bad "تصدير فاشل"

$A retest "$ID" --no-git >/dev/null 2>&1
[ "$($A list --state queued --json | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).length')" -ge 1 ] && ok "retest أنشأ مهمة جديدة" || bad "لا مهمة إعادة فحص"

$A stats >/dev/null 2>&1 && ok "stats" || bad "stats فشل"

echo
if [ "$fails" = "0" ]; then echo -e "\033[32mكل الاختبارات نجحت\033[0m"; exit 0; else echo -e "\033[31m$fails فشل\033[0m"; exit 1; fi
