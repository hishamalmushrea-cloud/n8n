#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Arena ↔ Blender Sync Agent  (arena_sync.py)
===========================================
الوسيط بين وكيل Arena (في المحادثة) و Blender على جهازك، عبر مستودع GitHub.

المطلوب على جهازك:
  1) برنامج git مثبّت (مع أي Clone لـ GitHub)
  2) هذا المستودع منسوخ محلياً (Clone) — انظر ARENA-LINK-GUIDE.md
  3) خادم الجسر يعمل داخل Blender  (blender_n8n_server.py)

التشغيل (من مجلد المستودع):
  python arena-bridge/arena_sync.py

يمكن ضبطه بمتغيرات البيئة:
  ARENA_BRANCH  الفرع            (افتراضي: arena/01a05efe-n8n)
  ARENA_BRIDGE  رابط الجسر        (افتراضي: http://127.0.0.1:9876)
  ARENA_POLL    ثواني بين السحب   (افتراضي: 15)

كيف يعمل؟
  - يسحب (git pull) كل دورة بحثاً عن أوامر جديدة في:  arena-bridge/commands/
  - ينفذ كل أمر عبر جسر Blender المحلي
  - يحفظ النتيجة (+ صورة إن وجدت) في:              arena-bridge/results/<id>/
  - يرفع النتائج (git push) ليراها وكيل Arena ويكمل معك

صيغة الأمر (يكتبها الوكيل في ملف JSON داخل commands/):
  {"id": "cmd-...", "action": "exec|render|screenshot|scene|health", "params": {...}}
"""

import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

try:  # طباعة عربية سليمة على ويندوز
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRANCH = os.environ.get("ARENA_BRANCH", "arena/01a05efe-n8n")
BRIDGE = os.environ.get("ARENA_BRIDGE", "http://127.0.0.1:9876").rstrip("/")
POLL = int(os.environ.get("ARENA_POLL", "10"))

# كم مرة يعيد المحاولة إذا كان Blender مغلقاً (10 ثوانٍ × 60 = ينتظر ~10 دقائق)
MAX_BRIDGE_RETRIES = int(os.environ.get("ARENA_BRIDGE_RETRIES", "60"))

CMDS_DIR = os.path.join(ROOT, "arena-bridge", "commands")
RESULTS_DIR = os.path.join(ROOT, "arena-bridge", "results")
STATE_FILE = os.path.join(ROOT, "arena-bridge", ".arena-sync.json")

ACTION_TIMEOUTS = {"health": 30, "scene": 60, "exec": 600, "screenshot": 600, "render": 7200}

# عدّاد المحاولات للأوامر التي تنتظر فتح Blender
_wait_attempts = {}
_wait_logged = set()


def log(msg):
    print("[arena-sync] %s" % msg, flush=True)


def git(*args, **kw):
    return subprocess.run(["git"] + list(args), cwd=ROOT,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, encoding="utf-8", errors="replace", **kw)


def git_ok(*args):
    p = git(*args)
    if p.returncode != 0:
        log("git %s failed: %s" % (" ".join(args[:2]), (p.stdout or "").strip()[:300]))
        return False
    return True


def ensure_identity():
    if not git("config", "user.email").returncode == 0:
        pass
    email = git("config", "user.email").stdout.strip()
    name = git("config", "user.name").stdout.strip()
    if not email:
        git("config", "user.email", "arena-link@users.noreply.github.com")
    if not name:
        git("config", "user.name", "Arena Blender Link")


def sync_down():
    """يجلب أحدث الأوامر من GitHub بدون المساس بالتغييرات المحلية."""
    if not git_ok("fetch", "origin", BRANCH):
        return False
    p = git("rev-parse", "HEAD")
    cur = p.stdout.strip() if p.returncode == 0 else ""
    p2 = git("rev-parse", "origin" + "/" + BRANCH)
    remote = p2.stdout.strip() if p2.returncode == 0 else ""
    if cur == remote:
        return True
    return git_ok("rebase", "--autostash", "origin" + "/" + BRANCH)


def sync_up():
    """يرفع النتائج مع إعادة المحاولة عند الرفض."""
    git_ok("add", "-A", os.path.join("arena-bridge", "results"))
    p = git("status", "--porcelain", "--", os.path.join("arena-bridge", "results"))
    if not p.stdout.strip():
        return True  # لا شيء جديد
    if not git_ok("commit", "-m", "Arena bridge: results update"):
        return False
    for attempt in range(3):
        if git_ok("push", "origin", BRANCH):
            return True
        git_ok("fetch", "origin", BRANCH)
        if not git_ok("rebase", "--autostash", "origin" + "/" + BRANCH):
            return False
    return False


def load_state():
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def save_state(state):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as fh:
            json.dump(state, fh)
    except Exception:
        pass


def call_bridge(cmd):
    action = cmd.get("action", "health")
    params = dict(cmd.get("params") or {})
    timeout = float(params.pop("timeout", 0)) or ACTION_TIMEOUTS.get(action, 300)
    try:
        if action in ("health", "scene"):
            req = urllib.request.Request(BRIDGE + "/" + action, method="GET")
        elif action in ("exec", "render", "screenshot"):
            req = urllib.request.Request(
                BRIDGE + "/" + action,
                data=json.dumps(params).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST")
        else:
            return {"ok": False, "error": "unknown action: %s" % action}
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8", "replace")[:2000]
        except Exception:
            body = ""
        return {"ok": False, "error": "HTTP %s: %s" % (exc.code, body)}
    except Exception as exc:
        return {"ok": False,
                "error": "cannot reach Blender bridge at %s — تأكد أن "
                         "blender_n8n_server.py يعمل داخل Blender (%s)" % (BRIDGE, exc)}


def process_command(cmd_file):
    try:
        with open(cmd_file, "r", encoding="utf-8") as fh:
            cmd = json.load(fh)
    except Exception as exc:
        log("skip unreadable command %s: %s" % (os.path.basename(cmd_file), exc))
        return None
    cid = str(cmd.get("id") or os.path.splitext(os.path.basename(cmd_file))[0])
    out_dir = os.path.join(RESULTS_DIR, cid)
    result_path = os.path.join(out_dir, "result.json")
    if os.path.exists(result_path):
        return None  # نُفّذ سابقاً
    log("executing command: %s (%s)" % (cid, cmd.get("action")))
    result = call_bridge(cmd)
    # إذا كان Blender مغلقاً: انتظر وأعد المحاولة بدل الفشل
    err = str(result.get("error") or "") if isinstance(result, dict) else ""
    if "cannot reach Blender bridge" in err:
        n = _wait_attempts.get(cid, 0) + 1
        _wait_attempts[cid] = n
        if cid not in _wait_logged or n % 12 == 0:
            log("waiting for Blender to open... (%s, retry %d/%d)" % (cid, n, MAX_BRIDGE_RETRIES))
            _wait_logged.add(cid)
        if n < MAX_BRIDGE_RETRIES:
            return None  # أبقِ الأمر معلقاً — سينفذ عند فتح Blender
    os.makedirs(out_dir, exist_ok=True)
    image_ref = None
    img = result.pop("image_base64_png", None) if isinstance(result, dict) else None
    if img:
        try:
            with open(os.path.join(out_dir, "image.png"), "wb") as fh:
                fh.write(base64.b64decode(img))
            image_ref = "image.png"
        except Exception:
            image_ref = None
    payload = {
        "id": cid,
        "action": cmd.get("action"),
        "ok": bool(result.get("ok")) if isinstance(result, dict) else False,
        "result": result,
        "agent_time": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    if image_ref:
        payload["image"] = image_ref
    with open(result_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    _wait_attempts.pop(cid, None)
    log("result saved: %s (ok=%s)" % (cid, payload["ok"]))
    return cid


def main():
    log("Arena <-> Blender sync agent starting")
    log("repo   : %s" % ROOT)
    log("branch : %s | bridge: %s | poll: %ss" % (BRANCH, BRIDGE, POLL))
    ensure_identity()
    os.makedirs(CMDS_DIR, exist_ok=True)
    os.makedirs(RESULTS_DIR, exist_ok=True)

    # أول تشغيل: علّم الأوامر الحالية كمنتهية حتى لا تُنفَّذ أوامر قديمة مفاجئة
    if load_state() is None:
        seen = sorted(os.listdir(CMDS_DIR)) if os.path.isdir(CMDS_DIR) else []
        save_state({"first_run": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "backfilled": len(seen)})
        log("first run: marked %d existing command(s) as seen" % len(seen))

    while True:
        try:
            if sync_down():
                done = []
                if os.path.isdir(CMDS_DIR):
                    for name in sorted(os.listdir(CMDS_DIR)):
                        if name.endswith(".json"):
                            cid = process_command(os.path.join(CMDS_DIR, name))
                            if cid:
                                done.append(cid)
                if done:
                    sync_up()
        except Exception as exc:
            log("loop error: %s" % exc)
        time.sleep(POLL)


if __name__ == "__main__":
    main()
