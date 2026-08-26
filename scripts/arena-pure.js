/**
 * ARENA.AI ONLY ORCHESTRATOR - 100% Arena.ai Agent Mode, No Other AI
 * Updated to support Strix Security Mode
 * 
 * Modes:
 * --mode=create    إنشاء مشروع Android
 * --mode=fix       إصلاح خطأ Build
 * --mode=improve   تحسين
 * --mode=test      كتابة اختبارات
 * --mode=security  فحص أمني بمعايير OWASP Mobile Top 10 (Strix-like)
 * --mode=fix-security إصلاح ثغرات أمنية
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
   - app/src/main/res/layout/, values/
   - settings.gradle.kts + build.gradle.kts الرئيسي
   - gradle/wrapper/...

2. التقنيات: Kotlin 100% + Jetpack Compose + Material3 + MVVM + ViewModel + StateFlow + Room لو يحتاج

3. الكود يجب أن يبني مباشرة: ./gradlew assembleDebug يجب أن ينجح

4. في النهاية اعرض كل ملف مع مساره: // FILE: app/src/main/java/...
ثم اضغط Download أو أنشئ ZIP

مهم: لا تشرح، فقط ابنِ المشروع كاملاً الآن.
`,

  fix: (errorLog) => `
المشروع فشل في البناء. يجب إصلاحه فوراً.

=== BUILD ERROR LOG ===
${errorLog.slice(0, 8000)}
=== END LOG ===

المطلوب:
1. حلل الخطأ بدقة
2. أصلح الملف/الملفات فقط
3. اعرض الملفات المصححة كاملة مع المسارات: // FILE: path/to/file
4. لا تغير باقي المشروع

أصلح الآن.
`,

  improve: () => `
البناء نجح! المشروع يعمل.

المطلوب: اختر تحسين واحد فقط وطبقه (لا تكسر ما يعمل):
- A) تحسين UI: Animation, Material3, Layout
- B) تحسين أداء: Recomposition, remember, LazyColumn
- C) Feature صغيرة: Dark Mode, Settings, Search
- D) Refactor: تنظيم الكود
- E) حفظ بيانات: Room, DataStore

اعرض الملفات المعدلة فقط مع المسارات.
نفذ تحسين واحد الآن.
`,

  test: () => `
المشروع يبني بنجاح. الآن مهمة الاختبار:
1. اكتب Unit Tests للـ ViewModel
2. اكتب Compose UI Test للشاشة الرئيسية
3. تأكد أن التطبيق لا يعمل Crash

اعرض ملفات الاختبار مع المسارات.
`,

  security: (projectPath) => `
أنت الآن Strix - خبير اختبار اختراق تطبيقات Android. مهمتك فحص أمني شامل.

المشروع: ${projectPath || 'مشروع Android في المجلد الحالي'}

افحص الكود بمعايير OWASP Mobile Top 10:

M1: Improper Credential Usage - ابحث عن API Keys, Secrets مكتوبة في الكود
M2: Supply Chain - مكتبات قديمة فيها ثغرات
M3: Auth/AuthZ - IDOR, Auth Bypass, Hardcoded credentials
M4: Input/Output Validation - SQL Injection, XSS, Intent Injection
M5: Insecure Communication - HTTP بدل HTTPS, Certificate pinning مفقود
M6: Privacy Controls - تسريب بيانات حساسة في Log
M7: Binary Protections - Debuggable true, Backup true
M8: Misconfiguration - Permissions زائدة (READ_SMS, etc)
M9: Insecure Data Storage - SharedPreferences بدون تشفير, SQLite غير مشفر
M10: Insufficient Cryptography - MD5, SHA1, Random ضعيف, Hardcoded IV

المطلوب:
1. اقرأ كل ملفات المشروع (ابحث عن *.kt, *.java, *.xml, *.gradle)
2. لكل ثغرة: اذكر الملف، السطر، النوع، الخطورة (high/medium/low)، و PoC أو مثال
3. في النهاية أنتج تقرير JSON بهذا الشكل:
{
  "vulnerabilities": [
    {
      "id": "M1-001",
      "type": "Hardcoded API Key",
      "owasp": "M1",
      "severity": "high",
      "file": "app/src/main/java/.../MainActivity.kt",
      "line": 25,
      "description": "...",
      "poc": "كود يثبت الثغرة",
      "fix": "كيف تصلحها"
    }
  ]
}

4. اعرض أيضاً الملفات المصححة لو أمكن: // FILE: path

ابدأ الفحص الأمني الآن، كن دقيقاً كـ Strix الحقيقي.
`,

  fixSecurity: (vulnReport) => `
وجد فحص Strix الأمني هذه الثغرات في تطبيق Android:

=== VULNERABILITY REPORT ===
${vulnReport.slice(0, 10000)}
=== END REPORT ===

المطلوب:
1. أصلح كل ثغرة مذكورة
2. اعرض الملفات المصححة كاملة مع المسارات: // FILE: path
3. استخدم أفضل الممارسات:
   - API Keys → BuildConfig أو local.properties
   - SharedPreferences → EncryptedSharedPreferences
   - HTTP → HTTPS + Certificate Pinning
   - Permissions → أزل غير الضروري
   - Log → أزل Log.d التي تطبع بيانات حساسة
   - Debuggable → false في release

أصلح الثغرات الأمنية الآن.
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
  else if (MODE === 'security') prompt = PROMPTS.security(PROJECT_PATH || IDEA);
  else if (MODE === 'fix-security') prompt = PROMPTS.fixSecurity(ERROR_LOG);
  else throw new Error(`Unknown mode: ${MODE}`);

  console.log(`\n=== ARENA PURE MODE: ${MODE.toUpperCase()} ===`);
  console.log(`Prompt length: ${prompt.length} chars`);
  console.log(`Session URL: ${session.url || 'NEW SESSION'}\n`);

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
    console.log(`Downloaded: ${filePath}`);
  });

  try {
    if (session.url) {
      console.log(`Continuing existing conversation: ${session.url}`);
      await page.goto(session.url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);
    } else {
      console.log('Starting new Arena Agent Mode session...');
      await page.goto('https://arena.ai/agent', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);
      const currentUrl = page.url();
      if (currentUrl.includes('/agent')) {
        await saveSession(currentUrl);
      }
    }

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
      throw new Error('Could not find Arena.ai input field');
    }

    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    
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

    console.log('Prompt sent, waiting for Arena.ai Agent to complete...');

    let completed = false;
    const maxWaitMinutes = MODE === 'security' ? 15 : 10;
    const startTime = Date.now();
    
    while (!completed && (Date.now() - startTime) < maxWaitMinutes * 60 * 1000) {
      await page.waitForTimeout(10000);
      const pageText = await page.locator('body').innerText().catch(() => '');
      
      if (pageText.includes('Download') || pageText.includes('completed') || pageText.includes('FILE:') || pageText.includes('vulnerabilities')) {
        await page.waitForTimeout(5000);
        const newText = await page.locator('body').innerText().catch(() => '');
        if (newText.length > pageText.length - 100) {
          completed = true;
        }
      }
      
      const elapsed = Math.round((Date.now() - startTime)/1000);
      console.log(`... still working (${elapsed}s elapsed)`);
    }

    await page.waitForTimeout(2000);
    const fullContent = await page.evaluate(() => document.body.innerText);
    
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

    try {
      const downloadBtn = page.locator('a:has-text("Download"), button:has-text("Download"), a[download]').first();
      if (await downloadBtn.count() > 0) {
        console.log('Found Download button, clicking...');
        await downloadBtn.click();
        await page.waitForTimeout(5000);
      }
    } catch (e) {}

    const result = {
      mode: MODE,
      success: true,
      sessionUrl: page.url(),
      textLength: fullContent.length,
      extractedFiles: extractedFiles,
      downloadedFiles: downloadedFiles,
      outputDir: OUTPUT_DIR,
      timestamp: new Date().toISOString(),
      fullText: fullContent.slice(0, 50000)
    };

    fs.writeFileSync('/tmp/arena_output.json', JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'full_response.txt'), fullContent);

    if (MODE.includes('security')) {
      fs.writeFileSync('/tmp/strix_results/vulnerabilities.json', JSON.stringify({
        scan_mode: 'arena-security-audit',
        mode: MODE,
        timestamp: new Date().toISOString(),
        raw_report: fullContent.slice(0, 20000),
        extracted_files: extractedFiles.length
      }, null, 2));
    }

    await saveSession(page.url());
    await context.storageState({ path: AUTH_FILE });

    console.log(`\n=== ARENA DONE (${MODE}) ===`);
    console.log(`Extracted files: ${extractedFiles.length}`);
    console.log(`Downloaded files: ${downloadedFiles.length}`);
    console.log(`Output dir: ${OUTPUT_DIR}`);

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
