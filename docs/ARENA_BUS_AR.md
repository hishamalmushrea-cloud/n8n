# n8n ⇄ Arena Bus ⇄ Strix — التوثيق Master (بدون أي API خارجي)

**الحالة في هذا المستودع:** مُنفَّذ ومُجرَّب من طرف لآخر، لا خطة على الورق.
انظر §7 للقياسات المُحقَّقة.

---

## ١) القرار المعماري: لا "بروكسي" يسرق الجلسة — بل **ناقل مهام**

| | الطريقة القديمة في هذا المستودع | الطريقة الجديدة (`arena/`) |
|---|---|---|
| كيف يصل n8n/Strix إلى الذكاء | `scripts/arena-openai-proxy.js` يفتح متصفح Playwright ويلصق الطلب في موقع Arena ويحوّله لـ OpenAI JSON | n8n يكتب ملف مهمة؛ Arena Agent Mode يسحبه وينفّذه ويرجعه |
| الاعتمادية | CSS selectors + جلسة كوكيز + انتظار ٢–٥ د لكل استدعاء | ملفات + git |
| الانفجار عند التغيير | أي تعديل في موقع Arena = شلل كامل | لا شيء يتغير |
| المخاطر القانونية/الحساب | استخدام آلي لموقع بلا API عام → خرق شروط واستخدام قد يوقف حسابك | الاستخدام المُصرَّح للوكيل |
| الحالة | **مُهمَلة** (الملفات باقية للتاريخ) | **معتمدة** |

> لماذا لا يمكن "استدعاء Arena من n8n مباشرة"؟ لأنه لا يوجد API عام لـ Arena Agent Mode، وأي محاولة
> اختراعه من واجهة الويب ستبقى قشرة هشّة. البنية الصحيحة: **n8n هو المجدول، الوكيل هو العقل،
> الملفات/ git هما ساعي البريد.**

---

## ٢) طبقات النظام

```
┌─ 1. التوجيه (n8n) ─────────────────────────────────────────────┐
│  Schedule / Webhook / CI → عقدة ExecuteCommand → arena submit  │
└───────────────────────────────┬────────────────────────────────┘
                                │  ملف JSON واحد
┌─ 2. الناقل (arena/bus) ──────▼────────────────────────────────┐
│  jobs/{queued,active,onhold,done,failed}/<ID>/                 │
│    job.json  findings.ndjson  events.ndjson  report.md/json   │
│    evidence/*              ← حجب أسرار تلقائي                  │
│  config/engagement.json    ← بوابة التفويض (Rules of Engagement)│
│  schema/*.schema.json      ← عقود البيانات لأي أداة            │
└───────────────────────────────┬────────────────────────────────┘
                                │ arena claim / add-finding / complete
┌─ 3. التنفيذ (أيّ محرّك) ──────▼────────────────────────────────┐
│  a) Arena Agent Mode  ← الافتراضي هنا، بلا Docker وبلا مفاتيح   │
│  b) Strix الحقيقي     ← `arena/runners/strix-docker.sh`         │
│       STRIX_LLM=ollama/qwen3-vl  LLM_API_BASE=http://localhost:11434 │
│       ثم import-strix.py → نفس الناقل، نفس الصيغة              │
│  c) verify.mjs        ← فحوصات حتمية لإعادة الاختبار (بلا LLM)  │
└───────────────────────────────────────────────────────────────┘
```

لا Redis، لا Postgres، لا سكرتير أسرار، لا بوابة دفع — أي شيء في `arena/` يعمل بـ Node فقط.

---

## ٣) الملفات

| المسار | الدور |
|---|---|
| `arena/bin/arena.mjs` | الـ CLI الكامل (~700 سطر، صفر اعتماديات) |
| `arena/bin/arena` | مُشغّل `arena` (أضِف مجلده لـ PATH) |
| `arena/bin/n8n-status.mjs` | يقرأ سجل n8n من SQLite مباشرة (قراءة فقط) — بدون REST/API key |
| `arena/config/engagement.json` | مَن يُسمح بفحصه، وبأي إجراءات، والسقف الزمني، والحقول المحجوبة |
| `arena/schema/{job,finding,report}.schema.json` | العقود؛ أي أداة ثالثة تكتب/تقرأ من نفس الصيغة |
| `arena/AGENTS.md` | بروتوكول الوكيل: المراحل، الممنوع، صيغة النتيجة |
| `arena/runners/strix-arena-runner.sh` | جسر الطابور: يحضّر Brief للوكيل أو يسلّم Strix |
| `arena/runners/make-brief.py` | يولّد ورقة تنفيذ المهمة من job.json |
| `arena/runners/strix-docker.sh` | وضع Strix الحقيقي (Docker + موديل محلي) |
| `arena/runners/import-strix.py` | يستورد `strix_runs/**` إلى الناقل مع تطبيع الحقول |
| `arena/n8n/arena-*.json` | ٤ سير عمل جاهزة للاستيراد |
| `arena/dashboard/index.html` + `arena serve` | لوحة معلومات محلية RTL بدون أصول خارجية |
| `arena/lab/` | تطبيق معمل مُتعمَّد الضعف + نسخة مؤمَّنة + `verify.mjs` |
| `arena/tests/smoke.sh` | 14 اختباراً ذاتياً للناقل |
| `arena/docker-compose.yml` | نسخة "بلا API" من البنية (ن8n + Postgres + runner + strix اختياري) |

### ٣.١ أوامر تستعملها كثيراً

```bash
export PATH="$PWD/arena/bin:$PATH"

arena list --state queued
arena show JOB-… --json --report
arena status JOB-… --field verdict        # لل_if_ في n8n
arena gate JOB-… --max-severity high      # بوابة CI: 0 مسموح / 1 مرفوض
arena set-finding JOB-… F-abc --status false-positive --note "لا يوجد IDOR، الاختبار على بيانات وهمية"
arena retest JOB-…                        # ينسخ النتائج كقائمة تحقّق
arena export JOB-… --out strix_runs/JOB-… # صيغة Strix القياسية
arena stats                               # للوحة المعلومات
arena serve --port 8787
bash arena/tests/smoke.sh
```

### ٣.٢ سير n8n الأربعة

| الملف | يفعله |
|---|---|
| `arena-pentest-run-once.json` | زر تشغيل فوري: submit → watch → status → gate → export → show → retest إن كانت FAIL |
| `arena-pentest-scheduled.json` | نفسه لكن `0 6 * * 1` (أحد ٦:٠٠) مع حلقة Wait بدل الحظر الطويل |
| `arena-agent-notify.json` | Webhook `POST /webhook/arena-agent-notify` يستدعيه `arena complete` عند الانتهاء (إيقاظ فوري + مسار تنبيه) |
| `arena-ci-gate.json` | Webhook من Git/CI: فحص quick ثم `gate` → 403 للـ pipeline عند ثغرة عالية |

استيراد: `n8n import:workflow --input=arena/n8n/<file>.json` (من مجلد n8n المثبَّت). **ملاحظة عملية:**
`--separate` للملف الذي يحوي **مصفوفة**؛ لملف كائن واحد استبدلها بحذف `--separate`.

### ٣.٣ فخّان في n8n وقعناهما فعلاً (موثّقان لغيرك)

1. **التعبيرات داخل `ExecuteCommand`**: يجب أن تبدأ القيمة كلها بـ `=`، وعندها تُكتب
   وسائطها `={{ … }}` — لكن **لا** تكتب `="={{ … }}"` داخل نص تعبير واحد، وإلا بقي `=` حرفياً
   والتهمه الـ shell. الصيغة الصحيحة: `"=cmd --title \"{{ $json.title }}\" --target \"{{ $json.target }}\""`.
2. **`arena serve`/CLI يحتاج `ARENA_BUS`**: n8n يعمل بمجلد عمل مختلف، لذا كل أمر يبدأ بـ
   `ARENA_BUS=/path/arena/bus …` (أو صدّر المتغير في حاوية n8n). بدون ذلك يُنشئ الناقل مجلداً جديداً.

---

## ٤) تثبيت على جهازك

```bash
# أ) أنت عندك Docker (موصى به):
cd n8n/arena && bash install.sh docker

# ب) بلا Docker (كما جرّبنا هنا — n8n 1.123 + sqlite3 مبني محلياً):
cd n8n/arena && bash install.sh npm
```

`install.sh` يفعل: فحص المتطلبات → `arena init` → إضافة PATH → توليد `arena/.env` بمفاتيح عشوائية
→ تثبيت/ترقية n8n → بناء `sqlite3` محلياً بدون تنزيل رؤوس Node من الإنترنت → استيراد الـ workflows
→ تشغيل `tests/smoke.sh`.

**العقبات الحقيقية اللي ستواجهك (وحلولها مثبتة هنا):**

| العائق | الحل المُستعمَل |
|---|---|
| `node-gyp` يفشل لأنه لا يستطيع تنزيل `nodejs.org/.../node-headers` | `--nodedir=/usr/local` (رؤوس Node موجودة في صورة node الرسمية) |
| `xlsx` في n8n يُوزَّع من `cdn.sheetjs.com` (محجوب عند كثير من الشبكات) | `package.json → overrides: { "xlsx": "0.18.5" }` من npm registry |
| n8n ≥ 2.x يطلب Node ≥ 24 | ثبّت `n8n@1.123.75` (`engines: >=20.19 <=24.x`) |
| حاويات بلا Docker | `STRIX_MODE=agent`: الوكيل ينفّذ المنهجية بدل محرّك Strix |
| نموذج محلي صغير يتعثّر في العمل الوكيلي (توثيق Strix نفسه) | لا تجبر `strix` على 7B؛ دع الوكيل ينفّذ، أو استخدم 70B+/Claude-class عند الحاجة |

---

## ٥) ما أضفتهُ أنتَ نسيَ ذكره (وكلها مُنفَّذة الآن)

1. **بوابة تفويض (Rules of Engagement):** فحص هدف غير مُسجَّل = رفض برمز خروج ٣. هذا يحميك قانونياً
   ومهنياً؛ أي أداة pentest بلا هذا القيد خطر حقيقي (خصوصاً لو شغّلتها مجدولاً بلا مراقبة).
2. **PoC إلزامي:** `add-finding` يرفض نتيجة بلا خطوات إعادة إنتاج → لا "SAST noise".
3. **حجب الأسرار آلياً** في الأدلة والمخرجات (`Authorization`, `Cookie`, `sk-…`, `password=…`).
4. **بوابة CI** (`arena gate`) + سير عمل جاهز للـ webhook — تفصل الفحص الأمني عن النشر.
5. **حلقة إصلاح → تحقّق** (`retest` + `set-finding --status fixed-verified`) مع `verify.mjs` حتمي
   يعيد إنتاج نفس الـ PoCs بدل أن "يصدّق" الوكيل نفسه.
6. **سجل تدقيق لكل خطوة** (`events.ndjson`) — لازم لأي امتثال (ISO 27001 / SOC 2 / PCI DSS 11.4).
7. **نقاط موافقة بشرية:** `requireApprovalFor` + `arena hold` للإجراءات العنيفة.
8. **نقل عبر git** بلا أي منفذ مفتوح (الناقل يمشي مع المستودع: جهازك ← الحاسوب ← الهاتف).
9. **لوحة معلومات محلية** بدون CDN/fonts خارجية (حتى في شبكة معزولة).
10. **مخططات JSON** فتنجح الحالة مع أدوات أخرى (Semgrep, npm audit, Gitleaks, Trivy) —
    مِرقِط مخرجاتها → `add-finding`.
11. **نسخ صيغتي المُخرَجات إلى `strix_runs/`** حتى تبقى متوافقاً مع تقارير Strix ومنصّته لاحقاً.
12. **تغطية أندرويد:** نفس العقد يخدم APK — `kind: apk`، وFrida/objection على المحاكي، ثم نتائج
    بنفس الصيغة. انظر §6.

## ٦) توسعة مميّزة إن أردت (مرتّبة بقيمة/جهد)

| # | التوسعة | لماذا | الجهد |
|---|---|---|---|
| 1 | **SAST gate في PR**: Semgrep + Gitleaks → `arena submit --actions sast` | يمنع الثغرة قبل الدمج | صغير |
| 2 | **اعتماديات**: `npm audit --json` / `pip-audit --json` → `add-finding` | نصف ثغرات التطبيقات من هنا | صغير |
| 3 | **SBOM + توقيع**: `syft` → `cosign`، تُرفق كدليل امتثال | مطلوب للتصدير/القطاع العام | متوسط |
| 4 | **فحص أندرويد آلي**: Frida + `objection` على emulator، ثم `arena complete` | مشروعك الأساسي اندرويد | متوسط |
| 5 | **IaC/حاويات**: `trivy config` + `checkov` على Terraform/Dockerfile | الثغرة كثيراً في النشر لا الكود | متوسط |
| 6 | **Replay داخلي**: `arena fuzz <id>` يحاكي تنضيج محدود داخل الشبكة الخاصة فقط | يلتقط منطق عمل مكسور | كبير |
| 7 | **متعدد وكلاء**: `arena claim --worker w1` + تقسيم بالملكية → فحوص متوازية على endpoints مختلفة | فحص أوسع بنفس الوقت | متوسط |
| 8 | **سلة نتائج للفرق**: تصدير findings إلى Jira/Linear + ربط PR الإصلاح | الثغرة اللي لا تُتتبَّع لا تُصلَح | متوسط |
| 9 | **مقاييس زمنية**: وقت الاكتشاف→الإصلاح (MTTR) في `stats` | يحوّل الأمن لأرقام تُدار | صغير |
| 10 | **تجفيف (air-gap)**: `arena serve` + `n8n offline license` على شبكة داخلية بلا إنترنت | للبيئات الحساسة | متوسط |

## ٧) ما تم قياسه فعلياً في هذه الجلسة

```text
n8n 1.123.75   ← npm install + sqlite3 build (بدون تنزيل رؤوس)
owner          ← owner@arena.local / (كلمة مرور التجربة في المحادثة)
workflows      ← 4 مستوردة، 3 منها مجرَّبة التنفيذ
demo job       ← JOB-20260829-1f4f73  (FAIL، 10 نتائج، درجة 15/100، 4 عالقة)
retest job     ← JOB-20260829-1f4f73-R0000 (PASS، درجة 100/100، 11 fixed-verified)
n8n execution  ← status: success — lastNodeExecuted: "مهمة إعادة فحص"
verify.mjs     ← 27/27 على النسخة المؤمَّنة، 8/27 على النسخة الأصلية (الفرق مُثبت)
arena tests    ← 14/14 smoke
```

## ٨) حدود صريحة (لا تُجمَّل)

- **هنا** n8n يعمل بوضع مطوّر (SQLite، بدون TLS، بدون SSO). للإنتاج: Postgres + reverse proxy + `N8N_ENCRYPTION_KEY` قوي + مصادقة + نسخ احتياطي لـ `~/.n8n` ولمجلد `arena/bus`.
- **مخزون الثغرات محلي**: بدون `nvd-data`/`osv` محدَّث لا يوجد كشف CVE آلي. `pip-audit`/`npm audit` يحتاجان
  قائمة تهديدات؛ في الشبكة المعزولة حدّث `osv-scanner` مرة شهرياً من مصدر موثوق.
- الوكيل **ليس بديلاً** عن اختبار اختراق مُعتمَد أو مراجعة قانونية؛ يرفع الغطاء، ولا يمنح ضماناً.
- التوقيع الآلي للنتائج لا يضمن "صواب" كل تصنيف CVSS — راجِع الشدة العالية قبل النشر للعملاء.
- لا تفحص SaaS لغيرك مهما بدت الفكرة براء؛ `engagement.json` هو الحد الفاصل.
