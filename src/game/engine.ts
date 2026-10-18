import * as THREE from 'three';
import { loadAssets } from './assets';
import { CarRig, type ThrusterGroup } from './car';
import { Environment, lookAt, type StageLook } from './environment';
import type { InputManager, InputState } from './input';
import { ParticlePool } from './particles';
import { PostFX } from './postfx';
import type { Settings } from './settings';
import { sfx, startLoops, stopLoops, updateLoops, startMusic, setMusicIntensity, setVolumes } from './audio';
import { stuntPose, type Stunt, type StuntPose } from './stunts';
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
  ThrusterMode,
  gradeFor,
} from './types';

const SIM_DT = 1 / 120;
const GRAVITY = -24;
const MAX_SPEED = 50;
const BOOST_SPEED = 74;
const ACCEL = 22;
const BOOST_ACCEL = 46;
// SpaceX Package: every thruster draws on the COPV air supply (0..100), which the compressor refills
const HOP_VY = 10;
const HOVER_ACCEL = 36;
const HOVER_CEIL = 14;
const HOVER_TIME = 2.6;
const LAUNCH_TIME = 0.45;
const LAUNCH_ACCEL = 70;
const CUSHION_ACCEL = 60;
const AIR_STRAFE = 8;
const AIR_REFILL = 18;
const COMPRESSOR_DELAY = 0.6;
const HOP_COST = 7;
const LAUNCH_COST = 6;
const REAR_DRAIN = 24;
const FRONT_DRAIN = 30;
const HOVER_DRAIN = 26;
const GRIP_DRAIN = 7;
const CUSHION_DRAIN = 30;
const PUFF_COST = 1.2;
const START_TIME = 35;
const COMBO_WINDOW = 4.5;
const ROLL_TIME = 0.62;
const CAR_HALF = new THREE.Vector3(0.95, 0.6, 2.3);
const COUNTDOWN = 3.4;
const RAIL_SPEED = 46;
const RAIL_BOOST_SPEED = 62;
const KICKFLIP_TIME = 0.8;
const wrapAngle = (a: number) => THREE.MathUtils.euclideanModulo(a + Math.PI, Math.PI * 2) - Math.PI;

type Mode = 'showroom' | 'countdown' | 'race' | 'over';

const VAPOUR: Record<ThrusterGroup, { rate: number; speed: number; size: number; life: number; reach: number; fog: number }> = {
  rear: { rate: 70, speed: 30, size: 0.32, life: 0.45, reach: 1.4, fog: 10 },
  front: { rate: 60, speed: 18, size: 0.38, life: 0.4, reach: 1.0, fog: 8 },
  down: { rate: 55, speed: 15, size: 0.42, life: 0.45, reach: 4.2, fog: 42 },
  side: { rate: 40, speed: 10, size: 0.28, life: 0.3, reach: 0, fog: 0 },
};
const FX_SCALE = { low: 0.35, medium: 0.7, high: 1 };

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
  private vapour = new ParticlePool(900, false);
  private fog = new ParticlePool(320, false);
  private fxAcc: number[] = [];
  private fogAcc: number[] = [];
  private plateWas = 0;
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
  private air = 100;
  private compressorWait = 0;
  private padBoost = 0;
  private boosting = false;
  private boostWas = false;
  private launchT = 0;
  private hoverBurn = 0;
  private hopFx = 0;
  private grip = 0;
  private landingAssist = false;
  private cushioned = false;
  private puffGap = 0;
  private puffLeft = 0;
  private puffSide = 0;
  private puffPower = 0;
  /** per-step thruster powers handed to the car rig */
  private thr = { rear: 0, front: 0, down: 0, sidePos: 0, sideNeg: 0 };
  private thrusterMode: ThrusterMode | null = null;
  private roll = 0;
  private rollDir = 0;
  private rolling = false;
  private tricks = 0;
  private bodyPitch = 0;
  private bodyRoll = 0;
  private invuln = 0;
  private throttle = 0;
  private brake = false;

  // stunt ramp: riding the corkscrew, then the launch over the line-up
  private rail: Stunt | null = null;
  private railSpeed = 0;
  private railBlend = 0;
  private stuntAir: Stunt | null = null;
  private stuntRoll = 0;
  private flipFrom = 0;
  private flipTo = 0;
  private flipT = -1;
  private flipDur = 0;
  private kickflip = false;
  private stuntHit = false;
  private pose: StuntPose = { pos: new THREE.Vector3(), roll: 0, slope: 0 };
  private stuntCam = 0;
  private railCam = 0;
  private camRoll = 0;

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
  private tmp3 = new THREE.Vector3();
  private tmp4 = new THREE.Vector3();
  private tmp5 = new THREE.Vector3();
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
    this.scene.add(this.exhaust.points, this.smoke.points, this.vapour.points, this.fog.points);

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
          air: this.air,
          thruster: this.thrusterMode,
          grip: this.grip,
          hoverBurn: this.hoverBurn,
          plate: this.car.plateDrop,
          mode: this.mode,
          score: this.score,
          timeLeft: this.timeLeft,
          bd: this.bd,
          rolling: this.rolling,
          rail: !!this.rail,
          stuntAir: !!this.stuntAir,
          stuntRoll: this.stuntRoll,
        }),
        rings: () => this.world.rings.filter((r) => !r.passed).slice(0, 3).map((r) => r.pos.toArray()),
        obstacles: () => this.world.obstacles.map((o) => [o.box.min.toArray(), o.box.max.toArray()]),
        traffic: () => this.world.traffic.filter((t) => t.active && !t.knocked).map((t) => [...t.pos.toArray(), t.half.x, t.half.y, t.half.z, t.speed]),
        stunts: () => this.world.stunts.map((s) => [s.funnelZ0, s.z0, s.z1, s.x, s.landZ0, s.landZ1]),
        scene: this.scene,
        camera: this.camera,
        car: this.car.root,
      };
    }
    this.loop();
  }

  private freshBreakdown(): RunBreakdown {
    return { crashes: 0, hardLandings: 0, tricks: 0, rings: 0, ringsTotal: 0, nearMisses: 0, stunts: 0, stuntsTotal: 0, airtime: 0, topSpeed: 0, checkpoints: 0 };
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
    this.vapour.setViewportHeight(h * dpr);
    this.fog.setViewportHeight(h * dpr);
  }

  // ---------------- run lifecycle ----------------

  private resetRun() {
    this.pos.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.heading = 0;
    this.steer = 0;
    this.onGround = true;
    this.airTime = 0;
    this.air = 100;
    this.compressorWait = 0;
    this.padBoost = 0;
    this.boosting = false;
    this.launchT = 0;
    this.hoverBurn = 0;
    this.hopFx = 0;
    this.grip = 0;
    this.cushioned = false;
    this.puffLeft = 0;
    this.resetThrusters();
    this.thrusterMode = null;
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
    this.bd.stuntsTotal = this.world.stunts.length;
    this.rail = null;
    this.stuntAir = null;
    this.stuntRoll = 0;
    this.flipT = -1;
    this.kickflip = false;
    this.stuntHit = false;
    this.stuntCam = 0;
    this.world.reset();
    this.exhaust.reset();
    this.smoke.reset();
    this.vapour.reset();
    this.fog.reset();
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
      air: this.air / 100,
      thruster: this.thrusterMode,
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
    this.emitVapour(dt);
    this.exhaust.update(dt);
    this.smoke.update(dt);
    this.vapour.update(dt);
    this.fog.update(dt);
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

    this.resetThrusters();
    this.landingAssist = false;
    if (!this.rail) this.tryEnterRail();
    if (this.rail) this.rideRail(dt, inp);
    else {
      this.updateStuntFlip(dt, inp);
      this.drive(dt, inp);
    }
    this.collide(dt);
    this.updateAttitudePuffs(dt);
    this.updateCompressor(dt);
    this.updateCarPose(dt, inp, true);
    this.emitFx(dt);

    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.bd.topSpeed = Math.max(this.bd.topSpeed, speed);
    this.score += Math.max(0, this.vel.z) * dt * 0.6;
    const t = this.thr;
    updateLoops(speed / BOOST_SPEED, Math.max(t.down, t.front, this.grip * 0.4, Math.max(t.sidePos, t.sideNeg) * 0.35), t.rear, !this.onGround);

    const st = Math.min(2, Math.floor(this.pos.z / 500));
    if (st !== this.stage && st > this.stage) {
      this.stage = st;
      this.events.onStage(st);
    }
    // contextual first-run hints
    if (this.pos.z > 60) this.hint('fly');
    if (this.pos.z > 115 && this.pos.z < 150) this.hint('ramp');
    if (this.pos.z > 240) this.hint('boost');
    if (this.pos.z > 420) this.hint('grip');
    if (this.pos.z > 330 && !this.onGround && !this.stuntAir) this.hint('roll');
    if (this.pos.z > 545) this.hint('barrier');
    if (this.pos.z > 1030) this.hint('gantry');
    const near = this.world.stuntAt(this.pos.z);
    if (near && this.pos.z > near.funnelZ0 - 70 && this.pos.z < near.funnelZ0) this.hint('stunt');
  }

  // ---------------- stunt ramp ----------------

  private tryEnterRail() {
    for (const s of this.world.stunts) {
      if (this.stuntAir === s || this.pos.z < s.z0 || this.pos.z > s.z1 - 2) continue;
      const entry = this.pos.z < s.z0 + 4 && Math.abs(this.pos.x - s.x) < s.hw && this.pos.y < 1.5;
      // anything that drifts into the tube mid-ramp gets pulled onto the deck rather than clipping through it
      const inside = Math.abs(this.pos.x - s.x) < s.radius + 1.5 && this.pos.y < s.radius * 2 + s.climb + 1.5;
      if (!entry && !inside) continue;
      this.rail = s;
      this.railSpeed = THREE.MathUtils.clamp(this.vel.z, RAIL_SPEED - 2, RAIL_BOOST_SPEED);
      this.railBlend = entry ? 0.6 : 0;
      this.heading = 0;
      this.rolling = false;
      this.roll = 0;
      this.onGround = true;
      this.stuntHit = false;
      this.kickflip = false;
      this.flipT = -1;
      this.events.onCallout('STUNT RAMP', 'gold');
      sfx.boost();
      this.shake = Math.max(this.shake, 0.25);
      return;
    }
  }

  private rideRail(dt: number, inp: InputState) {
    const s = this.rail!;
    this.throttle = Math.max(0, inp.throttle);
    this.brake = false;
    this.steer += (0 - this.steer) * Math.min(1, dt * 8);
    this.padBoost = Math.max(0, this.padBoost - dt);
    this.boostWas = inp.boost;
    const mains = inp.boost && this.air > 0;
    if (mains) {
      this.air = Math.max(0, this.air - REAR_DRAIN * dt);
      this.thr.rear = 1;
    }
    this.boosting = this.padBoost > 0 || mains;
    this.grip += (0 - this.grip) * Math.min(1, dt * 4);
    const target = this.boosting ? RAIL_BOOST_SPEED : RAIL_SPEED;
    this.railSpeed += (target - this.railSpeed) * Math.min(1, dt * 1.5);
    this.railBlend = Math.min(1, this.railBlend + dt * 5);

    const z = Math.min(this.pos.z + this.railSpeed * dt, s.z1);
    stuntPose(s, z, this.pose);
    this.tmp.copy(this.pos);
    this.pos.lerp(this.pose.pos, this.railBlend);
    this.pos.z = z;
    this.vel.subVectors(this.pos, this.tmp).divideScalar(dt);
    this.stuntRoll = this.pose.roll;
    this.heading = 0;
    this.onGround = true;

    if (z >= s.z1) {
      this.rail = null;
      this.stuntAir = s;
      this.onGround = false;
      this.airTime = 0;
      this.tricks = 0;
      this.vel.set(0, this.pose.slope * this.railSpeed + 2, this.railSpeed);
      this.air = 100;
      this.hoverBurn = 0;
      this.shake = Math.max(this.shake, 0.35);
      this.flash = Math.max(this.flash, 0.3);
      sfx.hop();
      this.events.onCallout('LAUNCH!', 'gold');
      this.hintsShown.delete('kickflip');
      this.hint('kickflip');
    }
  }

  /** In the air after a stunt launch: ROLL fires a 1.5-turn kickflip upright, otherwise the car self-rights slowly. */
  private updateStuntFlip(dt: number, inp: InputState) {
    if (!this.stuntAir) return;
    if (Math.abs(this.stuntRoll) > 0.4) {
      if (inp.roll !== 0 && !this.kickflip) {
        this.kickflip = true;
        this.flipFrom = this.stuntRoll;
        this.flipTo = this.stuntRoll + inp.roll * Math.PI * 3;
        this.flipTo = Math.round(this.flipTo / (Math.PI * 2)) * Math.PI * 2;
        this.flipDur = KICKFLIP_TIME;
        this.flipT = 0;
        this.tricks++;
        this.bd.tricks++;
        this.addCombo();
        this.addAir(15);
        this.puff(inp.roll, 1, 0.3);
        this.events.onPopup('KICKFLIP', 0, 'gold');
        this.events.onHint(null);
        this.activeHint = null;
        sfx.roll();
      } else if (this.flipT < 0 && this.airTime > 0.55) {
        this.flipFrom = this.stuntRoll;
        this.flipTo = 0;
        this.flipDur = 0.7;
        this.flipT = 0;
        this.puff(this.stuntRoll > 0 ? 1 : -1, 0.8, 0.25);
      }
    }
    if (this.flipT >= 0) {
      this.flipT = Math.min(1, this.flipT + dt / this.flipDur);
      const e = this.flipT < 0.5 ? 2 * this.flipT * this.flipT : 1 - Math.pow(-2 * this.flipT + 2, 2) / 2;
      this.stuntRoll = this.flipFrom + (this.flipTo - this.flipFrom) * e;
      if (this.flipT >= 1) {
        this.stuntRoll = 0;
        this.flipT = -1;
      }
    }
  }

  /** Called on touchdown after a launch. Returns false when the landing was a wipeout. */
  private finishStunt(): boolean {
    const upright = Math.abs(wrapAngle(this.stuntRoll)) < 0.6;
    const zone = this.stuntAir!;
    const inZone = this.pos.z >= zone.landZ0 && this.pos.z <= zone.landZ1 && Math.abs(this.pos.x - zone.x) < 11;
    this.stuntAir = null;
    this.stuntRoll = 0;
    this.flipT = -1;
    if (!upright) {
      this.hardLanding('STUNT WIPEOUT');
      return false;
    }
    const base = this.stuntHit ? 300 : 1200;
    const pts = Math.round((base + (this.kickflip ? 800 : 0) + (inZone ? 500 : 0)) * (1 + (this.combo - 1) * 0.25));
    this.score += pts;
    this.addCombo();
    if (!this.stuntHit) {
      this.bd.stunts++;
      this.timeLeft += 3;
    }
    this.events.onCallout(this.stuntHit ? 'STUNT SCRAPED' : this.kickflip ? 'KICKFLIP LANDED! +3s' : 'STUNT CLEARED! +3s', this.stuntHit ? 'good' : 'gold');
    this.events.onPopup(inZone ? 'BULLSEYE LANDING' : 'STUNT', pts, 'gold');
    this.flash = Math.max(this.flash, 0.4);
    sfx.checkpoint();
    return true;
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

    // ---- rear mains behind the drop-down plate: a launch kick from low speed, then boost ----
    this.padBoost = Math.max(0, this.padBoost - dt);
    const boostEdge = inp.boost && !this.boostWas;
    this.boostWas = inp.boost;
    if (boostEdge && this.onGround && fwd < 22 && this.air > LAUNCH_COST + 4) {
      this.launchT = LAUNCH_TIME;
      this.air -= LAUNCH_COST;
      this.events.onPopup('THRUSTER LAUNCH', 0, 'gold');
      this.shake = Math.max(this.shake, 0.3);
      sfx.boost();
    }
    this.launchT = Math.max(0, this.launchT - dt);
    const mains = this.launchT > 0 || (inp.boost && this.air > 0);
    if (mains) {
      if (this.launchT <= 0) this.air = Math.max(0, this.air - REAR_DRAIN * dt);
      this.thr.rear = 1;
    }
    this.boosting = this.padBoost > 0 || mains;
    const top = this.boosting ? BOOST_SPEED : MAX_SPEED;

    // ---- downforce: in hard corners at speed the side pods fire upward ----
    const wantsGrip = this.onGround && Math.abs(this.steer) > 0.45 && Math.abs(fwd) > 22 && this.air > 3;
    this.grip += ((wantsGrip ? 1 : 0) - this.grip) * Math.min(1, dt * (wantsGrip ? 8 : 4));
    if (wantsGrip) this.air = Math.max(0, this.air - GRIP_DRAIN * dt);

    // ---- front thrusters fire ahead under braking ----
    const thrusterBrake = inp.throttle < 0 && fwd > 3 && this.air > 0;
    if (thrusterBrake) {
      this.air = Math.max(0, this.air - FRONT_DRAIN * dt);
      this.thr.front = 1;
    }

    const offroad = Math.abs(this.pos.x) > ROAD_HALF_WIDTH + 1;
    if (this.onGround) {
      this.hoverBurn = 0;
      if (inp.throttle > 0) {
        const a = (this.boosting ? BOOST_ACCEL : ACCEL) * inp.throttle;
        fwd += a * Math.max(0, 1 - Math.pow(Math.max(0, fwd) / top, 2)) * dt;
      } else if (inp.throttle < 0) {
        if (fwd > 1) fwd = Math.max(0, fwd - (thrusterBrake ? 92 : 44) * dt);
        else fwd -= 14 * dt;
      } else {
        fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), (2 + Math.abs(fwd) * 0.12) * dt);
      }
      if (this.boosting && inp.throttle >= 0) fwd += (BOOST_ACCEL * 0.5) * Math.max(0, 1 - fwd / top) * dt;
      // the launch out-pushes the tyres: thrust beyond grip
      if (this.launchT > 0) fwd += LAUNCH_ACCEL * dt;
      if (offroad) fwd -= fwd * 0.5 * dt;
      if (fwd > top) fwd += (top - fwd) * Math.min(1, dt * 1.5);
      fwd = Math.max(-12, fwd);
      lat *= Math.exp(-((this.boosting ? 6 : 9) + this.grip * 10) * dt);
    } else {
      if (inp.throttle > 0) fwd += 6 * dt * Math.max(0, 1 - fwd / top);
      if (this.boosting) fwd += BOOST_ACCEL * 0.7 * Math.max(0, 1 - fwd / top) * dt;
      if (thrusterBrake) fwd -= 22 * dt;
      fwd -= fwd * 0.03 * dt;
      if (fwd > top) fwd += (top - fwd) * 0.5 * dt;
      // lateral thrusters translate the car sideways in the air
      if (this.air > 0) lat += this.steer * AIR_STRAFE * dt;
      lat *= Math.exp(-2.5 * dt);
    }

    // steering: responsive at low speed, calmer at top speed; downforce tightens the line
    const speedAbs = Math.abs(fwd);
    const turn = (1.6 * Math.min(1, speedAbs / 8) / (1 + speedAbs / 70)) * (1 + this.grip * 0.4);
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

    // ---- down thrusters: a hop, then a short hover while held (not sustained flight) ----
    const ground = this.world.groundHeight(this.pos.x, this.pos.z);
    const alt = this.pos.y - ground;
    if (inp.thrustPressed && this.onGround && this.air > HOP_COST) {
      this.air -= HOP_COST;
      this.vel.y = Math.max(this.vel.y, HOP_VY);
      this.onGround = false;
      this.airTime = 0;
      this.tricks = 0;
      this.hoverBurn = 0;
      this.cushioned = false;
      this.hopFx = 0.2;
      sfx.hop();
      this.burstSmoke(14, 3);
      this.shake = Math.max(this.shake, 0.15);
    }
    this.hopFx = Math.max(0, this.hopFx - dt);
    if (this.hopFx > 0) this.thr.down = 1;
    if (inp.thrust && !this.onGround && this.air > 0 && this.hoverBurn < HOVER_TIME && this.vel.y > -14) {
      this.hoverBurn += dt;
      // the burst sputters out at the end; lift tapers off near the ceiling so the car settles into a hover
      const fade = THREE.MathUtils.clamp((HOVER_TIME - this.hoverBurn) / 0.35, 0, 1);
      const taper = THREE.MathUtils.clamp((HOVER_CEIL - alt) / 3, 0, 1);
      this.vel.y += HOVER_ACCEL * taper * fade * dt;
      this.vel.y -= this.vel.y * 1.5 * fade * dt;
      this.air = Math.max(0, this.air - HOVER_DRAIN * dt);
      this.thr.down = Math.max(this.thr.down, 0.35 + 0.65 * fade);
    }

    // ---- landing assist: down thrusters cushion a fast descent if the car is upright ----
    if (!this.onGround && this.vel.y < -8 && !this.rolling && this.air > 2 && Math.abs(wrapAngle(this.stuntRoll)) < 0.5) {
      const reach = 1.5 - this.vel.y * 0.12;
      if (alt < reach && alt > 0.05) {
        this.vel.y += CUSHION_ACCEL * dt;
        this.air = Math.max(0, this.air - CUSHION_DRAIN * dt);
        this.thr.down = 1;
        this.landingAssist = true;
        this.cushioned = true;
      }
    }

    if (!this.onGround) {
      this.vel.y += GRAVITY * dt;
      // wing-body lift makes descents floaty at speed
      if (this.vel.y < 0) this.vel.y += Math.min(10, Math.max(0, fwd) * 0.17) * dt;
      this.vel.y -= this.vel.y * 0.25 * dt;
      this.airTime += dt;
      this.bd.airtime += dt;
    }

    // ---- barrel rolls (side thrusters fire to start the spin) ----
    if (inp.roll !== 0 && !this.onGround && !this.rolling && alt > 1.5 && this.flipT < 0 && this.stuntRoll === 0) {
      this.rolling = true;
      this.rollDir = inp.roll;
      this.roll = 0;
      this.puff(inp.roll, 1, 0.22);
      sfx.roll();
    }
    if (this.rolling) {
      this.roll += dt / ROLL_TIME;
      if (this.roll >= 1) {
        this.rolling = false;
        this.roll = 0;
        this.tricks++;
        this.bd.tricks++;
        this.addAir(10);
        this.puff(-this.rollDir, 0.9, 0.12);
        this.addCombo();
        this.events.onPopup('BARREL ROLL', 0, 'gold');
      }
    }

    this.pos.addScaledVector(this.vel, dt);
  }

  // ---------------- thrusters ----------------

  private resetThrusters() {
    this.thr.rear = this.thr.front = this.thr.down = this.thr.sidePos = this.thr.sideNeg = 0;
  }

  private addAir(n: number) {
    this.air = Math.min(100, this.air + n);
  }

  /** Fire one lateral pod for a short pulse. side > 0 is the pod on the car's +X flank. */
  private puff(side: number, power: number, dur = 0.07) {
    if (this.air <= 0 || side === 0) return;
    this.puffSide = side;
    this.puffPower = power;
    this.puffLeft = dur;
    this.air = Math.max(0, this.air - PUFF_COST * power);
  }

  /** Attitude control in the air: pulses while steering, plus small levelling blips. */
  private updateAttitudePuffs(dt: number) {
    this.puffGap -= dt;
    if (!this.onGround && !this.rail && this.puffLeft <= 0 && this.puffGap <= 0) {
      if (Math.abs(this.steer) > 0.15) {
        // the +X pod blows outward and pushes the car toward -X (screen-right)
        this.puff(this.steer > 0 ? 1 : -1, 1);
        this.puffGap = 0.15;
      } else {
        this.puff(Math.random() < 0.5 ? 1 : -1, 0.45, 0.05);
        this.puffGap = 0.45 + Math.random() * 0.5;
      }
    }
    if (this.puffLeft > 0) {
      this.puffLeft -= dt;
      if (this.puffSide > 0) this.thr.sidePos = this.puffPower;
      else this.thr.sideNeg = this.puffPower;
    }
    const t = this.thr;
    this.thrusterMode =
      this.launchT > 0
        ? 'LAUNCH'
        : this.landingAssist
          ? 'LANDING'
          : t.front > 0
            ? 'BRAKE'
            : t.rear > 0
              ? 'BOOST'
              : t.down > 0.3 && !this.onGround
                ? 'HOVER'
                : this.grip > 0.5
                  ? 'GRIP'
                  : null;
  }

  /** The onboard compressor tops the COPVs up whenever the big thrusters rest. */
  private updateCompressor(dt: number) {
    const t = this.thr;
    const firing = t.rear > 0 || t.front > 0 || t.down > 0 || this.grip > 0.3;
    if (firing) this.compressorWait = COMPRESSOR_DELAY;
    else if ((this.compressorWait -= dt) <= 0) this.addAir(AIR_REFILL * dt * (this.onGround || this.rail ? 1 : 0.6));
  }

  private collide(dt: number) {
    const prevZ = this.pos.z - this.vel.z * dt;

    // ---- ground ----
    const g = this.world.groundHeight(this.pos.x, this.pos.z);
    if (this.rail) {
      // the corkscrew deck carries the car; skip terrain contact
    } else if (this.pos.y <= g) {
      const impact = -this.vel.y;
      this.pos.y = g;
      if (!this.onGround) this.land(impact);
      const slope = (this.world.groundHeight(this.pos.x, this.pos.z + 0.5) - this.world.groundHeight(this.pos.x, this.pos.z - 0.5)) / 1;
      // the slope sample straddles ramp lips, where it is close to vertical; never fling the car down off one
      this.vel.y = Math.max(-8, slope * this.vel.z);
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

    // ---- stunt funnel: walls narrow the road onto the ramp deck ----
    for (const s of this.world.stunts) {
      if (this.rail || this.pos.z < s.funnelZ0 || this.pos.z > s.z0 || this.pos.y > 2) continue;
      const t = (this.pos.z - s.funnelZ0) / (s.z0 - s.funnelZ0);
      const lim = THREE.MathUtils.lerp(RAIL_X - 1.1, s.hw + 0.4, t) - 0.3 - CAR_HALF.x;
      const dx = this.pos.x - s.x;
      if (Math.abs(dx) > lim) {
        const side = Math.sign(dx);
        this.pos.x = s.x + side * lim;
        if (this.vel.x * side > 0) {
          if (Math.abs(this.vel.x) > 6) {
            this.shake = Math.max(this.shake, 0.2);
            this.sparks(this.tmp.set(this.pos.x + side, this.pos.y + 0.5, this.pos.z), 10);
          }
          this.vel.x *= -0.2;
        }
        this.heading *= 0.8;
      }
    }

    // ---- player AABB (heading-aware) ----
    const c = Math.abs(Math.cos(this.heading));
    const sn = Math.abs(Math.sin(this.heading));
    const hx = CAR_HALF.x * c + CAR_HALF.z * sn;
    const hz = CAR_HALF.x * sn + CAR_HALF.z * c;
    this.playerBox.min.set(this.pos.x - hx, this.pos.y + 0.15, this.pos.z - hz);
    this.playerBox.max.set(this.pos.x + hx, this.pos.y + 1.25, this.pos.z + hz);

    for (const o of this.world.obstacles) {
      if (!this.playerBox.intersectsBox(o.box)) continue;
      if (o.kind === 'parked' && this.vel.y <= 0 && this.pos.y > o.box.max.y - 0.6) {
        this.pos.y = o.box.max.y;
        this.vel.y = 9;
        this.onGround = false;
        const pts = 250 * this.combo;
        this.score += pts;
        this.addAir(6);
        this.addCombo();
        this.events.onPopup('ROOF HOP', pts, 'gold');
        sfx.hop();
        break;
      }
      if (this.invuln > 0) break;
      this.crash(o.kind === 'gantry' ? 'GANTRY HIT' : o.kind === 'parked' ? 'LINE-UP HIT' : 'BARRIER HIT', null);
      this.deflect(o.box);
      break;
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
          this.addAir(6);
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
          this.addAir(5);
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
          this.addAir(12);
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
    this.hoverBurn = 0;
    const cushioned = this.cushioned;
    this.cushioned = false;
    let stunt = false;
    if (this.stuntAir) {
      if (!this.finishStunt()) return;
      stunt = true;
    }
    if (this.rolling) {
      this.rolling = false;
      this.roll = 0;
      this.hardLanding('WIPEOUT');
      return;
    }
    if (impact > (stunt ? 32 : 20)) {
      this.hardLanding('HARD LANDING');
      return;
    }
    if (air > 0.6) {
      const trickPts = this.tricks * 400;
      const pts = Math.round((50 + Math.min(air, 4) * 80 + trickPts) * this.combo);
      this.score += pts;
      this.addCombo();
      this.addAir(6);
      const label = this.tricks > 0 ? `TRICK LANDING ×${this.tricks}` : cushioned ? 'THRUSTER LANDING' : air > 2 ? `BIG AIR ${air.toFixed(1)}s` : 'SMOOTH LANDING';
      this.events.onPopup(label, pts, this.tricks ? 'gold' : 'good');
      sfx.cleanLanding();
    }
    sfx.land();
    this.burstSmoke(cushioned ? 6 : 10 + Math.min(20, impact), 2 + impact * 0.1);
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
    if (this.stuntAir) this.stuntHit = true;
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
    const targetPitch = this.rail
      ? -Math.atan(this.pose.slope)
      : this.onGround
        ? -accel * 0.03 + (this.brake ? 0.04 : 0)
        : THREE.MathUtils.clamp(-this.vel.y * 0.02, -0.25, 0.25);
    const targetRoll = this.steer * (this.onGround ? 0.06 : 0.3) * Math.min(1, Math.abs(fwd) / 20);
    this.bodyPitch += (targetPitch - this.bodyPitch) * Math.min(1, dt * 6);
    this.bodyRoll += (targetRoll - this.bodyRoll) * Math.min(1, dt * 6);
  }

  private updateCarVisual(dt: number) {
    const r = this.car.root;
    const showroom = this.mode === 'showroom';
    let state = this.thr;
    if (showroom) {
      // hovering on the down thrusters for the title screen, with an occasional attitude blip
      r.position.set(0, 1.6 + Math.sin(this.clock * 1.6) * 0.1, 0);
      r.rotation.set(0, this.clock * 0.25, 0);
      this.car.body.rotation.set(Math.sin(this.clock * 1.1) * 0.02, 0, Math.sin(this.clock * 0.8) * 0.03);
      const blip = (phase: number) => (((this.clock * 0.55 + phase) % 1) < 0.05 ? 0.7 : 0);
      state = {
        rear: 0,
        front: 0,
        down: 0.8 + Math.sin(this.clock * 1.6 + 1.2) * 0.12,
        sidePos: blip(0),
        sideNeg: blip(0.5),
      };
    } else {
      r.position.copy(this.pos);
      r.rotation.set(0, this.heading, 0);
      const trick = this.rolling ? this.rollDir * this.roll * Math.PI * 2 : 0;
      this.car.body.rotation.set(this.bodyPitch, 0, -this.bodyRoll + trick + this.stuntRoll, 'YXZ');
      this.car.body.position.y = this.onGround ? Math.sin(this.clock * 30) * 0.004 * Math.min(1, Math.abs(this.vel.z) / 20) : 0;
    }
    const live = this.mode === 'race' || showroom;
    this.car.setVisible(this.invuln <= 0 || Math.floor(this.invuln * 14) % 2 === 0);
    this.car.update(
      dt,
      {
        speed: showroom ? 0 : this.vel.z,
        steer: showroom ? 0 : this.steer,
        rear: live ? state.rear : 0,
        front: live ? state.front : 0,
        down: live ? state.down : 0,
        sidePos: live ? state.sidePos : 0,
        sideNeg: live ? state.sideNeg : 0,
        grip: showroom ? 0 : this.grip,
        brake: this.brake && this.mode === 'race',
        night: this.look.night,
      },
      showroom ? 0 : this.world.groundHeight(this.pos.x, this.pos.z)
    );
  }

  private emitFx(dt: number) {
    const speed = Math.abs(this.vel.z);
    if (this.onGround && Math.abs(this.pos.x) > ROAD_HALF_WIDTH + 1 && speed > 10 && Math.random() < dt * 30) this.burstSmoke(1, 1.5);
  }

  /** White cold-gas vapour from every live nozzle, plus fog and dust where the jets reach the road. */
  private emitVapour(dt: number) {
    if (dt <= 0) return;
    const q = FX_SCALE[this.settings.quality];
    const showroom = this.mode === 'showroom';
    const carVel = showroom ? this.tmp3.set(0, 0, 0) : this.tmp3.copy(this.vel);
    const ground = showroom ? 0 : this.world.groundHeight(this.pos.x, this.pos.z);
    const stage = Math.min(2, Math.floor(this.pos.z / 500));
    const dust = stage === 0 ? 0xd2b58e : stage === 1 ? 0xd9dde2 : 0x9a96b0;
    const P = this.tmp;
    const D = this.tmp2;

    // the plate drops with a pressure burst before the mains settle into a steady jet
    const plate = this.car.plateDrop;
    const burst = plate > 0.5 && this.plateWas <= 0.5;
    this.plateWas = plate;

    this.car.nozzles.forEach((n, i) => {
      if (n.power < 0.04 && !(burst && n.group === 'rear')) {
        this.fxAcc[i] = 0;
        return;
      }
      const cfg = VAPOUR[n.group];
      this.car.nozzleWorld(n, P, D);
      this.fxAcc[i] = (this.fxAcc[i] ?? 0) + cfg.rate * n.power * q * dt;
      const count = Math.floor(this.fxAcc[i]);
      if (count > 0) {
        this.fxAcc[i] -= count;
        this.vapour.emit({
          count,
          pos: this.tmp4.copy(P).addScaledVector(D, 0.15),
          spread: 0.08,
          vel: this.tmp5.copy(carVel).multiplyScalar(0.9).addScaledVector(D, cfg.speed * (0.7 + 0.3 * n.power)),
          velSpread: cfg.speed * 0.2,
          life: cfg.life,
          size: cfg.size,
          grow: 6,
          color: 0xf4f7fb,
          alpha: (n.group === 'rear' ? 0.3 : 0.42) * Math.min(1, n.power + 0.2),
          drag: 4.5,
          gravity: 0.5,
          fadeIn: 0.12,
        });
      }
      if (burst && n.group === 'rear') {
        this.vapour.emit({
          count: Math.ceil(12 * q),
          pos: P,
          spread: 0.2,
          vel: this.tmp5.copy(carVel).multiplyScalar(0.9).addScaledVector(D, 14),
          velSpread: 9,
          life: 0.5,
          size: 0.35,
          grow: 5,
          color: 0xffffff,
          alpha: 0.32,
          drag: 3,
          gravity: 0.6,
          fadeIn: 0.05,
        });
      }

      // ground effect: jets that reach the road fan out into a low fog sheet and kick up dust
      if (!cfg.reach) return;
      const h = P.y - ground;
      if (h > cfg.reach || h < -0.5) return;
      const k = THREE.MathUtils.clamp(1 - h / cfg.reach, 0, 1) * Math.max(n.power, burst ? 1 : 0);
      this.fogAcc[i] = (this.fogAcc[i] ?? 0) + cfg.fog * k * q * dt + (burst ? 5 * q : 0);
      let fogCount = Math.floor(this.fogAcc[i]);
      this.fogAcc[i] -= fogCount;
      const hit = this.tmp4.copy(P);
      if (n.group !== 'down') hit.addScaledVector(D, 1.4);
      hit.y = ground + 0.1;
      while (fogCount-- > 0) {
        const a = Math.random() * Math.PI * 2;
        const out = 5 + 7 * k;
        const isDust = Math.random() < 0.3;
        this.fog.emit({
          count: 1,
          pos: hit,
          spread: 0.4,
          vel: this.tmp5.set(Math.cos(a) * out + carVel.x * 0.5 + D.x * 4, isDust ? 1.4 : 0.2, Math.sin(a) * out + carVel.z * 0.5 + D.z * 4),
          velSpread: 2,
          life: isDust ? 1.1 : 1.9,
          size: isDust ? 0.7 : 1.0,
          grow: isDust ? 2 : 2.8,
          color: isDust ? dust : 0xeef1f5,
          alpha: (isDust ? 0.24 : 0.36) * (0.5 + 0.5 * k),
          drag: 1.4,
          gravity: isDust ? -1.2 : 0.1,
          fadeIn: 0.15,
        });
      }
    });
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
      this.camLook.set(0, wide ? 1.7 : 2.3, 0).addScaledVector(right, wide ? -2.6 : 0);
      cam.lookAt(this.camLook);
      this.setFov(wide ? 42 : 48, dt);
      return;
    }

    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const air = 1 - Math.exp(-Math.max(0, this.pos.y) / 6);
    const stuntTarget = this.rail || this.stuntAir ? 1 : 0;
    this.stuntCam += (stuntTarget - this.stuntCam) * Math.min(1, dt * (stuntTarget ? 2.5 : 1.2));
    const dist = 7.4 + speed * 0.045 + air * 2.5 + this.stuntCam * 4;
    const height = 2.5 + air * 2.2 + (this.mode === 'countdown' ? 0.4 : 0) + this.stuntCam * 2;
    const target = this.tmp.set(this.pos.x - fx * dist, this.pos.y * 0.85 + height, this.pos.z - fz * dist);
    target.y = Math.max(target.y, this.world.groundHeight(target.x, target.z) + 1.2);
    // on the corkscrew the camera rides the tube axis so the deck never sits between it and the car
    this.railCam += ((this.rail ? 1 : 0) - this.railCam) * Math.min(1, dt * (this.rail ? 4 : 1.5));
    const tube = this.rail ?? this.stuntAir;
    if (tube && this.railCam > 0.001) {
      const up = this.stuntRoll;
      target.lerp(this.tmp2.set(this.pos.x - Math.sin(up) * 2.4, this.pos.y + Math.cos(up) * 2.4, this.pos.z - 7.5), this.railCam);
    }

    // lateral follow is looser than distance follow so steering reads on screen
    const rate = this.mode === 'countdown' ? 1.6 : 7 + this.railCam * 18;
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
    if (this.stuntAir) lookTarget.y -= this.stuntCam * Math.max(0, this.pos.y - 2) * 0.55;
    if (tube && this.railCam > 0.001) {
      const up = this.stuntRoll;
      lookTarget.lerp(this.tmp.set(this.pos.x - Math.sin(up) * 1.1, this.pos.y + Math.cos(up) * 1.1, this.pos.z + 8), this.railCam);
    }
    this.camLook.lerp(lookTarget, 1 - Math.exp(-dt * (this.railCam > 0.5 ? 18 : 10)));

    cam.position.copy(this.camPos);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    if (this.settings.shake) {
      const s = this.shake * this.shake * 0.6 + (this.boosting ? 0.02 : 0);
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
    }
    cam.lookAt(this.camLook);
    this.camRoll += ((this.rail ? this.stuntRoll : 0) - this.camRoll) * Math.min(1, dt * (this.rail ? 10 : 2.2));
    cam.rotateZ(-this.bodyRoll * 0.25 - this.camRoll);
    const speed01 = Math.min(1, speed / BOOST_SPEED);
    this.setFov(60 + speed01 * 14 + (this.boosting ? 8 : 0) - this.railCam * 12, dt);
  }

  private setFov(f: number, dt: number) {
    this.fov += (f - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
