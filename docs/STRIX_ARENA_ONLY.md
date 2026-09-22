# ربط Strix + Arena.ai Agent Mode فقط - بدون أي API

## ما هي Strix؟

Strix (usestrix/strix) هي أداة Pentesting AI مفتوحة المصدر:
- فريق وكلاء AI يهاجمون تطبيقك كـ Hacker حقيقي
- عندها أدوات: HTTP Proxy, Browser Automation, Terminal, Python Runtime
- تكتشف: SQL Injection, XSS, IDOR, SSRF, Auth Bypass, Business Logic bugs
- الميزة: لا تبلغ عن ثغرة إلا مع Proof-of-Concept يعمل فعلاً

**المشكلة الأصلية:** Strix تحتاج مفتاح OpenAI / Claude API (تكلفة $3-20 لكل فحص)

**حلك الجديد:** نجعل Strix تظن أنها تتكلم مع OpenAI، لكن في الحقيقة تتكلم مع **Arena.ai Agent Mode عبر متصفح آلي** - مجاناً وبدون API.

---

## الفكرة العبقرية: OpenAI-Compatible Proxy → Arena.ai

```
[Strix CLI] 
   ↓ (يظن أنه يكلم OpenAI API)
[http://localhost:8080/v1/chat/completions] ← Proxy Server (كتبته لك)
   ↓ (يحول الطلب لمتصفح آلي)
[Playwright Browser → Arena.ai Agent Mode]
   ↓ (Arena.ai يفكر ويرد)
[Proxy يحول رد Arena.ai لصيغة OpenAI JSON]
   ↓
[Strix يكمل الهجوم]
```

Strix لا يعرف أنه يكلم Arena.ai. بالنسبة له، هو يكلم OpenAI.

---

## الهيكل الكامل مع Android Studio

```
[فكرة المشروع]
   ↓
[n8n Orchestrator - المنسق فقط]
   ├─→ [Arena.ai Agent Mode - CREATE] → يبني تطبيق Android
   ├─→ [Sync → Android Studio Folder]
   ├─→ [Build: ./gradlew assembleDebug]
   ├─→ IF فشل → Arena FIX → Loop
   └─→ IF نجح:
        ├─→ [شغل APK على Emulator]
        ├─→ [Strix Scan - لكن LLM = Arena.ai Proxy]
        │     Strix يهاجم التطبيق (HTTP Proxy + Browser)
        │     كل قرار هجوم يأتي من Arena.ai عبر الـ Proxy
        │     ينتج: vulnerabilities.json + PoCs
        ├─→ [Arena.ai FIX Security] → "أصلح هذه الثغرات: [vuln report]"
        ├─→ [Sync + Rebuild + Re-Scan]
        └─→ [IF Duration Finished? → Telegram Report + APK]
```

**النتيجة:** تطبيق Android يُبنى، يُختبر أمنياً بـ Strix، وتُصلح ثغراته، كل الذكاء من Arena.ai فقط، بدون أي API مدفوع.

---

## الملفات الجديدة

### 1. `scripts/arena-openai-proxy.js`
خادم Express صغير يحاكي OpenAI API:

```javascript
POST /v1/chat/completions
{
  model: "gpt-4",
  messages: [{role: "user", content: "You are a pentester..."}]
}

→ Proxy يحولها لـ Playwright → يرسلها لـ Arena.ai Agent Mode
→ ينتظر رد Arena.ai (2-5 دقائق)
→ يحول الرد لصيغة OpenAI:
{
  choices: [{message: {content: "رد Arena.ai"}}]
}
```

Strix يضبط:
```bash
export OPENAI_API_KEY="dummy"
export OPENAI_BASE_URL="http://localhost:8080/v1"
strix --target ./MyApp --llm openai
```

### 2. `scripts/strix-arena-runner.sh`
سكريبت يشغله n8n:
- يشغل الـ Proxy في الخلفية
- يشغل Strix موجهاً للـ Proxy
- يحفظ نتائج الفحص في `/tmp/strix_results/`
- يوقف الـ Proxy

### 3. `workflows/arena-strix-security-team.json`
Workflow جديد:
- لا يوجد فيه أي AI Node
- فقط Execute Command → Arena.ai + Strix + Build
- Loop مستمر

---

## كيف يعمل Strix مع Arena.ai بدون API - خطوة بخطوة

### الخطوة 1: Proxy Server (كتبته لك)

الخادم يعمل على `localhost:8080`

عندما Strix يرسل:
```
"Find IDOR vulnerability in /api/user/{id}"
```

الـ Proxy:
1.  يأخذ الرسالة
2.  يفتح Arena.ai Agent Mode (نفس جلسة المشروع)
3.  يرسل: "أنت خبير أمني Strix، مهمتك إيجاد IDOR في /api/user/{id}، استخدم أدواتك، أنتج PoC بايثون"
4.  ينتظر Arena.ai (الذي عنده Browser + Terminal)
5.  يرجع رد Arena.ai كـ OpenAI JSON

### الخطوة 2: Strix ينفذ

Strix يأخذ قرار Arena.ai وينفذه بأدواته الحقيقية:
- يفتح HTTP Proxy
- يجرب `GET /api/user/123` ثم `GET /api/user/124`
- لو نجح، يكتب PoC بايثون
- يحفظ الثغرة

### الخطوة 3: الإصلاح

n8n يقرأ `strix_results/vulnerabilities.json` ويرسله لـ Arena.ai:
```
"Strix وجد هذه الثغرات في تطبيق Android:
- IDOR في UserProfile: يمكن قراءة بيانات مستخدم آخر
- Hardcoded API Key في MainActivity.kt
- Insecure Data Storage

أصلحها الآن، اعرض الملفات المصححة."
```

Arena.ai يصلح، n8n يبني مرة أخرى، ثم يعيد فحص Strix.

---

## نوعان من التكامل (اختر ما يناسبك)

### النوع A: Strix كامل مع Proxy (الأقوى - بنيته لك)
- Strix يعمل بكامل أدواته (Proxy, Browser, Terminal)
- كل قراراته من Arena.ai عبر الـ Proxy
- يكتشف ثغرات Runtime حقيقية
- يحتاج Docker + وقت (فحص واحد 10-20 دقيقة)

### النوع B: Arena.ai كـ Security Auditor بدون تشغيل Strix (الأسرع)
- لا تشغل Strix فعلياً
- n8n يرسل كود Android كاملاً لـ Arena.ai:
  > "أنت Strix، راجع هذا الكود بمعايير OWASP Mobile Top 10، ابحث عن: Hardcoded secrets, Insecure storage, Weak crypto, etc"
- Arena.ai يراجع الكود ويعطيك تقرير + إصلاح
- أسرع (3-5 دقائق) ولا يحتاج Docker

**أنصحك تبدأ بالنوع B، ثم تنتقل لـ A عندما يستقر المشروع.**

---

## OWASP Mobile Top 10 - ماذا يفحص Arena.ai؟

عندما تطلب من Arena.ai أن يكون Strix، اطلب منه فحص:

1.  **M1: Improper Credential Usage** - مفاتيح API مكتوبة في الكود
2.  **M2: Inadequate Supply Chain Security** - مكتبات قديمة
3.  **M3: Insecure Authentication/Authorization** - IDOR, Auth Bypass
4.  **M4: Insufficient Input/Output Validation** - SQL Injection, XSS
5.  **M5: Insecure Communication** - HTTP بدل HTTPS
6.  **M6: Inadequate Privacy Controls** - تسريب بيانات
7.  **M7: Insufficient Binary Protections** - Reverse Engineering
8.  **M8: Security Misconfiguration** - Permissions زائدة
9.  **M9: Insecure Data Storage** - حفظ Token في SharedPreferences بدون تشفير
10. **M10: Insufficient Cryptography** - استخدام MD5, Random ضعيف

برومبت جاهز في `arena-pure.js --mode=security`

---

## التكلفة والوقت

**بدون هذا الحل (Strix الأصلي):**
- كل فحص: $3-20 OpenAI API
- أسبوع كامل (50 فحص): $150-1000

**مع Arena.ai Proxy:**
- كل فحص: $0 (Arena.ai مجاني حالياً)
- أسبوع كامل: $0
- الوقت: أبطأ قليلاً (Arena.ai يأخذ 3-5 دقائق لكل قرار vs ثواني لـ OpenAI)

---

## كيف تبدأ؟

```bash
# 1. شغل النظام
docker-compose up -d  # يشمل الآن strix + arena-proxy

# 2. ثبت Strix
pipx install strix-agent
# أو
curl -fsSL https://get.strix.ai | sh

# 3. شغل الـ Proxy (يشتغل تلقائياً عبر n8n)
node scripts/arena-openai-proxy.js &
# يفتح على http://localhost:8080

# 4. جرب Strix مع Arena.ai
export OPENAI_API_KEY=sk-dummy
export OPENAI_BASE_URL=http://localhost:8080/v1
export STRIX_LLM=openai
strix --target /path/to/MyApp --scan-mode quick

# 5. استورد Workflow الجديد
# n8n → Import → workflows/arena-strix-security-team.json
```

الـ Workflow سيعمل لأيام:
Build → Strix Scan via Arena.ai → Fix via Arena.ai → Rebuild → Loop

---

## تحذير مهم

Strix يهاجم التطبيق فعلياً (يجرب SQL Injection حقيقي). لا تشغله على Production. شغله فقط على:
- Emulator محلي
- أو APK في مجلد معزول
- أو Staging environment

n8n Workflow اللي بنيته يشغله فقط على Emulator المحلي، آمن 100%.
