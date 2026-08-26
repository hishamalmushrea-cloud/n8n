/**
 * ARENA.AI ONLY ORCHESTRATOR - 100% Arena.ai Agent Mode, No Other AI
 * 
 * هذا السكريبت هو القلب - كل الذكاء من Arena.ai فقط
 * n8n يستدعيه فقط كـ منسق
 * 
 * الاستخدام:
 * node arena-pure.js --mode=create --idea="تطبيق تذكير ماء" --session=/tmp/arena_session.json
 * node arena-pure.js --mode=fix --error="...build log..." --session=/tmp/arena_session.json
 * node arena-pure.js --mode=improve --session=/tmp/arena_session.json
 * node arena-pure.js --mode=test --session=/tmp/arena_session.json
 * 
 * المتطلبات: npm install playwright
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
};

const MODE = getArg('mode') || 'create'; // create, fix, improve, test
const IDEA = getArg('idea') || '';
const ERROR_LOG = getArg('error') || '';
const SESSION_FILE = getArg('session') || '/tmp/arena_session.json';
const OUTPUT_DIR = '/tmp/arena_output';
const AUTH_FILE = './arena-auth.json';

// قوالب البرومبتات - كل الذكاء هنا، لكن التنفيذ من Arena.ai فقط
const PROMPTS = {
  create: (idea) => `
أنت مطور Android خبير محترف. مهمتك بناء مشروع كامل الآن.

المشروع المطلوب:
${idea}

المتطلبات الصارمة:
1. أنشئ مشروع Android Studio كامل وهيكل صحيح:
   - app/build.gradle.kts (أو build.gradle) مع كل dependencies
   - app/src/main/AndroidManifest.xml
   - app/src/main/java/com/example/app/MainActivity.kt
   - app/src/main/java/com/example/app/ui/...
   - app/src/main/res/layout/, values/, etc
   - settings.gradle.kts + build.gradle.kts الرئيسي
   - gradle/wrapper/...

2. التقنيات:
   - Kotlin 100%، لا Java
   - Jetpack Compose + Material3
   - MVVM + ViewModel + StateFlow
   - Room لو يحتاج حفظ بيانات
   - Navigation Compose

3. الكود يجب أن يبني مباشرة بدون أخطاء: ./gradlew assembleDebug يجب أن ينجح

4. في النهاية:
   - اعرض كل ملف مع مساره الكامل مثل: // FILE: app/src/main/java/...
   - ثم اضغط Download أو أنشئ ZIP بكل الملفات

مهم: لا تشرح، لا تسأل، فقط ابنِ المشروع كاملاً الآن. ابدأ فوراً.
`,

  fix: (errorLog) => `
المشروع فشل في البناء. يجب إصلاحه فوراً.

=== BUILD ERROR LOG ===
${errorLog.slice(0, 8000)}
=== END LOG ===

المطلوب:
1. حلل الخطأ بدقة - ما هو الملف المسبب؟ ما هي الـ dependency الناقصة؟
2. أصلح الملف/الملفات فقط
3. اعرض الملفات المصححة كاملة مع المسارات بنفس الصيغة: // FILE: path/to/file
4. لا تغير باقي المشروع إلا إذا كان ضروري
5. تأكد أن الإصلاح سيجعل ./gradlew assembleDebug ينجح

أصلح الآن، لا تشرح كثيراً، فقط اعرض الملفات المصححة.
`,

  improve: () => `
البناء نجح! المشروع يعمل حالياً.

المطلوب: اختر تحسين واحد فقط وطبقه الآن (لا تكسر ما يعمل):

اختر واحد من:
- A) تحسين UI: أضف Animation, تحسين ألوان Material3, تحسين Layout
- B) تحسين أداء: تحسين Recomposition في Compose, استخدام remember, LazyColumn optimization
- C) إضافة Feature صغيرة مفيدة: مثلاً Dark Mode, Settings Screen, Search, Filter
- D) Refactor: تنظيم الكود, فصل Composables, تحسين ViewModel
- E) إضافة حفظ بيانات: تحسين Room, DataStore

القواعد:
- تحسين واحد فقط في كل مرة
- اعرض الملفات المعدلة فقط مع المسارات
- تأكد أن المشروع لا يزال يبني بنجاح بعد التحسين

نفذ تحسين واحد الآن.
`,

  test: () => `
المشروع يبني بنجاح. الآن مهمة الاختبار:

1. اكتب Unit Tests للـ ViewModel
2. اكتب Compose UI Test للشاشة الرئيسية
3. تأكد أن التطبيق لا يعمل Crash عند الفتح

اعرض ملفات الاختبار مع المسارات:
- app/src/test/java/...
- app/src/androidTest/java/...

ثم اقترح كيف نتأكد أن التطبيق يعمل.
`
};

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function loadSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      console.log(`Loaded existing session: ${data.url || 'no url'}`);
      return data;
    }
  } catch (e) {
    console.log('No existing session, will create new one');
  }
  return { url: null, createdAt: null };
}

async function saveSession(url) {
  const data = { url, createdAt: new Date().toISOString(), mode: MODE };
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
  console.log(`Session saved: ${url}`);
}

async function runArena() {
  await ensureDir(OUTPUT_DIR);
  const session = await loadSession();
  
  let prompt = '';
  if (MODE === 'create') prompt = PROMPTS.create(IDEA);
  else if (MODE === 'fix') prompt = PROMPTS.fix(ERROR_LOG);
  else if (MODE === 'improve') prompt = PROMPTS.improve();
  else if (MODE === 'test') prompt = PROMPTS.test();
  else throw new Error(`Unknown mode: ${MODE}`);

  console.log(`\n=== ARENA PURE MODE: ${MODE.toUpperCase()} ===`);
  console.log(`Prompt length: ${prompt.length} chars`);
  console.log(`Session URL: ${session.url || 'NEW SESSION'}\n`);

  const browser = await chromium.launch({
    headless: false, // اجعله true بعد ما تتأكد أنه يعمل
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
    viewport: { width: 1280, height: 900 }
  });

  const page = await context.newPage();

  // اعتراض التحميلات
  let downloadedFiles = [];
  page.on('download', async (download) => {
    const fileName = download.suggestedFilename();
    const filePath = path.join(OUTPUT_DIR, fileName);
    await download.saveAs(filePath);
    downloadedFiles.push(filePath);
    console.log(`Downloaded: ${filePath}`);
  });

  try {
    if (session.url) {
      // أكمل نفس المحادثة
      console.log(`Continuing existing conversation: ${session.url}`);
      await page.goto(session.url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);
    } else {
      // جلسة جديدة
      console.log('Starting new Arena Agent Mode session...');
      await page.goto('https://arena.ai/agent', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);
      
      // احفظ URL الجديد بعد التوجيه
      const currentUrl = page.url();
      if (currentUrl.includes('/agent')) {
        await saveSession(currentUrl);
      }
    }

    // ابحث عن حقل الإدخال - Arena.ai يغير تصميمه، لذلك نجرب عدة محددات
    const inputSelectors = [
      'textarea[placeholder*="Ask"]',
      'textarea[placeholder*="message"]',
      'textarea',
      '[contenteditable="true"]',
      'div[role="textbox"]',
      'input[type="text"]'
    ];

    let inputFound = false;
    for (const selector of inputSelectors) {
      try {
        const locator = page.locator(selector).last();
        if (await locator.count() > 0 && await locator.isVisible({ timeout: 2000 })) {
          console.log(`Found input with selector: ${selector}`);
          await locator.click();
          await locator.fill(prompt);
          inputFound = true;
          break;
        }
      } catch (e) { continue; }
    }

    if (!inputFound) {
      throw new Error('Could not find Arena.ai input field - selectors need update. Please check arena.ai HTML');
    }

    // أرسل
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    
    // جرب زر الإرسال أيضاً
    const sendSelectors = ['button:has-text("Send")', 'button[aria-label="Send"]', 'button:has-text("Run")', '[data-testid="send"]'];
    for (const sel of sendSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.count() > 0 && await btn.isVisible({ timeout: 1000 })) {
          await btn.click();
          break;
        }
      } catch (e) {}
    }

    console.log('Prompt sent, waiting for Arena.ai Agent to complete... This may take 2-5 minutes');

    // انتظر حتى ينتهي الوكيل - نراقب اختفاء مؤشر التحميل أو ظهور Download
    // Arena.ai يعرض خطوات التنفيذ، ننتظر حتى تظهر رسالة نهائية
    let completed = false;
    const maxWaitMinutes = 10;
    const startTime = Date.now();
    
    while (!completed && (Date.now() - startTime) < maxWaitMinutes * 60 * 1000) {
      await page.waitForTimeout(10000); // تحقق كل 10 ثواني
      
      const pageText = await page.locator('body').innerText().catch(() => '');
      
      // علامات انتهاء
      if (pageText.includes('Download') || pageText.includes('completed') || pageText.includes('FILE:')) {
        // انتظر 5 ثواني إضافية للتأكد أنه انتهى فعلاً
        await page.waitForTimeout(5000);
        const newText = await page.locator('body').innerText().catch(() => '');
        if (newText.length > pageText.length - 100) { // لم يتغير كثيراً = انتهى
          completed = true;
        }
      }
      
      // لو ظهر خطأ في الصفحة
      if (pageText.toLowerCase().includes('error') && pageText.toLowerCase().includes('failed')) {
        console.log('Detected possible error in page, but continuing...');
      }
      
      const elapsed = Math.round((Date.now() - startTime)/1000);
      console.log(`... still working (${elapsed}s elapsed)`);
    }

    // اسحب كل النص
    await page.waitForTimeout(2000);
    const fullContent = await page.evaluate(() => document.body.innerText);
    
    // ابحث عن الملفات في النص (التي تبدأ بـ // FILE:)
    const fileMatches = [...fullContent.matchAll(/\/\/ FILE:\s*([^\n]+)\n([\s\S]*?)(?=\/\/ FILE:|$)/g)];
    
    let extractedFiles = [];
    if (fileMatches.length > 0) {
      console.log(`Found ${fileMatches.length} files in text output`);
      for (const match of fileMatches) {
        const filePath = match[1].trim();
        const fileContent = match[2].trim();
        const fullPath = path.join(OUTPUT_DIR, filePath);
        await ensureDir(path.dirname(fullPath));
        fs.writeFileSync(fullPath, fileContent);
        extractedFiles.push(fullPath);
      }
    }

    // جرب تحميل الملفات لو فيه زر Download
    try {
      const downloadBtn = page.locator('a:has-text("Download"), button:has-text("Download"), a[download]').first();
      if (await downloadBtn.count() > 0) {
        console.log('Found Download button, clicking...');
        await downloadBtn.click();
        await page.waitForTimeout(5000); // انتظر التحميل
      }
    } catch (e) {}

    // احفظ النتيجة النهائية
    const result = {
      mode: MODE,
      success: true,
      sessionUrl: page.url(),
      textLength: fullContent.length,
      extractedFiles: extractedFiles,
      downloadedFiles: downloadedFiles,
      outputDir: OUTPUT_DIR,
      timestamp: new Date().toISOString(),
      fullText: fullContent.slice(0, 50000) // أول 50k حرف
    };

    fs.writeFileSync('/tmp/arena_output.json', JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'full_response.txt'), fullContent);

    // حدث الـ session URL لو تغير
    await saveSession(page.url());
    await context.storageState({ path: AUTH_FILE });

    console.log(`\n=== ARENA DONE ===`);
    console.log(`Extracted files: ${extractedFiles.length}`);
    console.log(`Downloaded files: ${downloadedFiles.length}`);
    console.log(`Output dir: ${OUTPUT_DIR}`);
    console.log(JSON.stringify(result, null, 2));

    await browser.close();
    return result;

  } catch (err) {
    console.error('Arena automation failed:', err);
    await page.screenshot({ path: '/tmp/arena_error.png' }).catch(()=>{});
    fs.writeFileSync('/tmp/arena_output.json', JSON.stringify({ success: false, error: err.message, mode: MODE }, null, 2));
    await browser.close();
    throw err;
  }
}

runArena().catch(err => {
  console.error(err);
  process.exit(1);
});
