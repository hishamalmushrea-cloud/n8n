# تثبيت n8n بدون إنترنت — حزمة جاهزة (Offline Bundle)

هذه الحزمة تحتوي **n8n 2.35.0** كاملة ومثبّتة مسبقاً مع كل اعتمادياتها (2300+ حزمة)،
بما في ذلك وحدة `sqlite3` **مبنية وجاهزة** — لا تحتاج أي اتصال بالإنترنت إطلاقاً للتثبيت أو التشغيل.

## المواصفات المطلوبة
| المتطلب | القيمة |
|---|---|
| نظام التشغيل | Linux 64-bit (Debian / Ubuntu / أي توزيعة glibc) |
| Node.js | 22.16 أو أحدث (22 / 24 / 26) |
| إنترنت | ❌ غير مطلوب نهائياً |

## خطوات التثبيت

### 1) نزّل ملف الحزمة
من صفحة [Releases](../../releases) نزّل الملف:
`n8n-2.35.0-linux-x64-offline.tar.gz`

### 2) فك الضغط
```bash
mkdir -p "$HOME/.local/opt"
tar -xzf n8n-2.35.0-linux-x64-offline.tar.gz -C "$HOME/.local/opt"
```
سينشئ المجلد `$HOME/.local/opt/n8n`

### 3) التشغيل
```bash
node "$HOME/.local/opt/n8n/bin/n8n" start
```
أو استخدم سكربت التشغيل المرفق `start-n8n.sh` بعد وضعه بجانب مجلد `n8n`:
```bash
./start-n8n.sh
```

ثم افتح المتصفح على: **http://localhost:5678**

### 4) (اختياري) اجعلها أمراً عاماً
أضف هذا السطر إلى `~/.bashrc`:
```bash
alias n8n='node "$HOME/.local/opt/n8n/bin/n8n"'
```
ثم `source ~/.bashrc` وتستطيع استخدام `n8n start` من أي مكان.

## ملاحظات
- بياناتك (workflows / credentials) تُحفظ تلقائياً في `~/.n8n`
- عقدة **Kafka** غير متوفرة في هذه الحزمة (تعذّر بناء مكتباتها الأصلية)
- للتحقق من سلامة التنزيل: `sha256sum -c bundle.sha256`

## English Summary
Pre-installed, fully offline n8n 2.35.0 bundle for **Linux x64 (glibc)** with all dependencies
included and `sqlite3` pre-built. Requires only Node.js ≥ 22.16 — no internet needed.
Extract, then run: `node /path/to/n8n/bin/n8n start` and open http://localhost:5678
