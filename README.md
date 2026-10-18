# Tesla Flying Car Game

An arcade flying-car run built with Three.js, React and Vite. Drive, launch off ramps, fly through rings, dodge traffic and beat the clock across three stages: city at day, desert at sunset and a coastal highway at night.

Each stage has a signature stunt inspired by the stunt demos at Tesla's October 2026 next-gen Roadster reveal: a corkscrew ramp rolls the car upside down, launches it over a parked line-up of cars, Cybertrucks and a Semi, and you press roll in the air to kickflip upright before you hit the landing zone.

The Roadster carries the SpaceX Package: 10 cold-gas thrusters fed by compressed-air COPV tanks that an onboard compressor refills. The rear mains sit behind a drop-down licence plate and give launch and boost. The front thrusters brake. The side pods fire upward for grip in hard corners and sideways for attitude control in the air. The down thrusters give hops and short hovers, and they cushion landings. The underbody vacuum fans and the active rear wing work alongside them. The HUD's AIR gauge shows the tank pressure.

Play: https://xuanjia-liu.github.io/Tesla-Flying-Car-Game/

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Steer | A / D, arrow keys | Left stick | Drag on left half |
| Accelerate / thruster brake | W / S | RT / LT | Auto-throttle, Brake button |
| Hop (tap) / short hover (hold) | Space | A | Hop button |
| Rear-main launch and boost | Shift / K | X / RB | Boost button |
| Barrel roll / stunt kickflip (in air) | Q / E | B / Y + stick | Roll button |
| Pause | Esc / P | Start | Pause button |

## Development

```bash
npm install
npm run dev        # http://localhost:5173/Tesla-Flying-Car-Game/
npm run build && npm run preview
npm run lint && npm run typecheck
```

Append `?debug` to the URL for an FPS / draw-call overlay.

The site deploys to GitHub Pages from `main` (`.github/workflows/deploy.yml`); `vite.config.ts` sets `base: '/Tesla-Flying-Car-Game/'`.

## Assets

Models live in `public/models/` and are rebuilt with `tools/build-assets.sh` (Blender 4.x + Kenney CC0 kits, meshopt + WebP compressed). The hero car's nozzles (`Nozzle_<group>_<i>`), `plate_hinge`, `wing_pivot` and `fan_<i>` nodes drive the thruster animation in `src/game/car.ts`. See [CREDITS.md](CREDITS.md).
