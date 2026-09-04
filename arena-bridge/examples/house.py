# -*- coding: utf-8 -*-
"""مثال: تصميم بيت مجسم في Blender — يمكن تشغيله محلياً أو يرسله وكيل Arena كأمر.
شغّله داخل Blender (Scripting ▶) أو عبر الجسر: POST /exec بهذا الكود."""
import bpy
import math

# ---- تنظيف المشهد (اختياري: احذف الأسطر إن أردت الإبقاء على الموجود) ----
for ob in list(bpy.context.scene.objects):
    if ob.type in {"MESH", "CAMERA", "LIGHT"}:
        bpy.data.objects.remove(ob, do_unlink=True)

WALL = 0.25          # سماكة الجدار
H = 3.0              # ارتفاع الجدار
SIZE = 8.0           # عرض المنزل

def box(name, loc, size, mat=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = [s / 2 for s in size]
    if mat:
        ob.data.materials.append(mat)
    return ob

def material(name, color, rough=0.8, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m

mat_wall = material("Wall", (0.92, 0.90, 0.85))
mat_wood = material("Wood", (0.45, 0.28, 0.12), rough=0.6)
mat_roof = material("Roof", (0.55, 0.20, 0.15), rough=0.7)
mat_glass = material("Glass", (0.8, 0.9, 1.0), rough=0.05)
mat_glass.node_tree.nodes["Principled BSDF"].inputs["Transmission"].default_value = 0.9

# ---- الأرضية ----
box("Floor", (0, 0, -WALL / 2), (SIZE + 1, SIZE + 1, WALL), mat_wall)

# ---- الجدران الأربعة (مع فتحة باب في الجدار الأمامي) ----
box("Wall_N", (0, SIZE / 2, H / 2), (SIZE, WALL, H), mat_wall)
box("Wall_S_left", (-SIZE / 4 - 0.5, -SIZE / 2, H / 2), (SIZE / 2 - 1, WALL, H), mat_wall)
box("Wall_S_right", (SIZE / 4 + 0.5, -SIZE / 2, H / 2), (SIZE / 2 - 1, WALL, H), mat_wall)
box("Wall_S_top", (0, -SIZE / 2, H - 0.5), (2.0, WALL, 1.0), mat_wall)  # فوق الباب

# ---- نوافذ زجاجية في الجانبين ----
for i, x in enumerate((-SIZE / 4, SIZE / 4)):
    box("Window_E%d" % i, (SIZE / 2, x, H / 2), (WALL, 1.4, 1.4), mat_glass)
    box("Window_W%d" % i, (-SIZE / 2, x, H / 2), (WALL, 1.4, 1.4), mat_glass)

# ---- سقف مائل بسيط (لوحان) ----
roof_l = box("Roof_L", (-SIZE / 4, 0, H + 0.9), (SIZE * 0.62, SIZE + 0.6, 0.18), mat_roof)
roof_l.rotation_euler[1] = math.radians(28)
roof_r = box("Roof_R", (SIZE / 4, 0, H + 0.9), (SIZE * 0.62, SIZE + 0.6, 0.18), mat_roof)
roof_r.rotation_euler[1] = math.radians(-28)

# ---- باب خشبي ----
box("Door", (0, -SIZE / 2, 1.05), (1.0, 0.12, 2.1), mat_wood)

# ---- إضاءة + كاميرا ----
bpy.ops.object.light_add(type="SUN", location=(6, -6, 12))
sun = bpy.context.active_object
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), math.radians(15), math.radians(40))

bpy.ops.object.light_add(type="AREA", location=(-3, 2, 2.6))
bpy.context.active_object.data.energy = 200

bpy.ops.object.camera_add(location=(13, -13, 8))
cam = bpy.context.active_object
cam.rotation_euler = (math.radians(72), 0, math.radians(45))
bpy.context.scene.camera = cam

# ---- عالم + رندر ----
world = bpy.context.scene.world or bpy.data.worlds.new("World")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.65, 0.8, 0.95, 1)

bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
bpy.context.scene.render.resolution_x = 1600
bpy.context.scene.render.resolution_y = 1000

import os
os.makedirs(r"C:/n8n-renders", exist_ok=True)
bpy.context.scene.render.filepath = r"C:/n8n-renders/house.png"
bpy.ops.render.render(write_still=True)

RESULT = {
    "created": "house",
    "walls": 5, "windows": 4, "roof": "gabled", "door": True,
    "camera": "Camera", "render": r"C:/n8n-renders/house.png",
}
