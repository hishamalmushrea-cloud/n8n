/**
 * ARENA.AI → OpenAI Compatible Proxy for Strix
 * 
 * يجعل Strix يظن أنه يكلم OpenAI API، لكن في الحقيقة يكلم Arena.ai Agent Mode عبر متصفح آلي
 * 100% Arena.ai Only, No API Keys Needed
 * 
 * كيف يعمل:
 * 1. Strix يرسل POST /v1/chat/completions (صيغة OpenAI)
 * 2. Proxy يحول الرسالة لـ Playwright → Arena.ai Agent Mode
 * 3. ينتظر رد Arena.ai (2-5 دقائق)
 * 4. يحول رد Arena.ai لصيغة OpenAI JSON ويرجعه لـ Strix
 * 
 * الاستخدام:
 * node arena-openai-proxy.js
 * # يفتح على http://localhost:8080
 * 
 * ثم:
 * export OPENAI_BASE_URL=http://localhost:8080/v1
 * export OPENAI_API_KEY=sk-dummy-arena
 * strix --target ./MyApp --llm openai
 */

const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PROXY_PORT || 8080;
const AUTH_FILE = path.join(__dirname, 'arena-auth.json');
const SESSION_FILE = process.env.ARENA_SESSION_FILE || '/tmp/arena_session.json';
const OUTPUT_DIR = '/tmp/arena_proxy';

let browser = null;
let context = null;
let page = null;
let isPageReady = false;

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function initBrowser() {
  if (browser) return { browser, context, page };
  
  console.log('🚀 Starting Playwright browser for Arena.ai...');
  await ensureDir(OUTPUT_DIR);
  
  browser = await chromium.launch({
    headless: false, // اجعله true بعد الاختبار
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });
  
  context = await browser.newContext({
    storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
    viewport: { width: 1280, height: 900 }
  });
  
  page = await context.newPage();
  
  // تحميل الجلسة السابقة لو موجودة
  let sessionUrl = null;
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      sessionUrl = session.url;
    }
  } catch (e) {}
  
  if (sessionUrl) {
    console.log(`📂 Continuing Arena session: ${sessionUrl}`);
    await page.goto(sessionUrl, { waitUntil: 'networkidle', timeout: 60000 });
  } else {
    console.log('🆕 Starting new Arena Agent Mode session');
    await page.goto('https://arena.ai/agent', { waitUntil: 'networkidle', timeout: 60000 });
  }
  
  await page.waitForTimeout(3000);
  isPageReady = true;
  
  // احفظ URL
  const currentUrl = page.url();
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ url: currentUrl, createdAt: new Date().toISOString() }, null, 2));
  
  console.log(`✅ Arena.ai ready at: ${currentUrl}`);
  return { browser, context, page };
}

async function askArena(prompt) {
  if (!isPageReady) await initBrowser();
  
  console.log(`\n📤 Sending to Arena.ai (${prompt.length} chars): ${prompt.slice(0, 200)}...`);
  
  // ابحث عن حقل الإدخال
  const inputSelectors = [
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="message"]',
    'textarea',
    '[contenteditable="true"]',
    'div[role="textbox"]'
  ];
  
  let inputFound = false;
  for (const selector of inputSelectors) {
    try {
      const locator = page.locator(selector).last();
      if (await locator.count() > 0 && await locator.isVisible({ timeout: 3000 })) {
        await locator.click();
        await locator.fill(prompt);
        inputFound = true;
        console.log(`✅ Found input: ${selector}`);
        break;
      }
    } catch (e) { continue; }
  }
  
  if (!inputFound) {
    throw new Error('Could not find Arena.ai input field');
  }
  
  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter');
  
  // جرب زر Send
  const sendSelectors = ['button:has-text("Send")', 'button[aria-label="Send"]', 'button:has-text("Run")'];
  for (const sel of sendSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0 && await btn.isVisible({ timeout: 1000 })) {
        await btn.click();
        break;
      }
    } catch (e) {}
  }
  
  console.log('⏳ Waiting for Arena.ai response (2-5 min)...');
  
  let lastText = '';
  let stableCount = 0;
  const startTime = Date.now();
  const maxWait = 10 * 60 * 1000; // 10 دقائق
  
  while ((Date.now() - startTime) < maxWait) {
    await page.waitForTimeout(10000);
    const currentText = await page.locator('body').innerText().catch(() => '');
    
    if (currentText.length > lastText.length + 100) {
      // لا يزال يكتب
      lastText = currentText;
      stableCount = 0;
      const elapsed = Math.round((Date.now() - startTime)/1000);
      console.log(`... Arena still writing (${elapsed}s, ${currentText.length} chars)`);
    } else {
      stableCount++;
      if (stableCount >= 3) { // مستقر لـ 30 ثانية = انتهى
        console.log('✅ Arena response stable, assuming complete');
        break;
      }
    }
  }
  
  const fullText = await page.evaluate(() => document.body.innerText);
  
  // استخرج آخر رد فقط (بعد البرومبت)
  // Arena يعرض المحادثة كاملة، نحتاج آخر رسالة من الـ Agent
  const parts = fullText.split(prompt.slice(0, 50));
  const lastResponse = parts[parts.length - 1] || fullText;
  
  // احفظ
  await context.storageState({ path: AUTH_FILE });
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ url: page.url(), createdAt: new Date().toISOString() }, null, 2));
  
  console.log(`📥 Arena response: ${lastResponse.length} chars`);
  return lastResponse.slice(0, 15000); // أرجع أول 15k حرف
}

// OpenAI Compatible Endpoint - هذا ما يكلمه Strix
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, model, temperature, max_tokens } = req.body;
    
    console.log(`\n=== New Strix Request ===`);
    console.log(`Model: ${model}, Messages: ${messages?.length}`);
    
    // اجمع كل رسائل المستخدم
    const userMessages = (messages || []).filter(m => m.role === 'user' || m.role === 'system');
    const combinedPrompt = userMessages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    
    // أضف تعليمات Strix
    const strixPrompt = `
أنت Strix - خبير اختبار اختراق AI. مهمتك تنفيذ هذا الطلب الأمني بدقة:

${combinedPrompt}

القواعد:
- أنت تملك أدوات: HTTP Proxy, Browser Automation, Terminal, Python Runtime
- حلل الهدف، جرب هجوم حقيقي، أنتج Proof-of-Concept بايثون يعمل
- لا تبلغ عن ثغرة بدون PoC
- أرجع النتيجة بصيغة JSON إذا طلب منك، أو كود بايثون PoC

نفذ الآن:
`;
    
    const arenaResponse = await askArena(strixPrompt);
    
    // حول لصيغة OpenAI
    const openAIResponse = {
      id: `chatcmpl-arena-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now()/1000),
      model: model || 'arena-agent-mode',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: arenaResponse
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: Math.floor(combinedPrompt.length / 4),
        completion_tokens: Math.floor(arenaResponse.length / 4),
        total_tokens: Math.floor((combinedPrompt.length + arenaResponse.length)/4)
      }
    };
    
    console.log(`✅ Returning OpenAI-compatible response to Strix`);
    res.json(openAIResponse);
    
  } catch (err) {
    console.error('❌ Proxy error:', err);
    res.status(500).json({
      error: {
        message: err.message,
        type: 'arena_proxy_error'
      }
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', arena_ready: isPageReady, session_file: SESSION_FILE });
});

app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [
      { id: 'arena-agent-mode', object: 'model', created: Date.now(), owned_by: 'arena.ai' },
      { id: 'gpt-4', object: 'model', created: Date.now(), owned_by: 'arena-proxy' },
      { id: 'gpt-3.5-turbo', object: 'model', created: Date.now(), owned_by: 'arena-proxy' }
    ]
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🔥 Arena.ai → OpenAI Proxy running on http://0.0.0.0:${PORT}`);
  console.log(`📡 Strix should use: OPENAI_BASE_URL=http://localhost:${PORT}/v1`);
  console.log(`🔑 OPENAI_API_KEY=any-dummy-key`);
  console.log(`\nExample:`);
  console.log(`export OPENAI_BASE_URL=http://localhost:${PORT}/v1`);
  console.log(`export OPENAI_API_KEY=sk-arena-dummy`);
  console.log(`strix --target ./MyApp --llm openai\n`);
});

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  if (browser) await browser.close();
  process.exit(0);
});
