# n8n + Arena Bus + Strix — أتمتة أمنية بلا API خارجي

المستودع فيه طبقتان: **(أ)** عقد `arena/` الجديد الذي يربط n8n بـ Strix وبـ Arena Agent Mode
عبر ناقل ملفات/git، و**(ب)** مواد أقدم (fabrika الأندرويد/السير-أعمال اليدوية) مؤرشفة.

**ابدأ من هنا →** [`docs/ARENA_BUS_AR.md`](docs/ARENA_BUS_AR.md) · و[`arena/README.md`](arena/README.md) · [`arena/AGENTS.md`](arena/AGENTS.md)

```bash
cd n8n/arena
bash install.sh npm          # أو: bash install.sh docker
bash tests/smoke.sh          # 14 اختباراً ذاتياً
arena list --state queued    # ما الذي ينتظر الوكيل؟
```

## خارطة الطريق السريعة

| مهمة | أمر |
|---|---|
| فحص يدوي/مجدول | `arena submit --title "…" --target http://localhost:8090 --mode full` |
| تنفيذ الوكيل | اطلب في Arena: «نفّذ JOB-…» (البريف يُنشَأ آلياً في `arena/tasks/`) |
| قراءة النتيجة | `arena show JOB-… --json --report` |
| بوابة CI | `arena gate JOB-… --max-severity high` |
| تحقّق من الإصلاح | `arena retest JOB-…` + `node arena/lab/verify.mjs --base http://localhost:8090` |
| لوحة المعلومات | `arena serve --port 8787` |

## البنية

```
n8n (توجيه/جدولة) → arena/bus (ملفات + git) → Arena Agent Mode (العقل) → findings + تقرير + بوابة CI
                                     ↘ Strix الحقيقي (Docker + Ollama) عند توفره
```

مجلد `arena/lab/` فيه تطبيق معمل مُتعمَّد الضعف + نسخة مؤمَّنة + `verify.mjs` — لتشغيل الدورة كاملة
من طرف إلى طرف دون لمس أي نظام حقيقي.

> لا تفحص أي هدف ليس في `arena/config/engagement.json`. الفحص غير المصرّح به مخالفة قانونية.
