import * as THREE from 'three';
import { loadAssets } from './assets';
import { CarRig } from './car';
import { Environment, lookAt, type StageLook } from './environment';
import type { InputManager, InputState } from './input';
import { ParticlePool } from './particles';
import { PostFX } from './postfx';
import type { Settings } from './settings';
import { sfx, startLoops, stopLoops, updateLoops, startMusic, setMusicIntensity, setVolumes } from './audio';
import { World, type TrafficCar } from './world';
import {
  COURSE_LENGTH,
  GameEvents,
  GameStats,
  HintId,
  PAINTS,
  RAIL_X,
  ROAD_HALF_WIDTH,
  RunBreakdown,
  gradeFor,
} from './types';

const SIM_DT = 1 / 120;
const GRAVITY = -24;
const MAX_SPEED = 50;
const BOOST_SPEED = 74;
const ACCEL = 22;
const BOOST_ACCEL = 46;
const THRUST_ACCEL = 37;
const HOP_VY = 8.5;
const MAX_ALT = 24;
const ENERGY_DRAIN = 30;
const ENERGY_REFILL = 24;
const HOP_COST = 6;
const NITRO_DRAIN = 32;
const START_TIME = 35;
const COMBO_WINDOW = 4.5;
const ROLL_TIME = 0.62;
const CAR_HALF = new THREE.Vector3(0.95, 0.6, 2.3);
const COUNTDOWN = 3.4;

type Mode = 'showroom' | 'countdown' | 'race' | 'over';

const QUALITY = {
  low: { dpr: 1, shadows: false, shadowSize: 512, bloom: false },
  medium: { dpr: 1.5, shadows: true, shadowSize: 1024, bloom: true },
  high: { dpr: 2, shadows: true, shadowSize: 2048, bloom: true },
};

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private env: Environment;
  private postfx: PostFX;
  private world!: World;
  private car!: CarRig;
  private exhaust = new ParticlePool(600, true);
  private smoke = new ParticlePool(360, false);
  private raf = 0;
  private lastT = performance.now();
  private acc = 0;
  private clock = 0;
  private disposed = false;
  private paused = false;
  private mode: Mode = 'showroom';
  private settings: Settings;
  private cleanup: (() => void)[] = [];
  private ready = false;
  private look: StageLook;

  // vehicle state
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private heading = 0;
  private steer = 0;
  private onGround = true;
  private airTime = 0;
  private energy = 100;
  private nitro = 40;
  private padBoost = 0;
  private boosting = false;
  private thrusting = false;
  private hover = 0;
  private roll = 0;
  private rollDir = 0;
  private rolling = false;
  private tricks = 0;
  private bodyPitch = 0;
  private bodyRoll = 0;
  private invuln = 0;
  private throttle = 0;
  private brake = false;

  // run state
  private timeLeft = START_TIME;
  private runTime = 0;
  private countdown = 0;
  private score = 0;
  private combo = 1;
  private comboTimer = 0;
  private stage = 0;
  private bd: RunBreakdown = this.freshBreakdown();
  private hintsShown = new Set<HintId>();
  private activeHint: HintId | null = null;
  private hintTimer = 0;
  private statsTimer = 0;

  // camera / fx
  private camPos = new THREE.Vector3(8, 3, -8);
  private camLook = new THREE.Vector3();
  private shake = 0;
  private flash = 0;
  private fov = 62;
  private orbit = 0.6;
  private resScale = 1;
  private frameEma = 1 / 60;
  private perfTimer = 0;

  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private playerBox = new THREE.Box3();
  private carBox = new THREE.Box3();

  constructor(private container: HTMLElement, private input: InputManager, private events: GameEvents, settings: Settings) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(this.fov, 1, 0.3, 5000);
    this.env = new Environment(this.renderer, this.scene);
    this.look = lookAt(0).look;
    this.postfx = new PostFX(this.renderer, this.scene, this.camera, 1, 1);
    this.scene.add(this.exhaust.points, this.smoke.points);

    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    this.cleanup.push(() => window.removeEventListener('resize', onResize));
    const onVis = () => {
      if (document.hidden && this.mode === 'race') this.events.onHint(null);
    };
    document.addEventListener('visibilitychange', onVis);
    this.cleanup.push(() => document.removeEventListener('visibilitychange', onVis));
    this.applySettings(settings);
    this.resize();
  }

  async init(onProgress?: (p: number) => void) {
    const fonts = document.fonts
      ? Promise.race([document.fonts.load('900 64px Orbitron'), new Promise((r) => setTimeout(r, 2000))]).catch(() => undefined)
      : Promise.resolve();
    const [assets] = await Promise.all([loadAssets(onProgress), fonts]);
    if (this.disposed) return;
    this.world = new World(assets.props, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.world.group);
    this.car = new CarRig(assets.car);
    this.scene.add(this.car.root, this.car.shadow);
    this.applySettings(this.settings);
    this.resetRun();
    this.mode = 'showroom';
    this.ready = true;
    this.renderer.compile(this.scene, this.camera);
    if (new URLSearchParams(location.search).has('debug')) {
      // read-only probe used by the automated capture/test harness
      (window as unknown as { __roadster: unknown }).__roadster = {
        state: () => ({
          pos: this.pos.toArray(),
          vel: this.vel.toArray(),
          heading: this.heading,
          onGround: this.onGround,
          energy: this.energy,
          nitro: this.nitro,
          mode: this.mode,
          score: this.score,
          timeLeft: this.timeLeft,
          bd: this.bd,
          rolling: this.rolling,
        }),
        rings: () => this.world.rings.filter((r) => !r.passed).slice(0, 3).map((r) => r.pos.toArray()),
        obstacles: () => this.world.obstacles.map((o) => [o.box.min.toArray(), o.box.max.toArray()]),
        traffic: () => this.world.traffic.filter((t) => t.active && !t.knocked).map((t) => [...t.pos.toArray(), t.half.x, t.half.y, t.half.z, t.speed]),
        scene: this.scene,
      };
    }
    this.loop();
  }

  private freshBreakdown(): RunBreakdown {
    return { crashes: 0, hardLandings: 0, tricks: 0, rings: 0, ringsTotal: 0, nearMisses: 0, airtime: 0, topSpeed: 0, checkpoints: 0 };
  }

  applySettings(s: Settings) {
    this.settings = s;
    const q = QUALITY[s.quality];
    this.env.setShadows(q.shadows, q.shadowSize);
    this.renderer.shadowMap.enabled = q.shadows;
    this.postfx.setBloom(q.bloom);
    this.resScale = 1;
    this.resize();
    setVolumes(s.musicVolume, s.sfxVolume, s.muted);
    const paint = PAINTS.find((p) => p.id === s.paint) ?? PAINTS[0];
    this.car?.setPaint(paint.hex);
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const q = QUALITY[this.settings.quality];
    const dpr = Math.min(window.devicePixelRatio || 1, q.dpr) * this.resScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.postfx.composer.setPixelRatio(dpr);
    this.postfx.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.exhaust.setViewportHeight(h * dpr);
    this.smoke.setViewportHeight(h * dpr);
  }

  // ---------------- run lifecycle ----------------

  private resetRun() {
    this.pos.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.heading = 0;
    this.steer = 0;
    this.onGround = true;
    this.airTime = 0;
    this.energy = 100;
    this.nitro = 40;
    this.padBoost = 0;
    this.roll = 0;
    this.rolling = false;
    this.tricks = 0;
    this.invuln = 0;
    this.timeLeft = START_TIME;
    this.runTime = 0;
    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.stage = 0;
    this.bd = this.freshBreakdown();
    this.bd.ringsTotal = this.world.rings.length;
    this.world.reset();
    this.exhaust.reset();
    this.smoke.reset();
    this.car.setVisible(true);
  }

  startRun() {
    if (!this.ready) return;
    this.resetRun();
    const warp = Number(new URLSearchParams(location.search).get('z'));
    if (warp > 0) {
      this.pos.z = Math.min(warp, COURSE_LENGTH - 20);
      this.stage = Math.min(2, Math.floor(this.pos.z / 500));
      this.camPos.set(0, 3, this.pos.z - 8);
      for (const cp of this.world.checkpoints) cp.passed = cp.z < this.pos.z;
    }
    this.mode = 'countdown';
    this.countdown = COUNTDOWN;
    this.paused = false;
    this.hintTimer = 0;
    this.activeHint = null;
    startLoops();
    startMusic(1);
    setMusicIntensity(1);
    this.events.onStage(this.stage);
    this.emitStats();
  }

  toShowroom() {
    if (!this.ready) return;
    this.mode = 'showroom';
    this.paused = false;
    stopLoops();
    setMusicIntensity(0);
    this.resetRun();
    this.events.onHint(null);
  }

  setPaused(p: boolean) {
    if (this.mode !== 'race' && this.mode !== 'countdown') return;
    this.paused = p;
    if (p) updateLoops(0, 0, 0, false);
  }

  get isRacing() {
    return this.mode === 'race' || this.mode === 'countdown';
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    stopLoops();
    for (const fn of this.cleanup) fn();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private endRun(finished: boolean) {
    if (this.mode !== 'race') return;
    this.mode = 'over';
    stopLoops();
    setMusicIntensity(0);
    if (finished) {
      const timeBonus = Math.round(this.timeLeft * 150);
      this.score += timeBonus + 2500;
      this.events.onCallout('FINISH!', 'gold');
      this.events.onPopup(`TIME BONUS`, timeBonus + 2500, 'gold');
      sfx.finish();
    } else {
      this.events.onCallout("TIME'S UP", 'bad');
      sfx.fail();
    }
    this.events.onHint(null);
    this.emitStats();
    const score = Math.floor(this.score);
    window.setTimeout(
      () =>
        this.events.onGameOver({
          score,
          distance: Math.max(0, Math.floor(this.pos.z)),
          finished,
          runTime: this.runTime,
          grade: gradeFor(score, finished),
          breakdown: { ...this.bd, topSpeed: Math.round(this.bd.topSpeed * 2.237), airtime: Math.round(this.bd.airtime * 10) / 10 },
        }),
      finished ? 1600 : 1300
    );
  }

  private emitStats() {
    this.events.onStats({
      score: Math.floor(this.score),
      timeLeft: Math.max(0, this.timeLeft),
      energy: this.energy / 100,
      nitro: this.nitro / 100,
      speed: Math.hypot(this.vel.x, this.vel.z),
      combo: this.combo,
      comboTimer: this.combo > 1 ? Math.max(0, this.comboTimer) : 0,
      progress: THREE.MathUtils.clamp(this.pos.z / COURSE_LENGTH, 0, 1),
      distance: Math.max(0, Math.floor(this.pos.z)),
      airborne: !this.onGround,
      altitude: Math.max(0, this.pos.y - this.world.groundHeight(this.pos.x, this.pos.z)),
      countdown: this.mode === 'countdown' ? this.countdown : 0,
      stage: this.stage,
      boosting: this.boosting,
    } satisfies GameStats);
  }

  // ---------------- main loop ----------------

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const frame = Math.min((now - this.lastT) / 1000, 0.1);
    this.lastT = now;
    this.trackPerformance(frame);

    const running = !this.paused && (this.mode === 'race' || this.mode === 'countdown');
    if (running) {
      this.acc += frame;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < 12) {
        this.step(SIM_DT, this.input.sample());
        this.acc -= SIM_DT;
        steps++;
      }
      if (steps === 12) this.acc = 0;
    } else {
      this.acc = 0;
      this.input.sample();
    }
    const dt = this.paused ? 0 : frame;
    this.clock += dt;
    if (this.mode === 'showroom') this.updateShowroom(dt);
    if (this.mode === 'over') this.updateCoast(dt);

    this.look = this.env.update(this.pos.z, this.pos, this.camera, this.clock);
    this.world.update(dt, this.clock, this.pos.z, this.look, this.scene.fog as THREE.Fog, dt > 0 && this.mode !== 'showroom');
    this.updateCarVisual(dt);
    this.exhaust.update(dt);
    this.smoke.update(dt);
    this.updateCamera(dt);

    const speed01 = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / BOOST_SPEED);
    this.flash = Math.max(0, this.flash - dt * 1.8);
    if (QUALITY[this.settings.quality].bloom) {
      this.postfx.update(this.boosting ? 0.6 + speed01 * 0.4 : Math.max(0, speed01 - 0.6), this.flash, this.camera.aspect, this.clock, 0.45 + this.look.night * 0.35);
      this.postfx.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    if (this.isRacing) {
      this.statsTimer += frame;
      if (this.statsTimer > 1 / 20) {
        this.statsTimer = 0;
        this.emitStats();
      }
    }
  };

  private trackPerformance(frame: number) {
    if (!this.isRacing || this.paused) return;
    this.frameEma += (frame - this.frameEma) * 0.05;
    this.perfTimer += frame;
    if (this.perfTimer < 2) return;
    if (this.frameEma > 1 / 42 && this.resScale > 0.6) {
      this.resScale = Math.max(0.6, this.resScale - 0.1);
      this.resize();
      this.perfTimer = 0;
    } else if (this.frameEma < 1 / 58 && this.resScale < 1 && this.perfTimer > 5) {
      this.resScale = Math.min(1, this.resScale + 0.1);
      this.resize();
      this.perfTimer = 0;
    }
  }

  // ---------------- simulation ----------------

  private hint(id: HintId) {
    if (this.hintsShown.has(id)) return;
    this.hintsShown.add(id);
    this.activeHint = id;
    this.hintTimer = 5;
    this.events.onHint(id);
  }

  private addCombo() {
    this.combo = Math.min(8, this.combo + 1);
    this.comboTimer = 1;
  }

  private step(dt: number, inp: InputState) {
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0 && this.activeHint) {
        this.activeHint = null;
        this.events.onHint(null);
      }
    }

    if (this.mode === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after > 0) sfx.count();
      updateLoops(inp.throttle > 0 ? 0.35 : 0.05, 0, 0, false);
      if (this.countdown <= 0) {
        this.mode = 'race';
        sfx.go();
        this.hint('drive');
      }
      this.updateCarPose(dt, inp, false);
      return;
    }

    this.runTime += dt;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.endRun(false);
      return;
    }
    if (this.combo > 1) {
      this.comboTimer -= dt / COMBO_WINDOW;
      if (this.comboTimer <= 0) {
        this.combo = 1;
        this.comboTimer = 0;
      }
    }
    this.invuln = Math.max(0, this.invuln - dt);

    this.drive(dt, inp);
    this.collide(dt);
    this.updateCarPose(dt, inp, true);
    this.emitFx(dt);

    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.bd.topSpeed = Math.max(this.bd.topSpeed, speed);
    this.score += Math.max(0, this.vel.z) * dt * 0.6;
    updateLoops(speed / BOOST_SPEED, this.thrusting ? 1 : 0, this.boosting ? 1 : 0, !this.onGround);

    const st = Math.min(2, Math.floor(this.pos.z / 500));
    if (st !== this.stage && st > this.stage) {
      this.stage = st;
      this.events.onStage(st);
    }
    // contextual first-run hints
    if (this.pos.z > 60) this.hint('fly');
    if (this.pos.z > 115 && this.pos.z < 150) this.hint('ramp');
    if (this.pos.z > 240) this.hint('nitro');
    if (this.pos.z > 330 && !this.onGround) this.hint('roll');
    if (this.pos.z > 545) this.hint('barrier');
    if (this.pos.z > 1030) this.hint('gantry');
  }

  private drive(dt: number, inp: InputState) {
    const steerTarget = inp.steer;
    const steerRate = Math.abs(steerTarget) > Math.abs(this.steer) ? 6 : 10;
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * steerRate);
    this.throttle = inp.throttle;
    this.brake = inp.throttle < 0;

    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    // screen-right when looking down +Z is -X
    const rx = -fz;
    const rz = fx;
    let fwd = this.vel.x * fx + this.vel.z * fz;
    let lat = this.vel.x * rx + this.vel.z * rz;

    // nitro / pads
    this.padBoost = Math.max(0, this.padBoost - dt);
    const wantsNitro = inp.boost && this.nitro > 0;
    this.boosting = this.padBoost > 0 || wantsNitro;
    if (wantsNitro && this.padBoost <= 0) this.nitro = Math.max(0, this.nitro - NITRO_DRAIN * dt);
    const top = this.boosting ? BOOST_SPEED : MAX_SPEED;

    const offroad = Math.abs(this.pos.x) > ROAD_HALF_WIDTH + 1;
    if (this.onGround) {
      if (inp.throttle > 0) {
        const a = (this.boosting ? BOOST_ACCEL : ACCEL) * inp.throttle;
        fwd += a * Math.max(0, 1 - Math.pow(Math.max(0, fwd) / top, 2)) * dt;
      } else if (inp.throttle < 0) {
        fwd += fwd > 1 ? -44 * dt : -14 * dt;
      } else {
        fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), (2 + Math.abs(fwd) * 0.12) * dt);
      }
      if (this.boosting && inp.throttle >= 0) fwd += (BOOST_ACCEL * 0.5) * Math.max(0, 1 - fwd / top) * dt;
      if (offroad) fwd -= fwd * 0.5 * dt;
      if (fwd > top) fwd += (top - fwd) * Math.min(1, dt * 1.5);
      fwd = Math.max(-12, fwd);
      lat *= Math.exp(-(this.boosting ? 6 : 9) * dt);
    } else {
      if (inp.throttle > 0) fwd += 6 * dt * Math.max(0, 1 - fwd / top);
      if (this.boosting) fwd += BOOST_ACCEL * 0.7 * Math.max(0, 1 - fwd / top) * dt;
      fwd -= fwd * 0.03 * dt;
      if (fwd > top) fwd += (top - fwd) * 0.5 * dt;
      lat *= Math.exp(-2.5 * dt);
    }

    // steering: responsive at low speed, calmer at top speed
    const speedAbs = Math.abs(fwd);
    const turn = 1.6 * Math.min(1, speedAbs / 8) / (1 + speedAbs / 70);
    const yawRate = -this.steer * turn * (fwd < -0.5 ? -1 : 1) * (this.onGround ? 1 : 0.75);
    this.heading += yawRate * dt;
    // the course runs along +Z: keep the nose within a sane cone and gently re-centre in the air
    this.heading = THREE.MathUtils.clamp(this.heading, -1.05, 1.05);
    if (!this.onGround && Math.abs(this.steer) < 0.1) this.heading *= 1 - 0.6 * dt;
    if (this.onGround && !offroad && this.steer === 0 && speedAbs > 10) this.heading *= 1 - 0.15 * dt;

    const nfx = Math.sin(this.heading);
    const nfz = Math.cos(this.heading);
    this.vel.x = nfx * fwd + -nfz * lat;
    this.vel.z = nfz * fwd + nfx * lat;

    // ---- thrusters ----
    this.thrusting = false;
    const ground = this.world.groundHeight(this.pos.x, this.pos.z);
    const alt = this.pos.y - ground;
    if (inp.thrustPressed && this.onGround && this.energy > HOP_COST) {
      this.energy -= HOP_COST;
      this.vel.y = Math.max(this.vel.y, HOP_VY);
      this.onGround = false;
      this.airTime = 0;
      this.tricks = 0;
      sfx.hop();
      this.burstSmoke(14, 3);
      this.shake = Math.max(this.shake, 0.15);
    }
    if (inp.thrust && !this.onGround && this.energy > 0) {
      const taper = THREE.MathUtils.clamp((MAX_ALT + 4 - alt) / 8, 0, 1);
      this.vel.y += THRUST_ACCEL * taper * dt;
      this.energy = Math.max(0, this.energy - ENERGY_DRAIN * dt);
      this.thrusting = true;
    }
    if (!this.onGround) {
      this.vel.y += GRAVITY * dt;
      // wing-body lift makes descents floaty at speed
      if (this.vel.y < 0) this.vel.y += Math.min(10, Math.max(0, fwd) * 0.17) * dt;
      this.vel.y -= this.vel.y * 0.25 * dt;
      this.airTime += dt;
      this.bd.airtime += dt;
    } else {
      this.energy = Math.min(100, this.energy + ENERGY_REFILL * dt);
    }

    // ---- barrel rolls ----
    if (inp.roll !== 0 && !this.onGround && !this.rolling && alt > 1.5) {
      this.rolling = true;
      this.rollDir = inp.roll;
      this.roll = 0;
      sfx.roll();
    }
    if (this.rolling) {
      this.roll += dt / ROLL_TIME;
      if (this.roll >= 1) {
        this.rolling = false;
        this.roll = 0;
        this.tricks++;
        this.bd.tricks++;
        this.nitro = Math.min(100, this.nitro + 12);
        this.addCombo();
        this.events.onPopup('BARREL ROLL', 0, 'gold');
      }
    }

    this.pos.addScaledVector(this.vel, dt);
  }

  private collide(dt: number) {
    const prevZ = this.pos.z - this.vel.z * dt;

    // ---- ground ----
    const g = this.world.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= g) {
      const impact = -this.vel.y;
      this.pos.y = g;
      if (!this.onGround) this.land(impact);
      const slope = (this.world.groundHeight(this.pos.x, this.pos.z + 0.5) - this.world.groundHeight(this.pos.x, this.pos.z - 0.5)) / 1;
      this.vel.y = slope * this.vel.z;
      this.onGround = true;
    } else if (this.onGround) {
      // ran off a ramp lip or a ledge
      if (this.pos.y - g > 0.25) {
        this.onGround = false;
        this.airTime = 0;
        this.tricks = 0;
      } else {
        this.pos.y = g;
      }
    }

    // ---- rails ----
    const limit = RAIL_X - 1.1;
    if (Math.abs(this.pos.x) > limit) {
      const s = Math.sign(this.pos.x);
      this.pos.x = s * limit;
      if (this.vel.x * s > 0) {
        if (Math.abs(this.vel.x) > 6) {
          this.shake = Math.max(this.shake, 0.25);
          sfx.land();
          this.sparks(this.tmp.set(this.pos.x + s * 1, this.pos.y + 0.5, this.pos.z), 14);
        }
        this.vel.x *= -0.25;
        this.vel.z *= 0.985;
        this.heading *= 0.6;
      }
    }

    // ---- player AABB (heading-aware) ----
    const c = Math.abs(Math.cos(this.heading));
    const sn = Math.abs(Math.sin(this.heading));
    const hx = CAR_HALF.x * c + CAR_HALF.z * sn;
    const hz = CAR_HALF.x * sn + CAR_HALF.z * c;
    this.playerBox.min.set(this.pos.x - hx, this.pos.y + 0.15, this.pos.z - hz);
    this.playerBox.max.set(this.pos.x + hx, this.pos.y + 1.25, this.pos.z + hz);

    if (this.invuln <= 0) {
      for (const o of this.world.obstacles) {
        if (this.playerBox.intersectsBox(o.box)) {
          this.crash(o.kind === 'gantry' ? 'GANTRY HIT' : 'BARRIER HIT', null);
          this.deflect(o.box);
          break;
        }
      }
    }

    // ---- traffic ----
    for (const car of this.world.traffic) {
      if (!car.active || car.knocked) continue;
      const top = car.pos.y + car.half.y;
      this.carBox.min.set(car.pos.x - car.half.x, car.pos.y, car.pos.z - car.half.z);
      this.carBox.max.set(car.pos.x + car.half.x, top, car.pos.z + car.half.z);
      if (this.playerBox.intersectsBox(this.carBox)) {
        if (this.vel.y <= 0 && this.pos.y > top - 0.5) {
          // bounced off a roof
          this.pos.y = top;
          this.vel.y = 11;
          this.onGround = false;
          this.airTime = 0.3;
          this.score += 250 * this.combo;
          this.nitro = Math.min(100, this.nitro + 10);
          this.addCombo();
          this.events.onPopup('ROOF HOP', 250 * this.combo, 'gold');
          sfx.hop();
        } else if (this.invuln <= 0) {
          this.crash('TRAFFIC HIT', car);
        }
        continue;
      }
      // near miss when overtaking
      if (!car.passed && prevZ < car.pos.z && this.pos.z >= car.pos.z) {
        car.passed = true;
        const gap = Math.abs(this.pos.x - car.pos.x) - car.half.x - CAR_HALF.x;
        const vgap = this.pos.y - top;
        const close = (gap < 1.6 && gap > -0.2 && this.pos.y < top) || (vgap > 0 && vgap < 1.8 && Math.abs(this.pos.x - car.pos.x) < 2);
        if (close && this.vel.z - car.speed > 12) {
          const pts = 120 * this.combo;
          this.score += pts;
          this.bd.nearMisses++;
          this.nitro = Math.min(100, this.nitro + 9);
          this.addCombo();
          this.events.onPopup(vgap > 0 ? 'SKIM' : 'NEAR MISS', pts, 'good');
          sfx.whoosh();
        }
      }
    }

    // ---- rings ----
    for (const r of this.world.rings) {
      if (r.collected || r.passed) continue;
      if (prevZ < r.pos.z && this.pos.z >= r.pos.z) {
        r.passed = true;
        const d = Math.hypot(this.pos.x - r.pos.x, this.pos.y + 0.6 - r.pos.y);
        if (d < r.radius * 0.95) {
          this.world.collectRing(r);
          this.addCombo();
          const pts = 100 * this.combo;
          this.score += pts;
          this.bd.rings++;
          this.timeLeft += 0.5;
          this.energy = Math.min(100, this.energy + 14);
          this.nitro = Math.min(100, this.nitro + 8);
          this.events.onPopup('RING', pts, 'good');
          sfx.ring(this.combo);
          this.exhaust.emit({ count: 40, pos: r.pos, spread: r.radius * 1.4, velSpread: 10, life: 0.6, size: 0.5, grow: -0.5, color: 0x6fe4ff, drag: 2 });
        }
      }
    }

    // ---- boost pads ----
    if (this.onGround) {
      for (const p of this.world.pads) {
        if (Math.abs(this.pos.x - p.x) < p.halfW && Math.abs(this.pos.z - p.z) < p.halfL) {
          if (this.padBoost < 0.5) {
            this.events.onPopup('BOOST PAD', 50, 'good');
            this.score += 50;
            sfx.boost();
            this.shake = Math.max(this.shake, 0.2);
          }
          this.padBoost = 1.6;
        }
      }
    }

    // ---- checkpoints & finish ----
    for (const cp of this.world.checkpoints) {
      if (cp.passed || !(prevZ < cp.z && this.pos.z >= cp.z)) continue;
      cp.passed = true;
      if (cp.finish) {
        this.endRun(true);
        return;
      }
      this.timeLeft += cp.bonus;
      this.bd.checkpoints++;
      this.score += 500;
      this.events.onCallout(`CHECKPOINT +${cp.bonus}s`, 'good');
      sfx.checkpoint();
    }
  }

  private land(impact: number) {
    const air = this.airTime;
    this.airTime = 0;
    if (this.rolling) {
      this.rolling = false;
      this.roll = 0;
      this.hardLanding('WIPEOUT');
      return;
    }
    if (impact > 20) {
      this.hardLanding('HARD LANDING');
      return;
    }
    if (air > 0.6) {
      const trickPts = this.tricks * 400;
      const pts = Math.round((50 + Math.min(air, 4) * 80 + trickPts) * this.combo);
      this.score += pts;
      this.addCombo();
      this.nitro = Math.min(100, this.nitro + 8);
      this.events.onPopup(this.tricks > 0 ? `TRICK LANDING ×${this.tricks}` : air > 2 ? `BIG AIR ${air.toFixed(1)}s` : 'SMOOTH LANDING', pts, this.tricks ? 'gold' : 'good');
      sfx.cleanLanding();
    }
    sfx.land();
    this.burstSmoke(10 + Math.min(20, impact), 2 + impact * 0.1);
    this.shake = Math.max(this.shake, Math.min(0.4, impact * 0.02));
    this.tricks = 0;
  }

  private hardLanding(label: string) {
    this.bd.hardLandings++;
    this.combo = 1;
    this.comboTimer = 0;
    this.vel.x *= 0.5;
    this.vel.z *= 0.5;
    this.timeLeft -= 2;
    this.shake = 0.7;
    this.flash = 0.7;
    this.tricks = 0;
    sfx.thud();
    this.burstSmoke(30, 5);
    this.sparks(this.pos, 30);
    this.events.onCallout(`${label} −2s`, 'bad');
  }

  private crash(label: string, car: TrafficCar | null) {
    this.bd.crashes++;
    this.combo = 1;
    this.comboTimer = 0;
    this.timeLeft -= 3;
    this.shake = 1;
    this.flash = 1;
    this.invuln = 1.4;
    sfx.crash();
    this.sparks(this.tmp.copy(this.pos).setY(this.pos.y + 0.8).addScaledVector(this.tmp2.set(Math.sin(this.heading), 0, Math.cos(this.heading)), 2), 50);
    this.events.onCallout(`${label} −3s`, 'bad');
    if (car) {
      const push = this.tmp2.set(this.vel.x * 0.4 + Math.sign(car.pos.x - this.pos.x || 1) * 6, 0, Math.max(this.vel.z * 0.7, car.speed + 6));
      this.world.knock(car, push);
      this.vel.multiplyScalar(0.45);
    }
  }

  /** Pop the car clear of a static obstacle (under or over it) so a crash never pins it in place. */
  private deflect(box: THREE.Box3) {
    this.vel.z *= 0.4;
    this.vel.x *= 0.5;
    const mid = (box.min.y + box.max.y) / 2;
    if (box.min.y > 2 && this.pos.y + 0.7 < mid) {
      this.pos.y = Math.max(this.world.groundHeight(this.pos.x, this.pos.z), box.min.y - 1.4);
      this.vel.y = Math.min(this.vel.y, -4);
    } else {
      this.pos.y = box.max.y + 0.05;
      this.vel.y = Math.max(this.vel.y, 5);
      this.onGround = false;
    }
  }

  // ---------------- visuals ----------------

  private updateCarPose(dt: number, inp: InputState, live: boolean) {
    const fwd = this.vel.x * Math.sin(this.heading) + this.vel.z * Math.cos(this.heading);
    const accel = live ? inp.throttle : 0;
    const targetPitch = this.onGround ? -accel * 0.03 + (this.brake ? 0.04 : 0) : THREE.MathUtils.clamp(-this.vel.y * 0.02, -0.25, 0.25);
    const targetRoll = this.steer * (this.onGround ? 0.06 : 0.3) * Math.min(1, Math.abs(fwd) / 20);
    this.bodyPitch += (targetPitch - this.bodyPitch) * Math.min(1, dt * 6);
    this.bodyRoll += (targetRoll - this.bodyRoll) * Math.min(1, dt * 6);
    const hoverTarget = this.onGround ? 0 : 1;
    this.hover += (hoverTarget - this.hover) * Math.min(1, dt * (this.onGround ? 14 : 6));
  }

  private updateCarVisual(dt: number) {
    const r = this.car.root;
    const showroom = this.mode === 'showroom';
    if (showroom) {
      r.position.set(0, 0.55 + Math.sin(this.clock * 1.6) * 0.08, 0);
      r.rotation.set(0, this.clock * 0.25, 0);
      this.car.body.rotation.set(Math.sin(this.clock * 1.1) * 0.02, 0, Math.sin(this.clock * 0.8) * 0.03);
    } else {
      r.position.copy(this.pos);
      r.rotation.set(0, this.heading, 0);
      const trick = this.rolling ? this.rollDir * this.roll * Math.PI * 2 : 0;
      this.car.body.rotation.set(this.bodyPitch, 0, -this.bodyRoll + trick, 'YXZ');
      this.car.body.position.y = this.onGround ? Math.sin(this.clock * 30) * 0.004 * Math.min(1, Math.abs(this.vel.z) / 20) : 0;
    }
    this.car.setVisible(this.invuln <= 0 || Math.floor(this.invuln * 14) % 2 === 0);
    const speed = showroom ? 0 : this.vel.z;
    this.car.update(dt, {
      speed,
      steer: showroom ? 0 : this.steer,
      hover: showroom ? 1 : this.hover,
      thrust: showroom ? 0.25 + Math.sin(this.clock * 2) * 0.1 : this.thrusting ? 1 : 0,
      boost: showroom ? 0 : this.boosting ? 1 : 0,
      brake: this.brake && this.mode === 'race',
      night: this.look.night,
    }, showroom ? 0 : this.world.groundHeight(this.pos.x, this.pos.z));
  }

  private emitFx(dt: number) {
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    if (this.boosting || this.thrusting) {
      const n = this.boosting ? 3 : 1;
      for (const side of [-0.48, 0.48]) {
        this.tmp.set(this.pos.x - fz * side - fx * 2.6, this.pos.y + 0.52, this.pos.z + fx * side - fz * 2.6);
        this.exhaust.emit({
          count: n,
          pos: this.tmp,
          spread: 0.15,
          vel: this.tmp2.set(this.vel.x * 0.6 - fx * 12, this.vel.y * 0.6, this.vel.z * 0.6 - fz * 12),
          velSpread: 2,
          life: 0.28,
          size: 0.55,
          grow: -0.6,
          color: this.boosting ? 0x8fd4ff : 0x5aa8ff,
          drag: 3,
        });
      }
    }
    if (this.thrusting && Math.random() < dt * 60) {
      const alt = this.pos.y - this.world.groundHeight(this.pos.x, this.pos.z);
      this.exhaust.emit({
        count: 2,
        pos: this.tmp.set(this.pos.x, this.pos.y + 0.1, this.pos.z),
        spread: 2.2,
        vel: this.tmp2.set(this.vel.x * 0.8, -9, this.vel.z * 0.8),
        velSpread: 2,
        life: 0.25,
        size: 0.7,
        grow: 1,
        color: 0x9fdcff,
        alpha: 0.7,
        drag: 2,
      });
      if (alt < 7 && Math.random() < 0.5) this.burstSmoke(2, 2.5, true);
    }
    const speed = Math.abs(this.vel.z);
    if (this.onGround && Math.abs(this.pos.x) > ROAD_HALF_WIDTH + 1 && speed > 10 && Math.random() < dt * 30) this.burstSmoke(1, 1.5);
  }

  private burstSmoke(count: number, spread: number, under = false) {
    const ground = this.world.groundHeight(this.pos.x, this.pos.z);
    const stage = Math.min(2, Math.floor(this.pos.z / 500));
    const color = stage === 0 ? 0xd8b48a : stage === 1 ? 0xe8ecf0 : 0x9a96b0;
    this.smoke.emit({
      count,
      pos: this.tmp.set(this.pos.x, ground + 0.4, this.pos.z + (under ? 0 : -1)),
      spread: spread * 1.6,
      vel: this.tmp2.set(this.vel.x * 0.2, 1.2, this.vel.z * 0.2),
      velSpread: spread * 2,
      life: 1.1,
      size: 2.4,
      grow: 2.5,
      color,
      alpha: 0.38,
      drag: 1.6,
    });
  }

  private sparks(at: THREE.Vector3, count: number) {
    this.exhaust.emit({ count, pos: at, spread: 0.6, vel: this.tmp2.set(this.vel.x * 0.3, 4, this.vel.z * 0.3), velSpread: 14, life: 0.5, size: 0.28, grow: -0.5, color: 0xffa040, gravity: -20, drag: 1 });
  }

  private updateShowroom(dt: number) {
    this.orbit += dt * 0.12;
  }

  private updateCoast(dt: number) {
    // let the car roll to a stop after the run
    this.vel.multiplyScalar(Math.exp(-1.2 * dt));
    if (!this.onGround) this.vel.y += GRAVITY * dt;
    this.pos.addScaledVector(this.vel, dt);
    const g = this.world.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= g) {
      this.pos.y = g;
      this.vel.y = 0;
      this.onGround = true;
    }
    this.hover += ((this.onGround ? 0 : 1) - this.hover) * Math.min(1, dt * 6);
  }

  private updateCamera(dt: number) {
    const cam = this.camera;
    if (this.mode === 'showroom') {
      const wide = cam.aspect > 1.15;
      const radius = wide ? 8.2 : 10.5;
      const a = this.orbit;
      this.camPos.set(Math.sin(a) * radius, 2.1 + Math.sin(a * 0.7) * 0.4, Math.cos(a) * radius);
      cam.position.copy(this.camPos);
      // place the car right-of-centre on wide screens so the menu can sit on the left
      const right = this.tmp.set(Math.cos(a), 0, -Math.sin(a));
      this.camLook.set(0, wide ? 0.9 : 1.6, 0).addScaledVector(right, wide ? -2.6 : 0);
      cam.lookAt(this.camLook);
      this.setFov(wide ? 42 : 48, dt);
      return;
    }

    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const air = 1 - Math.exp(-Math.max(0, this.pos.y) / 6);
    const dist = 7.4 + speed * 0.045 + air * 2.5;
    const height = 2.5 + air * 2.2 + (this.mode === 'countdown' ? 0.4 : 0);
    const target = this.tmp.set(this.pos.x - fx * dist, this.pos.y * 0.85 + height, this.pos.z - fz * dist);
    target.y = Math.max(target.y, this.world.groundHeight(target.x, target.z) + 1.2);

    // lateral follow is looser than distance follow so steering reads on screen
    const rate = this.mode === 'countdown' ? 1.6 : 7;
    const a = 1 - Math.exp(-dt * rate);
    this.camPos.x += (target.x - this.camPos.x) * (1 - Math.exp(-dt * rate * 0.7));
    this.camPos.y += (target.y - this.camPos.y) * a;
    this.camPos.z += (target.z - this.camPos.z) * (1 - Math.exp(-dt * rate * 1.6));

    const lookAhead = 6 + speed * 0.08;
    const lookTarget = this.tmp2.set(
      this.pos.x + fx * lookAhead - this.steer * 0.8 * Math.cos(this.heading),
      this.pos.y + 1.1 + air * 0.5,
      this.pos.z + fz * lookAhead
    );
    this.camLook.lerp(lookTarget, 1 - Math.exp(-dt * 10));

    cam.position.copy(this.camPos);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    if (this.settings.shake) {
      const s = this.shake * this.shake * 0.6 + (this.boosting ? 0.02 : 0);
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
    }
    cam.lookAt(this.camLook);
    cam.rotateZ(-this.bodyRoll * 0.25);
    const speed01 = Math.min(1, speed / BOOST_SPEED);
    this.setFov(60 + speed01 * 14 + (this.boosting ? 8 : 0), dt);
  }

  private setFov(f: number, dt: number) {
    this.fov += (f - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
