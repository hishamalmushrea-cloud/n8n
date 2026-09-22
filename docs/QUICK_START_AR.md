# دليل البدء السريع - فريق AI مستمر مع n8n + Android Studio + Arena.ai

## 1. المتطلبات
- جهاز كمبيوتر بـ 16GB RAM على الأقل
- Docker Desktop
- Android Studio مثبت + Emulator
- حساب OpenAI / Claude API
- Telegram Bot (اختياري لكن مهم للمراقبة)

## 2. التشغيل في 5 دقائق

```bash
# 1. انسخ الملفات
git clone https://github.com/hishamalmushrea-cloud/n8n.git
cd n8n

# 2. عدل المسارات في docker-compose.yml
# غير ANDROID_PROJECTS_PATH و ANDROID_SDK_PATH حسب جهازك
notepad docker-compose.yml

# 3. شغل النظام
docker-compose up -d

# 4. افتح n8n
http://localhost:5678
User: admin / Pass: admin_password_change_me

# 5. ثبت Community Nodes
Settings → Community Nodes → Install:
- n8n-nodes-puppeteer
- n8n-nodes-browserless

# 6. استورد الـ Workflow
Workflows → Import from File → workflows/continuous-ai-dev-team.json
```

## 3. إعداد Arena.ai بدون API

### الطريقة السريعة (اكتشاف API خفي):
1. افتح Arena.ai في Chrome
2. اضغط F12 → Network Tab
3. شغل مهمة في Agent Mode
4. راقب الطلبات: ستجد POST /api/... 
5. انسخ كـ cURL → حوله لـ HTTP Request Node في n8n
6. انتهى! صار عندك API غير رسمي

### الطريقة المضمونة (Playwright):
```bash
cd scripts
npm init -y
npm install playwright
npx playwright install chromium
npx playwright codegen https://arena.ai
# سجل دخولك مرة واحدة، سيحفظ الجلسة في arena-auth.json
node arena-automation.js "test"
```

## 4. كيف تحدد المدة؟

في Node "Set Project Variables":
- duration_hours = 12 → نصف يوم
- duration_hours = 24 → يوم
- duration_hours = 168 → أسبوع

الـ Workflow سيحسب تلقائياً:
```
elapsed = now - start_time
if elapsed > duration_hours → يوقف ويرسل تقرير نهائي
else → ينتظر 5 دقائق ويكمل
```

## 5. المراقبة عبر Telegram

1. كلم @BotFather في Telegram → /newbot
2. انسخ الـ Token
3. في n8n: Credentials → Telegram API → الصق Token
4. ابدأ محادثة مع البوت وأرسل /start
5. احصل على Chat ID عبر: https://api.telegram.org/bot<TOKEN>/getUpdates
6. الصقه في Telegram Reporter Node

الآن سيصلك تقرير كل دورة + Screenshot للتطبيق!

## 6. نصائح للعمل لأيام

- **Git Auto-Commit:** فعل Git Node بعد كل Build ناجح
- **Token Saver:** استخدم Ollama المحلي للـ Fixer Agent
  - ثبت Ollama: https://ollama.com
  - في n8n: استخدم Ollama Node بدل OpenAI للمهام البسيطة
- **Error Recovery:** أنشئ Workflow ثاني اسمه "Watchdog"
  - Trigger: Cron كل 30 دقيقة
  - يتحقق: هل Workflow الرئيسي متوقف؟ لو نعم → يشغله مرة أخرى
- **Disk Space:** Gradle يستهلك مساحة. أضف Node ينظف /tmp كل 10 دورات

## 7. ماذا لو أردت إيقافه؟

في n8n → Executions → Stop Execution
أو عدل duration_hours إلى 0 وسيتوقف في الدورة القادمة

## 8. التكلفة التقريبية

- نصف يوم (12h, ~70 دورة): $5-15 مع GPT-4o-mini
- يوم كامل (24h): $15-30
- أسبوع (168h): $80-150 لو استخدمت GPT-4 فقط، $15-25 لو استخدمت Ollama للمهام الفرعية

## 9. التطوير القادم

- أضف Node لـ Appium لاختبار UI تلقائياً
- أضف Node لـ Firebase App Distribution لإرسال APK للمختبرين
- أضف Node لـ Play Store API للنشر التلقائي
