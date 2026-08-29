#!/usr/bin/env node
/**
 * verify.mjs — إعادة تحقّق حتمية (deterministic re-test) من قائمة النتائج.
 *
 * لا تعتمد على ذاكرة الوكيل: كل فحص هنا يعيد إنتاج الـ PoC الأصلي ويقيس السلوك.
 * مخرجاتها JSON تصلح لـ `arena set-finding` (آلي) وللقراءة البشرية.
 *
 *   node arena/lab/verify.mjs --base http://localhost:8090 [--json] [--map findings.map.json]
 *
 * الأوامر: --json يعيد مصفوفة {code, check, fixed, detail}
 */
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const BASE = String(arg('base', 'http://localhost:8090')).replace(/\/$/, '');

const results = [];
const push = (code, check, fixed, detail) => results.push({ code, check, fixed: !!fixed, detail: String(detail).slice(0, 300) });

async function req(method, path, { body, token, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) { h['content-type'] = 'application/json'; }
  if (token) h['authorization'] = `Bearer ${token}`;
  const r = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await r.text();
  return { status: r.status, headers: Object.fromEntries(r.headers.entries()), body: text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

const jwtPart = (tok, i) => { try { return JSON.parse(Buffer.from(tok.split('.')[i], 'base64url').toString()); } catch { return {}; } };

(async () => {
  /* ---------- precondition: login ---------- */
  const badEmail = await req('POST', '/api/login', { body: { email: 'ghost@lab.test', password: 'x' } });
  const badPass = await req('POST', '/api/login', { body: { email: 'ali@lab.test', password: 'x' } });
  const login = await req('POST', '/api/login', { body: { email: 'sara@lab.test', password: 'Passw0rd!2' } });
  const TOKEN = login.json?.token || '';
  push('PRE-01', 'login يعمل بحساب صحيح (لا كسر وظيفي)', login.status === 200 && !!TOKEN, `status=${login.status}`);
  push('F-218087a', 'توحيد رسالة خطأ الدخول (منع تعداد المستخدمين)',
    badEmail.body === badPass.body && badEmail.status === badPass.status, `${badEmail.body} | ${badPass.body}`);

  /* ---------- F1: debug endpoint ---------- */
  const dbg = await req('GET', '/api/debug');
  const leaks = /"(password|password_hash)"/.test(dbg.body);
  push('F-999df2', 'GET /api/debug لا يسرّب كلمات مرور', dbg.status >= 400 || !leaks, `status=${dbg.status} leak=${leaks}`);

  /* ---------- F2: IDOR + PAN ---------- */
  const others = await req('GET', '/api/orders/1002', { token: TOKEN });      // 1002 يملكه ali(id=1)
  const mine = await req('GET', '/api/orders/1001', { token: TOKEN });        // 1001 يملكه sara(id=2)
  push('F-9bbe6da', 'BOLA: قراءة طلب مستخدم آخر مرفوضة', others.status === 404 || others.status === 403, `status=${others.status} body=${others.body.slice(0, 80)}`);
  push('F-9bbe6db', 'الطلب الخاص بي ما زال مقروءاً (لا كسر وظيفي)', mine.status === 200, `status=${mine.status}`);
  push('F-9bbe6dc', 'لا رقم بطاقة كامل (PAN) في الاستجابات', !/\b\d{15,19}\b/.test(mine.body + others.body), `sample=${(mine.body + others.body).slice(0, 60)}`);
  const noauth = await req('GET', '/api/orders/1001');
  push('F-9bbe6dd', 'بدون توكن = 401', noauth.status === 401, `status=${noauth.status}`);

  /* ---------- F3: mass assignment ---------- */
  const esc = await req('POST', '/api/users/me', { token: TOKEN, body: { role: 'admin', password: 'pwned', id: 1 } });
  const me = esc.json?.user || {};
  const stillCustomer = me.role === 'customer' || me.role === undefined;
  const pwNotEchoed = !('password' in me) && !('password_hash' in me);
  push('F-ff4116a', 'Mass assignment: role من الجسم لا يُقبل', stillCustomer, `role=${me.role} status=${esc.status}`);
  push('F-ff4116b', 'حقل password في الجسم لا يُمرّر للنموذج', pwNotEchoed, `keys=${Object.keys(me).join(',')}`);

  /* ---------- F4: SSRF ---------- */
  const ssrfInternal = await req('POST', '/api/fetch-preview', { body: { url: `${BASE}/api/debug` } });
  const ssrfMeta = await req('POST', '/api/fetch-preview', { body: { url: 'http://169.254.169.254/latest/meta-data/' } });
  const ssrfFile = await req('POST', '/api/fetch-preview', { body: { url: 'file:///etc/passwd' } });
  const ssrfLocal = await req('POST', '/api/fetch-preview', { body: { url: 'http://127.0.0.1:5678/healthz' } });
  const blocked = (r) => r.status === 400 || /not allowed|blocked|denied/i.test(r.body);
  push('F-4a6f8ca', 'SSRF → loopback/internal port مرفوض', blocked(ssrfLocal), `status=${ssrfLocal.status} ${ssrfLocal.body.slice(0, 60)}`);
  push('F-4a6f8cb', 'SSRF → 169.254.169.254 metadata مرفوض', blocked(ssrfMeta), `status=${ssrfMeta.status} ${ssrfMeta.body.slice(0, 60)}`);
  push('F-4a6f8cc', 'SSRF → مخطط file:// مرفوض', blocked(ssrfFile), `status=${ssrfFile.status} ${ssrfFile.body.slice(0, 60)}`);
  push('F-4a6f8cd', 'SSRF → self-request للهدف مرفوض', blocked(ssrfInternal), `status=${ssrfInternal.status}`);

  /* ---------- F5: XSS ---------- */
  const payload = '<script>alert(1)</script>';
  const search = await req('GET', '/search?q=' + encodeURIComponent(payload));
  const isJson = /application\/json/.test(search.headers['content-type'] || '');
  push('F-a52038a', 'XSS: /search يُرجع JSON (لا HTML قابل للتنفيذ)', isJson, `ct=${search.headers['content-type']}`);
  const searchHtml = await req('GET', '/search.html?q=' + encodeURIComponent(payload));
  const escaped = /&lt;script&gt;/.test(searchHtml.body) && !/<script>alert\(1\)<\/script>/.test(searchHtml.body);
  push('F-a52038b', 'XSS: /search.html هرّب المخرجات', escaped, searchHtml.body.slice(0, 90));
  const csp = /content-security-policy/i.test(Object.keys(searchHtml.headers).join(','));
  push('F-65472a', 'ترويسة CSP موجودة', csp, `headers=${Object.keys(searchHtml.headers).join(',')}`);

  /* ---------- F6: rate limit ---------- */
  let codes = [];
  for (let i = 0; i < 10; i++) codes.push((await req('POST', '/api/login', { body: { email: 'ali@lab.test', password: 'bad' + i } })).status);
  push('F-218087b', 'Rate limit: 429 يظهر قبل 10 محاولات', codes.includes(429), codes.join(' '));

  /* ---------- F7: password handling ---------- */
  push('F-705ab6a', 'استجابة login لا تحتوي password/password_hash',
    !/"(password|password_hash)"\s*:/.test(login.body), login.body.slice(0, 120));
  push('F-705ab6b', 'login بكلمة مرور خاطئة يفشل فعلاً', badPass.status === 401, `status=${badPass.status}`);
  const weak = /"password":"Passw0rd!2"/.test(dbg.body + esc.body + login.body);
  push('F-705ab6c', 'لا كلمة مرور نص صريح في أي استجابة', !weak, `weak=${weak}`);

  /* ---------- F8: error handling ---------- */
  const err = await req('POST', '/api/fetch-preview', { body: { url: 'ftp://x/y' } });
  push('F-1233a4a', 'لا stack trace في رسائل الخطأ', !/stack|node:|at .*\.mjs/.test(err.body), err.body.slice(0, 90));
  const brk = await req('POST', '/api/fetch-preview', { body: { url: 'http://' + 'a'.repeat(300) + '.invalid' } });
  push('F-1233a4b', 'خطأ غير متوقع لا يكشف مسارات داخلية', !/home\/|usr\/|\bat \b/.test(brk.body), brk.body.slice(0, 90));

  /* ---------- F10: JWT ---------- */
  const head = jwtPart(TOKEN, 0), claims = jwtPart(TOKEN, 1);
  push('F-016e36a', 'JWT alg مثبّتة على HS256', head.alg === 'HS256', `alg=${head.alg}`);
  push('F-016e36b', 'JWT فيه iss/aud/exp', !!claims.iss && !!claims.aud && !!claims.exp, JSON.stringify({ iss: claims.iss, aud: claims.aud, exp: claims.exp }));
  const ttl = (claims.exp || 0) - Math.floor(Date.now() / 1000);
  push('F-016e36c', 'صلاحية التوكن ≤ 15 دقيقة', ttl > 0 && ttl <= 900, `ttl=${ttl}s`);
  const forged = (() => {
    try {
      const [_, p, s] = TOKEN.split('.');
      const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      return `${h}.${p}.${s}`;
    } catch { return TOKEN; }
  })();
  const forg = await req('GET', '/api/orders/1001', { token: forged });
  push('F-016e36d', 'تزوير بـ alg=none مرفوض', forg.status === 401, `status=${forg.status}`);
  const bogus = await req('GET', '/api/orders/1001', { token: 'aaa.bbb.ccc' });
  push('F-016e36e', 'توكن غير موقع مرفوض', bogus.status === 401, `status=${bogus.status}`);

  /* ---------- emit ---------- */
  const fixedCount = results.filter((r) => r.fixed).length;
  const summary = {
    base: BASE, at: new Date().toISOString(), checks: results.length,
    passed: fixedCount, failed: results.length - fixedCount,
    regressions: results.filter((r) => !r.fixed),
    per_finding: [...new Set(results.map((r) => r.code.replace(/[a-z]$/, '')))].map((fid) => {
      const rows = results.filter((r) => r.code.startsWith(fid) && fid !== 'PRE-01');
      return { finding: fid, fixed: rows.every((x) => x.fixed), checks: rows.length };
    }).filter((x) => x.finding !== 'PRE-01'),
  };
  if (argv.includes('--json')) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`verify @ ${BASE}\n`);
    for (const r of results) console.log(`  ${r.fixed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} [${r.code}] ${r.check}\n      ${r.detail.replace(/\n/g, ' ')}`);
    console.log(`\n  ${fixedCount}/${results.length} فحص نجح — ${summary.failed} لم يُغلق`);
  }
  process.exitCode = summary.failed ? 1 : 0;
})().catch((e) => { console.error('verify failed:', e.message); process.exit(2); });
