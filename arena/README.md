# العقد بين n8n و Strix و Arena Agent Mode — بدون أي API خارجي

> اقرأ هذا الملف أولاً. هو "العقد" (contract) الذي يجعل n8n يكلّفني بالمهام، ويجعلني أنا
> المنفّذ الذي يرجع النتائج. لا مفاتيح، لا سحابة، لا endpoints مدفوعة.

## ١. الفكرة في ثلاث جُمل

1. **n8n** لا يفكّر — **يُجدول ويُوجّه** فقط: يكتب ملف مهمة في `arena/bus/jobs/queued/`.
2. **ناقل الملفات + git** هو قناة النقل الوحيدة (بدل REST/queue servers)؛ لا منفذ مفتوح ولا سرّب بيانات.
3. **أنا (Arena Agent Mode)** أسحب المهمة، أنفّذ منهجية Strix، وأرجّع `findings.ndjson` + `report.md` + الأدلة.

```
┌───────────────┐  arena submit   ┌──────────────────────────┐
│ n8n Workflow  │────────────────▶│ arena/bus/jobs/queued/   │
│ (مجدوَل/Webhook)│◀────────────────│   JOB-…/job.json         │
└───────────────┘  arena watch/show└────────────┬─────────────┘
                                                 │ arena claim (lease)
                                                 ▼
                                     ┌────────────────────────┐
                                     │  Arena Agent Mode (me)  │
                                     │  ├─ STRIX_MODE=agent →  │  ← لا Docker: أنا أحرّك الأدوات
                                     │  └─ STRIX_MODE=docker → │  ← عندك Docker: أشغّل strix الحقيقي
                                     └────────────┬───────────┘
                                                  │ add-finding / evidence / complete
                                                  ▼
   findings.ndjson + report.md + evidence/  →  n8n يقرؤها → Telegram/Email/Sheet/Jira + gate في CI
```

## ٢. لماذا لا "Proxy" يسرق جلسة Arena من المتصفح؟

الملف القديم `scripts/arena-openai-proxy.js` كان يجعل Strix يظن أنه يكلّم OpenAI بينما المتصفح
يلصق الطلبات في موقع Arena. هذا الحل **لا يصلح لإنتاج** لأنه:

- غير مستقر (تغيّر واجهة الموقع = تعطّل كامل، وانتظار ٢–٥ دقائق لكل استدعاء LLM).
- يستدعي استخداماً آلية لموقع لا يوفّر API عام → خطر إغلاق حسابك ومخالفة الشروط.
- يتجاوز "الحلقة" الصحيحة: الوكيل الذكي يحتاج حالة، أدوات، صلاحيات، ومراجعة بشرية — لا إكمال جمل.

الصحيح: **نقلل الطبقات**. أنا وكيل موجود فعلاً، فأتركه يستهلك طابور مهام حقيقي بدل تزييف OpenAI.

## ٣. الأوامر (كل شيء في `arena/bin/arena.mjs`)

```bash
export PATH="$PWD/arena/bin:$PATH"        # أو: npm link داخل arena/
arena init                                # ينشئ bus/ و config/engagement.json
arena list --state queued                 # ما الذي ينتظرني؟
arena submit --title "Weekly pentest" --target http://localhost:8090 \
             --actions passive,active,exploit-validation --mode full --priority P2
arena claim  <ID> --worker arena-agent    # تأمّين (lease + heartbeat) ضد التكرار
arena note   <ID> "بدأت الاستطلاع"
arena add-finding <ID> --file f.json      # يُتحقق من المخطط (PoC إلزامي)
arena evidence  <ID> poc.txt --stdin       # يُخفي الأسرار تلقائياً
arena complete <ID> --summary "..."        # يولّد report.md + report.json + verdict
arena gate     <ID> --max-severity high   #_ci_ يرفض البناء إذا كان هناك عالي/حرج
arena export   <ID> --out strix_runs/<ID> # شكل مُخرَجات Strix القياسي
arena target add <url|path> --kind url --actions passive,active  # تسجيل أصل تملكه
arena target list | check <target> | rm <target>
arena probe <id> --plan arena/probe/plans/owasp-baseline.json --var token=eyJ…
arena stats                               # للخُطط ولوحة المعلومات
arena serve --port 8787                   # قراءة فقط: /api/stats للوحة المعلومات
```

| الأمر | لماذا موجود |
|---|---|
| `claim` | تأمين بمهلة (TTL) حتى لا ينفّذ وكيلان نفس الفحص |
| `gate` | بوابة CI: بناء لا يمر مع ثغرة عالية |
| `retest` | فحص تحقق من الإصلاح (fix → verify) تلقائياً |
| `export` | لا نعيد اختراع صيغة التقارير: نلتزم بصيغة Strix |
| `check-target` / رفض `submit` | **بوابة التفويض**: لا نفحص ما لا تملكه |

## ٤. صلاحيات الفحص (مهم — أمان وقانون)

`arena/config/engagement.json` هو "ميثاق الاستهداف":

```json
{
  "allowlist": [
    { "target": "http://localhost:8090", "kind": "url",
      "actions": ["passive", "active", "exploit-validation"], "note": "lab" }
  ],
  "forbidden": ["ddos", "data-destruction", "mass-credential-stuffing"],
  "requireApprovalFor": ["exploit-validation"],
  "redact": ["Authorization", "Cookie", "Set-Cookie"],
  "maxDurationSeconds": 3600
}
```

`arena submit` على هدف خارج القائمة → الحالة `blocked` ورمز خروج `3`. لا استثناء صامت.

## ٥. وضعَي Strix

| الوضع | متى | كيف |
|---|---|---|
| `agent` (افتراضي هنا) | لا Docker ولا مفاتيح | أنا أنفّذ منهجية Strix بالأدوات المتاحة وأكتب findings بالصيغة |
| `docker` | جهازك فيه Docker | `arena/runners/strix-docker.sh` يشغّل `strix --target …` ثم يستورد `strix_runs/<run>/findings.json` إلى الناقل |
| `local-llm` | تريد تشغيله بلا إشرافي | Strix + Ollama (`docs.strix.ai/llm-providers/local.md`) — يبقى بلا API خارجي لكنه يستهلك GPU |

```bash
STRIX_MODE=docker ARENA_TARGET=http://localhost:8090 bash arena/runners/strix-docker.sh <JOB_ID>
```

## ٦. n8n

ثلاثة سير عمل جاهزة في `arena/n8n/` (استيراد من الواجهة أو CLI):

| الملف | يفعل |
|---|---|
| `arena-pentest-scheduled.json` | مجدوَل أسبوعياً → submit → watch حتى أُنهي → تقرير |
| `arena-pentest-on-commit.json` | Webhook من Git/CI → فحص سريع → `gate` يوقف النشر |
| `arena-agent-notify.json` | أستدعيه أنا عند `complete` (resume فوري بدون انتظار دورية) |

استيراد من سطر الأوامر:
```bash
cd ~/n8n-runtime && node node_modules/n8n/bin/n8n import:workflow \
  --separate --input=/home/user/n8n/arena/n8n/arena-pentest-scheduled.json
```

## ٧. المزايا التي بنيتها ولم تطلبها (لأنها ضرورية عملياً)

1. **بوابة تفويض** بحساب استهداف صريح (لا فحص لهدف غير مسموح).
2. **PoC إلزامي**: `add-finding` يرفض نتيجة بلا خطوات إثبات → لا ضوضاء SAST.
3. **حجب الأسرار آلي** في الأدلة والمُخرجات (`redactText`).
4. **بوابة CI** (`arena gate`) تتكامل مع GitHub Actions لوقف النشر.
5. **حلقة إصلاح → تحقق** (`arena retest`) مع `status: fixed-verified`.
6. **نقل بالـ git** (`arena commit`) فيعمل عبر أجهزة مختلفة بلا منفذ مفتوح.
7. **سجل تدقيق** `events.ndjson` لكل خطوة (من، متى، ماذا) — مطلوب في أي امتثال (ISO/SOC2).
8. **نقاط قرار بشري**: `arena hold` عندما يلزم موافقة على إجراء عنيف.
9. **لوحة معلومات محلية** تقرأ الناقل مباشرة (`arena serve`).
10. **مخططات JSON** (`arena/schema/`) فأي أداة أخرى تكتب مهمة وتستهلك نتائجها.

## ٨. حدود الأمانة

- n8n هنا مثبت npm محلياً (SQLite) لأغراض التجربة؛ للإنتاج استخدم Docker/VPS مع Postgres ومصادقة.
- أنا لست بديلاً عن اختبار اختراق مُعتمَد؛ الفحص الآلي يرفع الغطاء، لا يمنح ضماناً.
- فحص تطبيقات الأندرويد ديناميكياً يحتاج Frida/emulator؛ المخطط في `docs/ANDROID_AI_TEAM_ARCHITECTURE.md` ما زال صالحاً لكن استبدل طبقة "Playwright proxy" بهذا الناقل.
