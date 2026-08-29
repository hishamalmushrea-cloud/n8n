#!/usr/bin/env node
/**
 * arena probe — "العيون واليدان" حين لا يستطيع الوكيل الوصول للشبكة.
 *
 * الفكرة: الوكيل (Arena Agent Mode) يكتب خطة فحص declarative، والأداة تعملها
 * حيث يوجد الوصول للشبكة (جهازك/الخادم/داخل الشبكة الداخلية)، ثم تُرجع الردود
 * إلى الناقل. لا يُرسل شيء لأي API خارجي — الملف يمشي مع git.
 *
 *   arena probe <JOB_ID> --plan plan.json [--var token=eyJ...] [--base http://host] [--save]
 *   arena probe <JOB_ID> --from-verify      # يحوّل فحوص verify.mjs إلى خطة ثم ينفّذها
 *
 * خطة الطلبات (JSON):
 * {
 *   "base": "https://staging.example.com",
 *   "timeoutMs": 8000,
 *   "requests": [
 *     { "id": "baseline", "method": "GET", "path": "/health" },
 *     { "id": "idor", "method": "GET", "path": "/api/orders/1002",
 *       "headers": { "authorization": "Bearer {{token}}" },
 *       "assert": [ { "status": { "in": [401, 404] } } ] },
 *     { "id": "xss", "method": "GET", "path": "/search?q=%3Cscript%3Ealert(1)%3C/script%3E",
 *       "assert": [ { "body_not_contains": "alert(1)</script>" },
 *                   { "header": { "content-security-policy": { "present": true } } } ] }
 *   ]
 * }
 *
 * أنواع الإسيرشن: status{equals|in} · header{name:{equals|present}} ·
 *   body_contains / body_not_contains (regex عبر /…/) · json{path:"a.b.c", equals|exists} ·
 *   latency_ms{lt} · redirect_not_followed (نتوقع 3xx مع Location أو 4xx)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';

const BUS = process.env.ARENA_BUS || findBus(process.cwd());
function findBus(from) {
  try { const r = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: from, encoding: 'utf8' }).trim(); if (r) return path.join(r, 'arena', 'bus'); } catch {}
  return path.join(path.resolve(from), 'arena', 'bus');
}
const CONFIG = path.join(path.dirname(BUS), 'config', 'engagement.json');

/* ------------------------------------------------------------ argv */
const argv = process.argv.slice(2);
const job = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i === -1 ? d : argv[i + 1]; };
const bool = (k) => argv.includes(`--${k}`);
const vars = {};
for (let i = 0; i < argv.length; i++) if (argv[i] === '--var' && argv[i + 1]) { const [k, ...v] = String(argv[i + 1]).split('='); vars[k] = v.join('='); i++; }

/* ------------------------------------------------------------ engagement */
function loadCfg() { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return { allowlist: [] }; } }
function assertAuthorized(base) {
  const cfg = loadCfg();
  const norm = (s) => String(s || '').trim().replace(/\/+$/, '').toLowerCase();
  const hit = (cfg.allowlist || []).find((a) => norm(base).startsWith(norm(a.target)) || norm(a.target).startsWith(norm(base)));
  if (!hit) fail(`الهدف ${base} غير مسجّل في arena/config/engagement.json — لا فحص بلا تفويض.\n  أضِفه: arena target add ${base} --kind url --actions passive,active`);
  const actions = hit.actions || [];
  if (!actions.includes('active') && !actions.includes('passive')) fail(`الهدف ${base} لا يملك إجراءً نشطاً في التفويض (المسموح: ${actions.join(',') || '—'})`);
  return { entry: hit, cfg };
}
function redact(s, cfg) {
  let t = String(s);
  for (const key of cfg.redact || []) t = t.replace(new RegExp(`((?:^|\\n|\\s)${key}\\s*[:=]\\s*)[^\\n]*`, 'gi'), '$1[REDACTED]');
  return t;
}
function fail(msg) { console.error(JSON.stringify({ ok: false, error: msg })); process.exit(3); }

/* ------------------------------------------------------------ plan */
function loadPlan() {
  const p = flag('plan');
  if (p) return JSON.parse(fs.readFileSync(p, 'utf8'));
  if (bool('stdin')) return JSON.parse(fs.readFileSync(0, 'utf8'));
  fail('استخدم --plan ملف.json أو --stdin');
}
const sub = (s) => String(s || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : (m)));
function dig(obj, dotted) { return String(dotted).split('.').reduce((a, k) => (a == null ? undefined : a[k]), obj); }
function toRe(pat) {
  const s = String(pat);
  if (s.startsWith('/') && s.lastIndexOf('/') > 0) return new RegExp(s.slice(1, s.lastIndexOf('/')), s.slice(s.lastIndexOf('/') + 1));
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function sendOne({ base, method = 'GET', path: p = '/', headers = {}, body, timeoutMs = 8000, insecure = false }) {
  return new Promise((resolve) => {
    const url = new URL(sub(p) || '/', base);
    const mod = url.protocol === 'https:' ? https : http;
    const t0 = Date.now();
    const payload = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = { ...headers };
    for (const k of Object.keys(h)) h[k] = sub(h[k]);
    if (payload !== undefined && !h['content-type']) h['content-type'] = 'application/json';
    const req = mod.request(
      { hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname + url.search, method, headers: h, timeout: timeoutMs, rejectUnauthorized: !insecure },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null; try { json = JSON.parse(text); } catch {}
          resolve({
            status: res.statusCode,
            headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)])),
            bodyBytes: Buffer.concat(chunks).length,
            body: text.slice(0, 20000),
            json, latencyMs: Date.now() - t0, location: res.headers.location || null,
          });
        });
      },
    );
    req.on('error', (e) => resolve({ error: e.message, code: e.code || null, latencyMs: Date.now() - t0 }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', latencyMs: Date.now() - t0 }); });
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/* ------------------------------------------------------------ asserts */
function checkAssert(r, a) {
  const out = [];
  for (const [kind, spec] of Object.entries(a)) {
    let pass = false, detail = '';
    if (kind === 'status') {
      if (spec.equals !== undefined) { pass = r.status === spec.equals; detail = `status=${r.status} نتوقع ${spec.equals}`; }
      if (spec.in) { pass = spec.in.includes(r.status); detail = `status=${r.status} ضمن ${spec.in.join('/')}؟ ${pass}`; }
      if (spec.notIn) { pass = !spec.notIn.includes(r.status); detail = `status=${r.status} ليس ضمن ${spec.notIn.join('/')}`; }
    } else if (kind === 'header') {
      for (const [name, cond] of Object.entries(spec)) {
        const have = r.headers?.[String(name).toLowerCase()];
        if (cond?.present !== undefined) pass = cond.present ? have !== undefined : have === undefined;
        else if (cond?.equals !== undefined) pass = have === cond.equals;
        else pass = have !== undefined;
        detail = `${name}=${have === undefined ? '—' : String(have).slice(0, 60)} (present=${have !== undefined})`;
      }
    } else if (kind === 'body_contains' || kind === 'body_not_contains') {
      const m = toRe(spec).test(String(r.body || ''));
      pass = kind === 'body_contains' ? m : !m;
      detail = `match=${m} على ${String(spec).slice(0, 40)}`;
    } else if (kind === 'json') {
      const v = dig(r.json, spec.path);
      if (spec.exists !== undefined) pass = spec.exists ? v !== undefined : v === undefined;
      else pass = JSON.stringify(v) === JSON.stringify(spec.equals);
      detail = `${spec.path}=${JSON.stringify(v)?.slice(0, 80)}`;
    } else if (kind === 'latency_ms') {
      pass = (r.latencyMs || 0) < (spec.lt ?? 1e9); detail = `${r.latencyMs}ms < ${spec.lt}ms`;
    } else if (kind === 'redirect_not_followed') {
      pass = !(r.status >= 300 && r.status < 400 && r.location) || !new URL(r.location, 'http://x').hostname;
      detail = `status=${r.status} location=${r.location || '—'}`;
    } else if (kind === 'no_error_leak') {
      pass = !/(Traceback|Exception|SQLSTATE|at \S+\.\w+:\d+|(?:\/home\/|\/var\/www\/|\/usr\/lib\/))/i.test(String(r.body || ''));
      detail = `body=${String(r.body || '').slice(0, 60)}`;
    } else { out.push({ kind, pass: false, detail: 'unknown assert type' }); continue; }
    out.push({ kind, spec: JSON.stringify(spec), pass, detail });
  }
  if (r.error) out.push({ kind: 'reachable', pass: false, detail: `${r.error} (${r.code || ''})` });
  return out;
}

/* ------------------------------------------------------------ main */
(async () => {
  const plan = loadPlan();
  const base = flag('base') || plan.base;
  if (!base) fail('الخطة تحتاج "base" أو --base');
  if (!/^https?:\/\//.test(base)) fail('base يجب أن يبدأ بـ http:// أو https://');
  assertAuthorized(base);

  const requests = plan.requests || [];
  if (!requests.length) fail('لا طلبات في الخطة');
  const cfg = loadCfg();
  const rows = [];
  const dir = job ? path.join(BUS, 'jobs', 'active', job) : null;
  const probeDir = dir ? path.join(dir, 'probes') : path.join(process.cwd(), 'probes');
  if (job) fs.mkdirSync(probeDir, { recursive: true });

  for (const q of requests) {
    const t0 = Date.now();
    let r;
    try {
      r = await sendOne({ base, timeoutMs: plan.timeoutMs || 8000, insecure: !!plan.insecure, ...q, path: sub(q.path), headers: q.headers ? Object.fromEntries(Object.entries(q.headers).map(([k, v]) => [k, sub(v)])) : {} });
    } catch (e) { r = { error: e.message }; }
    // capture: "capture": { "token": "json.token", "hdr": "headers.set-cookie" }
    if (q.capture) {
      for (const [name, src] of Object.entries(q.capture)) {
        const [kind, expr] = String(src).includes('.') ? [src.split('.')[0], src.split('.').slice(1).join('.')] : ['body', src];
        let val;
        if (kind === 'json') val = dig(r.json, expr);
        else if (kind === 'headers') val = r.headers?.[expr.toLowerCase()];
        else if (kind === 'status') val = r.status;
        else val = (r.body || '').slice(0, 2000);
        if (val === undefined) val = null;
        vars[name] = val === null || val === undefined ? '' : String(val);
      }
      if (vars.token && vars.forged === undefined) {
        try {
          const [_, pl, sg] = String(vars.token).split('.');
          if (pl) vars.forged = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${pl}.${sg || ''}`;
        } catch {}
      }
    }
    const checks = (q.assert || []).flatMap((a) => checkAssert(r, a));
    const passed = checks.length === 0 ? null : checks.every((c) => c.pass);
    rows.push({ id: q.id || q.path, method: q.method || 'GET', path: sub(q.path), status: r.status ?? null, latencyMs: r.latencyMs ?? (Date.now() - t0), passed, checks, note: q.note || '' });
    const dump = {
      id: q.id || q.path, at: new Date().toISOString(), base, request: { method: q.method || 'GET', path: sub(q.path), headers: redact(JSON.stringify(q.headers || {}), cfg), body: q.body === undefined ? null : redact(typeof q.body === 'string' ? q.body : JSON.stringify(q.body), cfg) },
      response: { status: r.status ?? null, headers: redact(JSON.stringify(r.headers || {}), cfg), bytes: r.bodyBytes ?? (r.body || '').length, bodyPreview: redact((r.body || r.error || '').slice(0, 4000), cfg) },
      checks,
    };
    if (job) fs.writeFileSync(path.join(probeDir, `${dump.id.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`), JSON.stringify(dump, null, 2) + '\n');
  }

  const summary = {
    ok: rows.every((r) => r.passed !== false),
    job, base, at: new Date().toISOString(),
    totals: { requests: rows.length, assertions: rows.reduce((a, b) => a + b.checks.length, 0), failed: rows.filter((r) => r.passed === false).length, info: rows.filter((r) => r.passed === null).length },
    rows: rows.map(({ checks, ...r }) => ({ ...r, failed_checks: checks.filter((c) => !c.pass).map((c) => `${c.kind}: ${c.detail}`) })),
  };
  if (job) fs.writeFileSync(path.join(probeDir, 'results.json'), JSON.stringify(summary, null, 2) + '\n');
  if (dir) {
    fs.appendFileSync(path.join(dir, 'events.ndjson'), JSON.stringify({ ts: new Date().toISOString(), actor: 'arena-probe', type: 'probe', msg: `${summary.totals.requests} طلب / ${summary.totals.failed} فشل إسيرشن`, ok: summary.ok }) + '\n');
  }
  console.log(`\n  probe @ ${base}${job ? `  (job ${job})` : ''}`);
  for (const r of rows) {
    const mark = r.passed === null ? '·' : r.passed ? '✓' : '✗';
    console.log(`  ${mark} ${String(r.id).padEnd(22)} ${String(r.method).padEnd(6)} ${String(r.status ?? 'ERR').padEnd(5)} ${String(r.latencyMs).padEnd(6)}ms ${r.note || ''}`);
    for (const c of r.checks.filter((x) => !x.pass)) console.log(`      ✗ ${c.kind}: ${c.detail}`);
  }
  console.log(`\n  ${summary.totals.assertions - summary.totals.failed}/${summary.totals.assertions} إسيرشن نجح · ${summary.totals.info} بلا إسيرشن (مسح معلوماتي)\n`);
  if (job) console.log(`  الردود الخام: ${path.relative(process.cwd(), probeDir)}/*.json`);
  process.exitCode = summary.totals.failed ? 1 : 0;
})();
