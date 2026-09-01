# تثبيت n8n بدون إنترنت — حزمة ويندوز/لينكس/ماك جاهزة

هذه الحزمة تحتوي **n8n 2.35.0** كاملة مع كل اعتمادياتها (2200+ حزمة) وقاعدة البيانات تعمل عبر
**WebAssembly (بدون أي ترجمة native)** — لذا تعمل على **Windows 64-bit** و Linux 64-bit و macOS
دون أي أدوات بناء أو إنترنت إطلاقاً.

## المتطلبات (ويندوز)
| المتطلب | القيمة |
|---|---|
| نظام التشغيل | Windows 10/11 64-bit (أو Linux x64 / macOS) |
| Node.js | **22.16 أو أحدث** (22 / 24 / 26) — فقط هذا! |
| أدوات بناء | ❌ غير مطلوبة نهائياً |
| إنترنت | ❌ غير مطلوب نهائياً |

> نزّل Node.js مرة واحدة (من nodejs.org أو أي جهاز صديق — حزمة MSI صغيرة ~30MB).

## الخطوة 1: تنزيل الحزمة (394MB مقسمة إلى 5 أجزاء)

### الطريقة أ) git (أسهل — أمر واحد)
```bash
git clone --depth 1 -b arena/01a05efe-n8n https://github.com/hishamalmushrea-cloud/n8n.git n8n-repo
```

### الطريقة ب) من المتصفح
نزّل الملفات الستة من:
**https://github.com/hishamalmushrea-cloud/n8n/tree/arena/01a05efe-n8n/offline-bundle**
(ادخل على كل ملف ثم زر Download)

## الخطوة 2: دمج الأجزاء

### على ويندوز (CMD أو PowerShell):
```cmd
cd n8n-repo\offline-bundle
copy /b n8n-2.35.0-offline-universal.tar.gz.part-* n8n-offline.tar.gz
certutil -hashfile n8n-offline.tar.gz SHA256
```
يجب أن تكون النتيجة:
`bdc3c07fd71a30fd0fccc85db7ff29326bdeb217d52e4d87fafbbb3d074c717e`

### على لينكس/ماك:
```bash
cat n8n-2.35.0-offline-universal.tar.gz.part-* > n8n-offline.tar.gz
sha256sum n8n-offline.tar.gz
```

## الخطوة 3: فك الضغط

على ويندوز استخدم 7-Zip أو WinRAR لفك `n8n-offline.tar.gz` (مرتين: gz ثم tar)،
أو على PowerShell (ويندوز 10+ فيه tar مدمج):
```powershell
mkdir $env:USERPROFILE\n8n-offline
tar -xzf n8n-offline.tar.gz -C $env:USERPROFILE\n8n-offline
```
سينشئ المجلد: `%USERPROFILE%\n8n-offline\n8n`

## الخطوة 4: التشغيل 🚀

انسخ `start-n8n.cmd` (من هذا المستودع) إلى داخل `%USERPROFILE%\n8n-offline\` ثم انقر عليه مرتين،
أو من CMD:
```cmd
node %USERPROFILE%\n8n-offline\n8n\bin\n8n start
```
على لينكس/ماك:
```bash
node ~/n8n-offline/n8n/bin/n8n start
```

ثم افتح المتصفح على: **http://localhost:5678**
أول مرة ستُطلب منك إنشاء حساب مالك (أي بيانات — كل شيء محلي عندك).

### (اختياري) أمر عام
أضف إلى PATH أو أنشئ اختصاراً. على لينكس أضف إلى `~/.bashrc`:
```bash
alias n8n='node "$HOME/n8n-offline/n8n/bin/n8n"'
```

## ملاحظات
- بياناتك (workflows / credentials) تُحفظ في `%USERPROFILE%\.n8n` (ويندوز) أو `~/.n8n` (لينكس/ماك)
- عقدة **Kafka** فقط غير متوفرة — كل شيء آخر يعمل
- قاعدة البيانات SQLite تعمل عبر طبقة WebAssembly متوافقة fully-tested (هجرات + تنفيذ عمليات ✓)
- ميزات تحتاج خوادم n8n الخارجية (كتالوج القوالب، ترخيص) لن تعمل بدون إنترنت — لا تؤثر على عملك

## English Summary
Fully offline, **cross-platform (Windows x64 / Linux x64 / macOS)** pre-installed n8n 2.35.0.
Database runs on WebAssembly — zero native compilation, zero internet. Only requirement: Node.js ≥ 22.16.
Join the 5 parts (`copy /b` on Windows, `cat` on Linux/macOS), extract, then run
`node n8n/bin/n8n start` or double-click `start-n8n.cmd`. sha256 of full bundle:
`bdc3c07fd71a30fd0fccc85db7ff29326bdeb217d52e4d87fafbbb3d074c717e`
