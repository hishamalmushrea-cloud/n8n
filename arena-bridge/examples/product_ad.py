# -*- coding: utf-8 -*-
"""مثال: إعلان منتج (زجاجة عطر على منصة مع إضاءة استوديو) — يشغّل محلياً أو عبر وكيل Arena."""
import bpy
import math

for ob in list(bpy.context.scene.objects):
    if ob.type in {"MESH", "CAMERA", "LIGHT"}:
        bpy.data.objects.remove(ob, do_unlink=True)

def material(name, color, rough=0.5, metal=0.0, transmission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if transmission:
        bsdf.inputs["Transmission"].default_value = transmission
    return m

# ---- خلفية استوديو منحنية ----
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
floor = bpy.context.active_object
floor.name = "StudioFloor"
floor.data.materials.append(material("StudioWhite", (0.96, 0.96, 0.96), rough=0.9))
bpy.ops.object.modifier_add(type="SUBSURF")

# ---- منصة دائرية معدنية ----
bpy.ops.mesh.primitive_cylinder_add(radius=1.6, depth=0.25, location=(0, 0, 0.125))
podium = bpy.context.active_object
podium.name = "Podium"
podium.data.materials.append(material("GoldMetal", (0.95, 0.75, 0.35), rough=0.25, metal=1.0))

# ---- زجاجة العطر (جسم + عنق + غطاء ذهبي) ----
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 1.15))
body = bpy.context.active_object
body.name = "BottleBody"
body.scale = (0.55, 0.3, 0.75)
bpy.ops.object.modifier_add(type="BEVEL")
body.modifiers["Bevel"].width = 0.06
body.data.materials.append(material("PerfumeGlass", (0.9, 0.85, 0.95), rough=0.05, transmission=0.85))

bpy.ops.mesh.primitive_cylinder_add(radius=0.12, depth=0.5, location=(0, 0, 2.05))
neck = bpy.context.active_object
neck.name = "BottleNeck"
neck.data.materials.append(material("PerfumeGlass", (0.9, 0.85, 0.95), rough=0.05, transmission=0.85))

bpy.ops.mesh.primitive_cylinder_add(radius=0.16, depth=0.28, location=(0, 0, 2.42))
cap = bpy.context.active_object
cap.name = "BottleCap"
cap.data.materials.append(material("GoldMetal", (0.95, 0.75, 0.35), rough=0.25, metal=1.0))

# ---- سائل ذهبي داخل الزجاجة (كتلة أصغر) ----
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.95))
liquid = bpy.context.active_object
liquid.name = "Liquid"
liquid.scale = (0.48, 0.25, 0.55)
liquid.data.materials.append(material("AmberLiquid", (0.85, 0.55, 0.15), rough=0.1))

# ---- إضاءة استوديو ثلاثية النقاط ----
def add_light(name, loc, rot, energy, size=3):
    bpy.ops.object.light_add(type="AREA", location=loc)
    l = bpy.context.active_object
    l.name = name
    l.data.energy = energy
    l.data.size = size
    l.rotation_euler = rot
    return l

add_light("Key",   ( 4, -4, 5), (math.radians(55), 0, math.radians(40)), 600, 4)
add_light("Fill",  (-5, -3, 3), (math.radians(70), 0, math.radians(-35)), 250, 5)
add_light("Rim",   ( 0,  4, 4), (math.radians(115), 0, math.radians(180)), 400, 3)

# ---- كاميرا تصوير إعلاني (زاوية منخفضة قريبة) ----
bpy.ops.object.camera_add(location=(3.2, -5.2, 2.1))
cam = bpy.context.active_object
cam.rotation_euler = (math.radians(80), 0, math.radians(28))
bpy.context.scene.camera = cam

# ---- عمق ميدان ضحل + رندر ----
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.resolution_x = 1600
scene.render.resolution_y = 2000  # طولي — مناسب لإعلان
cam.data.dof.use_dof = True
cam.data.dof.focus_object = podium
cam.data.dof.aperture_fstop = 2.2

world = scene.world or bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.05, 0.08, 1)

import os
os.makedirs(r"C:/n8n-renders", exist_ok=True)
scene.render.filepath = r"C:/n8n-renders/product_ad.png"
bpy.ops.render.render(write_still=True)

RESULT = {
    "created": "product_ad",
    "product": "perfume bottle on gold podium",
    "lighting": "three-point studio",
    "camera": "low angle, f/2.2 DOF",
    "render": r"C:/n8n-renders/product_ad.png",
}
