"""Builds the hero car, styled after the next-gen Tesla Roadster revealed in October 2026
(angular Esprit / SR-71 wedge, wraparound glass canopy with a removable roof panel, slim
front light bar with pop-down lamps, full-width tail bar, four-nozzle diffuser, flush
active rear wing), and exports it as GLB.

Run headless:
  blender -b -P tools/blender/build_hero_car.py -- public/models/roadster.glb [--preview]

Modelling space used below: X right, Y up, Z forward (three.js convention).
`v()` converts to Blender's Z-up / -Y-forward space so the glTF exporter
produces a +Z-forward, +Y-up model.

Object names are part of the contract with src/game/car.ts: wheel_XX / spin_XX empties,
Nozzle_* meshes, and the material names Paint / Glass / LightFront / LightRear /
ThrusterGlow / WheelGlow.
"""
import math
import sys

import bmesh
import bpy
from mathutils import Matrix

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
    "Paint": material("Paint", (0.88, 0.89, 0.9), 0.6, 0.25, coat=1.0),
    "Glass": material("Glass", (0.01, 0.015, 0.025), 0.2, 0.04),
    "Trim": material("Trim", (0.025, 0.027, 0.03), 0.4, 0.5),
    "Tire": material("Tire", (0.02, 0.02, 0.022), 0.0, 0.85),
    "Rim": material("Rim", (0.16, 0.17, 0.19), 1.0, 0.3),
    "LightFront": material("LightFront", (1, 1, 1), emission=(0.85, 0.93, 1.0), strength=6),
    "LightRear": material("LightRear", (1, 0.05, 0.08), emission=(1.0, 0.04, 0.08), strength=6),
    "ThrusterGlow": material("ThrusterGlow", (0.6, 0.85, 1.0), emission=(0.45, 0.8, 1.0), strength=2),
    "WheelGlow": material("WheelGlow", (0.1, 0.7, 1.0), emission=(0.15, 0.75, 1.0), strength=3),
}


def new_obj(name, bm, mat, parent=None, smooth=True, sharp_angle=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = smooth
    if sharp_angle is not None:
        me.set_sharp_from_angle(angle=math.radians(sharp_angle))
    me.materials.append(MAT[mat])
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    if parent:
        ob.parent = parent
    return ob


def loft_rings(name, rings, mat, parent=None, sharp_angle=28):
    """rings: list of (z, [(x, y), ...]) with the same point count, ordered front to back or back to front."""
    bm = bmesh.new()
    vr = [[bm.verts.new(v(x, y, z)) for x, y in pts] for z, pts in rings]
    n = len(vr[0])
    for r0, r1 in zip(vr, vr[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    bm.faces.new(list(reversed(vr[0])))
    bm.faces.new(vr[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj(name, bm, mat, parent, smooth=True, sharp_angle=sharp_angle)


def body_ring(yb, ys, yt, wb, ws, wt, crown=0.02):
    """Faceted section: flat floor, tucked lower side, crisp shoulder crease, flat deck with a slight crown."""
    ym = max(yb + 0.03, ys - 0.17)
    wm = ws - 0.025
    right = [(wb, yb), (wm, ym), (ws, ys), (wt, yt)]
    left = [(-x, y) for x, y in reversed(right)]
    return [(0, yb)] + right + [(0, yt + crown)] + left


def cabin_ring(yb, yt, wb, wt, crown=0.03):
    right = [(wb, yb), (wb - 0.015, yb + (yt - yb) * 0.25), (wt, yt)]
    left = [(-x, y) for x, y in reversed(right)]
    return [(0, yb)] + right + [(0, yt + crown)] + left


def box(name, size, center, mat, bevel=0.0, parent=None, segments=2, rot_x=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = size
    ca, sa = math.cos(rot_x), math.sin(rot_x)
    for vert in bm.verts:
        x, y, z = vert.co.x * sx, vert.co.y * sy, vert.co.z * sz
        y, z = y * ca - z * sa, y * sa + z * ca
        vert.co = v(x + center[0], y + center[1], z + center[2])
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segments, affect="EDGES", profile=0.5)
    return new_obj(name, bm, mat, parent, smooth=bevel > 0, sharp_angle=40 if bevel else None)


def prism_x(name, radius, width, center, mat, segs=28, parent=None, bevel=0.0, spin=0.0):
    """Cylinder / n-gon prism whose axis is the model X axis."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=radius, radius2=radius, depth=width)
    if spin:
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(spin, 3, "Z"))
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"))
    if bevel:
        caps = [e for e in bm.edges if any(len(f.verts) > 4 for f in e.link_faces)]
        bmesh.ops.bevel(bm, geom=caps, offset=bevel, segments=3, affect="EDGES", profile=0.5, clamp_overlap=True)
    for vert in bm.verts:
        vert.co.x += center[0]
        vert.co.y += -center[2]
        vert.co.z += center[1]
    return new_obj(name, bm, mat, parent, sharp_angle=50)


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
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"))
    for vert in bm.verts:
        vert.co.x += center[0]
        vert.co.y += -center[2]
        vert.co.z += center[1]
    return new_obj(name, bm, mat, parent, sharp_angle=50)


def apply_modifiers(ob):
    bpy.context.view_layer.objects.active = ob
    for mod in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


root = bpy.data.objects.new("Roadster", None)
scene.collection.objects.link(root)

WHEEL_R = 0.37
WHEELS = {"FL": (-0.90, 1.45), "FR": (0.90, 1.45), "RL": (-0.92, -1.42), "RR": (0.92, -1.42)}

# ---- main body: knife-edge nose, long straight hood rising to the screen, crisp shoulder,
#      haunches over the rear wheels and a tall cut-off tail ----
BODY = [
    # z,     yb,   ys,   yt,   wb,   ws,   wt
    (2.46, 0.30, 0.38, 0.42, 0.62, 0.70, 0.56),
    (2.30, 0.25, 0.42, 0.49, 0.80, 0.90, 0.74),
    (1.95, 0.22, 0.53, 0.62, 0.86, 1.00, 0.82),
    (1.45, 0.22, 0.60, 0.71, 0.86, 1.03, 0.84),
    (0.95, 0.22, 0.58, 0.76, 0.85, 1.00, 0.84),
    (0.30, 0.21, 0.60, 0.80, 0.84, 0.99, 0.84),
    (-0.40, 0.21, 0.63, 0.82, 0.85, 1.02, 0.86),
    (-1.00, 0.21, 0.67, 0.84, 0.86, 1.06, 0.88),
    (-1.45, 0.22, 0.71, 0.86, 0.86, 1.07, 0.89),
    (-1.95, 0.25, 0.69, 0.84, 0.84, 1.04, 0.88),
    (-2.36, 0.30, 0.67, 0.82, 0.80, 0.98, 0.84),
]
body = loft_rings("Body", [(z, body_ring(*r)) for z, *r in BODY], "Paint", parent=root)

# angular (hexagonal, flat-topped) wheel arches, Cybertruck-style
cutters = []
for key, (x, z) in WHEELS.items():
    c = prism_x(f"ArchCut_{key}", 0.45, 0.6, (math.copysign(1.18, x), 0.36, z), "Trim", segs=6, spin=math.pi / 6)
    cutters.append(c)
    mod = body.modifiers.new(f"arch_{key}", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = c
apply_modifiers(body)
for c in cutters:
    bpy.data.objects.remove(c, do_unlink=True)
bev = body.modifiers.new("bevel", "BEVEL")
bev.width = 0.012
bev.segments = 2
bev.limit_method = "ANGLE"
bev.angle_limit = math.radians(25)
bev.harden_normals = True

# dark arch liners so the cut-outs read as wheel wells, not holes
for key, (x, z) in WHEELS.items():
    box(f"ArchLiner_{key}", (0.16, 0.34, 0.80), (math.copysign(0.66, x), 0.42, z), "Trim", parent=root)

# ---- wraparound glass canopy (windscreen flows into the side glass) ----
CANOPY = [
    # z,     yb,   yt,   wb,   wt
    (1.02, 0.70, 0.77, 0.80, 0.74),
    (0.60, 0.70, 0.97, 0.81, 0.62),
    (0.10, 0.72, 1.12, 0.81, 0.56),
    (-0.45, 0.74, 1.14, 0.82, 0.55),
    (-0.95, 0.76, 1.06, 0.83, 0.53),
]
loft_rings("Canopy", [(z, cabin_ring(*r)) for z, *r in CANOPY], "Glass", parent=root)

# removable roof panel in body colour on top of the glass
ROOF = [
    (0.16, 1.085, 1.125, 0.57, 0.52),
    (-0.45, 1.115, 1.155, 0.575, 0.52),
    (-0.90, 1.055, 1.085, 0.555, 0.50),
]
loft_rings("RoofPanel", [(z, cabin_ring(yb, yt, wb, wt, crown=0.01)) for z, yb, yt, wb, wt in ROOF], "Paint", parent=root)

# fastback / sail panels sweeping down to the tail
FASTBACK = [
    (-0.80, 0.78, 1.08, 0.84, 0.54),
    (-1.35, 0.80, 0.99, 0.87, 0.60),
    (-1.90, 0.80, 0.91, 0.88, 0.70),
    (-2.34, 0.78, 0.87, 0.86, 0.76),
]
loft_rings("Fastback", [(z, cabin_ring(*r, crown=0.01)) for z, *r in FASTBACK], "Paint", parent=root)
# rear louvre glass strip on the fastback
LOUVRE = [
    (-0.95, 1.02, 1.065, 0.42, 0.40),
    (-1.55, 0.94, 0.975, 0.46, 0.44),
]
loft_rings("RearGlass", [(z, cabin_ring(yb, yt, wb, wt, crown=0.0)) for z, yb, yt, wb, wt in LOUVRE], "Glass", parent=root)

# ---- front: slim full-width light bar, pop-down lamp pods, intake slot, splitter ----
box("LightFront", (1.30, 0.022, 0.03), (0, 0.395, 2.455), "LightFront", bevel=0.008, parent=root)
for side in (-1, 1):
    box(f"LampRecess{side}", (0.36, 0.012, 0.11), (side * 0.52, 0.572, 2.12), "Trim", parent=root, rot_x=0.36)
    box(f"Lamp{side}", (0.30, 0.014, 0.024), (side * 0.52, 0.565, 2.165), "LightFront", bevel=0.005, parent=root, rot_x=0.36)
box("Intake", (1.10, 0.05, 0.03), (0, 0.33, 2.44), "Trim", bevel=0.01, parent=root)
box("Splitter", (1.50, 0.04, 0.30), (0, 0.24, 2.30), "Trim", bevel=0.015, parent=root)
box("Underbody", (1.66, 0.08, 4.40), (0, 0.22, 0.0), "Trim", bevel=0.03, parent=root)
for side in (-1, 1):
    box(f"Sill{side}", (0.06, 0.07, 1.90), (side * 0.86, 0.255, 0.02), "Trim", bevel=0.015, parent=root)

# ---- rear: full-width tail bar, centre high-mounted stop lamp, diffuser with four nozzles ----
box("LightRear", (1.86, 0.045, 0.04), (0, 0.775, -2.375), "LightRear", bevel=0.012, parent=root)
box("Chmsl", (0.56, 0.02, 0.03), (0, 0.885, -2.335), "LightRear", bevel=0.006, parent=root)
box("TailPanel", (1.62, 0.24, 0.05), (0, 0.55, -2.37), "Trim", bevel=0.015, parent=root)
box("Diffuser", (1.62, 0.20, 0.36), (0, 0.33, -2.24), "Trim", bevel=0.03, parent=root)
for i in range(7):
    box(f"Fin{i}", (0.025, 0.12, 0.30), (-0.66 + i * 0.22, 0.32, -2.30), "Trim", parent=root)
for i, x in enumerate((-0.62, -0.21, 0.21, 0.62)):
    tag = ("L", "L2", "R2", "R")[i]
    cylinder_z(f"Nozzle_{tag}", 0.11, 0.13, 0.22, (x, 0.50, -2.40), "Trim", segs=24, parent=root)
    cylinder_z(f"ThrusterGlow_{tag}", 0.09, 0.09, 0.02, (x, 0.50, -2.515), "ThrusterGlow", segs=24, parent=root)

# flush active rear wing (shown slightly raised), with a dark gap under it
box("WingGap", (1.46, 0.02, 0.32), (0, 0.885, -2.10), "Trim", parent=root)
box("Wing", (1.52, 0.035, 0.38), (0, 0.925, -2.12), "Paint", bevel=0.012, parent=root, rot_x=0.08)

# ---- wheels: large aero discs. Each wheel hangs off an empty (steer pivot) with a child that spins about the axle ----
for key, (x, z) in WHEELS.items():
    pivot = bpy.data.objects.new(f"wheel_{key}", None)
    pivot.location = v(x, WHEEL_R - 0.01, z)
    pivot.parent = root
    scene.collection.objects.link(pivot)
    spin = bpy.data.objects.new(f"spin_{key}", None)
    spin.parent = pivot
    scene.collection.objects.link(spin)
    out = 1 if x > 0 else -1
    prism_x(f"Tire_{key}", WHEEL_R, 0.30, (0, 0, 0), "Tire", segs=32, parent=spin, bevel=0.06)
    prism_x(f"Rim_{key}", 0.27, 0.31, (0, 0, 0), "Rim", segs=10, parent=spin)
    prism_x(f"Hub_{key}", 0.08, 0.32, (0, 0, 0), "WheelGlow", segs=16, parent=spin)
    torus_x(f"RimGlow_{key}", 0.275, 0.015, out * 0.155, "WheelGlow", parent=spin)

if "--preview" in sys.argv:
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 60
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    target = bpy.data.objects.new("t", None)
    target.location = v(0, 0.55, 0)
    scene.collection.objects.link(target)
    c = cam.constraints.new("TRACK_TO")
    c.target = target
    scene.camera = cam
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = 960, 540
    for tag, pos in {"front": (5.2, 1.9, 6.0), "rear": (-5.0, 2.2, -6.2), "side": (8.5, 0.9, 0.0), "top": (0.01, 9.0, 0.5)}.items():
        cam.location = v(*pos)
        scene.render.filepath = OUT.replace(".glb", f"-{tag}.png")
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(target, do_unlink=True)

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
