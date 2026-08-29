#!/usr/bin/env node
/**
 * arena lab — النسخة المُؤمَّنة (بعد إصلاح النتائج العشرة).
 * نفس الواجهة تماماً، لكن كل ثغرة أُغلقت. الهدف: يُثبت أن `arena retest` يرى PASS فعلاً،
 * لا أن التقرير "يُجمَّل".
 *
 *   node server.secured.mjs --port 8090
 */
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';

const PORT = Number(process.argv.find((a, i) => process.argv[i - 1] === '--port') || 8090);
const SECRET = process.env.LAB_JWT_SECRET || crypto.randomBytes(32).toString('hex'); // FIX #10: لا سر في المصدر
const ISS = 'lab-app';
const AUD = 'lab-api';
const DEBUG_ENABLED = process.env.LAB_DEBUG === '1' && process.env.NODE_ENV !== 'production'; // FIX #1

const scrypt = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const hashPw = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `s2:${salt}:${scrypt(pw, salt)}`; };
const verifyPw = (stored, pw) => {
  const [v, salt, digest] = String(stored || '').split(':');
  if (v !== 's2' || !salt) return false;
  const a = Buffer.from(scrypt(pw, salt), 'hex');
  const b = Buffer.from(digest, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b); // FIX #7 + توقيت ثابت
};

const DB = {
  users: [
    { id: 1, email: 'ali@lab.test', password_hash: hashPw('Passw0rd!1'), role: 'admin' },
    { id: 2, email: 'sara@lab.test', password_hash: hashPw('Passw0rd!2'), role: 'customer' },
  ],
  orders: [
    { id: 1001, user_id: 2, item: 'iPhone 15', amount: 999, card_last4: '1111', note: 'deliver to gate 3' }, // FIX #2: لا PAN
    { id: 1002, user_id: 1, item: 'Keyboard', amount: 120, card_last4: '5559', note: 'gift wrap' },
  ],
  audit: [],
};

/* ---------------------------------- FIX #6: حد لمحاولات الدخول (IP + حساب) */
const attempts = new Map();
function rateLimit(key, max = 5, windowMs = 15 * 60_000) {
  const now = Date.now();
  const rec = attempts.get(key) || { n: 0, reset: now + windowMs };
  if (now > rec.reset) { rec.n = 0; rec.reset = now + windowMs; }
  rec.n++;
  attempts.set(key, rec);
  return { allowed: rec.n <= max, retryAfterMs: rec.reset - now };
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
const makeToken = (u) => {
  const payload = { sub: u.id, role: u.role, iss: ISS, aud: AUD, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 15 * 60 }; // FIX #10: 15 دقيقة
  const p = b64(payload);
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${p}.${sign(p)}`;
};
function readToken(h) {
  try {
    const parts = String(h || '').replace(/^Bearer /i, '').split('.');
    if (parts.length !== 3) return null;
    const [hdr, p, s] = parts;
    const head = JSON.parse(Buffer.from(hdr, 'base64url').toString());
    if (head.alg !== 'HS256') return null;                       // FIX #10: تثبيت الخوارزمية (لا alg confusion)
    const expect = Buffer.from(sign(p));
    const got = Buffer.from(String(s));
    if (expect.length !== got.length || !crypto.timingSafeEqual(expect, got)) return null;
    const c = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (c.iss !== ISS || c.aud !== AUD) return null;
    if (typeof c.sub !== 'number' || !Number.isInteger(c.sub)) return null;
    const now = Math.floor(Date.now() / 1000);
    if (!c.exp || c.exp < now || (c.iat || 0) > now + 30) return null;
    return c;
  } catch { return null; }
}

/* ------------------------------- FIX #9: ترويسات أمنية موحّدة + إخفاء البنية */
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'geolocation=(), camera=(), microphone=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
  'cache-control': 'no-store',
};
const SENT_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key']);

function json(res, code, obj, extra = {}) {
  if (process.env.NODE_ENV === 'production') extra['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...SECURITY_HEADERS,
    ...extra,
  });
  res.end(body);
}
const dto = (u) => { const { password: _p, password_hash: _h, ...safe } = u; return safe; }; // FIX #7
const escapeHtml = (s) => String(s).replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));

/* --------------------------------------- FIX #4: SSRF — allowlist بروتوكول + منع الشبكات الخاصة */
const PRIV = /^(?:127\.|10\.|0\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|::1$|fe80:|fc|fd)/i;
async function safeUrl(raw) {
  let u; try { u = new URL(String(raw)); } catch { return { error: 'bad url' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'scheme not allowed' };
  if (u.username || u.password) return { error: 'credentials in url not allowed' };
  let addrs;
  try { addrs = await dns.lookup(u.hostname, { all: true }); } catch { return { error: 'dns failure' }; }
  if (!addrs.length || addrs.some((a) => PRIV.test(a.address))) return { error: 'host not allowed' };
  return { url: u, address: addrs[0].address };
}

const routes = {
  'POST /api/login': (req, res, b) => {
    const key = `${req.socket.remoteAddress}|${String(b.email || '').toLowerCase()}`;
    const rl = rateLimit(key);
    if (!rl.allowed) return json(res, 429, { error: 'too many attempts' }, { 'retry-after': String(Math.ceil(rl.retryAfterMs / 1000)) });
    const u = DB.users.find((x) => x.email === String(b.email || '').toLowerCase());
    const ok = u && verifyPw(u.password_hash, String(b.password || ''));
    if (!ok) return json(res, 401, { error: 'invalid credentials' }); // FIX #6: رسالة موحّدة
    DB.audit.push({ t: Date.now(), ev: 'login', user: u.email });
    return json(res, 200, { token: makeToken(u), user: dto(u) });
  },

  'GET /api/orders/:id': (req, res, b, params, claims) => {
    const o = DB.orders.find((x) => String(x.id) === params.id && (x.user_id === claims.sub || claims.role === 'admin'));
    if (!o) return json(res, 404, { error: 'not found' }); // FIX #2: فحص الملكية + 404 لا 403 (يمنع التعداد)
    return json(res, 200, o);
  },

  'GET /search': (req, res) => {
    const q = decodeURIComponent((req.url.split('q=')[1] || '').slice(0, 200));
    return json(res, 200, { query: q, results: [] }); // FIX #5: لا HTML أبداً
  },
  'GET /search.html': (req, res) => {
    const q = decodeURIComponent((req.url.split('q=')[1] || '').slice(0, 200));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
    res.end(`<html><body><h1>نتائج البحث: ${escapeHtml(q)}</h1></body></html>`); // FIX #5: تهريب
  },

  'POST /api/users/me': (req, res, b, params, claims) => {
    const u = DB.users.find((x) => x.id === claims.sub);       // FIX #3: لا_id من الجسم
    if (!u) return json(res, 404, { error: 'no such user' });
    const { email, note } = b ?? {};                            // FIX #3: allowlist حقول
    if (email !== undefined) {
      const e = String(email).toLowerCase().slice(0, 200);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return json(res, 400, { error: 'bad email' });
      if (DB.users.some((x) => x.email === e && x.id !== u.id)) return json(res, 409, { error: 'taken' });
      u.email = e;
    }
    if (note !== undefined) u.note = String(note).slice(0, 500);
    return json(res, 200, { updated: true, user: dto(u) });
  },

  'POST /api/fetch-preview': async (req, res, b) => {
    const chk = await safeUrl(b.url);
    if (chk.error) return json(res, 400, { error: chk.error });   // FIX #4
    const mod = chk.url.protocol === 'https:' ? https : http;
    const r2 = mod.get(chk.url, { timeout: 3000, maxRedirects: 0, headers: { host: chk.url.host } }, (r) => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode)) { r.resume(); return json(res, 400, { error: 'redirects not allowed' }); }
      let data = ''; let size = 0;
      r.on('data', (c) => { size += c.length; if (size > 64_000) { r.destroy(); } else data += c; });
      r.on('end', () => json(res, 200, { status: r.statusCode, preview: data.slice(0, 500) }));
    });
    r2.on('error', () => json(res, 200, { status: 'unreachable' })); // لا تفاصيل داخلية
    r2.on('timeout', () => { r2.destroy(); json(res, 504, { error: 'timeout' }); });
  },

  'GET /api/debug': (req, res, b, p, claims) => {                  // FIX #1: مُعطَّل افتراضياً
    if (!DEBUG_ENABLED) return json(res, 404, { error: 'no route' });
    if (claims?.role !== 'admin') return json(res, 403, { error: 'forbidden' });
    return json(res, 200, { env: 'lab', counts: { users: DB.users.length, orders: DB.orders.length } });
  },

  'GET /health': (req, res) => json(res, 200, { ok: true, service: 'lab-app', version: '1.0.1' }),
};

function match(method, pathname) {
  for (const key of Object.keys(routes)) {
    const [m, p] = key.split(' ');
    if (m !== method) continue;
    const pp = p.split('/'); const up = pathname.split('/');
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

const NEEDS_AUTH = (p) => p.startsWith('/api/orders') || p === '/api/users/me' || p === '/api/debug';

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 64_000) { req.destroy(); res.destroy(); } }); // FIX: حد حجم فعلي
  req.on('end', async () => {
    let body = {};
    const ct = String(req.headers['content-type'] || '');
    try { if (raw) { if (!ct.startsWith('application/json')) throw new Error('content-type must be application/json'); body = JSON.parse(raw); } }
    catch (e) { return json(res, 415, { error: 'unsupported body' }); }
    const url = new URL(req.url, 'http://x');
    const claims = NEEDS_AUTH(url.pathname) ? readToken(req.headers.authorization) : readToken(req.headers.authorization);
    if (NEEDS_AUTH(url.pathname) && !claims) return json(res, 401, { error: 'auth required' });
    const m = match(req.method, url.pathname);
    if (!m) return json(res, 404, { error: 'no route' });
    try { await m.handler(req, res, body, m.params, claims); }
    catch (e) { const rid = crypto.randomUUID(); console.error(`[${rid}]`, e); json(res, 500, { error: 'internal error', requestId: rid }); } // FIX #8
  });
}).listen(PORT, '0.0.0.0', () => console.log(`[lab] SECURED build on 0.0.0.0:${PORT} (debug=${DEBUG_ENABLED ? 'on' : 'off'})`));
