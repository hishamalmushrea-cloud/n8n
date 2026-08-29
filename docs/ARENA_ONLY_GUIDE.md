> ⛔ **غير مُوصى به (مؤرشف):** هذه الصفحة تصف فكرة "Arena → OpenAI proxy عبر Playwright"
> التي تُهمَل الآن. البديل المُنفَّذ والمُجرَّب: [`docs/ARENA_BUS_AR.md`](ARENA_BUS_AR.md) — ناقل ملفات
> يجعل Arena Agent Mode هو العقل، بلا استرجاع واجهة موقع ولا مفاتيح API. الملفات القديمة
> (`scripts/arena-openai-proxy.js`, `scripts/arena-automation.js`) باقية للتاريخ فقط.

# نظام يعتمد 100% على Arena.ai Agent Mode فقط - بدون أي ذكاء اصطناعي آخر

## الفكرة الأساسية

**n8n = مجرد عامل ومنسق، ليس ذكاء**
- لا OpenAI
- لا Claude  
- لا Ollama
- كل التفكير والكود والتحليل يأتي من **Arena.ai Agent Mode فقط**

**n8n يفعل 4 أشياء فقط:**
1.  يرسل برومبت إلى Arena.ai عبر متصفح آلي
2.  يحمل الملفات التي أنتجها Arena.ai وينسخها لمجلد Android Studio
3.  يشغل `gradlew assembleDebug` ويقرأ النتيجة
4.  لو فشل → يرسل الخطأ لـ Arena.ai ليصلحه، لو نجح → يطلب تحسين جديد
5.  يكرر حتى تنتهي المدة

---

## كيف يعمل Arena.ai Agent Mode؟

حسب موقع Arena الرسمي:
- Arena.ai Agent Mode هو وكيل مستقل (Autonomous Agent) عنده أدوات: web search, coding, file creation, bash/sandbox
- تعطيه مهمة واحدة متعددة الخطوات وهو يخطط وينفذ وينتج ملفات
- كل جلسة تبقى محفوظة، تقدر تكمل المحادثة بنفس السياق
- هو نفسه يستطيع أن يبني مشروع Android كامل لو أعطيته البرومبت الصحيح

لذلك سنستخدمه كـ **المطور الوحيد** في الفريق.

---

## تصميم البرومبتات - المفتاح كله هنا

بما أننا نعتمد على Arena.ai فقط، جودة البرومبت = جودة المشروع.

### 1. برومبت إنشاء المشروع (Iteration 0)

```
أنت مطور Android خبير Kotlin + Jetpack Compose.

المشروع: [فكرة المستخدم]

المطلوب:
- أنشئ مشروع Android Studio كامل قابل للبناء فوراً
- المسار: app/src/main/java/com/example/app/ + res/layout + AndroidManifest.xml + build.gradle.kts
- استخدم: Kotlin, Jetpack Compose, Material3, Room, MVVM
- لا تشرح، فقط أنشئ الملفات
- في النهاية اضغط Download All كـ ZIP أو اعرض كل ملف مع مساره الكامل

ابدأ الآن. لا تسأل، نفذ.
```

### 2. برومبت إصلاح الخطأ (عند فشل Build)

```
المشروع فشل في البناء. هذا هو الـ Build Log:

[الصق هنا محتوى /tmp/android_logs/build_full.log - آخر 200 سطر]

المطلوب:
1. حلل الخطأ بدقة
2. أصلح الملف/الملفات المسببة فقط
3. اعرض الملفات المصححة كاملة مع المسارات
4. لا تغير باقي المشروع

أصلح الآن.
```

### 3. برومبت التحسين (عند نجاح Build)

```
البناء نجح! المشروع الحالي يعمل.

المطلوب الآن - اختر واحد فقط من هذه التحسينات وطبقه:
- تحسين أداء (Performance)
- تحسين UI/UX
- إضافة Feature صغيرة مفيدة
- تنظيف كود (Refactor)
- إضافة Unit Test

القاعدة: لا تكسر ما يعمل. أضف تحسين واحد فقط في كل مرة.
اعرض الملفات المعدلة فقط.

نفذ التحسين الآن.
```

### 4. برومبت الاختبار

```
المشروع يبني بنجاح. الآن:

1. اكتب 3 Espresso tests للشاشة الرئيسية
2. تأكد أن التطبيق يفتح بدون Crash
3. لو وجدت مشكلة، أصلحها

اعرض ملفات الاختبار مع المسارات.
```

كل هذه البرومبتات يرسلها n8n إلى **نفس جلسة Arena.ai** (نفس الـ conversation) حتى يتذكر المشروع.

---

## كيف يحافظ n8n على نفس جلسة Arena.ai؟

Arena.ai Agent Mode يحفظ المحادثة في URL مثل:
`https://arena.ai/agent/c/abc123-def456`

**الحل في Playwright:**

1.  أول مرة: افتح `https://arena.ai/agent` → أرسل برومبت الإنشاء → احفظ الـ URL النهائي + `storageState` (cookies) في `/tmp/arena_session.json`
2.  المرات القادمة: افتح نفس الـ URL المحفوظ → أرسل رسالة جديدة (Fix أو Improve) في نفس المحادثة → Arena يتذكر كل شيء

هذا موجود في السكريبت الجديد `arena-pure.js`

---

## الهيكل الجديد - n8n بدون أي Node ذكاء اصطناعي

```
[Manual Trigger]
   ↓
[Set Variables: idea, duration_hours=72, project_path, iteration=0, arena_session_url=null]
   ↓
[Execute Command: node arena-pure.js --mode=create --idea="..." --session=/tmp/arena_session.json]
   ↓ (Arena.ai ينتج ملفات)
[Execute Command: bash sync-arena-to-android.sh /tmp/arena_output /home/node/android_projects/MyApp]
   ↓
[Execute Command: bash build-and-test.sh MyApp] → ينتج build.log + screenshot.png
   ↓
[IF Build Success?]
   ├─ No → [Read build.log] → [Execute Command: node arena-pure.js --mode=fix --error="$(cat build.log)" --session=...] → Loop back to Sync
   └─ Yes → [IF Duration Finished? (now - start_time > duration_hours)]
              ├─ Yes → [Telegram: انتهى + ملخص + APK] → Stop
              └─ No → [Wait 5 min] → [Execute Command: node arena-pure.js --mode=improve --session=...] → Loop
```

**لا يوجد أي OpenAI Node. كل شيء Execute Command + IF + Wait + Telegram.**

---

## الملفات الجديدة (Arena Only)

### `scripts/arena-pure.js`
سكريبت واحد يتعامل مع كل الأوضاع:
- `--mode=create` : إنشاء مشروع جديد
- `--mode=fix` : إصلاح خطأ بناء
- `--mode=improve` : تحسين
- `--mode=test` : كتابة اختبارات

يحافظ على نفس الجلسة عبر `arena_session.json`

### `workflows/arena-only-team.json`
Workflow جديد 100% بدون AI Nodes. فقط:
- Manual Trigger
- Set
- Execute Command (3 مرات)
- IF (2 مرات)
- Wait
- Telegram
- Read Binary File (للـ Screenshot)

### `scripts/sync-arena-to-android.sh`
يفك ضغط ZIP من Arena وينسخه لمجلد Android Studio مع الحفاظ على الهيكل

---

## كيف تتحكم في المدة؟

نفس الفكرة السابقة لكن بدون AI:

في Set Node:
```
duration_hours = 12  // نصف يوم
duration_hours = 24  // يوم
duration_hours = 168 // أسبوع
```

في IF Node:
```
{{$now.toMillis() - Date.parse($json.start_time) / 3600000}} > {{$json.duration_hours}}
```

n8n سيستمر في استدعاء Arena.ai كل 5 دقائق حتى تنتهي المدة.

---

## المميزات عندما تعتمد على Arena.ai فقط

1.  **أرخص بـ 100%:** Arena.ai مجاني (حالياً) بينما OpenAI يكلف
2.  **أذكى في المشاريع الكبيرة:** Agent Mode مصمم لبناء مشاريع كاملة، ليس مجرد إكمال كود
3.  **يتذكر السياق:** نفس الجلسة = يتذكر كل الملفات التي أنشأها
4.  **ينتج ملفات جاهزة:** يعطيك ZIP مباشرة، لا تحتاج تحليل JSON
5.  **يتعامل مع الأخطاء بنفسه:** لو أعطيته Build Log، يفهمه ويصلحه لأنه مطور كامل

## العيوب والحلول

**عيب 1: Arena.ai بطيء أحياناً (2-5 دقائق لكل مهمة)**
- الحل: هذا طبيعي، اجعل Wait 5 دقائق بين كل دورة. هو يبني مشروع كامل، ليس مجرد سطر كود.

**عيب 2: لا يوجد API رسمي**
- الحل: السكريبت `arena-pure.js` يستخدم Playwright + حفظ الجلسة. يعمل 100% حتى بدون API.

**عيب 3: الجلسة قد تنتهي**
- الحل: السكريبت يحفظ كل شيء في `/tmp/arena_session.json`. لو انتهت، يبدأ جلسة جديدة ويرسل له ملخص المشروع الحالي (يقرأ كل ملفات Android Studio ويلصقها كـ Context).

---

## مثال دورة كاملة (12 ساعة)

```
الساعة 0:00 - Iteration 1
n8n: "أنشئ تطبيق تذكير ماء" → Arena.ai (5 دقائق) → ينتج 25 ملف → Sync → Build → فشل (Missing Room dependency)

الساعة 0:07 - Iteration 2
n8n: "فشل البناء: Could not find androidx.room..." → Arena.ai (3 دقائق) → يصلح build.gradle → Build → نجح!

الساعة 0:12 - Iteration 3
n8n: "البناء نجح، حسّن الـ UI" → Arena.ai → يضيف Animation → Build → نجح → Screenshot → Telegram

... تتكرر كل 5-7 دقائق ...

الساعة 12:00
n8n: المدة انتهت → يرسل لك على Telegram: "انتهى العمل، 85 Build ناجح، 12 فشل وتم إصلاحه، APK جاهز" + يرفع APK
```

في 12 ساعة، Arena.ai سيعمل حوالي 100-120 دورة تحسين، كأنه مطور يعمل يوم كامل بدون توقف.

---

## كيف تبدأ الآن؟

```bash
docker-compose up -d
# افتح http://localhost:5678
# استورد workflows/arena-only-team.json
# عدل idea و duration_hours
# شغل
```

لا تحتاج مفاتيح OpenAI. فقط حساب Arena.ai (مجاني) وتسجيل دخول مرة واحدة في Playwright.
