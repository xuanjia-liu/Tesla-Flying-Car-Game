# Tesla Flying Car Game

An arcade flying-car run built with Three.js, React and Vite. Drive, launch off ramps, fly through rings, dodge traffic and beat the clock across three stages: city at day, desert at sunset and a coastal highway at night.

Each stage has a signature stunt inspired by the stunt demos at Tesla's October 2026 next-gen Roadster reveal: a corkscrew ramp rolls the car upside down, launches it over a parked line-up of cars, Cybertrucks and a Semi, and you press roll in the air to kickflip upright before you hit the landing zone.

Play: https://xuanjia-liu.github.io/Tesla-Flying-Car-Game/

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Steer | A / D, arrow keys | Left stick | Drag on left half |
| Accelerate / brake | W / S | RT / LT | Auto-throttle, Brake button |
| Fly (thrust up) | Space | A | Thrust button |
| Nitro | Shift / K | X / RB | Nitro button |
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

Models live in `public/models/` and are rebuilt with `tools/build-assets.sh` (Blender 4.x + Kenney CC0 kits, meshopt + WebP compressed). See [CREDITS.md](CREDITS.md).
