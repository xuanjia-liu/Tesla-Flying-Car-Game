"""Builds the hero flying roadster and exports it as GLB.

Run headless:
  blender -b -P tools/blender/build_hero_car.py -- public/models/roadster.glb

Modelling space used below: X right, Y up, Z forward (three.js convention).
`v()` converts to Blender's Z-up / -Y-forward space so the glTF exporter
produces a +Z-forward, +Y-up model.
"""
import math
import sys

import bmesh
import bpy

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "roadster.glb"


def v(x, y, z):
    return (x, -z, y)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, metallic=0.0, roughness=0.5, emission=None, strength=1.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = roughness
    m.diffuse_color = (*(emission or color), 1)
    if coat:
        p.inputs["Coat Weight"].default_value = coat
    if emission:
        p.inputs["Emission Color"].default_value = (*emission, 1)
        p.inputs["Emission Strength"].default_value = strength
    return m


MAT = {
    "Paint": material("Paint", (0.86, 0.87, 0.9), 0.85, 0.22, coat=1.0),
    "Glass": material("Glass", (0.01, 0.015, 0.025), 0.2, 0.04),
    "Trim": material("Trim", (0.03, 0.032, 0.036), 0.5, 0.45),
    "Tire": material("Tire", (0.02, 0.02, 0.022), 0.0, 0.85),
    "Rim": material("Rim", (0.55, 0.57, 0.6), 1.0, 0.25),
    "LightFront": material("LightFront", (1, 1, 1), emission=(0.85, 0.93, 1.0), strength=6),
    "LightRear": material("LightRear", (1, 0.05, 0.08), emission=(1.0, 0.04, 0.08), strength=6),
    "Accent": material("Accent", (0.1, 0.7, 1.0), emission=(0.15, 0.75, 1.0), strength=4),
    "ThrusterGlow": material("ThrusterGlow", (0.6, 0.85, 1.0), emission=(0.45, 0.8, 1.0), strength=2),
    "WheelGlow": material("WheelGlow", (0.1, 0.7, 1.0), emission=(0.15, 0.75, 1.0), strength=3),
}


def new_obj(name, bm, mat, parent=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = smooth
    me.materials.append(MAT[mat])
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    if parent:
        ob.parent = parent
    return ob


def superellipse_ring(cx, cy, w, h_top, h_bot, n, exp_top=3.2, exp_bot=5.0):
    pts = []
    for i in range(n):
        a = (i / n) * math.tau
        c, s = math.cos(a), math.sin(a)
        e = exp_top if s >= 0 else exp_bot
        x = cx + w * math.copysign(abs(c) ** (2 / e), c)
        hh = h_top if s >= 0 else h_bot
        y = cy + hh * math.copysign(abs(s) ** (2 / e), s)
        pts.append((x, y))
    return pts


def loft(name, sections, mat, n=16, subsurf=2, exp_top=3.2, exp_bot=5.0, parent=None):
    """sections: list of (z, bottom_y, top_y, half_width, mid_y_frac)."""
    bm = bmesh.new()
    rings = []
    for z, yb, yt, w, *rest in sections:
        mid = rest[0] if rest else 0.45
        cy = yb + (yt - yb) * mid
        pts = superellipse_ring(0, cy, w, yt - cy, cy - yb, n, exp_top, exp_bot)
        rings.append([bm.verts.new(v(x, y, z)) for x, y in pts])
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        verts = list(reversed(ring)) if flip else ring
        bm.faces.new(verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_obj(name, bm, mat, parent)
    if subsurf:
        mod = ob.modifiers.new("sub", "SUBSURF")
        mod.levels = subsurf
        mod.render_levels = subsurf
    return ob


def box(name, size, center, mat, bevel=0.0, parent=None, segments=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = size
    for vert in bm.verts:
        x, y, z = vert.co
        vert.co = v(x * sx + center[0], y * sy + center[1], z * sz + center[2])
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segments, affect="EDGES", profile=0.5)
    return new_obj(name, bm, mat, parent, smooth=bevel > 0)


def cylinder_x(name, radius, width, center, mat, segs=28, parent=None, bevel=0.0):
    """Cylinder whose axis is the model X axis."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=radius, radius2=radius, depth=width)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=__import__("mathutils").Matrix.Rotation(math.pi / 2, 3, "Y"))
    if bevel:
        caps = [e for e in bm.edges if any(len(f.verts) > 4 for f in e.link_faces)]
        bmesh.ops.bevel(bm, geom=caps, offset=bevel, segments=3, affect="EDGES", profile=0.5, clamp_overlap=True)
    for vert in bm.verts:
        vert.co.x += center[0]
        vert.co.y += -center[2]
        vert.co.z += center[1]
    return new_obj(name, bm, mat, parent)


def torus_x(name, major, minor, x_offset, mat, parent=None, segs=40, rings=8):
    """Thin ring lying in the model YZ plane (axis along X)."""
    bm = bmesh.new()
    grid = []
    for i in range(segs):
        a = i / segs * math.tau
        row = []
        for j in range(rings):
            b = j / rings * math.tau
            r = major + minor * math.cos(b)
            row.append(bm.verts.new(v(x_offset + minor * math.sin(b), r * math.sin(a), r * math.cos(a))))
        grid.append(row)
    for i in range(segs):
        for j in range(rings):
            a, b = grid[i][j], grid[(i + 1) % segs][j]
            c, d = grid[(i + 1) % segs][(j + 1) % rings], grid[i][(j + 1) % rings]
            bm.faces.new((a, b, c, d))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj(name, bm, mat, parent)


def cylinder_z(name, r0, r1, length, center, mat, segs=24, parent=None):
    """Cone/cylinder along the model Z (forward) axis."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r0, radius2=r1, depth=length)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=__import__("mathutils").Matrix.Rotation(math.pi / 2, 3, "X"))
    for vert in bm.verts:
        vert.co.x += center[0]
        vert.co.y += -center[2]
        vert.co.z += center[1]
    return new_obj(name, bm, mat, parent)


root = bpy.data.objects.new("Roadster", None)
scene.collection.objects.link(root)

# ---- main body: long, low wedge with pronounced rear haunches ----
body_sections = [
    # z,    bottom, top,  half-w, mid
    (-2.36, 0.36, 0.78, 0.80, 0.55),
    (-2.22, 0.27, 0.90, 0.93, 0.5),
    (-1.80, 0.23, 0.97, 1.00, 0.45),
    (-1.25, 0.22, 0.97, 1.02, 0.45),
    (-0.60, 0.21, 0.90, 0.96, 0.45),
    (0.10, 0.21, 0.83, 0.92, 0.45),
    (0.80, 0.21, 0.76, 0.94, 0.45),
    (1.45, 0.22, 0.69, 0.99, 0.45),
    (1.95, 0.25, 0.58, 0.95, 0.45),
    (2.25, 0.30, 0.48, 0.84, 0.45),
    (2.42, 0.36, 0.42, 0.62, 0.5),
]
loft("Body", body_sections, "Paint", n=20, subsurf=2, parent=root)

# ---- teardrop canopy ----
canopy_sections = [
    (-1.30, 0.70, 0.90, 0.48, 0.3),
    (-0.95, 0.70, 1.12, 0.60, 0.3),
    (-0.40, 0.70, 1.24, 0.66, 0.3),
    (0.20, 0.70, 1.22, 0.66, 0.3),
    (0.75, 0.66, 1.06, 0.62, 0.3),
    (1.20, 0.62, 0.80, 0.50, 0.3),
    (1.42, 0.62, 0.68, 0.30, 0.4),
]
loft("Canopy", canopy_sections, "Glass", n=16, subsurf=2, exp_top=2.6, parent=root)

# ---- underbody, diffuser, splitter ----
box("Underbody", (1.70, 0.10, 4.30), (0, 0.22, 0.0), "Trim", bevel=0.04, parent=root)
box("Diffuser", (1.40, 0.22, 0.30), (0, 0.36, -2.28), "Trim", bevel=0.04, parent=root)
box("Splitter", (1.30, 0.05, 0.30), (0, 0.28, 2.12), "Trim", bevel=0.02, parent=root)
for i in range(5):
    box(f"Fin{i}", (0.03, 0.18, 0.28), (-0.56 + i * 0.28, 0.36, -2.30), "Trim", parent=root)

# ---- signature full-width light bars ----
box("LightFront", (1.36, 0.035, 0.05), (0, 0.47, 2.27), "LightFront", bevel=0.012, parent=root)
box("LightRear", (1.56, 0.05, 0.05), (0, 0.74, -2.36), "LightRear", bevel=0.015, parent=root)
for side in (-1, 1):
    box(f"Accent{side}", (0.02, 0.025, 2.9), (side * 0.985, 0.36, 0.0), "Accent", parent=root)

# ---- rear wing on twin struts ----
box("Wing", (1.70, 0.05, 0.40), (0, 1.12, -2.02), "Trim", bevel=0.02, parent=root)
for side in (-1, 1):
    box(f"WingStrut{side}", (0.05, 0.26, 0.22), (side * 0.55, 0.98, -1.98), "Trim", bevel=0.01, parent=root)
    box(f"WingTip{side}", (0.04, 0.16, 0.44), (side * 0.86, 1.12, -2.02), "Paint", bevel=0.01, parent=root)

# ---- twin rear cold-gas thrusters ----
for side in (-1, 1):
    x = side * 0.48
    noz = cylinder_z(f"Nozzle{side}", 0.15, 0.19, 0.34, (x, 0.52, -2.30), "Trim", parent=root)
    noz.name = f"Nozzle_{'L' if side < 0 else 'R'}"
    glow = cylinder_z(f"ThrusterGlow{side}", 0.12, 0.12, 0.02, (x, 0.52, -2.475), "ThrusterGlow", parent=root)
    glow.name = f"ThrusterGlow_{'L' if side < 0 else 'R'}"

# ---- wheel pods: each wheel hangs off an empty so the game can swivel it flat for hover mode ----
WHEELS = {"FL": (-0.90, 1.47), "FR": (0.90, 1.47), "RL": (-0.92, -1.47), "RR": (0.92, -1.47)}
for key, (x, z) in WHEELS.items():
    pivot = bpy.data.objects.new(f"wheel_{key}", None)
    pivot.location = v(x, 0.36, z)
    pivot.parent = root
    scene.collection.objects.link(pivot)
    spin = bpy.data.objects.new(f"spin_{key}", None)
    spin.parent = pivot
    scene.collection.objects.link(spin)
    out = 1 if x > 0 else -1
    cylinder_x(f"Tire_{key}", 0.36, 0.28, (0, 0, 0), "Tire", segs=32, parent=spin, bevel=0.06)
    cylinder_x(f"Rim_{key}", 0.25, 0.30, (0, 0, 0), "Rim", segs=6, parent=spin)
    cylinder_x(f"Hub_{key}", 0.10, 0.31, (0, 0, 0), "WheelGlow", segs=16, parent=spin)
    torus_x(f"RimGlow_{key}", 0.285, 0.022, out * 0.15, "WheelGlow", parent=spin)

if "--preview" in sys.argv:
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = v(4.6, 2.4, 5.4)
    target = bpy.data.objects.new("t", None)
    target.location = v(0, 0.5, 0)
    scene.collection.objects.link(target)
    c = cam.constraints.new("TRACK_TO")
    c.target = target
    scene.camera = cam
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.resolution_x, scene.render.resolution_y = 960, 540
    scene.render.filepath = OUT.replace(".glb", "-preview.png")
    bpy.ops.render.render(write_still=True)
    scene.collection.objects.unlink(cam)
    scene.collection.objects.unlink(target)

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_extras=False,
    export_cameras=False,
    export_lights=False,
)
tris = 0
dg = bpy.context.evaluated_depsgraph_get()
for ob in scene.objects:
    if ob.type == "MESH":
        me = ob.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
print(f"EXPORTED {OUT} triangles={tris}")
