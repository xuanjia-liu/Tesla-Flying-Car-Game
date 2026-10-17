"""Packs selected Kenney CC0 models into a single GLB with one shared texture per kit.

  blender -b -P tools/blender/pack_props.py -- <car-kit GLB dir> <city-kit GLB dir> <out.glb>

Every source model becomes a top-level node named "<prefix>_<model>" so the game
can look it up and build an InstancedMesh per model.
"""
import os
import sys

import bpy

car_dir, city_dir, out = sys.argv[sys.argv.index("--") + 1 :][:3]

CARS = ["sedan", "taxi", "police", "van", "suv", "truck", "delivery", "hatchback-sports", "sedan-sports"]
BUILDINGS = [
    "building-a", "building-b", "building-c", "building-d", "building-e", "building-f", "building-g", "building-h",
    "building-skyscraper-a", "building-skyscraper-b", "building-skyscraper-c", "building-skyscraper-d", "building-skyscraper-e",
]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def import_model(path, node_name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new(node_name, None)
    scene.collection.objects.link(root)
    for o in new:
        if o.parent is None:
            o.parent = root
    return root


for name in CARS:
    import_model(os.path.join(car_dir, f"{name}.glb"), f"car_{name}")
for name in BUILDINGS:
    import_model(os.path.join(city_dir, f"{name}.glb"), f"bld_{name.replace('building-', '')}")

# Collapse duplicated textures/materials that every Kenney file embeds.
canonical = {}
for mat in list(bpy.data.materials):
    if not mat.use_nodes:
        continue
    img = next((n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None)
    key = (mat.name.split(".")[0], img.size[:] if img else None, img.pixels[:64] if img else None)
    if key in canonical:
        target = canonical[key]
        for ob in bpy.data.objects:
            for slot in ob.material_slots:
                if slot.material == mat:
                    slot.material = target
    else:
        canonical[key] = mat

bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, export_yup=True)
print("PACKED", out, "materials", len(canonical))
