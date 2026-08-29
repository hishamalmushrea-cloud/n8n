#!/usr/bin/env node
/**
 * arena — The zero-API job bus that makes n8n ↔ Strix ↔ Arena Agent Mode work together.
 *
 * Design rule: NO network calls, NO API keys, NO external DB.
 * Transport = the filesystem + git.  Brain = whoever claims the job (Arena Agent Mode).
 *
 *   n8n workflow --(Execute Command)--> arena submit --> bus/queued/<id>/
 *   Arena Agent Mode (me) --(bash)--> arena claim / add-finding / complete
 *   arena complete --> optional local webhook ping + git commit --> n8n reads report
 *
 * States: queued -> active -> (onhold) -> done | failed
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';

/* ------------------------------------------------------------------ paths */

const BUS_ROOT = process.env.ARENA_BUS || findBusRoot(process.cwd());
const BUS = {
  root: BUS_ROOT,
  jobs: path.join(BUS_ROOT, 'jobs'),
  tmp: path.join(BUS_ROOT, '.tmp'),
  config: path.join(BUS_ROOT, '..', 'config', 'engagement.json'),
};
const STATES = ['queued', 'active', 'onhold', 'done', 'failed'];

function findBusRoot(from) {
  // 1) git root wins: <repo>/arena/bus
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: from, encoding: 'utf8' }).trim();
    if (root) return path.join(root, 'arena', 'bus');
  } catch {}
  // 2) walk up looking for a bus we already created
  let dir = path.resolve(from);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'arena', 'bus', 'jobs'))) return path.join(dir, 'arena', 'bus');
    if (fs.existsSync(path.join(dir, 'bus', 'jobs'))) return path.join(dir, 'bus');
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.join(path.resolve(from), 'arena', 'bus');
}

const jobDir = (id) => {
  for (const s of STATES) {
    const p = path.join(BUS.jobs, s, id);
    if (fs.existsSync(p)) return p;
  }
  return null;
};
const findJob = (id) => {
  const d = jobDir(id);
  if (!d) return null;
  const state = path.basename(path.dirname(d));
  return { dir: d, state, job: readJson(path.join(d, 'job.json')) };
};

/* ------------------------------------------------------------- primitives */

function ensureDirs() {
  for (const s of STATES) fs.mkdirSync(path.join(BUS.jobs, s), { recursive: true });
  fs.mkdirSync(BUS.tmp, { recursive: true });
}
function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJsonAtomic(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = path.join(BUS.tmp, `${path.basename(p)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, p);
}
function nowIso() { return new Date().toISOString(); }
function newId() {
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `JOB-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}
function logEvent(dir, type, msg, extra = {}) {
  fs.appendFileSync(
    path.join(dir, 'events.ndjson'),
    JSON.stringify({ ts: nowIso(), actor: process.env.ARENA_ACTOR || 'cli', type, msg, ...extra }) + '\n',
  );
}
function out(obj) {
  console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}
function die(msg, code = 2) {
  console.error(JSON.stringify({ ok: false, error: msg }));
  process.exit(code);
}

/* ------------------------------------------------------------ engagement */

function loadEngagement() {
  const cfg = readJson(BUS.config, null);
  if (!cfg) {
    return { allowlist: [], forbidden: ['*'], redact: ['Authorization', 'Set-Cookie'], maxDurationSeconds: 3600, _missing: true };
  }
  return cfg;
}
function normalizeTarget(t) {
  return String(t || '').trim().replace(/\/+$/, '').toLowerCase();
}
function checkAuthorization(target, requestedActions) {
  const cfg = loadEngagement();
  const nt = normalizeTarget(target);
  const entry = (cfg.allowlist || []).find(
    (a) => normalizeTarget(a.target) === nt || nt.startsWith(normalizeTarget(a.target) + '/'),
  );
  if (!entry) {
    return {
      allowed: false,
      reason: `target not in engagement allowlist: ${target}`,
      hint: `أضفه إلى arena/config/engagement.json مع صلاحيات صريحة، أو استهدف تطبيقك/معمل الاختبار فقط.`,
    };
  }
  const permitted = entry.actions || [];
  const bad = (requestedActions || []).filter((a) => !permitted.includes(a));
  if (bad.length) return { allowed: false, reason: `actions not permitted for ${target}: ${bad.join(', ')}`, hint: `المسموح: ${permitted.join(', ') || '(لا شيء)'}` };
  return { allowed: true, entry, cfg };
}
function redactText(s, cfg) {
  let s2 = String(s);
  for (const key of cfg.redact || []) {
    const re = new RegExp(`((?:^|\\n|\\s)${key}\\s*[:=]\\s*)[^\\n]*`, 'gi');
    s2 = s2.replace(re, '$1[REDACTED]');
  }
  // generic secret shapes
  s2 = s2
    .replace(/(sk|pk|api|token|key)[-_][A-Za-z0-9]{16,}/gi, (m) => m.slice(0, 6) + '[REDACTED]')
    .replace(/(password|passwd|secret)["'\s:=]+[^"'\s,}]{3,}/gi, '$1=[REDACTED]');
  return s2;
}

/* --------------------------------------------------------------- argv */

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { flags[k] = true; }
      else { flags[k] = next; i++; }
    } else pos.push(a);
  }
  return { pos, flags };
}
const stdinText = () => {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
};

/* --------------------------------------------------------------- commands */

const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

function logAuditTarget(action, entry) {
  try {
    const p = path.join(BUS.root, '..', 'config', 'engagement.audit.ndjson');
    fs.appendFileSync(p, JSON.stringify({ ts: nowIso(), action, entry }) + '\n');
  } catch {}
}

const CMD = {
  help() {
    out(`arena — job bus for n8n + Strix + Arena Agent Mode (zero API)

  arena init
  arena submit --title "..." --target <url|path> [--actions passive,active,exploit-validation]
               [--mode quick|full|compliance] [--priority P1..P4] [--notify <webhook>]
               [--context-file f] [--stdin] [--id <id>]
  arena list [--state queued] [--json]
  arena show <id> [--findings]
  arena claim <id> [--worker arena-agent]
  arena note <id> "message"
  arena add-finding <id> [--file f.json | --stdin]
  arena evidence <id> <name> [--file f | --stdin]
  arena complete <id> [--report report.md | --report-stdin] [--summary "..."] [--score 0-100]
  arena fail <id> --reason "..."
  arena hold <id> --reason "needs-info|approval"
  arena retest <id>            # child job that verifies fixes
  arena set-finding <id> <F-id|*> [--status fixed-verified|false-positive|accepted-risk|open]
                      [--note "..."] [--verify "step1|step2"]   # triage + تحقق من الإصلاح
  arena findings <id> [--json]        # النتائج الخام
  arena gate <id> [--max-severity high]   # exit 1 if blocking findings (CI/CD)
  arena status <id> [--field state]        # plain text for n8n IF nodes
  arena watch <id> [--timeout 1800] [--interval 15] [--quiet]
  arena target add <url|path> [--kind url|code] [--actions passive,active,exploit-validation] [--note ""]
  arena target list | rm <target> | check <target> [--actions …]
  arena probe <id> --plan plan.json [--var token=…]   # تنفيذ خطة الفحص حيث يوجد الوصول للشبكة
  arena stats                     # dashboard summary
  arena export <id> [--out strix_runs/<id>]  # Strix-shaped run dir
  arena commit  # git commit the bus so the other side pulls it
  arena serve [--port 8787]       # read-only JSON API + dashboard for the bus
`);
  },

  init() {
    ensureDirs();
    fs.mkdirSync(path.dirname(BUS.config), { recursive: true });
    if (!fs.existsSync(BUS.config)) {
      writeJsonAtomic(BUS.config, {
        version: 1,
        owner: process.env.USER || 'you',
        allowlist: [
          { target: 'http://localhost:8090', kind: 'url', actions: ['passive', 'active', 'exploit-validation'], note: 'lab target (deliberately vulnerable)' },
          { target: 'http://127.0.0.1:8090', kind: 'url', actions: ['passive', 'active', 'exploit-validation'], note: 'lab target alias' },
        ],
        forbidden: ['ddos', 'data-destruction', 'mass-credential-stuffing', 'social-engineering'],
        redact: ['Authorization', 'Cookie', 'Set-Cookie'],
        requireApprovalFor: ['exploit-validation'],
        maxDurationSeconds: 3600,
        maxConcurrentJobs: 1,
      });
    }
    out({ ok: true, bus: BUS.root, config: BUS.config });
  },

  submit({ flags, onCreated }) {
    const hooks = { onCreated };
    ensureDirs();
    const target = flags.target || '';
    const actions = String(flags.actions || 'passive,active').split(',').map((s) => s.trim()).filter(Boolean);
    const id = flags.id || newId();
    if (flags['dry-run']) { out({ ok: true, id, target, actions }); return; }

    const auth = checkAuthorization(target, actions);
    const dir = path.join(BUS.jobs, auth.allowed ? 'queued' : 'onhold', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });

    const job = {
      schema: 'arena.job/1',
      id,
      title: flags.title || `security check: ${target}`,
      target: { value: target, kind: auth.entry?.kind || 'unknown', authorized: auth.allowed },
      actions,
      mode: flags.mode || 'quick',
      priority: flags.priority || 'P3',
      state: auth.allowed ? 'queued' : 'blocked',
      created_at: nowIso(),
      updated_at: nowIso(),
      requested_by: 'n8n',
      notify_url: flags.notify && flags.notify !== true ? String(flags.notify) : null,
      context: {},
      lease: null,
      result: null,
    };
    if (flags['context-file']) job.context.instructions = redactText(fs.readFileSync(flags['context-file'], 'utf8'), loadEngagement());
    if (flags.stdin || flags['context-stdin']) {
      const t = stdinText();
      if (t) job.context.payload = redactText(t, loadEngagement());
    }
    if (!auth.allowed) job.blocked_reason = auth.reason;

    writeJsonAtomic(path.join(dir, 'job.json'), job);
    if (typeof hooks.onCreated === 'function') hooks.onCreated(dir);
    logEvent(dir, 'submit', `queued from ${flags.from || 'cli'}`, { actions, authorized: auth.allowed });
    if (!auth.allowed) logEvent(dir, 'policy-block', auth.reason);

    if (!flags['no-git']) tryGitCommit(`arena: submit ${id}`);
    out({
      ok: true, id,
      state: job.state,
      dir,
      ...(auth.allowed ? {} : { blocked: auth.reason, hint: auth.hint }),
    });
    if (!auth.allowed) process.exitCode = 3;
  },

  list({ flags }) {
    ensureDirs();
    const states = flags.state ? String(flags.state).split(',') : STATES;
    const rows = [];
    for (const s of states) {
      const base = path.join(BUS.jobs, s);
      for (const id of fs.existsSync(base) ? fs.readdirSync(base) : []) {
        const j = readJson(path.join(base, id, 'job.json'));
        if (!j) continue;
        const findings = countFindings(path.join(base, id));
        rows.push({ id, title: j.title, target: j.target.value, state: s, priority: j.priority, mode: j.mode, findings, updated_at: j.updated_at });
      }
    }
    rows.sort((a, b) => (a.priority || 'P9').localeCompare(b.priority || 'P9') || (b.updated_at || '').localeCompare(a.updated_at || ''));
    out(flags.json === true ? rows : rows.map((r) => `${r.id}\t${r.state}\t${r.priority}\t${r.findings}F\t${r.title}`).join('\n') || '(no jobs)');
  },

  show({ pos, flags }) {
    const rec = findJob(pos[0]);
    if (!rec) die(`job not found: ${pos[0]}`);
    const findings = readFindings(rec.dir);
    const events = readLines(path.join(rec.dir, 'events.ndjson')).map((l) => JSON.parse(l)).slice(-15);
    const report = fs.existsSync(path.join(rec.dir, 'report.md')) ? fs.readFileSync(path.join(rec.dir, 'report.md'), 'utf8') : null;
    out({
      ok: true,
      job: rec.job,
      state: rec.state,
      findings: findings.map((f) => ({ id: f.id, title: f.title, severity: f.severity, cvss: f.cvss, verified: f.verified, status: f.status, cwe: f.cwe })),
      counts: countsFor(findings),
      events,
      ...(flags.findings === true ? { full: findings } : {}),
      ...(flags.report === true ? { report } : {}),
    });
  },

  status({ pos, flags }) {
    const rec = findJob(pos[0]);
    if (!rec) die(`job not found: ${pos[0]}`);
    const findings = readFindings(rec.dir);
    const c = countsFor(findings);
    if (flags.field) {
      const map = {
        state: rec.state,
        job_state: rec.job.state,
        findings: String(findings.length),
        blocking: String(c.blocking),
        score: String(rec.job.result?.score ?? ''),
        summary: String(rec.job.result?.summary ?? ''),
        verdict: String(rec.job.result?.verdict ?? ''),
        id: rec.job.id,
        title: String(rec.job.title ?? ''),
        target: String(rec.job.target?.value ?? ''),
        mode: String(rec.job.mode ?? ''),
        actions: (rec.job.actions || []).join(','),
        blocking: blockingList(rec.dir).join('\n'),
        report: fs.existsSync(path.join(rec.dir, 'report.md')) ? path.join(rec.dir, 'report.md') : '',
      };
      out(map[flags.field] ?? '');
      if (flags.field === 'job_state' && ['done', 'failed'].includes(map.job_state) === false) process.exitCode = 0;
      return;
    }
    out({ ok: true, id: rec.job.id, state: rec.state, job_state: rec.job.state, counts: c, result: rec.job.result });
  },

  claim({ pos, flags }) {
    const id = pos[0];
    if (!id) {
      // claim-first queued job
      const base = path.join(BUS.jobs, 'queued');
      const ids = fs.existsSync(base) ? fs.readdirSync(base) : [];
      if (!ids.length) die('no queued jobs', 4);
      return CMD.claim({ pos: [ids.sort()[0]], flags });
    }
    const src = path.join(BUS.jobs, 'queued', id);
    if (!fs.existsSync(src)) die(`not in queued state: ${id}`, 4);
    const dst = path.join(BUS.jobs, 'active', id);
    fs.renameSync(src, dst);
    const jf = path.join(dst, 'job.json');
    const job = readJson(jf);
    job.state = 'running';
    job.updated_at = nowIso();
    job.lease = { worker: flags.worker || 'arena-agent', claimed_at: nowIso(), heartbeat_at: nowIso(), ttl_seconds: Number(flags.ttl || 1800) };
    writeJsonAtomic(jf, job);
    logEvent(dst, 'claim', `claimed by ${job.lease.worker}`);
    out({ ok: true, id, state: 'active', dir: dst, target: job.target, actions: job.actions, mode: job.mode, context: job.context });
  },

  note({ pos }) {
    const rec = findJob(pos[0]);
    if (!rec) die(`job not found: ${pos[0]}`);
    logEvent(rec.dir, 'note', pos.slice(1).join(' ') || '(empty)');
    touch(rec.dir);
    out({ ok: true, id: rec.job.id });
  },

  'add-finding'({ pos, flags }) {
    const rec = findJob(pos[0]);
    if (!rec) die(`job not found: ${pos[0]}`);
    const raw = flags.file ? fs.readFileSync(flags.file, 'utf8') : stdinText();
    let f;
    try { f = JSON.parse(raw); } catch { return die('finding must be valid JSON'); }
    const errs = validateFinding(f);
    if (errs.length) return die(`invalid finding: ${errs.join('; ')}`);
    const cfg = loadEngagement();
    f.id = f.id || `F-${crypto.randomBytes(3).toString('hex')}`;
    f.status = f.status || 'open';
    f.found_at = nowIso();
    f.reported_by = f.reported_by || 'arena-agent';
    f.title = redactText(f.title, cfg);
    fs.appendFileSync(path.join(rec.dir, 'findings.ndjson'), JSON.stringify(f) + '\n');
    logEvent(rec.dir, 'finding', `${f.severity} ${f.title}`, { finding_id: f.id, cvss: f.cvss, cwe: f.cwe });
    touch(rec.dir);
    out({ ok: true, id: rec.job.id, finding: f.id, severity: f.severity, verified: !!f.verified });
  },

  evidence({ pos, flags }) {
    const rec = findJob(pos[0]);
    if (!rec) die(`job not found: ${pos[0]}`);
    const name = (pos[1] || 'note.txt').replace(/[^a-zA-Z0-9._-]/g, '_');
    const cfg = loadEngagement();
    const body = flags.file ? fs.readFileSync(flags.file, 'utf8') : stdinText();
    fs.writeFileSync(path.join(rec.dir, 'evidence', name), redactText(body, cfg));
    logEvent(rec.dir, 'evidence', name);
    out({ ok: true, file: path.join('evidence', name) });
  },

  complete({ pos, flags }) {
    const rec = findJob(pos[0]);
    if (!rec) die(`job not found: ${pos[0]}`);
    const findings = readFindings(rec.dir);
    const report = flags.report
      ? fs.readFileSync(flags.report, 'utf8')
      : flags['report-stdin'] || flags['report-stdin'] === true
        ? stdinText()
        : autoReport(rec.job, findings);
    fs.writeFileSync(path.join(rec.dir, 'report.md'), report);
    writeJsonAtomic(path.join(rec.dir, 'report.json'), {
      id: rec.job.id, generated_at: nowIso(), summary: rec.job.title,
      target: rec.job.target.value, mode: rec.job.mode, counts: countsFor(findings),
      findings, evidence: fs.existsSync(path.join(rec.dir, 'evidence')) ? fs.readdirSync(path.join(rec.dir, 'evidence')) : [],
    });
    const c = countsFor(findings);
    const score = flags.score !== undefined && flags.score !== true ? Number(flags.score) : scoreForFindings(readFindings(rec.dir));
    rec.job.state = 'done';
    rec.job.updated_at = nowIso();
    rec.job.result = {
      verdict: c.blocking > 0 ? 'FAIL' : 'PASS',
      score,
      summary: flags.summary && flags.summary !== true ? String(flags.summary) : `${c.total} finding(s), ${c.blocking} blocking`,
      counts: c,
      report: 'report.md',
      finished_at: nowIso(),
    };
    rec.job.lease = null;
    writeJsonAtomic(path.join(rec.dir, 'job.json'), rec.job);
    logEvent(rec.dir, 'complete', rec.job.result.summary, { verdict: rec.job.result.verdict });
    const dst = path.join(BUS.jobs, 'done', rec.job.id);
    try { fs.renameSync(rec.dir, dst); } catch { /* already moved */ }
    if (rec.job.notify_url) ping(rec.job.notify_url, { id: rec.job.id, state: 'done', verdict: rec.job.result.verdict, counts: c });
    tryGitCommit(`arena: complete ${rec.job.id} (${rec.job.result.verdict})`);
    out({ ok: true, id: rec.job.id, state: 'done', ...rec.job.result });
  },

  fail({ pos, flags }) {
    const rec = findJob(pos[0]);
    if (!rec) die(`job not found: ${pos[0]}`);
    rec.job.state = 'failed';
    rec.job.updated_at = nowIso();
    rec.job.result = { verdict: 'ERROR', error: String(flags.reason || 'unspecified') };
    writeJsonAtomic(path.join(rec.dir, 'job.json'), rec.job);
    logEvent(rec.dir, 'fail', rec.job.result.error);
    try { fs.renameSync(rec.dir, path.join(BUS.jobs, 'failed', rec.job.id)); } catch {}
    if (rec.job.notify_url) ping(rec.job.notify_url, { id: rec.job.id, state: 'failed' });
    out({ ok: true, id: rec.job.id, state: 'failed' });
  },

  hold({ pos, flags }) {
    const rec = findJob(pos[0]);
    if (!rec) die(`job not found: ${pos[0]}`);
    rec.job.state = 'onhold';
    rec.job.updated_at = nowIso();
    rec.job.hold_reason = String(flags.reason || 'needs-info');
    writeJsonAtomic(path.join(rec.dir, 'job.json'), rec.job);
    logEvent(rec.dir, 'hold', rec.job.hold_reason);
    out({ ok: true, id: rec.job.id, state: 'onhold', reason: rec.job.hold_reason });
  },

  retest({ pos, flags }) {
    const rec = findJob(pos[0]);
    if (!rec) die(`job not found: ${pos[0]}`);
    const findings = readFindings(rec.dir).filter((f) => f.status !== 'fixed-verified');
    if (!findings.length) return out({ ok: true, message: 'no open findings — nothing to retest' });
    const id = `${rec.job.id}-R${String(Date.now()).slice(-4)}`;
    const checklist = findings.map((f) => ({ ...f, status: 'fix-pending-retest', retest_of: f.id, triage_note: undefined }));
    const childDir = CMD.submit({
      pos: [],
      onCreated: (dir) => {
        fs.appendFileSync(path.join(dir, 'findings.ndjson'), checklist.map((f) => JSON.stringify(f)).join('\n') + '\n');
        logEvent(dir, 'retest-seed', `${checklist.length} نتيجة منسوخة من ${rec.job.id} كقائمة تحقّق`);
      },
      flags: {
        id,
        title: `retest: ${rec.job.title} (${findings.length} findings)`,
        target: rec.job.target.value,
        actions: flags.actions !== true && flags.actions ? flags.actions : (rec.job.actions || []).join(','),
        mode: 'retest',
        priority: 'P2',
        'context-file': (() => { const p = path.join(BUS.tmp, `${id}.ctx`); fs.writeFileSync(p, findings.map((f) => `- ${f.severity} ${f.title}\n  verify: ${f.reproduction?.steps?.join(' ') || f.evidence || ''}`).join('\n')); return p; })(),
        notify: rec.job.notify_url || false,
      },
    });
  },

  'set-finding'({ pos, flags }) {
    const rec = findJob(pos[0]);
    if (!rec) die(`job not found: ${pos[0]}`);
    const fid = pos[1];
    const status = flags.status && flags.status !== true ? String(flags.status) : null;
    const VALID = ['open', 'accepted-risk', 'false-positive', 'fix-pending-retest', 'fixed-verified'];
    if (status && !VALID.includes(status)) return die(`status must be one of ${VALID.join('|')}`);
    const lines = readLines(path.join(rec.dir, 'findings.ndjson'));
    let hit = 0;
    const updated = lines.map((l) => {
      let f; try { f = JSON.parse(l); } catch { return l; }
      if (fid && f.id !== fid && !(fid === '*')) return JSON.stringify(f);
      if (status) f.status = status;
      if (flags.note && flags.note !== true) f.triage_note = String(flags.note);
      if (flags.verify && flags.verify !== true) f.verification = { steps: String(flags.verify).split('|'), at: nowIso(), by: process.env.ARENA_ACTOR || 'arena-agent' };
      if (status === 'fixed-verified') f.verified = f.verified ?? true;
      f.updated_at = nowIso();
      hit++;
      return JSON.stringify(f);
    });
    if (!hit) return die(`no matching finding: ${fid}`);
    writeJsonAtomic(path.join(rec.dir, 'findings.ndjson.tmp'), {}); fs.unlinkSync(path.join(rec.dir, 'findings.ndjson.tmp'));
    const tmp = path.join(BUS.tmp, 'findings.ndjson');
    fs.writeFileSync(tmp, updated.join('\n') + '\n');
    fs.renameSync(tmp, path.join(rec.dir, 'findings.ndjson'));
    logEvent(rec.dir, 'triage', `${fid || '*'} → ${status || '(no change)'}`, { note: flags.note && flags.note !== true ? String(flags.note) : undefined });
    touch(rec.dir);
    const counts = countsFor(readFindings(rec.dir));
    out({ ok: true, id: rec.job.id, updated: hit, counts });
  },

  
  findings({ pos, flags }) {
    const rec = findJob(pos[0]);
    if (!rec) die(`job not found: ${pos[0]}`);
    const f = readFindings(rec.dir);
    if (flags.json) return out({ ok: true, id: rec.job.id, counts: countsFor(f), findings: f });
    out(f.map((x) => `${x.severity.toUpperCase().padEnd(8)} ${(x.cvss ?? '').toString().padEnd(4)} ${x.status.padEnd(18)} ${x.id}  ${x.title}`).join('\n') || '(no findings)');
  },

  /* ---------------------------------------------- تفويض الأهداف (engagement.json) */
  target({ pos, flags }) {
    const sub = pos[0] || 'list';
    const cfgPath = BUS.config;
    const cfg = readJson(cfgPath, { version: 1, allowlist: [], forbidden: [], redact: ['Authorization', 'Cookie', 'Set-Cookie'], maxDurationSeconds: 3600 }) || { allowlist: [] };
    cfg.allowlist = cfg.allowlist || [];
    const norm = (t) => String(t || '').trim().replace(/\/+$/, '').toLowerCase();
    if (sub === 'list') return out({ ok: true, file: cfgPath, allowlist: cfg.allowlist.map((a) => ({ target: a.target, kind: a.kind, actions: a.actions, note: a.note || '' })) });
    if (sub === 'check') {
      const a = checkAuthorization(pos[1], String(flags.actions || 'passive').split(','));
      return out({ ok: a.allowed, target: pos[1], ...(a.allowed ? { entry: a.entry } : { reason: a.reason, hint: a.hint }) });
    }
    const t = pos[1];
    if (!t) die('usage: arena target add <url|path> [--kind url|code|apk] [--actions a,b] [--note "..."] | rm <target> | list | check <target>');
    if (sub === 'add') {
      const kind = flags.kind && flags.kind !== true ? flags.kind : /^https?:\/\//.test(t) ? 'url' : 'code';
      const actions = String(flags.actions || (kind === 'code' ? 'passive,sast' : 'passive')).split(',').map((x) => x.trim()).filter(Boolean);
      const known = ['passive', 'sast', 'active', 'exploit-validation', 'fuzz', 'osint', 'compliance-evidence'];
      const bad = actions.filter((x) => !known.includes(x));
      if (bad.length) die(`إجراءات غير معروفة: ${bad.join(', ')} — المسموح: ${known.join(', ')}`);
      const i = cfg.allowlist.findIndex((a) => norm(a.target) === norm(t));
      const entry = { target: t.replace(/\/+$/, ''), kind, actions, note: flags.note && flags.note !== true ? String(flags.note) : 'أُضيف بـ arena target add' };
      if (i >= 0) cfg.allowlist[i] = { ...cfg.allowlist[i], ...entry };
      else cfg.allowlist.push(entry);
      if (entry.actions.some((x) => ['active', 'exploit-validation', 'fuzz'].includes(x)) && !cfg._authorizedReminder) {
        console.error('\n  ⚠️  أنت تمنح الآن إذناً بفحص حي. تأكد أن هذا الأصل ملكك أو لديك تفويض مكتوب،');
        console.error('     وأن سياسة المزوّد (SaaS/استضافة مشتركة) تسمح بالفحص. راجع قسم authorized tester / safe-harbour.\n');
      }
      writeJsonAtomic(cfgPath, cfg);
      logAuditTarget('add', entry);
      return out({ ok: true, action: 'add', entry, file: cfgPath, total: cfg.allowlist.length });
    }
    if (sub === 'rm' || sub === 'remove') {
      const before = cfg.allowlist.length;
      cfg.allowlist = cfg.allowlist.filter((a) => norm(a.target) !== norm(t));
      writeJsonAtomic(cfgPath, cfg);
      logAuditTarget('remove', { target: t });
      return out({ ok: before !== cfg.allowlist.length, action: 'remove', target: t, removed: before - cfg.allowlist.length });
    }
    die(`unknown subcommand: ${sub} (add|rm|list|check)`);
  },

  probe({ pos, flags }) {
    const script = path.join(BUS.root, '..', 'probe', 'probe.mjs');
    if (!fs.existsSync(script)) die(`probe.mjs غير موجود: ${script} — انسخه للجهاز الذي يملك الوصول للشبكة`);
    const args = [script, ...pos];
    for (const [k, v] of Object.entries(flags)) args.push(`--${k}`, ...(v === true ? [] : [String(v)]));
    const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ARENA_BUS: BUS.root } });
    process.exitCode = r.status ?? 1;
  },


  gate({ pos, flags }) {
    const rec = findJob(pos[0]);
    if (!rec) die(`job not found: ${pos[0]}`);
    const max = String(flags['max-severity'] || 'high');
    const findings = readFindings(rec.dir);
    const blocking = findings.filter((f) => (SEVERITY_RANK[f.severity] ?? 0) >= (SEVERITY_RANK[max] ?? 3) && f.status === 'open');
    const report = blocking.map((f) => `${f.severity.toUpperCase()} ${f.id} ${f.title}${f.verified ? ' [PoC verified]' : ''}`);
    out({ ok: blocking.length === 0, blocking: blocking.length, details: report });
    if (blocking.length) { console.error(`BLOCKED by ${blocking.length} finding(s) >= ${max}`); process.exitCode = 1; }
  },

  watch({ pos, flags }) {
    const id = pos[0];
    const timeout = Number(flags.timeout || 1800) * 1000;
    const interval = Number(flags.interval || 15) * 1000;
    const t0 = Date.now();
    while (true) {
      const rec = findJob(id);
      if (!rec) die(`job not found: ${id}`);
      const s = rec.job.state;
      if (['done', 'failed', 'onhold', 'blocked'].includes(s)) {
        out(flags.quiet ? s : { ok: s === 'done', id, state: s, result: rec.job.result || null });
        if (s !== 'done') process.exitCode = 1;
        return;
      }
      if (Date.now() - t0 > timeout) { out({ ok: false, id, state: s, error: 'watch-timeout' }); process.exitCode = 124; return; }
      if (!flags.quiet) console.error(`[arena] ${id} ${s} … waiting ${Math.round(interval / 1000)}s`);
      sleepSync(Math.min(interval, 2000));
    }
  },

  stats() {
    ensureDirs();
    const byState = {};
    const jobs = [];
    for (const s of STATES) {
      const base = path.join(BUS.jobs, s);
      const ids = fs.existsSync(base) ? fs.readdirSync(base) : [];
      byState[s] = ids.length;
      for (const id of ids) {
        const j = readJson(path.join(base, id, 'job.json'));
        if (!j) continue;
        const f = readFindings(path.join(base, id));
        jobs.push({ id, title: j.title, target: j.target.value, state: s, priority: j.priority, verdict: j.result?.verdict || null, score: j.result?.score ?? null, counts: countsFor(f), updated_at: j.updated_at, findings: f.map((x) => ({ id: x.id, title: x.title, severity: x.severity, cvss: x.cvss, cwe: x.cwe, verified: !!x.verified, status: x.status })) });
      }
    }
    const sevTotals = {};
    for (const j of jobs) for (const f of j.findings) sevTotals[f.severity] = (sevTotals[f.severity] || 0) + 1;
    out({ ok: true, generated_at: nowIso(), bus: BUS.root, by_state: byState, totals: { jobs: jobs.length, findings: jobs.reduce((a, b) => a + b.findings.length, 0), by_severity: sevTotals }, jobs: jobs.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')) });
  },

  export({ pos, flags }) {
    const rec = findJob(pos[0]);
    if (!rec) die(`job not found: ${pos[0]}`);
    const dir = flags.out ? String(flags.out) : path.join(process.cwd(), 'strix_runs', rec.job.id);
    fs.mkdirSync(dir, { recursive: true });
    const findings = readFindings(rec.dir);
    writeJsonAtomic(path.join(dir, 'run.json'), {
      name: rec.job.id, target: rec.job.target.value, started_at: rec.job.created_at, finished_at: rec.job.updated_at,
      status: rec.job.state === 'done' ? 'finished' : rec.job.state, agent: rec.job.actions.join(','), mode: rec.job.mode,
    });
    writeJsonAtomic(path.join(dir, 'findings.json'), { findings, counts: countsFor(findings) });
    if (fs.existsSync(path.join(rec.dir, 'report.md'))) fs.copyFileSync(path.join(rec.dir, 'report.md'), path.join(dir, 'report.md'));
    if (fs.existsSync(path.join(rec.dir, 'evidence'))) copyDir(path.join(rec.dir, 'evidence'), path.join(dir, 'artifacts'));
    fs.appendFileSync(path.join(dir, 'agent_log.ndjson'), readLines(path.join(rec.dir, 'events.ndjson')).join('\n') + '\n');
    writeJsonAtomic(path.join(dir, 'report.json'), readJson(path.join(rec.dir, 'report.json'), {}));
    out({ ok: true, dir, findings: findings.length });
  },

  commit({ flags }) {
    out({ ok: tryGitCommit(flags.m ? String(flags.m) : `arena: bus sync ${nowIso()}`) });
  },

  serve({ flags }) {
    const port = Number(flags.port || 8787);
    const dashPath = path.join(BUS.root, '..', 'dashboard', 'index.html');
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/api/stats') { const j = spawnSyncJson(['stats']); res.writeHead(200, jsonHeaders()); return res.end(JSON.stringify(j)); }
      if (u.pathname.startsWith('/api/jobs/')) {
        const j = spawnSyncJson(['show', u.pathname.split('/')[3]]);
        res.writeHead(j?.ok ? 200 : 404, jsonHeaders());
        return res.end(JSON.stringify(j));
      }
      if (u.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
      const p = fs.existsSync(dashPath) ? (u.pathname === '/' || u.pathname === '/index.html' ? dashPath : null) : null;
      if (p) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(p)); }
      res.writeHead(404, jsonHeaders()); res.end(JSON.stringify({ error: 'not found', endpoints: ['/api/stats', '/api/jobs/<id>', '/health'] }));
    });
    server.on('error', (e) => die(`serve failed: ${e.message}`));
    server.listen(port, '0.0.0.0', () => console.log(`[arena] serving bus on 0.0.0.0:${port}`));
    const keep = setInterval(() => { ensureDirs(); }, 60000);
    process.on('SIGTERM', () => { clearInterval(keep); server.close(); process.exit(0); });
    process.on('SIGINT', () => { clearInterval(keep); server.close(); process.exit(0); });
  },
};

/* ------------------------------------------------------------- helpers */

const __sab = new SharedArrayBuffer(4);
const __i32 = new Int32Array(__sab);
function sleepSync(ms) { Atomics.wait(__i32, 0, 0, ms); }


function spawnSyncJson(args) {
  try {
    const stdout = execFileSync(process.execPath, [process.argv[1], ...args, '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (e) {
    return { ok: false, error: (e.stdout || e.message || '').toString().slice(0, 400) };
  }
}
function jsonHeaders() { return { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }; }
function copyDir(a, b) {
  fs.mkdirSync(b, { recursive: true });
  for (const e of fs.readdirSync(a, { withFileTypes: true })) {
    const s = path.join(a, e.name);
    if (e.isDirectory()) copyDir(s, path.join(b, e.name));
    else fs.copyFileSync(s, path.join(b, e.name));
  }
}
function blockingList(dir) {
  return readFindings(dir)
    .filter((f) => ['high', 'critical'].includes(f.severity) && f.status === 'open')
    .map((f) => `${f.severity.toUpperCase()} ${f.id} ${f.title}`);
}
function readLines(p) { try { return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()); } catch { return []; } }
function readFindings(dir) { return readLines(path.join(dir, 'findings.ndjson')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
function countFindings(dir) { return readLines(path.join(dir, 'findings.ndjson')).length; }
function countsFor(findings) {
  const c = { total: findings.length, by_severity: {}, open: 0, fixed_verified: 0, blocking: 0 };
  for (const f of findings) {
    c.by_severity[f.severity] = (c.by_severity[f.severity] || 0) + 1;
    if (f.status === 'open') { c.open++; if (['high', 'critical'].includes(f.severity)) c.blocking++; }
    if (f.status === 'fixed-verified') c.fixed_verified++;
  }
  return c;
}
function scoreFor(c, mode) { return scoreForFindings(Object.entries(c.by_severity || {}).map(([severity, n]) => ({ severity, status: 'open' })).flatMap(([severity, n]) => Array(n).fill({ severity, status: 'open' }))); }
/**
 * درجة الأمان = 100 − عقوبات النتائج المفتوحة فقط.
 * fixed-verified لا تُعاقَب، accepted-risk نصف العقوبة، false-positive صفر.
 */
function scoreForFindings(findings) {
  const w = { critical: 25, high: 12, medium: 5, low: 2, info: 0 };
  const mult = { open: 1, 'fix-pending-retest': 1, 'accepted-risk': 0.5, 'false-positive': 0, 'fixed-verified': 0 };
  let s = 100;
  for (const f of findings || []) s -= (w[f.severity] ?? 1) * (mult[f.status ?? 'open'] ?? 1);
  return Math.max(0, Math.min(100, Math.round(s)));
}
function touch(dir) {
  const jf = path.join(dir, 'job.json');
  const j = readJson(jf);
  if (j) { j.updated_at = nowIso(); if (j.lease) j.lease.heartbeat_at = nowIso(); writeJsonAtomic(jf, j); }
}
function validateFinding(f) {
  const errs = [];
  for (const k of ['title', 'severity', 'cvss', 'description', 'reproduction', 'remediation']) if (f[k] === undefined) errs.push(`missing ${k}`);
  if (f.severity && !Object.keys(SEVERITY_RANK).includes(f.severity)) errs.push(`severity must be one of ${Object.keys(SEVERITY_RANK).join('|')}`);
  if (f.cvss !== undefined && (typeof f.cvss !== 'number' || f.cvss < 0 || f.cvss > 10)) errs.push('cvss must be 0-10');
  if (f.reproduction && !f.reproduction.steps) errs.push('reproduction.steps required (PoC)');
  return errs;
}
function autoReport(job, findings) {
  const c = countsFor(findings);
  const L = [];
  L.push(`# تقرير فحص أمني — ${job.title}`);
  L.push('');
  L.push(`- **المعرّف:** \`${job.id}\``);
  L.push(`- **الهدف:** \`${job.target.value}\` (${job.target.kind})`);
  L.push(`- **الوضع:** ${job.mode} — **الأولوية:** ${job.priority}`);
  L.push(`- **التاريخ:** ${nowIso()}`);
  L.push(`- **المنفّذ:** Arena Agent Mode (بدون API خارجي)`);
  L.push(`- **الخلاصة:** ${c.total} نتيجة — ${c.blocking} حاسمة/عالية`);
  L.push('');
  L.push('## الجدول');
  L.push('');
  L.push('| | الخطورة | CVSS | العنوان | مُثبَت | الحالة |');
  L.push('|---|---|---|---|---|---|');
  for (const f of findings) L.push(`| ${f.id} | ${f.severity} | ${f.cvss} | ${f.title} | ${f.verified ? '✅' : '—'} | ${f.status} |`);
  L.push('');
  for (const f of findings) {
    L.push(`## ${f.severity.toUpperCase()} — ${f.title} (\`${f.id}\`)`);
    L.push('');
    L.push(f.description);
    L.push('');
    L.push(`**خطوات الإثبات (PoC):**`);
    for (const s of f.reproduction?.steps || []) L.push(`- ${s}`);
    if (f.reproduction?.request) { L.push(''); L.push('```http'); L.push(f.reproduction.request); L.push('```'); }
    if (f.reproduction?.response) { L.push(''); L.push('```'); L.push(f.reproduction.response); L.push('```'); }
    L.push('');
    L.push(`**الإصلاح المقترح:** ${f.remediation?.summary || f.remediation}`);
    if (f.remediation?.patch) { L.push(''); L.push('```diff'); L.push(f.remediation.patch); L.push('```'); }
    L.push('');
    L.push(`**المرجع:** CWE-${f.cwe || '?'} · OWASP ${f.owasp || '?'} · ${f.references || ''}`);
    L.push('');
    L.push('---');
    L.push('');
  }
  L.push(`> هذا التقرير يولَّده من \`arena\` CLI من ناقل الملفات، ويُقرأ مباشرة من n8n عبر \`arena show\`.`);
  return L.join('\n');
}
function ping(url, body) {
  try {
    const u = new URL(url);
    const http = u.protocol === 'https:' ? require('node:https') : require('node:http');
    const req = http.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'POST', headers: { 'content-type': 'application/json' }, timeout: 4000 }, (res) => { res.resume(); });
    req.on('error', () => {});
    req.end(JSON.stringify({ source: 'arena-bus', ...body }));
  } catch {}
}
function tryGitCommit(msg) {
  if (process.env.ARENA_GIT === 'off') return false;
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: BUS.root, encoding: 'utf8' }).trim();
    execFileSync('git', ['add', '-A', path.relative(root, BUS.root)], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', msg, '--no-verify'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

/* ------------------------------------------------------------------ main */

ensureDirs();
const { pos, flags } = parseArgs(process.argv.slice(2));
const cmd = pos[0] || 'help';
const rest = { pos: pos.slice(1), flags };
if (!CMD[cmd]) die(`unknown command: ${cmd}\nrun \`arena help\``);
CMD[cmd](rest);
