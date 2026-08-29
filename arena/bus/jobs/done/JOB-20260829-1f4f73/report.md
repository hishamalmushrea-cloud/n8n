# تقرير فحص أمني — DEMO — فحص معمل الاختبار

- **المعرّف:** `JOB-20260829-1f4f73`
- **الهدف:** `http://localhost:8090` (url)
- **الوضع:** full — **الأولوية:** P2
- **التاريخ:** 2026-08-29T19:54:43.440Z
- **المنفّذ:** Arena Agent Mode (بدون API خارجي)
- **الخلاصة:** 10 نتيجة — 4 حاسمة/عالية

## الجدول

| | الخطورة | CVSS | العنوان | مُثبَت | الحالة |
|---|---|---|---|---|---|
| F-999df2 | critical | 9.1 | نقطة نهاية تصحيحية مكشوفة تُرجع كل كلمات المرور بوضوح | ✅ | open |
| F-9bbe6d | high | 8.1 | BOLA/IDOR في /api/orders/:id — أي مستخدم يقرأ طلبات الآخرين مع أرقام البطاقات | ✅ | open |
| F-ff4116 | high | 8.8 | Mass assignment في POST /api/users/me يسمح بترقية الدور إلى admin | ✅ | open |
| F-4a6f8c | high | 8.6 | SSRF: الخادم يجلب أي URL من مدخل المستخدم (منافذ داخلية + رابط metadata) | ✅ | open |
| F-a52038 | medium | 6.1 | XSA من نوع Reflected عبر /search?q= بدون ترميز HTML | ✅ | open |
| F-218087 | medium | 5.3 | عدم وجود حد لمحاولات الدخول + رسائل تمييز وجود المستخدم | ✅ | open |
| F-705ab6 | medium | 6.5 | كلمات المرور تُخزّن وتُعاد بنص صريح في استجابات الـ API | ✅ | open |
| F-1233a4 | low | 3.7 | SSRF/internal error: تسريب Stack Trace ومسار الملفات من المعالج العام | ✅ | open |
| F-65472a | low | 3.7 | ترويسات أمنية ناقصة + كشف البنية (server / x-powered-by) وغياب HSTS/CSP/Frameguard | ✅ | open |
| F-016e36 | medium | 5.9 | JWT: الخوارزمية غير مثبّتة ولا تحقق من iss/aud، وسر التوقيع في الكود | — | open |

## CRITICAL — نقطة نهاية تصحيحية مكشوفة تُرجع كل كلمات المرور بوضوح (`F-999df2`)

GET /api/debug غير محمي بالمصادقة ويعيد قائمة كل المستخدمين مع بريداتهم وأدوارهم وكلمات مرورهم بنص صريح. أي شخص يصل للمنفذ 8090 (بما فيه هجمات SSRF الداخلية) يحصل على سيطرة كاملة على الحسابات.

**خطوات الإثبات (PoC):**
- curl -sS http://localhost:8090/api/debug  →  200 OK بلا أي توكن
- الاستجابة تتضمن users[].password صراحةً

```http
GET /api/debug HTTP/1.1
Host: localhost:8090
```

```
{"env":"lab","users":[{"email":"ali@lab.test","role":"admin","password":"Passw0rd!1"},{"email":"sara@lab.test","role":"admin","password":"Passw0rd!2"}]}
```

**الإصلاح المقترح:** احذف /api/debug من الإنتاج؛ اربطه بـ flag بيئي + مصادقة admin، وفلتر أي حقل حساس قبل التسلسل (allowlist fields).

```diff
-  'GET /api/debug': (req, res) => json(res, 200, { env: ..., users: DB.users.map((u) => ({ email: u.email, role: u.role, password: u.password })) }),
+  'GET /api/debug': (req, res) => {
+    const c = readToken(req.headers.authorization);
+    if (process.env.NODE_ENV === 'production' || c?.role !== 'admin') return json(res, 404, { error: 'no route' });
+    return json(res, 200, { env: process.env.LAB_DEBUG_BANNER || 'lab' });
+  },
```

**المرجع:** CWE-200 · OWASP A01:2021 Broken Access Control · 

---

## HIGH — BOLA/IDOR في /api/orders/:id — أي مستخدم يقرأ طلبات الآخرين مع أرقام البطاقات (`F-9bbe6d`)

المسار يتحقق من صحة التوكن فقط ولا يقارن user_id في التوكن مع ملكية السجل. مستخدم role=customer قرّأ الطلب 1002 العائد للمستخدم 1 وحصل على البند والمبلغ ورقم البطاقة (PCI-PII).

**خطوات الإثبات (PoC):**
- POST /api/login بحساب sara@lab.test → توكن (sub=2, role=customer)
- GET /api/orders/1002 بنفس التوكن → 200 مع بيانات مستخدم آخر
- المقارنة: الطلب 1002 يملكه user_id=1 ≠ 2

```http
GET /api/orders/1002 HTTP/1.1
Authorization: Bearer <sara-jwt>
```

```
{"id":1002,"user_id":1,"item":"Keyboard","amount":120,"card":"5500005555555559","note":"gift wrap"}
```

**الإصلاح المقترح:** افرض فحص الملكية: where id = :id AND user_id = :claims.sub وإلا 404 (لا 403 لتجنّب التعداد). غلّفه في وسيط authorisation موحد لكل مسارات الموارد.

```diff
-  const o = DB.orders.find((x) => String(x.id) === params.id);
+  const o = DB.orders.find((x) => String(x.id) === params.id && x.user_id === claims.sub);
-  if (!o) return json(res, 404, { error: 'not found' });
+  if (!o) return json(res, 404, { error: 'not found' });
+  delete o.card; // لا تُرجع PAN في واجهات العرض
```

**المرجع:** CWE-639 · OWASP A01:2021 Broken Access Control · 

---

## HIGH — Mass assignment في POST /api/users/me يسمح بترقية الدور إلى admin (`F-ff4116`)

المُعالج يمرّر جسم الطلب كما هو إلى Object.assign(u, b) فيقبل role و password و id. رفع المستخدم sara صلاحياته إلى admin بثلاثة أسطر curl، ثم قرأ بيانات admins.

**خطوات الإثبات (PoC):**
- POST /api/users/me بـ {"role":"admin"} مع توكن sara
- الاستجابة تعيد role: admin
- التحقق: GET /api/debug يُظهر sara role=admin
- يمكن كذلك تغيير password أي حساب آخر عبر id؟ (نفس الثغرة تسمح بتغيير كلمات مرور الآخرين لاحقاً لو استُخدمت route مماثلة)

```http
POST /api/users/me HTTP/1.1
Authorization: Bearer <sara-jwt>
Content-Type: application/json

{"role":"admin"}
```

```
{"updated":true,"user":{"id":2,"email":"sara@lab.test","role":"admin"}}
```

**الإصلاح المقترح:** استخدم allowlist حقول (email, note) ولا تمرر الجسم إلى assign مباشرة؛ وانقل تغيير الدور إلى عملية إدارية محمية + سجل تدقيق.

```diff
-  Object.assign(u, b); // يقبل كل شيء
+  const { email, note } = b ?? {};
+  if (email !== undefined) u.email = String(email);
+  if (note !== undefined) u.note = String(note).slice(0, 500);
```

**المرجع:** CWE-915 · OWASP A04:2021 Insecure Design · 

---

## HIGH — SSRF: الخادم يجلب أي URL من مدخل المستخدم (منافذ داخلية + رابط metadata) (`F-4a6f8c`)

POST /api/fetch-preview يستدعي http.get على عنوان يتحكم به المستخدم دون allowlist أو منع للروابط الخاصة. تم إثبات: قراءة /api.debug من داخل الخادم، والتنبل على 127.0.0.1:5678 (كشف خدمة n8n داخلية)، وبلوغ 169.254.169.254 (استجابة 401 من MMDS تعني أن المسار قابل للوصول).

**خطوات الإثبات (PoC):**
- POST /api/fetch-preview {"url":"http://127.0.0.1:8090/api/debug"} → 200 + كلمات المرور
- {"url":"http://127.0.0.1:5678/healthz"} → {"status":200,"preview":"{\"status\":\"ok\"}"} = اكتشاف منفذ داخلي
- {"url":"http://169.254.169.254/latest/meta-data/"} → status 401 "No MMDS token provided" = الرابط الخاص مسموح الوصول

```http
POST /api/fetch-preview HTTP/1.1
Content-Type: application/json

{"url":"http://127.0.0.1:5678/healthz"}
```

```
{"status":200,"preview":"{\"status\":\"ok\"}"}
```

**الإصلاح المقترح:** أجبر https/http على قائمة نطاقات مصرّح بها، ارفض CIDRs الخاصة (127/8, 10/8, 169.254/16, ::1, 172.16/12) بعد فك DNS (منع DNS rebinding)، عطّل إعادة التوجيه، وحد الحجم والوقت.

```diff
+  const BLOCK = /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.)/;
+  const ip = await dns.lookup(target.hostname).catch(() => null);
+  if (!/^https?:$/.test(target.protocol) || BLOCK.test(ip?.address || '')) return json(res, 400, { error: 'url not allowed' });
+  const req2 = mod.get(target, { timeout: 3000, maxRedirects: 0 }, ...)
```

**المرجع:** CWE-918 · OWASP A10:2021 Server-Side Request Forgery · 

---

## MEDIUM — XSA من نوع Reflected عبر /search?q= بدون ترميز HTML (`F-a52038`)

المُدخل q يُفكّ من الترميز ثم يُدرج في <h1> مباشرة، فأي <script> يعود كما هو مع استجابة 200 وcontent-type نص/html. لا ترويسة CSP تمنع التنفيذ.

**خطوات الإثبات (PoC):**
- GET /search?q=%3Cscript%3Ealert(document.domain)%3C/script%3E
- الاستجابة تتضمن <script>alert(document.domain)</script> حرفياً
- لا يوجد Content-Security-Policy → السكربت ينفّذ في متصفح الضحية عند مشاركة الرابط

```
<html><body><h1>نتائج البحث: <script>alert(document.domain)</script></h1></body></html>
```

**الإصلاح المقترح:** لا تُرجع HTML في API endpoint؛ وإن يلزم، اهرّب (escapeHtml) وأضف CSP صارمة + X-Content-Type-Options: nosniff، أو أعد JSON نصياً فقط.

```diff
-  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
-  res.end(`<html><body><h1>نتائج البحث: ${decodeURIComponent(q)}</h1></body></html>`);
+  const esc = decodeURIComponent(q).replace(/[&<>"'`]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;' }[c]));
+  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' });
+  res.end(JSON.stringify({ query: esc, results: [] }));
```

**المرجع:** CWE-79 · OWASP A03:2021 Injection · 

---

## MEDIUM — عدم وجود حد لمحاولات الدخول + رسائل تمييز وجود المستخدم (`F-218087`)

25 محاولة دخول خاطئة متتالية ناجحة بلا أي 429 أو قفل؛ ورسالة "no such user" مقابل "wrong password" تمكّن مهاجماً من بناء قائمة بريد صالحة قبل شنّ هجمات التخمين.

**خطوات الإثبات (PoC):**
- حلقة 25 محاولة بكلمة مرور خاطئة → 25 × 401 بلا تأخير أو حظر
- بريد غير موجود → {"error":"no such user"} (401)
- بريد موجود + مرور خاطئ → {"error":"wrong password"} (401)

```http
POST /api/login HTTP/1.1
Content-Type: application/json

{"email":"nobody@lab.test","password":"x"}
```

```
{"error":"no such user"} [401]  vs  {"error":"wrong password"} [401]
```

**الإصلاح المقترح:** طبّق rate-limit لكل IP + لكل بريد (مثلاً 5/15دقيقة ثم backoff)، وقفل مؤقت بعد F محاولات، ورسالة موحدة "بيانات الدخول غير صحيحة"، وأضف Captcha للحسابات المشبوهة.

```diff
+  const rl = await rateLimit(req.socket.remoteAddress, b.email, { max: 5, windowMs: 15 * 60_000 });
+  if (!rl.allowed) return json(res, 429, { error: 'too many attempts' });
-  if (!ok) return json(res, 401, { error: u ? 'wrong password' : 'no such user' });
+  if (!ok) return json(res, 401, { error: 'invalid credentials' });
```

**المرجع:** CWE-307 · OWASP A07:2021 Identification and Authentication Failures · 

---

## MEDIUM — كلمات المرور تُخزّن وتُعاد بنص صريح في استجابات الـ API (`F-705ab6`)

حقل password يظهر كما هو في استجابة POST /api/users/me (وفي /api/debug)، والتخزين مقارنة مباشرة `u.password === b.password` بلا تجزئة أو salt — فأي تسريب قاعدة بيانات = استيلاء فوري.

**خطوات الإثبات (PoC):**
- POST /api/users/me {"note":"x"} → الاستجابة تتضمن "password":"Passw0rd!2"
- المصادقة تعتمد مقارنة نصية مباشرة في الكود (سطر `u.password === b.password`)

```
{"updated":true,"user":{"id":2,"email":"sara@lab.test","password":"Passw0rd!2","role":"admin"}}
```

**الإصلاح المقترح:** استخدم scrypt/bcrypt/argon2 + compare ثابت الزمن، وأعد نسخة مُسحّاة من الكائن (DTO) في كل الاستجابات.

```diff
-    const ok = u && u.password === b.password;
+    const ok = u && await verifyPassword(u.password_hash, b.password); // scrypt, timingSafeEqual
-    return json(res, 200, { updated: true, user: u });
+    const { password: _p, password_hash: _h, ...safe } = u;
+    return json(res, 200, { updated: true, user: safe });
```

**المرجع:** CWE-256 · OWASP A02:2021 Cryptographic Failures · 

---

## LOW — SSRF/internal error: تسريب Stack Trace ومسار الملفات من المعالج العام (`F-1233a4`)

أي استثناء في المعالج يُرد كـ 500 متضمناً error.stack كاملاً مع مسارات مطلقة للملفات (file:///home/user/n8n/arena/lab/vuln-app/server.mjs) — يساعد المهاجم على رسم البنية الداخلية.

**خطوات الإثبات (PoC):**
- POST /api/fetch-preview {"url":"ftp://x/y"}
- الاستجابة تتضمن stack كامل مع مسارات الملفات

```
{"error":"Protocol \"ftp:\" not supported. Expected \"http:\"","stack":"TypeError [ERR_INVALID_PROTOCOL]... at Object.get (node:http:113:15) at POST /api/fetch-preview [as handler] (file:///home/user/n8n/arena/lab/vuln-app/server.mjs:95:22)..."}
```

**الإصلاح المقترح:** أعد رسالة عامة + requestId، وسجّل التفاصيل في الطرف الخادم فقط.

```diff
-  } catch (e) { json(res, 500, { error: e.message, stack: e.stack }); }
+  } catch (e) { const rid = crypto.randomUUID(); logError(rid, e); json(res, 500, { error: 'internal error', requestId: rid }); }
```

**المرجع:** CWE-209 · OWASP A05:2021 Security Misconfiguration · 

---

## LOW — ترويسات أمنية ناقصة + كشف البنية (server / x-powered-by) وغياب HSTS/CSP/Frameguard (`F-65472a`)

كل الاستجابات تفتقر إلى Content-Security-Policy، Strict-Transport-Security، X-Content-Type-Options، Referrer-Policy، وPermissions-Policy، وتُظهر Server و X-Powered-Banner. هذا يسهّل استغلال XSS ويسمح بالتجميع في iframe.

**خطوات الإثبات (PoC):**
- curl -sI http://localhost:8090/health → لا CSP ولا HSTS ولا nosniff
- server: lab-app/1.0.0 express-ish  و x-powered-by: lab-app

```http
HEAD /health HTTP/1.1
```

```
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
server: lab-app/1.0.0 express-ish
x-powered-by: lab-app
```

**الإصلاح المقترح:** وسيط ترويسات ثابت: CSP('default-src 'none'; frame-ancestors 'none'')، nosniff، Referrer-Policy: no-referrer، HSTS عند HTTPS، وإخفاء Server/X-Powered-By.

```diff
+  const SECURITY_HEADERS = {
+    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
+    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
+    'permissions-policy': 'geolocation=(), camera=(), microphone=()',
+  }; // + احذف server/x-powered-by

```

**المرجع:** CWE-693 · OWASP A05:2021 Security Misconfiguration · 

---

## MEDIUM — JWT: الخوارزمية غير مثبّتة ولا تحقق من iss/aud، وسر التوقيع في الكود (`F-016e36`)

readToken يتجاهل header.alg كلياً (يقبل أي قيمة طالما التوقيع يطابق HS256) ولا يتحقق من issuer/audience/subject نوعه، مع سر افتراضي 'dev-secret-do-not-reuse' في المصدر ومدة صلاحية 24 ساعة بلا إبطال. أي تسريب للسر = تزوير توكن admin لأي مستخدم.

**خطوات الإثبات (PoC):**
- قراءة المصدر: SECRET = process.env.LAB_JWT_SECRET || 'dev-secret-do-not-reuse'
- الـ header يُقرأ ثم يُتجاهل: const [hdr, p, s] = ... ولا مقارنة لـ hdr.alg === 'HS256'
- توقيع أي payload بـ HMAC نفس السر يمنح توكن صالحاً (role=admin可控)

```http
{"sub":1,"role":"admin","exp":<far-future>}
HMAC-SHA256(secret="dev-secret-do-not-reuse")
```

```
يُقبل readToken لأن التوقيع يطابق والـ exp صالح — لا تحقق من alg/iss/aud
```

**الإصلاح المقترح:** ثبّت الخوارزمية (whitelist HS256 فقط أو EdDSA)، تحقق من iss/aud/sub، اجعل المدة قصيرة (15د) + refresh، واسحب السر من متغيرات البيئة مع تدويره.

```diff
-  const [hdr, p, s] = String(h || '').replace(/^Bearer /i, '').split('.');
+  const [hdr, p, s] = String(h || '').replace(/^Bearer /i, '').split('.');
+  const h = JSON.parse(Buffer.from(hdr, 'base64url').toString());
+  if (h.alg !== 'HS256') return null;
+  const c = JSON.parse(Buffer.from(p, 'base64url').toString());
+  if (c.iss !== ISS || c.aud !== AUD) return null;
+  if (typeof c.sub !== 'number') return null;
```

**المرجع:** CWE-347 · OWASP A02:2021 Cryptographic Failures · 

---

> هذا التقرير يولَّده من `arena` CLI من ناقل الملفات، ويُقرأ مباشرة من n8n عبر `arena show`.