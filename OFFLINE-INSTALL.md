# تثبيت n8n بدون إنترنت — حزمة جاهزة (Offline Bundle)

هذه الحزمة تحتوي **n8n 2.35.0** كاملة ومثبّتة مسبقاً مع كل اعتمادياتها (2300+ حزمة)،
بما في ذلك وحدة `sqlite3` **مبنية وجاهزة** — لا تحتاج أي اتصال بالإنترنت إطلاقاً للتثبيت أو التشغيل.

## المواصفات المطلوبة
| المتطلب | القيمة |
|---|---|
| نظام التشغيل | Linux 64-bit (Debian / Ubuntu / أي توزيعة glibc) — على ويندوز استخدم WSL2 |
| Node.js | 22.16 أو أحدث (22 / 24 / 26) |
| إنترنت | ❌ غير مطلوب نهائياً |

## الخطوة 1: تنزيل الحزمة (403MB مقسمة إلى 5 أجزاء)

الحزمة موجودة في مجلد [`offline-bundle/`](./offline-bundle/) في هذا الفرع.

### الطريقة أ) تنزيل الأجزاء من المتصفح
نزّل الملفات الستة من هذا الرابط:
**https://github.com/hishamalmushrea-cloud/n8n/tree/arena/01a05efe-n8n/offline-bundle**
(اضغط على كل ملف ثم زر Download)

ثم أعد دمجها في ملف واحد:
```bash
cat n8n-2.35.0-linux-x64-offline.tar.gz.part-* > n8n-2.35.0-linux-x64-offline.tar.gz
sha256sum n8n-2.35.0-linux-x64-offline.tar.gz
# يجب أن يكون الناتج: a4388978a6f0220bdcf57b3e17f3aeae4425d9f1b374b668b7b8af31332c0f76
```

### الطريقة ب) بـ git (أمر واحد)
```bash
git clone --depth 1 -b arena/01a05efe-n8n https://github.com/hishamalmushrea-cloud/n8n.git n8n-repo
cat n8n-repo/offline-bundle/*.part-* > n8n-2.35.0-linux-x64-offline.tar.gz
```

## الخطوة 2: فك الضغط
```bash
mkdir -p "$HOME/.local/opt"
tar -xzf n8n-2.35.0-linux-x64-offline.tar.gz -C "$HOME/.local/opt"
```
سينشئ المجلد `$HOME/.local/opt/n8n`

## الخطوة 3: التشغيل
```bash
node "$HOME/.local/opt/n8n/bin/n8n" start
```
أو انسخ [`start-n8n.sh`](./start-n8n.sh) بجانب مجلد `n8n` وشغّله.

ثم افتح المتصفح على: **http://localhost:5678**

### (اختياري) اجعلها أمراً عاماً
أضف إلى `~/.bashrc`:
```bash
alias n8n='node "$HOME/.local/opt/n8n/bin/n8n"'
```

## ملاحظات
- بياناتك (workflows / credentials) تُحفظ تلقائياً في `~/.n8n`
- عقدة **Kafka** غير متوفرة في هذه الحزمة
- sha256 للحزمة الكاملة: `a4388978a6f0220bdcf57b3e17f3aeae4425d9f1b374b668b7b8af31332c0f76`

## English Summary
Pre-installed, fully offline n8n 2.35.0 bundle for **Linux x64 (glibc)** with all dependencies
included and `sqlite3` pre-built (split into 5 parts under `offline-bundle/`).
Join parts: `cat *.part-* > bundle.tar.gz`, extract, then run `node n8n/bin/n8n start`
and open http://localhost:5678. Requires only Node.js ≥ 22.16 — no internet needed.
