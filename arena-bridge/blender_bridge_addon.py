# -*- coding: utf-8 -*-
"""
Arena / n8n Bridge — إضافة Blender (Addon)
==========================================
ثبّتها مرة واحدة من: Edit ← Preferences ← Add-ons ← Install
بعدها يعمل الجسر تلقائياً مع كل تشغيل لبلندر — لا تحتاج تشغيل أي شيء يدوياً.

الجسر يستمع محلياً على 127.0.0.1:9876 (آمن — لا وصول من الشبكة)
ويوفّر: /health /scene /exec /render /screenshot
لكل من: وكيل Arena (عبر arena_sync.py) أو n8n أو أي أداة محلية.
"""
bl_info = {
    "name": "Arena / n8n Bridge",
    "author": "Arena Agent",
    "version": (1, 1, 0),
    "blender": (3, 0, 0),
    "location": "تلقائي عند بدء Blender (افتح System Console لرؤية الحالة)",
    "description": "جسر HTTP محلي يتيح لوكيل Arena أو n8n التصميم والرندر داخل Blender تلقائياً",
    "category": "System",
}

import base64
import io
import json
import os
import queue
import tempfile
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import bpy

DEFAULT_PORT = 9876
job_queue = queue.Queue()
results = {}
results_lock = threading.Lock()


def _port():
    try:
        env = os.environ.get("ARENA_BRIDGE_PORT")
        if env:
            return int(env)
    except Exception:
        pass
    try:
        addon = bpy.context.preferences.addons.get(__name__)
        if addon and getattr(addon, "preferences", None) and addon.preferences.port:
            return int(addon.preferences.port)
    except Exception:
        pass
    return DEFAULT_PORT


def _jsonable(value):
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return repr(value)


# ------------------------- المهام (تُنفَّذ على الخيط الرئيسي) -------------------------
def job_health(_):
    return {"in_blender": True,
            "blender_version": bpy.app.version_string,
            "scene": bpy.context.scene.name}


def job_scene(_):
    scene = bpy.context.scene
    objects = []
    for ob in scene.objects:
        try:
            mats = [s.material.name for s in ob.material_slots if s.material]
        except Exception:
            mats = []
        objects.append({
            "name": ob.name, "type": ob.type,
            "location": [round(v, 4) for v in ob.location],
            "rotation": [round(v, 4) for v in ob.rotation_euler],
            "scale": [round(v, 4) for v in ob.scale],
            "dimensions": [round(v, 4) for v in ob.dimensions],
            "materials": mats, "visible": not ob.hide_render,
        })
    return {
        "scene_name": scene.name,
        "blender_version": bpy.app.version_string,
        "render_engine": scene.render.engine,
        "object_count": len(objects),
        "objects": objects,
        "materials": [{"name": m.name} for m in bpy.data.materials],
        "cameras": [ob.name for ob in scene.objects if ob.type == "CAMERA"],
        "active_camera": scene.camera.name if scene.camera else None,
    }


def job_exec(params):
    code = params.get("code") or ""
    if not isinstance(code, str) or not code.strip():
        return {"ok": False, "error": "empty code"}
    env = {"RESULT": None}
    buffer = io.StringIO()
    try:
        import contextlib
        with contextlib.redirect_stdout(buffer):
            exec(code, env)  # noqa: S102
        return {"ok": True, "stdout": buffer.getvalue()[-8000:],
                "result": _jsonable(env.get("RESULT"))}
    except Exception:
        return {"ok": False, "stdout": buffer.getvalue()[-8000:],
                "error": traceback.format_exc(limit=8)[-8000:]}


def job_render(params):
    scene = bpy.context.scene
    engine = str(params.get("engine") or "").upper()
    if engine in {"CYCLES", "BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"}:
        scene.render.engine = engine
    if params.get("samples") and scene.render.engine == "CYCLES":
        try:
            scene.cycles.samples = int(params["samples"])
        except Exception:
            pass
    if params.get("res_x"):
        scene.render.resolution_x = int(params["res_x"])
    if params.get("res_y"):
        scene.render.resolution_y = int(params["res_y"])
    if params.get("camera"):
        cam = bpy.data.objects.get(str(params["camera"]))
        if cam is None:
            return {"ok": False, "error": "camera not found: %s" % params["camera"]}
        scene.camera = cam
    if params.get("frame") is not None:
        scene.frame_set(int(params["frame"]))
    output = params.get("output") or "//arena_render.png"
    scene.render.filepath = output
    try:
        if params.get("animation"):
            bpy.ops.render.render(animation=True)
            return {"ok": True, "output": bpy.path.abspath(output), "animation": True}
        bpy.ops.render.render(write_still=True)
        path = bpy.path.abspath(scene.render.filepath)
        if not os.path.isfile(path) and os.path.isfile(path + ".png"):
            path += ".png"
        return {"ok": True, "output": path,
                "size": os.path.getsize(path) if os.path.isfile(path) else None}
    except Exception:
        return {"ok": False, "error": traceback.format_exc(limit=8)[-4000:]}


def job_screenshot(params):
    scene = bpy.context.scene
    old = (scene.render.resolution_x, scene.render.resolution_y,
           scene.render.engine, scene.render.filepath)
    old_samples = scene.cycles.samples if scene.render.engine == "CYCLES" else None
    fd, tmp = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    os.remove(tmp)
    try:
        scene.render.resolution_x = int(params.get("res_x", 640))
        scene.render.resolution_y = int(params.get("res_y", 360))
        engine = str(params.get("engine", "BLENDER_EEVEE_NEXT")).upper()
        if engine in {"CYCLES", "BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"}:
            try:
                scene.render.engine = engine
            except TypeError:
                scene.render.engine = "BLENDER_EEVEE"
        if scene.render.engine == "CYCLES":
            scene.cycles.samples = int(params.get("samples", 16))
        scene.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        if not os.path.isfile(tmp):
            tmp += ".png"
        with open(tmp, "rb") as fh:
            data = base64.b64encode(fh.read()).decode("ascii")
        try:
            os.remove(tmp)
        except OSError:
            pass
        return {"image_base64_png": data}
    except Exception:
        return {"ok": False, "error": traceback.format_exc(limit=8)[-4000:]}
    finally:
        scene.render.resolution_x, scene.render.resolution_y, scene.render.engine, scene.render.filepath = old
        if old_samples and scene.render.engine == "CYCLES":
            scene.cycles.samples = old_samples


JOB_HANDLERS = {
    "health": job_health,
    "scene": job_scene,
    "exec": job_exec,
    "render": job_render,
    "screenshot": job_screenshot,
}


def _process_queue():
    """مؤقّت bpy — ينفّذ مهمة واحدة على الخيط الرئيسي كل 30ms."""
    try:
        job_id, kind, params = job_queue.get_nowait()
    except queue.Empty:
        return 0.03
    handler = JOB_HANDLERS.get(kind)
    try:
        outcome = handler(params or {})
        if isinstance(outcome, dict) and "ok" not in outcome:
            outcome = dict(outcome, ok=True)
    except Exception:
        outcome = {"ok": False, "error": traceback.format_exc(limit=8)[-4000:]}
    with results_lock:
        results[job_id] = outcome
    return 0.001 if not job_queue.empty() else 0.03


# ------------------------- خادم HTTP -------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "ArenaBridge/1.1"

    def log_message(self, fmt, *args):
        print("[arena-bridge] " + (fmt % args))

    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _run(self, kind, params, timeout):
        import uuid
        job_id = str(uuid.uuid4())
        job_queue.put((job_id, kind, params))
        waited = 0.0
        while waited < timeout:
            with results_lock:
                if job_id in results:
                    return results.pop(job_id)
            import time as _t
            _t.sleep(0.02)
            waited += 0.02
        return {"ok": False, "error": "timeout waiting for Blender (%s)" % kind}

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/")
        if path in ("", "/health", "/healthz"):
            return self._send(200, self._run("health", {}, 15))
        if path == "/scene":
            return self._send(200, self._run("scene", {}, 60))
        return self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/")
        try:
            length = int(self.headers.get("Content-Length") or 0)
            params = json.loads(self.rfile.read(length).decode("utf-8") or "{}") if length else {}
        except Exception as exc:
            return self._send(400, {"ok": False, "error": "bad JSON: %s" % exc})
        if not isinstance(params, dict):
            return self._send(400, {"ok": False, "error": "object expected"})
        if path == "/exec":
            return self._send(200, self._run("exec", params, float(params.get("timeout", 600))))
        if path == "/render":
            return self._send(200, self._run("render", params, float(params.get("timeout", 7200))))
        if path == "/screenshot":
            return self._send(200, self._run("screenshot", params, float(params.get("timeout", 600))))
        return self._send(404, {"ok": False, "error": "not found"})


_server = None


def start_server():
    """يشغّل الخادم إن لم يكن يعمل — يُستدعى تلقائياً عند تسجيل الإضافة."""
    global _server
    if _server is not None:
        return _server
    port = _port()
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as exc:
        print("[arena-bridge] تعذّر فتح المنفذ %s (%s) — ربما نسخة بلندر أخرى تعمل بالفعل بالجسر" % (port, exc))
        return None
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        bpy.app.timers.register(_process_queue, first_interval=0.1, persistent=True)
    except Exception as exc:
        print("[arena-bridge] timer error: %s" % exc)
    _server = httpd
    print("=" * 56)
    print("  Arena/n8n Bridge يعمل الآن تلقائياً  ←  127.0.0.1:%d" % port)
    print("  (health / scene / exec / render / screenshot)")
    print("=" * 56)
    return _server


def stop_server():
    global _server
    if _server is not None:
        _server.shutdown()
        _server = None
    try:
        bpy.app.timers.unregister(_process_queue)
    except Exception:
        pass


# ------------------------- واجهة Blender -------------------------
class ARENA_BRIDGE_OT_restart(bpy.types.Operator):
    """إعادة تشغيل الجسر (بعد تغيير المنفذ مثلاً)"""
    bl_idname = "arena_bridge.restart"
    bl_label = "Restart Arena Bridge"

    def execute(self, context):
        stop_server()
        start_server()
        self.report({"INFO"}, "Arena bridge restarted")
        return {"FINISHED"}


class ARENA_BRIDGE_Prefs(bpy.types.AddonPreferences):
    bl_idname = __name__

    port: bpy.props.IntProperty(
        name="Port", default=DEFAULT_PORT, min=1024, max=65535,
        description="المنفذ المحلي للجسر (افتراضي 9876)")

    def draw(self, context):
        layout = self.layout
        layout.prop(self, "port")
        layout.operator("arena_bridge.restart")


classes = (ARENA_BRIDGE_OT_restart, ARENA_BRIDGE_Prefs)


def register():
    for cls in classes:
        try:
            bpy.utils.register_class(cls)
        except Exception:
            pass
    start_server()


def unregister():
    stop_server()
    for cls in reversed(classes):
        try:
            bpy.utils.unregister_class(cls)
        except Exception:
            pass
