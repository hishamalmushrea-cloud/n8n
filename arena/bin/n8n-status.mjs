#!/usr/bin/env node
/**
 * n8n-status — يقرأ سجل n8n مباشرة من قاعدة SQLite (قراءة فقط).
 * لا API، لا منفذ، لا مفتاح: نفس فلسفة الناقل.
 *
 *   node arena/bin/n8n-status.mjs [--limit 10] [--workflow <id>] [--nodes] [--json]
 *
 * يُستخدم من لوحة المعلومات، أو من سير عمل n8n نفسه (لتقرير "ماذا جرى اليوم").
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i === -1 ? d : (argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[i + 1]); };

const HOME = process.env.HOME || '/home/user';
const candidates = [
  process.env.N8N_SQLITE,
  path.join(HOME, '.n8n', 'database.sqlite'),
  path.join(HOME, '.n8n', 'n8n.sqlite.db'),
].filter(Boolean);
const dbPath = candidates.find((p) => fs.existsSync(p));
if (!dbPath) { console.log(JSON.stringify({ ok: false, error: 'n8n sqlite not found', looked: candidates })); process.exit(1); }

let sqlite3;
const tryReqs = [];
tryReqs.push(() => require('sqlite3'));
tryReqs.push(() => createRequire(path.join(process.cwd(), 'noop.js'))('sqlite3'));
if (process.env.N8N_MODULES) tryReqs.push(() => createRequire(path.join(process.env.N8N_MODULES, 'noop.js'))('sqlite3'));
for (const f of tryReqs) { try { sqlite3 = f(); if (sqlite3) break; } catch {} }
if (!sqlite3) {
  console.log(JSON.stringify({ ok: false, error: "module 'sqlite3' غير متاح — شغّل من مجلد n8n-runtime أو اضبط N8N_MODULES=/path/to/node_modules", hint: 'N8N_MODULES=/home/user/n8n-runtime/node_modules node arena/bin/n8n-status.mjs' }));
  process.exit(1);
}

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
const run = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));

(async () => {
  const wfFilter = typeof flag('workflow') === 'string' ? 'where e."workflowId" = ?' : '';
  const params = wfFilter ? [flag('workflow')] : [];
  const rows = await run(
    `select e.id, e."workflowId", e.status, e.mode, e."startedAt", e."stoppedAt", e.finished, w.name as workflow
       from execution_entity e left join workflow_entity w on w.id = e."workflowId"
       ${wfFilter} order by e.id desc limit ?`, [...params, Number(flag('limit', 10))]);
  const out = [];
  for (const r of rows) {
    const item = { ...r, nodes: null };
    if (flag('nodes')) {
      try {
        const [{ data }] = await run('select data from execution_data where "executionId" = ?', [r.id]);
        const d = JSON.parse(data);
        item.run_data = Object.entries(d.resultData?.runData || {}).map(([node, execs]) => ({
          node,
          status: execs[execs.length - 1]?.startedAt ? 'ran' : 'unknown',
          startedAt: execs[0]?.startedAt,
          source: execs[execs.length - 1]?.source?.previousNode || null,
          output: execs[execs.length - 1]?.data?.main?.[0]?.[0]?.json ?? null,
          error: execs[execs.length - 1]?.error?.message ?? null,
        }));
        item.error_message = d.resultData?.error?.message || null;
        item.last_node = d.resultData?.lastNodeExecuted || null;
      } catch (e) { item.nodes_error = e.message; }
    }
    out.push(item);
  }
  const summary = {
    ok: true, db: dbPath, generated_at: new Date().toISOString(),
    totals: {
      executions: out.length,
      success: out.filter((r) => r.status === 'success').length,
      failed: out.filter((r) => !['success', 'running', 'waiting'].includes(r.status)).length,
      running: out.filter((r) => ['running', 'waiting', 'new'].includes(r.status)).length,
    },
    executions: out,
  };
  if (flag('json')) { console.log(JSON.stringify(summary, null, 2)); return; }
  console.log(`n8n DB: ${dbPath}`);
  console.table(out.map((r) => ({ id: r.id, workflow: r.workflow || r.workflowId, status: r.status, started: r.startedAt, lastNode: r.last_node || '', error: (r.error_message || '').slice(0, 60) })));
})().catch((e) => { console.log(JSON.stringify({ ok: false, error: e.message })); process.exit(1); })
  .finally(() => db.close());
