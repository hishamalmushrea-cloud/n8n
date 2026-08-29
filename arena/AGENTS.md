# AGENTS.md — بروتوكول الوكيل (اقرأه قبل تنفيذ أي مهمة من الناقل)

هذا الملف هو **العقد** بين n8n (الذي يُنتج المهام) وبين الوكيل الذي ينفّذها (Arena Agent Mode، أو أي
وكيل آخر: Claude Code / Codex / Cursor — لأن كلهم يعملون على الملفات نفسها).

## ٠) القاعدة الذهبية

> أنت لست "مكمّل جمل". أنت مهندس أمان يملك أدوات تنفيذ. كل نتيجة بلا إثبات = **لا نتيجة**.
> وكل هدف خارج `arena/config/engagement.json` = **رفض**، لا استثناء.

## ١) دورة حياة المهمة

```
queued ──claim──▶ active ──(hold)──▶ onhold ──┐
   ▲                              │            │
   │                              ▼            ▼
   └──────────(retest job)────  done  ◀── complete --report
                                  ▲
                        failed ◀── fail --reason
```

```bash
export ARENA_BUS=$PWD/arena/bus
arena list --state queued                 # ماذا ينتظر؟
arena claim  <ID> --worker arena-agent    # تأمين + heartbeat (TTL 30د)
arena note   <ID> "بدأت الاستطلاع"
# ... تنفيذ فعلي ...
arena add-finding <ID> --stdin            # نتيجة واحدة لكل سطر JSON (مخطط إلزامي)
arena evidence    <ID> poc-1.txt --stdin   # دليل خام (يُحجب تلقائياً)
arena complete    <ID> --summary "..."     # يولّد report.md/report.json ويبلّغ n8n
arena commit                              # انقل الحالة عبر git للطرف الآخر
```

## ٢) تسلسل العمل (منهجية Strix — مطبّقة يدوياً)

| # | مرحلة | أدواتك | معيار النهاية |
|---|---|---|---|
| 1 | Recon | `curl`, `nmap`/`rustscan`, `gobuster`, `httpx`, `waybackurls` | قائمة نقاط نهاية + تقنيات + ترويسات |
| 2 | SAST | `semgrep`, `gitleaks`, `npm audit`/`pip-audit`, قراءة الكود | نقاط دخول خطرة + أسرار |
| 3 | Threat model | عقلك + قائمة `active` | أين المال/البيانات/الصلاحيات؟ |
| 4 | Active tests | `curl`, `ffuf`, `sqlmap`, `playwright` | محاولة لكل فئة OWASP مناسبة |
| 5 | Validation | بناء PoC يعمل | 200/تغيّر حالة ملحوظ ≠ فرضية |
| 6 | Reporting | `arena add-finding` | CVSS + CWE + patch مقترح |
| 7 | Fix loop | `arena retest` | `fixed-verified` فقط بعد إعادة الإثبات |

فئات يجب تغطيتها على أي تطبيق ويب/هاتف:
`authn` (JWT: alg/iss/aud/exp، reset flows) · `authz` (BOLA/IDOR أفقي ورأسي، mass assignment) ·
`injection` (SQL/NoSQL/Cmd/SSTI/Log4Shell-style) · `crypto` (تخزين المرور، تسريب PAN/PII في الردود) ·
`config` (نقاط debug، `/actuator`, `.env`, `.git`, ترويسات ناقصة) · `client` (XSA/DOM XSS/CSRF/clickjacking) ·
`ssrf` (روابط خاصة + metadata) · `business` (تلاعب بالسعر/الكمية/الحالة، سباقات) · `upload` (نوع/حجم/مسار) ·
`mobile` (HTTPS pinning، Deep links، WebView JavaScript bridge، IPC بلا أذن، بيانات في Logcat/SharedPreferences).

## ٣) قواعد صارمة

1. **ممنوع** (يُقرأ من engagement.json): DoS، حذف/تدمير بيانات، تخمين جماعي لكلمات المرور، تصيّد، لمس tenants أخرى.
2. **لا أسرار في التقارير**: لا توكن صالح كاملاً، لا مفاتيح إنتاج. `evidence` يُمرّر على `redactText` — راجع يدوياً أيضاً.
3. **لا تعديل لملفات الهدف** داخل الفحص الأمني؛ الإصلاحات تُقترح في `remediation.patch` وتُطبَّق في مهمة إنشاء منفصلة.
4. **لا تكتب في `arena/bus/jobs/done/*`** بعد الإكمال — افتح `retest` بدل ذلك.
5. **حدّ الوقت** `maxDurationSeconds`: تجاوزه = `arena fail --reason timeout`.
6. **مهمّة واحدة في المرة** إلا لو `maxConcurrentJobs > 1` (الافتراضي 1 لأن التنفيذ بشري/وكيلي).
7. كل إجراء عنيف مدرج في `requireApprovalFor` → اعمل `arena hold <ID> --reason "approval"` وانتظر موافقة n8n/المالك.

## ٤) صيغة النتيجة (ملخّص — الكامل في `arena/schema/finding.schema.json`)

```json
{
  "title": "BOLA في /api/orders/:id يقرأ طلبات الآخرين مع أرقام البطاقات",
  "severity": "high", "cvss": 8.1, "cvss_vector": "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N",
  "cwe": "639", "owasp": "A01:2021",
  "description": "…لماذا حدث وكيف…",
  "reproduction": { "steps": ["…", "…"], "request": "GET /api/orders/1002 …", "response": "{\"card\":\"4111…\"}" },
  "remediation": { "summary": "افحص الملكية في الاستعلام نفسه", "patch": "- …\n+ …", "effort": "S" },
  "verified": true, "evidence": "evidence/02-idor.txt", "source": "arena-agent"
}
```

## ٥) إن توفر Strix الحقيقي (وضع `docker`/`local`)

```bash
STRIX_LLM=ollama/qwen3-vl LLM_API_BASE=http://localhost:11434 STRIX_API_KEY=local \
  strix --target "$TARGET" --scan-mode standard --non-interactive
# ثم الاستيراد إلى الناقل (نفس الصيغة، نفس المسار):
python3 arena/runners/import-strix.py <JOB_ID> ./strix_runs
```
`arena gate <ID> --max-severity high` هو بوّابة CI: 0 = مسموح بالنشر، 1 = مرفوض.

## ٦) ما يُرجعه n8n لك بعد الإكمال

`arena show <ID> --json` → `job.result = { verdict, score, summary, counts, report }`.
لا تحتاج أن تعرف n8n: التقرير ملف، والناقل git — أي مستهلك آخر (Telegram، Google Sheets، Jira، GitHub PR)
يقرأ من نفس المصدر.
