# Credits

## 3D models

- **Hero roadster** (`public/models/roadster.glb`) — original low-poly model built procedurally in Blender by `tools/blender/build_hero_car.py`, styled after Tesla's next-gen Roadster as revealed in October 2026: wedge nose, slim front light bar with pop-down lamps, wraparound glass canopy, full-width rear light bar, four-nozzle diffuser and active wing. No third-party geometry is used. Released with this repository. Tesla and Roadster are trademarks of Tesla, Inc.; this is an unofficial fan project.
- **Parked Semi and Cybertruck** in the stunt line-ups — original procedural geometry in `src/game/stunts.ts`.
- **Traffic cars, buildings and props** (packed into `public/models/props.glb`) — from Kenney's [Car Kit](https://kenney.nl/assets/car-kit) and [City Kit (Commercial)](https://kenney.nl/assets/city-kit-commercial), © Kenney ([kenney.nl](https://www.kenney.nl)), licensed [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Attribution is not required but appreciated.

Rebuild both files with `tools/build-assets.sh` (needs Blender 4.x and the two Kenney kits).

## Design references

The car and the stunt section were designed from public coverage of the October 15, 2026 Roadster reveal; no images or footage are included in the game.

- Car design: [Car and Driver exterior gallery](https://www.caranddriver.com/photos/a74152579/tesla-roadster-revealed-exterior-gallery/) and [design changes article](https://www.caranddriver.com/news/a74158531/2029-tesla-roadster-design-changes/).
- Stunts ("The Ramp" inverted curved ramp and "The Kickflip" over parked Tesla vehicles): [The Verge](https://www.theverge.com/transportation/1012552/tesla-roadster-next-gen-reveal-elon-musk), [Road & Track](https://www.roadandtrack.com/news/a74159440/tesla-roadster-flip-float-launch-control-0-60-mph-videos/), [Engadget](https://www.engadget.com/2288448/relive-tesla-ridiculously-fun-roadster-stunt-show/).

## Audio, textures and sky

All sound effects and music are synthesized at runtime with the Web Audio API (`src/game/audio.ts`). Road, sand, water and signage textures are drawn procedurally on canvas (`src/game/textures.ts`). The sky uses the Three.js `Sky` example shader (MIT).

## Fonts

[Orbitron](https://fonts.google.com/specimen/Orbitron) and [Exo 2](https://fonts.google.com/specimen/Exo+2), SIL Open Font License 1.1, served by Google Fonts.
