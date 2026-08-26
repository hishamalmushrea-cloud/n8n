/**
 * ARENA.AI ONLY FACTORY - Full Factory with 7 Stages
 * 100% Arena.ai Agent Mode, No Other AI, No APIs
 * 
 * Modes:
 * create, fix, improve, test,
 * security, fix-security,
 * playstore, fix-playstore,
 * ui-review,
 * performance,
 * publish-listing
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
};

const MODE = getArg('mode') || 'create';
const IDEA = getArg('idea') || '';
const ERROR_LOG = getArg('error') || '';
const SESSION_FILE = getArg('session') || '/tmp/arena_session.json';
const OUTPUT_DIR = '/tmp/arena_output';
const AUTH_FILE = path.join(__dirname, 'arena-auth.json');
const PROJECT_PATH = getArg('project') || '';
const SCREENSHOT_PATH = getArg('screenshot') || '/tmp/arena_screenshots/latest.png';

const PROMPTS = {
  create: (idea) => `
أنت مطور Android خبير محترف. مهمتك بناء مشروع كامل الآن.

المشروع المطلوب:
${idea}

المتطلبات الصارمة:
1. أنشئ مشروع Android Studio كامل وهيكل صحيح:
   - app/build.gradle.kts مع كل dependencies
   - app/src/main/AndroidManifest.xml
   - app/src/main/java/com/example/app/MainActivity.kt
   - app/src/main/java/com/example/app/ui/...
   - app/src/main/res/values/ + layout/
   - settings.gradle.kts + build.gradle.kts الرئيسي

2. التقنيات: Kotlin 100% + Jetpack Compose + Material3 + MVVM + ViewModel + StateFlow + Room لو يحتاج

3. الكود يجب أن يبني مباشرة: ./gradlew assembleDebug يجب أن ينجح

4. اعرض كل ملف مع مساره: // FILE: app/src/main/java/...
ابدأ الآن.
`,

  fix: (errorLog) => `
المشروع فشل في البناء. يجب إصلاحه فوراً.

=== BUILD ERROR LOG ===
${errorLog.slice(0, 8000)}
=== END LOG ===

المطلوب:
1. حلل الخطأ بدقة
2. أصلح الملف/الملفات فقط
3. اعرض الملفات المصححة: // FILE: path
أصلح الآن.
`,

  improve: () => `
البناء نجح! المشروع يعمل.

اختر تحسين واحد فقط وطبقه (لا تكسر ما يعمل):
- A) تحسين UI: Animation, Material3
- B) أداء: Recomposition, remember, LazyColumn
- C) Feature صغيرة: Dark Mode, Settings, Search
- D) Refactor
- E) Room/DataStore

اعرض الملفات المعدلة فقط.
نفذ تحسين واحد الآن.
`,

  test: () => `
المشروع يبني بنجاح. اكتب Unit Tests + Compose UI Tests.
اعرض ملفات الاختبار مع المسارات.
`,

  security: (projectPath) => `
أنت Strix - خبير اختبار اختراق Android. افحص أمنياً شامل:

المشروع: ${projectPath}

افحص OWASP Mobile Top 10:
M1 Hardcoded Secrets, M2 Supply Chain, M3 Auth, M4 Input Validation, 
M5 Insecure Communication, M6 Privacy, M7 Binary, M8 Misconfig, M9 Insecure Storage, M10 Crypto

لكل ثغرة: الملف، السطر، النوع، الخطورة، PoC، fix
أنتج JSON: { vulnerabilities: [{id, type, owasp, severity, file, line, description, poc, fix}] }
واعرض الملفات المصححة: // FILE: path

ابدأ الفحص الأمني الآن.
`,

  fixSecurity: (vulnReport) => `
Strix وجد هذه الثغرات:

=== VULNERABILITIES ===
${vulnReport.slice(0, 10000)}
=== END ===

أصلح كل ثغرة:
- API Keys → BuildConfig
- SharedPreferences → EncryptedSharedPreferences
- HTTP → HTTPS
- Log.d حساس → احذف
- Debuggable true → false
اعرض الملفات المصححة: // FILE: path
أصلح الآن.
`,

  playstore: (projectPath) => `
أنت خبير Google Play Policy 2024-2025. راجع هذا المشروع Android هل سيُرفض؟

المشروع: ${projectPath}
افحص:

1. Permissions الخطيرة:
   - READ_SMS, SEND_SMS, CALL_LOG, MANAGE_EXTERNAL_STORAGE, ACCESS_BACKGROUND_LOCATION
   - هل كل Permission ضروري؟ ما البديل؟

2. Target SDK: يجب 34+

3. Data Safety: هل يجمع بيانات؟

4. Hardcoded: debuggable true, allowBackup true مع بيانات حساسة

5. Content: كلمات محظورة، WebView بدون Privacy Policy

المطلوب:
- تقرير: { policy_issues: [{type, permission, severity: high/medium, reason, fix, alternative}] }
- هل سيُرفض؟ نعم/لا ولماذا
- اعرض AndroidManifest.xml المصحح: // FILE: app/src/main/AndroidManifest.xml

افحص بمعايير Play Store الحالية.
`,

  fixPlaystore: (report) => `
تقرير Play Store Policy وجد مشاكل:

=== POLICY REPORT ===
${report.slice(0, 8000)}
=== END ===

أصلح كل مشكلة:
- أزل Permissions غير ضرورية
- استخدم MediaStore بدل MANAGE_EXTERNAL_STORAGE
- حدث targetSdk لـ 34
- أصلح Manifest

اعرض الملفات المصححة: // FILE: path
`,

  uiReview: () => `
أنت Senior UI/UX Designer + Google Material3 Expert. لديك Screenshot للتطبيق (سأرفعه).

حلل كـ Google Design Reviewer:

1. قيم التصميم من 10
2. المشاكل: تباين ألوان، مسافات، Typography، Material3 compliance، Accessibility
3. اقترح تحسين واحد فقط وطبقه (Animation, Colors, Layout, etc)
4. اعرض الملفات المعدلة: // FILE: path

ملاحظة: إذا لم تصلك الصورة، حلل الكود الحالي في app/src/main/java/com/example/app/ui/ واقترح تحسين Material3.

نفذ تحسين UI واحد الآن.
`,

  performance: () => `
أنت خبير أداء Android.

بيانات الأداء:
- Build time, APK size, RAM, Logcat (سأرسلها)

حسّن:
- APK size: استخدم R8, أزل مكتبات غير مستخدمة
- Recomposition: استخدم remember, derivedStateOf, LazyColumn keys
- Memory: تجنب Leaks
- Jank: Skipped frames

اعرض الملفات المحسنة: // FILE: path
حسّن الأداء الآن.
`,

  publishListing: (idea) => `
المشروع جاهز للنشر في Play Store.

المشروع: ${idea}

اكتب Store Listing احترافي:

1. App Title (30 حرف)
2. Short Description (80 حرف)
3. Full Description (4000 حرف) مع Keywords
4. Keywords للـ ASO
5. What's New (أول إصدار)
6. Privacy Policy نص قصير
7. Data Safety: ما البيانات التي تجمعها؟

بـ 3 لغات: عربي، إنجليزي، فرنسي

أنتج JSON:
{
  "title": {...},
  "short_desc": {...},
  "full_desc": {...},
  "keywords": [...],
  "privacy_policy": "...",
  "data_safety": {...}
}

اكتب الآن.
`
};

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function loadSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      return data;
    }
  } catch (e) {}
  return { url: null };
}

async function saveSession(url) {
  const data = { url, createdAt: new Date().toISOString(), mode: MODE };
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
}

async function runArena() {
  await ensureDir(OUTPUT_DIR);
  await ensureDir('/tmp/strix_results');
  await ensureDir('/tmp/arena_screenshots');
  const session = await loadSession();
  
  let prompt = '';
  if (MODE === 'create') prompt = PROMPTS.create(IDEA);
  else if (MODE === 'fix') prompt = PROMPTS.fix(ERROR_LOG);
  else if (MODE === 'improve') prompt = PROMPTS.improve();
  else if (MODE === 'test') prompt = PROMPTS.test();
  else if (MODE === 'security') prompt = PROMPTS.security(PROJECT_PATH || IDEA);
  else if (MODE === 'fix-security') prompt = PROMPTS.fixSecurity(ERROR_LOG);
  else if (MODE === 'playstore') prompt = PROMPTS.playstore(PROJECT_PATH || IDEA);
  else if (MODE === 'fix-playstore') prompt = PROMPTS.fixPlaystore(ERROR_LOG);
  else if (MODE === 'ui-review') prompt = PROMPTS.uiReview();
  else if (MODE === 'performance') prompt = PROMPTS.performance();
  else if (MODE === 'publish-listing') prompt = PROMPTS.publishListing(IDEA);
  else throw new Error(`Unknown mode: ${MODE}`);

  console.log(`\n=== ARENA FACTORY MODE: ${MODE.toUpperCase()} ===`);
  console.log(`Session: ${session.url || 'NEW'}`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
    viewport: { width: 1280, height: 900 }
  });

  const page = await context.newPage();

  let downloadedFiles = [];
  page.on('download', async (download) => {
    const fileName = download.suggestedFilename();
    const filePath = path.join(OUTPUT_DIR, fileName);
    await download.saveAs(filePath);
    downloadedFiles.push(filePath);
  });

  try {
    if (session.url) {
      console.log(`Continuing: ${session.url}`);
      await page.goto(session.url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);
    } else {
      console.log('New Arena session...');
      await page.goto('https://arena.ai/agent', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);
      await saveSession(page.url());
    }

    // رفع Screenshot لو وضع ui-review
    if (MODE === 'ui-review' && fs.existsSync(SCREENSHOT_PATH)) {
      try {
        console.log(`Uploading screenshot: ${SCREENSHOT_PATH}`);
        const fileInput = page.locator('input[type="file"]').first();
        if (await fileInput.count() > 0) {
          await fileInput.setInputFiles(SCREENSHOT_PATH);
          await page.waitForTimeout(2000);
        }
      } catch (e) {
        console.log('Could not upload screenshot, continuing with code review');
      }
    }

    const inputSelectors = ['textarea[placeholder*="Ask"]', 'textarea', '[contenteditable="true"]', 'div[role="textbox"]'];
    let inputFound = false;
    for (const selector of inputSelectors) {
      try {
        const locator = page.locator(selector).last();
        if (await locator.count() > 0 && await locator.isVisible({ timeout: 2000 })) {
          await locator.click();
          await locator.fill(prompt);
          inputFound = true;
          break;
        }
      } catch (e) { continue; }
    }

    if (!inputFound) throw new Error('Input not found');

    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    
    for (const sel of ['button:has-text("Send")', 'button[aria-label="Send"]', 'button:has-text("Run")']) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.count() > 0 && await btn.isVisible({ timeout: 1000 })) {
          await btn.click();
          break;
        }
      } catch (e) {}
    }

    console.log('Waiting for Arena...');

    let completed = false;
    const maxWait = (MODE === 'security' || MODE === 'playstore') ? 15 : 10;
    const startTime = Date.now();
    
    while (!completed && (Date.now() - startTime) < maxWait * 60 * 1000) {
      await page.waitForTimeout(10000);
      const pageText = await page.locator('body').innerText().catch(() => '');
      if (pageText.includes('Download') || pageText.includes('FILE:') || pageText.includes('vulnerabilities') || pageText.includes('policy_issues')) {
        await page.waitForTimeout(5000);
        const newText = await page.locator('body').innerText().catch(() => '');
        if (newText.length > pageText.length - 100) {
          completed = false;
        } else {
          completed = true;
        }
      }
      console.log(`... working ${Math.round((Date.now()-startTime)/1000)}s`);
    }

    await page.waitForTimeout(2000);
    const fullContent = await page.evaluate(() => document.body.innerText);
    
    const fileMatches = [...fullContent.matchAll(/\/\/ FILE:\s*([^\n]+)\n([\s\S]*?)(?=\/\/ FILE:|$)/g)];
    let extractedFiles = [];
    if (fileMatches.length > 0) {
      for (const match of fileMatches) {
        const filePath = match[1].trim();
        const fileContent = match[2].trim();
        const fullPath = path.join(OUTPUT_DIR, filePath);
        await ensureDir(path.dirname(fullPath));
        fs.writeFileSync(fullPath, fileContent);
        extractedFiles.push(fullPath);
      }
    }

    try {
      const downloadBtn = page.locator('a:has-text("Download"), button:has-text("Download"), a[download]').first();
      if (await downloadBtn.count() > 0) {
        await downloadBtn.click();
        await page.waitForTimeout(5000);
      }
    } catch (e) {}

    const result = {
      mode: MODE,
      success: true,
      sessionUrl: page.url(),
      textLength: fullContent.length,
      extractedFiles,
      downloadedFiles,
      outputDir: OUTPUT_DIR,
      timestamp: new Date().toISOString(),
      fullText: fullContent.slice(0, 50000)
    };

    fs.writeFileSync('/tmp/arena_output.json', JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'full_response.txt'), fullContent);

    if (MODE.includes('security')) {
      fs.writeFileSync('/tmp/strix_results/vulnerabilities.json', JSON.stringify(result, null, 2));
    }
    if (MODE.includes('playstore')) {
      fs.writeFileSync('/tmp/playstore_report.json', JSON.stringify(result, null, 2));
    }

    await saveSession(page.url());
    await context.storageState({ path: AUTH_FILE });

    console.log(`\n=== ARENA DONE ${MODE} - Files: ${extractedFiles.length} ===`);
    await browser.close();
    return result;

  } catch (err) {
    console.error('Failed:', err);
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
