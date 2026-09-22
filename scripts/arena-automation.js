/**
 * Playwright Script للتحكم في Arena.ai Agent Mode بدون API
 * يشغله n8n عبر Execute Command: node arena-automation.js "فكرة المشروع"
 * 
 * المتطلبات: npm install playwright
 * npx playwright install chromium
 */

const { chromium } = require('playwright');

async function runArenaAgent(projectIdea) {
  const browser = await chromium.launch({
    headless: false, // اجعله true بعد الاختبار
    args: ['--no-sandbox']
  });
  
  const context = await browser.newContext({
    storageState: './arena-auth.json' // احفظ تسجيل الدخول أول مرة
  });
  
  const page = await context.newPage();
  
  console.log('Opening Arena.ai...');
  await page.goto('https://arena.ai', { waitUntil: 'networkidle' });
  
  // 1. تسجيل الدخول (لو لم يكن محفوظ)
  // لو الصفحة تطلب Login، انتظر يدوياً أول مرة واحفظ الـ storageState
  
  // 2. اذهب لوضع Agent Mode
  await page.waitForSelector('text=Agent Mode', { timeout: 10000 }).catch(()=>{});
  const agentButton = page.locator('text=Agent Mode').first();
  if (await agentButton.count() > 0) {
    await agentButton.click();
  }
  
  // 3. الصق فكرة المشروع
  const promptInput = page.locator('textarea, [contenteditable="true"], input[type="text"]').last();
  await promptInput.waitFor({ timeout: 15000 });
  await promptInput.fill(`
أنت مطور Android خبير. المهمة:

${projectIdea}

المطلوب:
1. أنشئ مشروع Android Studio كامل (Kotlin + Jetpack Compose)
2. الهيكل: app/src/main/java/ + res/ + AndroidManifest.xml + build.gradle
3. اكتب الكود كاملاً وقابل للبناء مباشرة
4. لا تشرح، فقط اكتب الملفات مع المسارات

ابدأ الآن.
  `);
  
  // 4. اضغط Enter / Send
  await page.keyboard.press('Enter');
  const sendButton = page.locator('button:has-text("Send"), button:has-text("Run"), [aria-label="Send"]').first();
  if (await sendButton.count() > 0) {
    await sendButton.click();
  }
  
  console.log('Agent started, waiting for completion...');
  
  // 5. انتظر حتى ينتهي الوكيل (يراقب اختفاء مؤشر التحميل أو ظهور زر Download)
  // هذه المحددات تختلف حسب Arena.ai، عدّلها بعد فحص الموقع
  try {
    await page.waitForSelector('text=Completed, text=Done, text=Download, [data-state="completed"]', { timeout: 10 * 60 * 1000 }); // 10 دقائق
  } catch (e) {
    console.log('Timeout waiting for completion, grabbing current content anyway');
  }
  
  // 6. اسحب النتيجة
  await page.waitForTimeout(2000);
  const resultText = await page.locator('main, [role="main"], .chat-container').last().innerText().catch(() => '');
  
  // 7. حمل الملفات لو فيه زر تحميل
  const downloadLink = page.locator('a:has-text("Download"), button:has-text("Download")').first();
  let downloadPath = null;
  if (await downloadLink.count() > 0) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadLink.click()
    ]);
    downloadPath = `/tmp/arena-result-${Date.now()}.zip`;
    await download.saveAs(downloadPath);
    console.log(`Downloaded to ${downloadPath}`);
  }
  
  // 8. احفظ النتيجة لـ n8n
  const fs = require('fs');
  const output = {
    success: true,
    text: resultText.slice(0, 20000), // أول 20k حرف
    downloadPath: downloadPath,
    timestamp: new Date().toISOString()
  };
  
  fs.writeFileSync('/tmp/arena_output.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  
  await context.storageState({ path: './arena-auth.json' }); // احفظ الجلسة
  await browser.close();
  
  return output;
}

// التشغيل من n8n
const idea = process.argv[2] || "تطبيق ToDo بسيط";
runArenaAgent(idea).catch(err => {
  console.error(err);
  process.exit(1);
});
