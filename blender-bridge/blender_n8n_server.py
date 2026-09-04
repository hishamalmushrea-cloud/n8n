# -*- coding: utf-8 -*-
"""
Blender ↔ n8n Bridge Server  (blender_n8n_server.py)
====================================================
يشغّل خادم HTTP محلي داخل Blender كي يستدعيه n8n (أو أي أداة) لتنفيذ أوامر
تصميم ثلاثي الأبعاد. يعمل بالكامل بدون إنترنت.

التشغيل من داخل Blender:
  1) افتح تبويب Scripting في Blender
  2) افتح هذا الملف واضغط ▶ (Run Script)
  3) سيعمل الخادم على:  http://127.0.0.1:9876

التشغيل بدون واجهة (headless) من سطر الأوامر:
  blender --background --python blender_n8n_server.py -- --port 9876

نقاط النهاية (Endpoints):
  GET  /health                 → حالة الخادم ونسخة Blender
  GET  /scene                  → قائمة كائنات المشهد ومواصفاتها (ليرى الذكاء الاصطناعي المشهد)
  POST /exec    {"code": "..."} → تنفيذ كود Python (bpy) داخل Blender
                                 ضع النتيجة في متغير RESULT لإرجاعها إلى n8n
  POST /render  {"output": "C:/out/render.png", "engine": "CYCLES",
                 "samples": 64, "res_x": 1920, "res_y": 1080,
                 "camera": "Camera", "frame": 1}   → رندر المشهد
  POST /screenshot {"res_x": 640, "res_y": 360}    → رندر سريع يعود كصورة base64
                                 (الذكاء الاصطناعي "يرى" المشهد عبرها)

ملاحظة أمان: الخادم يستمع على 127.0.0.1 فقط (جهازك المحلي) — لا يستقبل اتصالات خارجية.
"""

import base64
import io
import json
import os
import queue
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import bpy  # noqa: F401  (متوفر داخل Blender فقط)
    IN_BLENDER = True
except ImportError:  # للاختبار خارج Blender
    IN_BLENDER = False
    bpy = None

# ---------------------------------------------------------------------------
# إعدادات
# ---------------------------------------------------------------------------
DEFAULT_PORT = 9876
DEFAULT_HOST = "127.0.0.1"

# طابور الأوامر: الخادم يعمل في خيط منفصل، لكن bpy يجب استدعاؤه من الخيط
# الرئيسي فقط، لذا نمرر الأوامر عبر طابور وينفذها مؤقّت bpy.app.timers.
job_queue = queue.Queue()
results = {}          # job_id → نتيجة التنفيذ
results_lock = threading.Lock()


def _parse_cli_port():
    """يقرأ --port من سطر الأوامر (بعد --) في وضع --background."""
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
        if "--port" in argv:
            i = argv.index("--port")
            if i + 1 < len(argv):
                try:
                    return int(argv[i + 1])
                except ValueError:
                    pass
    return DEFAULT_PORT


# ---------------------------------------------------------------------------
# المهام التي تُنفَّذ على الخيط الرئيسي داخل Blender
# ---------------------------------------------------------------------------
def _jsonable(value):
    """يحوّل قيمة Python إلى شيء قابل للتسلسل JSON."""
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return repr(value)


def job_scene_info():
    scene = bpy.context.scene
    objects = []
    for ob in scene.objects:
        try:
            mat_names = [s.material.name for s in ob.material_slots if s.material]
        except Exception:
            mat_names = []
        objects.append({
            "name": ob.name,
            "type": ob.type,
            "location": [round(v, 4) for v in ob.location],
            "rotation": [round(v, 4) for v in ob.rotation_euler],
            "scale": [round(v, 4) for v in ob.scale],
            "dimensions": [round(v, 4) for v in ob.dimensions],
            "materials": mat_names,
            "visible": not ob.hide_render,
        })
    materials = [{"name": m.name, "users": m.users} for m in bpy.data.materials]
    cameras = [ob.name for ob in scene.objects if ob.type == "CAMERA"]
    return {
        "scene_name": scene.name,
        "blender_version": bpy.app.version_string,
        "render_engine": scene.render.engine,
        "frame": scene.frame_current,
        "object_count": len(objects),
        "objects": objects,
        "materials": materials,
        "cameras": cameras,
        "active_camera": scene.camera.name if scene.camera else None,
    }


def job_exec(params):
    """ينفذ كود Python داخل Blender ويلتقط المخرجات و RESULT."""
    code = params.get("code") or ""
    env = {"RESULT": None}
    buffer = io.StringIO()
    if not isinstance(code, str) or not code.strip():
        return {"ok": False, "error": "empty code"}
    try:
        import contextlib
        with contextlib.redirect_stdout(buffer):
            exec(code, env)  # noqa: S102 — الغرض الأساسي من الأداة
        return {
            "ok": True,
            "stdout": buffer.getvalue()[-8000:],
            "result": _jsonable(env.get("RESULT")),
        }
    except Exception:
        return {
            "ok": False,
            "stdout": buffer.getvalue()[-8000:],
            "error": traceback.format_exc(limit=8)[-8000:],
        }


def job_render(params):
    scene = bpy.context.scene
    engine = params.get("engine")
    if engine:
        allowed = {"CYCLES", "BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"}
        engine = str(engine).upper()
        if engine in allowed:
            scene.render.engine = engine
    samples = params.get("samples")
    if samples and scene.render.engine == "CYCLES":
        try:
            scene.cycles.samples = int(samples)
        except Exception:
            pass
    res_x = params.get("res_x")
    res_y = params.get("res_y")
    if res_x:
        scene.render.resolution_x = int(res_x)
    if res_y:
        scene.render.resolution_y = int(res_y)
    camera = params.get("camera")
    if camera:
        cam = bpy.data.objects.get(str(camera))
        if cam is None:
            return {"ok": False, "error": "Camera not found: %s" % camera}
        scene.camera = cam
    frame = params.get("frame")
    if frame is not None:
        scene.frame_set(int(frame))

    output = params.get("output") or "//n8n_render.png"
    scene.render.filepath = output
    animation = bool(params.get("animation"))
    try:
        if animation:
            bpy.ops.render.render(animation=True)
            return {"ok": True, "output": bpy.path.abspath(output), "animation": True}
        bpy.ops.render.render(write_still=True)
        path = bpy.path.abspath(scene.render.filepath)
        # تصحيح امتداد PNG التلقائي
        if not os.path.isfile(path) and os.path.isfile(path + ".png"):
            path += ".png"
        return {"ok": True, "output": path,
                "size": os.path.getsize(path) if os.path.isfile(path) else None}
    except Exception:
        return {"ok": False, "error": traceback.format_exc(limit=8)[-4000:]}


def job_screenshot(params):
    """رندر سريع صغير يعود كـ base64 حتى 'يرى' الذكاء الاصطناعي النتيجة."""
    import tempfile
    scene = bpy.context.scene
    old = {
        "x": scene.render.resolution_x,
        "y": scene.render.resolution_y,
        "engine": scene.render.engine,
        "samples": getattr(scene.cycles, "samples", None) if scene.render.engine == "CYCLES" else None,
        "filepath": scene.render.filepath,
    }
    try:
        scene.render.resolution_x = int(params.get("res_x", 640))
        scene.render.resolution_y = int(params.get("res_y", 360))
        engine = params.get("engine", "BLENDER_EEVEE_NEXT")
        allowed = {"CYCLES", "BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"}
        if engine.upper() in allowed:
            try:
                scene.render.engine = engine.upper()
            except TypeError:
                scene.render.engine = "BLENDER_EEVEE"
        if scene.render.engine == "CYCLES":
            scene.cycles.samples = int(params.get("samples", 16))
        fd, tmp_path = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        os.remove(tmp_path)
        scene.render.filepath = tmp_path
        bpy.ops.render.render(write_still=True)
        if not os.path.isfile(tmp_path):
            tmp_path += ".png"
        with open(tmp_path, "rb") as fh:
            data = base64.b64encode(fh.read()).decode("ascii")
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        return {"ok": True, "image_base64_png": data}
    except Exception:
        return {"ok": False, "error": traceback.format_exc(limit=8)[-4000:]}
    finally:
        scene.render.resolution_x = old["x"]
        scene.render.resolution_y = old["y"]
        if old["engine"]:
            scene.render.engine = old["engine"]
        if old["samples"] and scene.render.engine == "CYCLES":
            scene.cycles.samples = old["samples"]
        scene.render.filepath = old["filepath"]


def job_health():
    return {
        "ok": True,
        "in_blender": IN_BLENDER,
        "blender_version": bpy.app.version_string if IN_BLENDER else "stub",
        "scene": bpy.context.scene.name if IN_BLENDER else "StubScene",
    }


JOB_HANDLERS = {
    "health": job_health,
    "scene": job_scene_info,
    "exec": job_exec,
    "render": job_render,
    "screenshot": job_screenshot,
}


def _process_queue():
    """مؤقّت bpy — ينفذ مهمة واحدة كل 50ms على الخيط الرئيسي."""
    try:
        job_id, kind, params = job_queue.get_nowait()
    except queue.Empty:
        return 0.05
    handler = JOB_HANDLERS.get(kind)
    try:
        if handler is None:
            outcome = {"ok": False, "error": "unknown job: %s" % kind}
        else:
            outcome = handler(params) if kind in ("exec", "render", "screenshot") else handler()
        # أي handler يعيد ok=False أو يرمي استثناء نُمرره كما هو
        if isinstance(outcome, dict) and "ok" not in outcome:
            outcome = dict(outcome, ok=True)
    except Exception:
        outcome = {"ok": False, "error": traceback.format_exc(limit=8)[-4000:]}
    with results_lock:
        results[job_id] = outcome
    return 0.001 if not job_queue.empty() else 0.05


# ---------------------------------------------------------------------------
# خادم HTTP
# ---------------------------------------------------------------------------
class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "BlenderN8nBridge/1.0"

    def log_message(self, fmt, *args):  # نسخة أهدأ
        sys.stderr.write("[bridge] " + (fmt % args) + "\n")

    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _run_job(self, kind, params, timeout):
        import uuid
        job_id = str(uuid.uuid4())
        job_queue.put((job_id, kind, params))
        waited = 0.0
        while waited < timeout:
            with results_lock:
                if job_id in results:
                    return results.pop(job_id)
            time_sleep(0.02)
            waited += 0.02
        with results_lock:
            results.pop(job_id, None)
        return {"ok": False, "error": "timeout waiting for Blender (job %s)" % kind}

    # --- GET ---
    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/")
        if path in ("", "/health", "/healthz"):
            if IN_BLENDER:
                return self._send(200, self._run_job("health", {}, timeout=15))
            return self._send(200, {"ok": True, "in_blender": False, "stub": True})
        if path == "/scene":
            return self._send(200, self._run_job("scene", {}, timeout=30))
        return self._send(404, {"ok": False, "error": "not found: %s" % path})

    # --- POST ---
    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/")
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            params = json.loads(raw.decode("utf-8") or "{}")
        except Exception as exc:
            return self._send(400, {"ok": False, "error": "bad JSON: %s" % exc})
        if not isinstance(params, dict):
            return self._send(400, {"ok": False, "error": "JSON object expected"})
        if path == "/exec":
            code = params.get("code")
            if not code or not isinstance(code, str):
                return self._send(400, {"ok": False, "error": "field 'code' is required"})
            timeout = float(params.get("timeout", 300))
            return self._send(200, self._run_job("exec", params, timeout=timeout))
        if path == "/render":
            timeout = float(params.get("timeout", 3600))
            return self._send(200, self._run_job("render", params, timeout=timeout))
        if path == "/screenshot":
            timeout = float(params.get("timeout", 600))
            return self._send(200, self._run_job("screenshot", params, timeout=timeout))
        return self._send(404, {"ok": False, "error": "not found: %s" % path})


def time_sleep(seconds):
    if IN_BLENDER:
        # لا تستخدم time.sleep في خيط الخادم داخل Blender بشكل مطوّل؛
        # الانتظار هنا قصير (20ms) لتفقّد النتيجة فقط.
        import time as _t
        _t.sleep(seconds)
    else:
        import time as _t
        _t.sleep(seconds)


def start_server(host=DEFAULT_HOST, port=DEFAULT_PORT):
    # في وضع الاختبار خارج Blender: نفّذ المهام فورًا بدون مؤقّت
    if not IN_BLENDER:
        def _drain():
            while True:
                try:
                    job_id, kind, params = job_queue.get(timeout=0.1)
                except queue.Empty:
                    continue
                handler = JOB_HANDLERS.get(kind)
                try:
                    outcome = handler(params) if kind in ("exec", "render", "screenshot") else handler()
                    if isinstance(outcome, dict) and "ok" not in outcome:
                        outcome = dict(outcome, ok=True)
                except Exception:
                    outcome = {"ok": False, "error": traceback.format_exc(limit=5)}
                with results_lock:
                    results[job_id] = outcome
        threading.Thread(target=_drain, daemon=True).start()
    else:
        try:
            bpy.app.timers.register(_process_queue, first_interval=0.0, persistent=True)
        except Exception as exc:
            print("[bridge] Could not register timer: %s" % exc)
            return None

    httpd = ThreadingHTTPServer((host, port), BridgeHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    print("=" * 60)
    print("  Blender ↔ n8n Bridge is RUNNING")
    print("  http://%s:%d   (health / scene / exec / render / screenshot)" % (host, port))
    print("  اترك Blender مفتوحاً واستدعِ العنوان من n8n")
    print("=" * 60)
    return httpd


# ---------------------------------------------------------------------------
_server = None

if __name__ == "__main__":
    # يعمل عند التشغيل من محرر نصوص Blender أو بـ blender --python
    _port = _parse_cli_port()
    try:
        _server = start_server(port=_port)
    except OSError as exc:
        print("[bridge] Could not start (port busy?): %s" % exc)
