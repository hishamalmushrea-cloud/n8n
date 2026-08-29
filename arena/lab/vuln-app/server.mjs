#!/usr/bin/env node
/**
 * arena lab target — تطبيق متعمَّدُ الضعف لتجربة الدورة الكاملة (n8n → Arena → findings)
 *
 * ⚠️  للاستخدام المحلي فقط داخل معمل الاختبار. لا تنشر هذا الملف.
 *     It is intentionally vulnerable: it exists so the pipeline can be proven end-to-end.
 *
 *  node server.mjs --port 8090
 */
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';

const PORT = Number((process.argv.find((a, i) => process.argv[i - 1] === '--port') || 8090));
const SECRET = process.env.LAB_JWT_SECRET || 'dev-secret-do-not-reuse';

const DB = {
  users: [
    { id: 1, email: 'ali@lab.test', password: 'Passw0rd!1', role: 'admin' },
    { id: 2, email: 'sara@lab.test', password: 'Passw0rd!2', role: 'customer' },
  ],
  orders: [
    { id: 1001, user_id: 2, item: 'iPhone 15', amount: 999, card: '4111111111111111', note: 'deliver to gate 3' },
    { id: 1002, user_id: 1, item: 'Keyboard', amount: 120, card: '5500005555555559', note: 'gift wrap' },
  ],
  audit: [],
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
const makeToken = (u) => { const p = b64({ sub: u.id, role: u.role, exp: Date.now() + 864e5 }); return `${b64({ alg: 'HS256', typ: 'JWT' })}.${p}.${sign(p)}`; };
const readToken = (h) => {
  try {
    const [hdr, p, s] = String(h || '').replace(/^Bearer /i, '').split('.');
    if (!p) return null;
    if (sign(p) !== s) return null;           // BUG #6 (info): signature checked, but...
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (claims.exp && claims.exp < Date.now()) return null;
    return claims;                            // ...no issuer/audience binding, alg not pinned
  } catch { return null; }
};

const json = (res, code, obj, extra = {}) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    // BUG #1 (medium): ترويسات أمنية ناقصة — no CSP / HSTS / X-Frame-Options / nosniff
    'server': 'lab-app/1.0.0 express-ish',
    'x-powered-by': 'lab-app',
    ...extra,
  });
  res.end(body);
};

const routes = {
  // 1) login — BUG #2 (high): no rate limit, timings leak user existence, password compared with ==
  'POST /api/login': (req, res, b) => {
    const u = DB.users.find((x) => x.email === b.email);
    const ok = u && u.password === b.password;
    if (!ok) return json(res, 401, { error: u ? 'wrong password' : 'no such user' });
    DB.audit.push({ t: Date.now(), ev: 'login', user: u.email });
    return json(res, 200, { token: makeToken(u), user: { id: u.id, email: u.email, role: u.role } });
  },

  // 2) IDOR — BUG #3 (critical/high): أي توكن صالح يقرأ أي طلب
  'GET /api/orders/:id': (req, res, b, params) => {
    if (!readToken(req.headers.authorization)) return json(res, 401, { error: 'auth required' });
    const o = DB.orders.find((x) => String(x.id) === params.id);
    if (!o) return json(res, 404, { error: 'not found' });
    return json(res, 200, o); // no ownership check
  },

  // 3) reflected XSS — BUG #4 (medium): q يُعكس بدون ترميز في HTML
  'GET /search': (req, res) => {
    const q = req.url.split('q=')[1] || '';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<html><body><h1>نتائج البحث: ${decodeURIComponent(q)}</h1></body></html>`);
  },

  // 4) mass assignment + priv esc — BUG #5 (high): role يقبل من العميل
  'POST /api/users/me': (req, res, b) => {
    const claims = readToken(req.headers.authorization);
    if (!claims) return json(res, 401, { error: 'auth required' });
    const u = DB.users.find((x) => x.id === claims.sub);
    Object.assign(u, b); // accepts role, password, everything
    return json(res, 200, { updated: true, user: u });
  },

  // 5) SSRF — BUG #7 (high): fetch لمدخل المستخدم
  'POST /api/fetch-preview': (req, res, b) => {
    if (!b.url) return json(res, 400, { error: 'url required' });
    let target;
    try { target = new URL(b.url); } catch { return json(res, 400, { error: 'bad url' }); }
    const mod = target.protocol === 'https:' ? https : http; // BUG #7: any scheme/host allowed, incl. 169.254.169.254
    const req2 = mod.get(target, { timeout: 3000 }, (r) => {
      let data = '';
      r.on('data', (c) => (data += c));
      r.on('end', () => json(res, 200, { status: r.statusCode, preview: data.slice(0, 500) }));
    });
    req2.on('error', (e) => json(res, 200, { error: e.message })); // error details leaked
    req2.on('timeout', () => { req2.destroy(); json(res, 504, { error: 'timeout' }); });
  },

  // 6) debug endpoint — BUG #8 (low): معلومات زائدة
  'GET /api/debug': (req, res) => json(res, 200, { env: process.env.LAB_DEBUG_BANNER || 'lab', users: DB.users.map((u) => ({ email: u.email, role: u.role, password: u.password })) }),

  'GET /health': (req, res) => json(res, 200, { ok: true, service: 'lab-app', version: '1.0.0' }),
};

function match(url) {
  const [method, pathOnly] = [url.method, url.pathname];
  for (const key of Object.keys(routes)) {
    const [m, p] = key.split(' ');
    if (m !== method) continue;
    const pp = p.split('/'); const up = pathOnly.split('/');
    if (pp.length !== up.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(':')) params[pp[i].slice(1)] = up[i];
      else if (pp[i] !== up[i]) { ok = false; break; }
    }
    if (ok) return { handler: routes[key], params };
  }
  return null;
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); }); // BUG #9 (low): no real body limit handling / no content-type enforcement
  req.on('end', () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* BUG #10: silent parse failure -> {} */ }
    const url = new URL(req.url, 'http://x');
    const m = match({ method: req.method, pathname: url.pathname });
    if (!m) return json(res, 404, { error: 'no route' });
    try { m.handler(req, res, body, m.params); } catch (e) { json(res, 500, { error: e.message, stack: e.stack }); } // BUG #11 (medium): stack trace leaked
  });
}).listen(PORT, '0.0.0.0', () => console.log(`[lab] vulnerable demo app on 0.0.0.0:${PORT}`));
