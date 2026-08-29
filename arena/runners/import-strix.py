#!/usr/bin/env python3
"""import-strix.py — حوّل مخرجات Strix إلى عناصر findings في ناقل arena.

Strix يكتب نتائجها في  strix_runs/<run-name>/…  بصيغ متعددة حسب الإصدار.
هذه الأداة متسامحة: تبحث عن أي JSON يحوي قائمة ثغرات، وتطابق ما تستطيع،
ثم تكتبها بـ arena add-finding (فتُتحقّق من المخطط وتُحقَن الأدلة).

  python3 import-strix.py <JOB_ID> <runs_dir> [--strix-exit N] [--strict]
"""
import argparse
import json
import os
import re
import subprocess
import sys

SEV_MAP = {
    "critical": "critical", "crit": "critical", "9": "critical",
    "high": "high", "h": "high", "severe": "high", "7": "high",
    "medium": "medium", "med": "medium", "moderate": "medium", "5": "medium",
    "low": "low", "l": "low", "minor": "low", "2": "low",
    "info": "info", "informational": "info", "note": "info",
}
LIST_KEYS = ("vulnerabilities", "findings", "issues", "results", "reports")
FIND_KEYS = ("finding", "vulnerability", "issue", "title", "name", "description", "severity")


def walk_lists(obj, path=""):
    """يعطي كل قائمة تبدو كقائمة ثغرات."""
    found = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}/{k}"
            if isinstance(v, list) and v and isinstance(v[0], dict):
                keys = {kk.lower() for kk in v[0].keys()}
                if keys & set(FIND_KEYS):
                    found.append((p, v))
            else:
                found.extend(walk_lists(v, p))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            found.extend(walk_lists(v, f"{path}[{i}]"))
    return found


def norm_finding(raw):
    def get(*names, default=None):
        for n in names:
            for k in raw.keys():
                if k.lower() == n:
                    return raw[k]
        return default

    title = get("title", "name", "summary", "finding", default="")
    if isinstance(title, dict):
        title = title.get("value") or str(title)[:200]
    title = str(title).strip() or "(untitled finding)"

    sev = str(get("severity", "risk", "level", default="medium")).lower().strip()
    sev = SEV_MAP.get(sev, "medium" if not any(c.isdigit() for c in sev) else SEV_MAP.get(re.sub(r"\D", "", sev)[:1], "medium"))

    cvss = get("cvss", "cvss_score", "score", "severity_score")
    try:
        cvss = float(re.findall(r"\d+(?:\.\d+)?", str(cvss))[0])
    except Exception:
        cvss = {"critical": 9.1, "high": 7.5, "medium": 5.3, "low": 3.1, "info": 0.0}[sev]

    steps = get("steps", "reproduction_steps", "proof_of_concept", "poc", default=None)
    if isinstance(steps, str):
        steps = [s for s in re.split(r"\n+", steps) if s.strip()]
    if not isinstance(steps, list) or not steps:
        ev = get("evidence", "request", "http_request", "exploit", "payload", default=None)
        steps = [str(ev)[:2000]] if ev else [f"راجع مخرجات Strix الأصلية للنتيجة: {title}"]

    desc = get("description", "details", "impact", "summary", default="")
    if isinstance(desc, (dict, list)):
        desc = json.dumps(desc, ensure_ascii=False)[:4000]
    desc = str(desc).strip() or title

    rem = get("remediation", "recommendation", "fix", "mitigation", default=None)
    if rem is None:
        rem = "طبّق التوصية الواردة في تقرير Strix، ثم أعد الفحص بـ: arena retest <JOB_ID>"
    if isinstance(rem, (dict, list)):
        rem = json.dumps(rem, ensure_ascii=False)

    out = {
        "title": title[:300],
        "severity": sev,
        "cvss": min(10.0, max(0.0, cvss)),
        "cwe": str(get("cwe", "cwe_id", default="") or "").replace("CWE-", ""),
        "owasp": get("owasp", "owasp_category", "category", default="") or "",
        "description": desc[:6000],
        "reproduction": {"steps": [str(s)[:1500] for s in steps[:12]]},
        "remediation": {"summary": str(rem)[:3000]},
        "verified": bool(get("verified", "confirmed", "poc_validated", default=False)) or bool(get("poc", "proof_of_concept")),
        "source": "strix",
        "source_ref": get("id", "uid", "uuid", default=None),
    }
    req, resp = get("request", "http_request"), get("response", "http_response")
    if req:
        out["reproduction"]["request"] = str(req)[:4000]
    if resp:
        out["reproduction"]["response"] = str(resp)[:4000]
    for evk in ("file", "filepath", "location", "code_location", "line"):
        if raw.get(evk) is not None:
            out.setdefault("code_location", {})[evk] = raw[evk]
    return {k: v for k, v in out.items() if v not in ("", None, {}, [])}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("job_id")
    ap.add_argument("runs_dir")
    ap.add_argument("--strix-exit", type=int, default=None)
    ap.add_argument("--strict", action="store_true", help="لا تكتب نتيجة غير مكتملة")
    ap.add_argument("--arena", default=os.environ.get("ARENA_BIN", "arena"))
    args = ap.parse_args()

    candidates = []
    for root, _dirs, files in os.walk(args.runs_dir):
        if os.sep + args.job_id + os.sep in root:
            continue
        for f in files:
            if f.lower().endswith((".json", ".jsonl", ".ndjson")) and "arena" not in root:
                candidates.append(os.path.join(root, f))

    imported = skipped = 0
    for path in sorted(candidates, key=lambda p: (-os.path.getmtime(p), p)):
        try:
            if path.endswith((".jsonl", ".ndjson")):
                docs = [json.loads(l) for l in open(path) if l.strip()]
            else:
                docs = [json.load(open(path))]
        except Exception:
            continue
        lists = []
        for d in docs:
            if isinstance(d, list):
                lists.append(("<root>", d))
            lists.extend(walk_lists(d))
        if not lists:
            continue
        for where, items in lists:
            for raw in items[:200]:
                if not isinstance(raw, dict):
                    continue
                f = norm_finding(raw)
                if args.strict and (not f.get("cwe") or len(f["description"]) < 40):
                    skipped += 1
                    continue
                p = subprocess.run([args.arena, "add-finding", args.job_id, "--stdin"],
                                    input=json.dumps(f, ensure_ascii=False), text=True,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                if p.returncode == 0:
                    imported += 1
                else:
                    skipped += 1
                    print(f"[import] reject {path}{where}: {p.stderr.strip()[:160]}", file=sys.stderr)
        if imported:
            break  # أول ملف مُرضٍ يكفي (تجنّب تكرار نفس الفحص من نسخ متعددة)

    summary = {
        "ok": True,
        "job": args.job_id,
        "imported": imported,
        "skipped": skipped,
        "scanned_files": len(candidates),
        "strix_exit": args.strix_exit,
        "verdict_hint": "PASS" if (args.strix_exit == 0 and imported == 0) else ("FAIL" if imported else "UNKNOWN"),
    }
    subprocess.run([args.arena, "note", args.job_id, f"strix import: {imported} imported / {skipped} rejected"], text=True)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
