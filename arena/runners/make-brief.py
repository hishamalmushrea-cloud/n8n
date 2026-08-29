#!/usr/bin/env python3
"""make-brief.py — يحوّل job (من `arena show`) إلى بريف تنفيذ لمنهجية Strix.
البريف هو "العقد" الذي يقرأه الوكيل (Arena Agent Mode) أو Strix المحلي."""
import json
import os
import sys

CHECKLIST = {
    "recon": [
        "خريطة السطح: مسارات، ترويسات، إصدارات، robots.txt/sitemap، ملفات مكشوفة (.git, .env, backups)",
        "بصمة التقنيات: server, x-powered-by, cookies flags, TLS",
        "اكتشاف نقاط API: OpenAPI/Swagger، GraphQL introspection، مسارات /admin، /debug، /actuator",
    ],
    "sast": [
        "أسرار في الكود (API keys، passwords، private keys) + .env غير محمي",
        "استعلامات SQL نصية / eval / exec / deserialization غير آمنة",
        "نقاط نهاية بدون تحقق ملكية المورد (IDOR) أو بدون authorisation middleware",
        "اعتماديات معروفة الثغرات (package-lock / requirements) — قارن بقائمة محلية إن أمكن",
        "CSRF، CORS واسع (origin: *)، رفع ملفات بلا تحقق نوع/حجم، SSRF من مدخلات المستخدم",
    ],
    "active": [
        "A01 Broken Access Control: أفقي/رأسي، تجاوز المصادقة، JWT alg=none / عدم تحقق iss-aud",
        "A02 التشفير: كلمات مرور مكشوفة في الرد، HTTPS/TLS إعدادات، Cookies بدون Secure/HttpOnly/SameSite",
        "A03 Injection: SQLi (error/time/blind)، Command، SSTI، Log injection",
        "A05 Security Misconfiguration: ترويسات ناقصة، أوضاع debug، رسائل أخطاء تفصيلية",
        "A07 XSS (reflected/stored/DOM) + A08 منطق العمل (سعر/كمية/صلاحيات/تسابق)",
        "A09/A10: سجلات تحمل أسراراً، SSRF إلى 169.254.169.254 و metadata",
    ],
    "exploit_validation": [
        "لكل نتيجة مشبوهة: اكتب PoC يعمل فعلاً (request/response كامل منقّى)",
        "لا تُبلغ عن شيء لم تُثبته — سياسة Strix: zero false positives مفضّلة على الحجم",
        "احسب CVSS 3.1 وقارنه بـ CWE المناسب",
    ],
    "reporting": [
        "العنوان، الشدة، CVSS، CWE/OWASP، الوصف، خطوات الإثبات، الإصلاح (مع patch إن أمكن)",
        "ملخص تنفيذي بالعربية + جدول + توصيات مرتبة بالأولوية",
        "لا أسرار/بريد حقيقي في التقرير — الناقل يحجب تلقائياً لكن راجع",
    ],
}

MODE_STAGES = {
    "quick": ["recon", "sast", "reporting"],
    "standard": ["recon", "sast", "active", "reporting"],
    "full": ["recon", "sast", "active", "exploit_validation", "reporting"],
    "deep": ["recon", "sast", "active", "exploit_validation", "reporting"],
    "compliance": ["recon", "sast", "active", "exploit_validation", "reporting"],
    "retest": ["sast", "exploit_validation", "reporting"],
}


def main():
    job_path, out_path = sys.argv[1], sys.argv[2]
    doc = json.load(open(job_path))
    job = doc.get("job", doc)
    jid = job.get("id", "?")
    target = (job.get("target") or {}).get("value", "?")
    kind = (job.get("target") or {}).get("kind", "url")
    mode = job.get("mode", "standard")
    actions = job.get("actions", ["passive", "active"])
    ctx = job.get("context", {}) or {}
    cfg = None
    eng = os.path.join(os.path.dirname(os.path.dirname(out_path)), "config", "engagement.json")
    if os.path.exists(eng):
        cfg = json.load(open(eng))
    budget = (cfg or {}).get("maxDurationSeconds", 3600)

    stages = MODE_STAGES.get(mode, MODE_STAGES["standard"])
    if kind == "code" and "sast" not in stages:
        stages.insert(0, "sast")

    lines = [
        f"# بريف فحص أمني — {jid}",
        "",
        f"- **الهدف:** `{target}`  (نوع: {kind})",
        f"- **الوضع:** `{mode}`  ·  **الأولوية:** {job.get('priority', 'P3')}",
        f"- **الإجراءات المصرّح بها:** {', '.join(actions)}",
        f"- **سقف الوقت:** {budget} ثانية · **المنفّذ:** Arena Agent Mode (بدون API خارجي)",
        "",
        "## المراحل",
        "",
    ]
    for i, s in enumerate(stages, 1):
        lines.append(f"### {i}. {s}")
        for item in CHECKLIST[s]:
            lines.append(f"- [ ] {item}")
        lines.append("")

    if ctx.get("instructions"):
        lines += ["## تعليمات إضافية من n8n", "", "```", ctx["instructions"].strip(), "```", ""]
    if ctx.get("payload"):
        lines += ["## حمولة إضافية", "", "```", ctx["payload"].strip(), "```", ""]

    if cfg and cfg.get("forbidden"):
        lines += ["## ممنوع (قواعد الاشتباك)", ""] + [f"- {x}" for x in cfg["forbidden"]] + [""]

    lines += [
        "## طريقة الإرجاع (إلزامية)",
        "",
        "```bash",
        "A=arena/bin/arena   # أو `arena` بعد إضافة PATH",
        f'echo \'{json.dumps({"title": "…", "severity": "high", "cvss": 8.1,',
        '  "cwe": "639", "owasp": "A01", "description": "…",',
        '  "reproduction": {"steps": ["…"], "request": "GET /…", "response": "{…}"},',
        '  "remediation": {"summary": "…"}, "verified": true}\'' + f" | $A add-finding {jid} --stdin",
        f"cat evidence.txt | $A evidence {jid} poc-1.txt --stdin",
        f"$A complete {jid} --summary \"…\"",
        "```",
        "",
        "> `add-finding` يرفض أي نتيجة بلا `reproduction.steps` (لا تقارير بلا إثبات).",
        "> `complete` يولّد report.md/report.json ويبلّغ n8n ويحسب verdict من الشدة.",
    ]
    open(out_path, "w").write("\n".join(lines) + "\n")
    print(out_path)


if __name__ == "__main__":
    main()
