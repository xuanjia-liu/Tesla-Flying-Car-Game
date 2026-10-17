#!/usr/bin/env bash
# Rebuilds public/models/*.glb.
#   BLENDER=/path/to/blender KENNEY_CARS=<Car Kit "GLB format" dir> KENNEY_CITY=<City Kit Commercial "GLB format" dir> tools/build-assets.sh
# Kenney kits (CC0): https://kenney.nl/assets/car-kit and https://kenney.nl/assets/city-kit-commercial
set -euo pipefail
cd "$(dirname "$0")/.."
BLENDER=${BLENDER:-blender}
tmp=$(mktemp -d)
"$BLENDER" -b -P tools/blender/build_hero_car.py -- "$tmp/roadster.glb"
"$BLENDER" -b -P tools/blender/pack_props.py -- "$KENNEY_CARS" "$KENNEY_CITY" "$tmp/props.glb"
opts=(--compress meshopt --simplify false --join false --flatten false --instance false)
npx --yes @gltf-transform/cli optimize "$tmp/roadster.glb" public/models/roadster.glb "${opts[@]}"
npx --yes @gltf-transform/cli optimize "$tmp/props.glb" public/models/props.glb "${opts[@]}" --texture-compress webp
rm -rf "$tmp"
