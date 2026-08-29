#!/usr/bin/env bash
# install.sh — يثبّت العقد على جهازك: n8n (docker أو npm) + arena CLI في PATH + استيراد السير-أعمال.
# بدون أي مفتاح API.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
MODE="${1:-docker}"     # docker | npm
say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "مفقود: $1 — ثبّته أولاً" >&2; exit 1; }; }

say "١) فحص المتطلبات"
need node; node -v; need git
if [ "$MODE" = docker ]; then need docker; docker compose version || docker-compose --version; fi

say "٢) تهيئة الناقل"
ARENA_BUS="$ROOT/arena/bus" node "$HERE/bin/arena.mjs" init
[ -f "$ROOT/arena/config/engagement.json" ] || echo "تحذير: لا يوجد engagement.json"
chmod +x "$HERE/bin/arena" 2>/dev/null || true

say "٣) إضافة arena إلى PATH"
LINE="export PATH=\"$HERE:\$PATH\""
PROFILE="${BASH_ENV:-$HOME/.bashrc}"; [ -n "${ZSH_VERSION:-}" ] && PROFILE="$HOME/.zshrc"
grep -qF "arena/bin" "$PROFILE" 2>/dev/null || { echo "$LINE" >>"$PROFILE"; echo "أُضيف إلى $PROFILE"; }
export PATH="$HERE:$PATH"
arena list --json | head -3

if [ "$MODE" = docker ]; then
  say "٤) n8n + البنية عبر Docker Compose"
  [ -f "$ROOT/arena/.env" ] || cat > "$ROOT/arena/.env" <<EOF
N8N_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
N8N_DB_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(12).toString('hex'))")
TARGET_APPS_PATH=$HOME/apps
STRIX_MODE=agent
EOF
  echo ".env أُنشئ بمفاتيح عشوائية (محلي فقط)."
  ( cd "$ROOT/arena" && docker compose up -d ) 
  echo "n8n: http://localhost:5678 — استورد arena/n8n/*.json من الواجهة (أو: docker compose exec n8n n8n import:workflow ...)"
else
  say "٤) n8n عبر npm (تثبيت محلي)"
  RT="${N8N_RUNTIME:-$HOME/n8n-runtime}"
  mkdir -p "$RT"; ( cd "$RT" && [ -f package.json ] || npm init -y >/dev/null )
  # xlsx في n8n يُوزَّع من cdn.sheetjs.com — محجوب في بعض الشبكات؛ نثبّت من npm
  ( cd "$RT" && node -e "
const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));
p.overrides={...(p.overrides||{}),xlsx:'0.18.5'};fs.writeFileSync('package.json',JSON.stringify(p,null,2));" )
  say "تثبيت n8n (قد يستغرق دقائق)"
  ( cd "$RT" && npm install n8n@1.123.75 --ignore-scripts --omit=optional --no-audit --loglevel=error )
  say "بناء وحدة sqlite3 الأصلية (لا تنزيل من الإنترنت)"
  if [ -d /usr/local/include/node ]; then
    ( cd "$RT/node_modules/sqlite3" && node /usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --release --nodedir=/usr/local ) || \
    ( cd "$RT/node_modules/sqlite3" && npx --yes node-gyp rebuild --release --nodedir=/usr/local )
  else
    echo "تعذّر بناء sqlite3 (لا رؤوس Node في /usr/local/include/node) — استخدم الوضع docker."
    echo "بديل: ثبّت Node عبر nvm بحيث تكون الرؤوس متاحة، ثم أعد المحاولة."
  fi
  say "استيراد سير الأعمال إلى n8n"
  export N8N_ENCRYPTION_KEY="${N8N_ENCRYPTION_KEY:-arena_local_dev_key_0123456789abcdef}" DB_TYPE=sqlite
  for f in "$ROOT"/arena/n8n/arena-*.json; do
    ( cd "$RT" && node node_modules/n8n/bin/n8n import:workflow --input="$f" ) 2>&1 | grep -i "success\|error" || true
  done
  cat <<EOF

التشغيل:
  cd $RT
  N8N_HOST=0.0.0.0 N8N_PORT=5678 N8N_ENCRYPTION_KEY=... node node_modules/n8n/bin/n8n start
  المتصفح: http://localhost:5678  → أنشئ حساب المالك → Workflows → "Arena+Strix — تشغيل فوري (DEMO)" → Execute
EOF
fi

say "٥) تجربة الدخان (تتحقق أن الناقل يعمل)"
bash "$ROOT/arena/tests/smoke.sh" || exit 1
say "تم. الخطوة التالية: arena list --state queued ثم اطلب من Arena Agent Mode تنفيذ المهمة."
