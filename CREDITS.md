# Credits

## 3D models

- **Hero roadster** (`public/models/roadster.glb`) — original model built procedurally in Blender by `tools/blender/build_hero_car.py`. Released with this repository.
- **Traffic cars, buildings and props** (packed into `public/models/props.glb`) — from Kenney's [Car Kit](https://kenney.nl/assets/car-kit) and [City Kit (Commercial)](https://kenney.nl/assets/city-kit-commercial), © Kenney ([kenney.nl](https://www.kenney.nl)), licensed [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Attribution is not required but appreciated.

Rebuild both files with `tools/build-assets.sh` (needs Blender 4.x and the two Kenney kits).

## Audio, textures and sky

All sound effects and music are synthesized at runtime with the Web Audio API (`src/game/audio.ts`). Road, sand, water and signage textures are drawn procedurally on canvas (`src/game/textures.ts`). The sky uses the Three.js `Sky` example shader (MIT).

## Fonts

[Orbitron](https://fonts.google.com/specimen/Orbitron) and [Exo 2](https://fonts.google.com/specimen/Exo+2), SIL Open Font License 1.1, served by Google Fonts.
