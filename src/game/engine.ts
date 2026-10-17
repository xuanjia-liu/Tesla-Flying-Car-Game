import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CarModel } from './carModel';
import { World, ParkedCar, STAGES } from './world';
import { InputManager } from './input';
import { PostFX } from './postfx';
import { injectCallout } from './callout';
import { COURSE_FINISH, GameEvents, GameStats, GameOverResult, RunBreakdown, TANK_RESERVE_FRACTION } from './types';

const lerpColor = (c: THREE.Color, hex: number, t: number) => c.lerp(_tmpColor.set(hex), t);
const _tmpColor = new THREE.Color();
import {
  playThruster, playThud, playChime, playBlip, playBoost, playFail, playWhoosh,
  engineStart, engineUpdate, engineStop,
} from './audio';

const GRAVITY = -22;
const START_TIME = 60;
const TANK_MAX = 100;
const TANK_DRAIN_PER_SEC = 55;
const TANK_REFILL_PER_SEC = 40;
const TANK_HOP_COST = 26;
const TANK_FLIP_COST = 14;
const TANK_CUSHION_COST = 15;
const TANK_LANDING_MIN = TANK_RESERVE_FRACTION * TANK_MAX; // hover can never eat into this
const HOP_IMPULSE = 13;
const HOP_FORWARD_IMPULSE = 8;
const FLIP_TIME = 0.55;
const BOOST_TIME_MAX = 1.4;
const PAD_TIME_BONUS = 5;
const RING_TIME_BONUS = 3;
const RING_SCORE = 100;
const PAD_SCORE = 150;
const CLEAN_LANDING_SCORE = 250;
const FLIP_SCORE = 200;
const CRASH_PENALTY_TIME = 8;
const HARD_LANDING_PENALTY_TIME = 5;
const CRASH_INVULN_TIME = 1.8;
const MAX_SPEED = 46;
const BOOST_SPEED = 62;
const COUNTDOWN_TIME = 3.2;

interface Trail {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private car: CarModel;
  private world: World;
  private input: InputManager;
  private events: GameEvents;
  private raf = 0;
  private lastT = 0;
  private running = false;
  private paused = false;
  private disposed = false;

  // car state
  private pos = new THREE.Vector3(0, 0, 10);
  private vel = new THREE.Vector3();
  private heading = 0;
  private onGround = true;
  private tank = TANK_MAX;
  private flipTimer = 0;
  private flipAxis = 1;
  private airTime = 0;
  private maxAirThisJump = 0;
  private didFlip = false;
  private hopHeldLast = false;
  private boostTimer = 0;
  private boostCooldown = 0;
  private vapor: Trail[] = [];
  private dust: Trail[] = [];
  private shake = 0;
  private combo = 1;
  private comboChain = 0;
  private timeLeft = START_TIME;
  private score = 0;
  private distance = 0;
  private startZ = 10;
  private countdown = 0;
  private invuln = 0;
  private crashedCarIds = new Set<number>();
  private statsAccum = 0;
  private slowmo = 0;
  private topSpeedSeen = 0;
  private camPos = new THREE.Vector3(0, 6, -14);
  private camLook = new THREE.Vector3();
  private moonLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private postfx!: PostFX;
  private redFlash = 0;
  private baseFov = 66;
  private cleanupFns: (() => void)[] = [];

  // breakdown
  private bd = { crashes: 0, hardLandings: 0, flips: 0, rings: 0, airtime: 0 };
  // in-game tutorial prompts
  private promptShown = { hop: false, cushion: false, flip: false, pad: false };
  private nearMissCooldown = new Map<number, number>();

  constructor(container: HTMLElement, input: InputManager, events: GameEvents) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x1a1410);
    this.scene.fog = new THREE.Fog(0x2a2018, 80, 420);
    this.camera = new THREE.PerspectiveCamera(this.baseFov, container.clientWidth / container.clientHeight, 0.1, 900);

    // environment map so the silver paint actually reflects something
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.car = new CarModel();
    this.scene.add(this.car.group);
    this.world = new World();
    this.scene.add(this.world.group);
    this.input = input;
    this.events = events;

    this.setupLights();
    this.setupParticles();
    this.postfx = new PostFX(this.renderer, this.scene, this.camera, container.clientWidth, container.clientHeight);
    this.resetRun();
    this.attachResize(container);

    const onVis = () => {
      if (document.hidden && this.running && !this.paused) this.setPaused(true);
    };
    document.addEventListener('visibilitychange', onVis);
    this.cleanupFns.push(() => document.removeEventListener('visibilitychange', onVis));

    this.lastT = performance.now();
    this.loop();
  }

  private setupLights() {
    const hemi = new THREE.HemisphereLight(0xffd9a0, 0x35281e, 0.75);
    this.scene.add(hemi);
    this.hemiLight = hemi;
    const sun = new THREE.DirectionalLight(0xffc27a, 1.5);
    sun.position.set(-70, 55, -30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
    sun.shadow.camera.far = 260;
    this.scene.add(sun);
    this.moonLight = sun;
  }

  private setupParticles() {
    const vaporTex = makeVaporTexture();
    for (let i = 0; i < 90; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: vaporTex, color: 0xf2f6fa, transparent: true, opacity: 0, depthWrite: false })
      );
      sprite.visible = false;
      this.scene.add(sprite);
      this.vapor.push({ sprite, life: 0, maxLife: 1 });
    }
    const dustTex = makeDustTexture();
    for (let i = 0; i < 40; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: dustTex, color: 0xc9a878, transparent: true, opacity: 0, depthWrite: false })
      );
      sprite.visible = false;
      this.scene.add(sprite);
      this.dust.push({ sprite, life: 0, maxLife: 1 });
    }
  }

  startRun() {
    this.resetRun();
    engineStart();
    this.running = true;
  }

  setPaused(p: boolean) {
    if (!this.running) return;
    this.paused = p;
    if (p) engineUpdate(0);
  }

  isPaused() {
    return this.paused;
  }

  private resetRun() {
    this.pos.set(0, 0, 10);
    this.vel.set(0, 0, 0);
    this.heading = 0;
    this.onGround = true;
    this.tank = TANK_MAX;
    this.flipTimer = 0;
    this.airTime = 0;
    this.maxAirThisJump = 0;
    this.didFlip = false;
    this.boostTimer = 0;
    this.boostCooldown = 0;
    this.combo = 1;
    this.comboChain = 0;
    this.timeLeft = START_TIME;
    this.score = 0;
    this.distance = 0;
    this.startZ = 10;
    this.shake = 0;
    this.countdown = COUNTDOWN_TIME;
    this.invuln = 0;
    this.crashedCarIds.clear();
    this.nearMissCooldown.clear();
    this.bd = { crashes: 0, hardLandings: 0, flips: 0, rings: 0, airtime: 0 };
    this.promptShown = { hop: false, cushion: false, flip: false, pad: false };
    this.slowmo = 0;
    this.topSpeedSeen = 0;
    this.world.reset();
    this.car.bodyPivot.rotation.set(0, 0, 0);
    this.car.bodyPivot.position.set(0, 0, 0);
    this.car.setVisible(true);
    this.emitStats();
  }

  private emitStats() {
    const stats: GameStats = {
      score: Math.floor(this.score),
      timeLeft: Math.max(0, this.timeLeft),
      tank: this.tank / TANK_MAX,
      speed: this.vel.length(),
      combo: this.combo,
      distance: Math.max(0, Math.floor(this.pos.z - this.startZ)),
      airborne: !this.onGround,
      countdown: this.countdown,
    };
    this.events.onStats(stats);
  }

  private attachResize(container: HTMLElement) {
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      this.renderer.setSize(w, h);
      this.postfx.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    this.cleanupFns.push(() => window.removeEventListener('resize', onResize));
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    engineStop();
    for (const fn of this.cleanupFns) fn();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    let dt = Math.min((now - this.lastT) / 1000, 0.05);
    this.lastT = now;

    this.input.beginFrame();
    if (this.input.consumePause()) {
      if (this.running) this.setPaused(!this.paused);
      if (!this.running) this.events.onToast('PAUSE', 'good');
    }

    if (this.running && !this.paused) {
      // slow-motion moment on clean flip landing
      if (this.slowmo > 0) {
        this.slowmo -= dt;
        dt *= 0.35;
      }
      this.step(dt);
    }
    this.world.update(now / 1000, this.running && !this.paused);
    this.updateStageLighting();
    this.updateCamera(dt);
    this.postfx.update(
      this.boostTimer > 0 ? 1 : 0,
      this.redFlash,
      this.camera.aspect
    );
    this.redFlash = Math.max(0, this.redFlash - dt * 1.5);
    this.postfx.composer.render();
  };

  private step(dt: number) {
    // ---- countdown before the clock starts ----
    if (this.countdown > 0) {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(Math.max(0, this.countdown));
      if (after !== before && after > 0) playBlip();
      if (this.countdown <= 0) playChime();
      this.emitStats();
      // let the car creep forward slowly during countdown
      this.vel.z *= 0.9;
      this.pos.addScaledVector(this.vel, dt);
      return;
    }

    // ---- timer ----
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.endRun();
      return;
    }

    // ---- input snapshot ----
    const s = this.input.state;
    this.input.applyTouch(s);
    const fwd = s.forward;
    const steer = s.steer;
    const hopPressed = s.hop && !this.hopHeldLast;
    this.hopHeldLast = s.hop;
    const hopHeld = s.hop;

    // ---- boost (0-60 burst) ----
    this.boostCooldown = Math.max(0, this.boostCooldown - dt);
    if (s.boost && this.boostCooldown <= 0 && this.onGround) {
      this.boostTimer = BOOST_TIME_MAX;
      this.boostCooldown = BOOST_TIME_MAX + 2.2;
      playBoost();
      this.events.onPopup('LAUNCH BOOST', 100, 'good');
      this.score += 100;
      this.shake = Math.max(this.shake, 0.25);
    }
    if (this.boostTimer > 0) {
      this.boostTimer -= dt;
      this.topSpeedSeen = Math.max(this.topSpeedSeen, this.vel.length());
    }

    // ---- steering + driving ----
    const boosting = this.boostTimer > 0;
    const maxSpeed = boosting ? BOOST_SPEED : MAX_SPEED;
    const accel = boosting ? 120 : 34;
    if (this.onGround) {
      if (fwd > 0) this.vel.z += accel * dt;
      else if (fwd < 0) this.vel.z -= 26 * dt;
      else this.vel.z *= 1 - 1.2 * dt;
    } else {
      if (fwd > 0) this.vel.z += 6 * dt;
    }
    this.vel.z = THREE.MathUtils.clamp(this.vel.z, -10, maxSpeed);

    const speed = Math.abs(this.vel.z);
    this.topSpeedSeen = Math.max(this.topSpeedSeen, speed);
    const turnRate = 1.9 * Math.min(1, speed / 14 + 0.25);
    this.heading -= steer * turnRate * dt * (fwd < 0 ? -1 : 1);
    const grip = this.onGround ? 6.5 : 0.4;
    const dirX = Math.sin(this.heading);
    const dirZ = Math.cos(this.heading);
    const forwardSpeed = this.vel.x * dirX + this.vel.z * dirZ;
    const lateral = new THREE.Vector3(this.vel.x, 0, this.vel.z).addScaledVector(
      new THREE.Vector3(dirX, 0, dirZ),
      -forwardSpeed
    );
    this.vel.x -= lateral.x * Math.min(1, grip * dt);
    this.vel.z -= lateral.z * Math.min(1, grip * dt);
    if (this.onGround && steer !== 0 && speed > 4) {
      this.vel.x += dirZ * -steer * 6 * dt * 10;
    }

    // ---- hop (thruster leap) ----
    if (hopPressed && this.onGround && this.tank >= TANK_HOP_COST + TANK_LANDING_MIN) {
      this.tank -= TANK_HOP_COST;
      this.vel.y = HOP_IMPULSE;
      const dirBoost = fwd >= 0 ? 1 : 0.4;
      this.vel.x += Math.sin(this.heading) * HOP_FORWARD_IMPULSE * dirBoost;
      this.vel.z += Math.cos(this.heading) * HOP_FORWARD_IMPULSE * dirBoost;
      this.onGround = false;
      this.didFlip = false;
      this.airTime = 0;
      this.maxAirThisJump = 0;
      playThruster(0.5, 0.55);
      this.burst(this.vapor, 6, 2.5, 2.6);
      this.spawnDustRing();
      this.shake = Math.max(this.shake, 0.18);
      if (!this.promptShown.hop) {
        this.promptShown.hop = true;
        this.events.onToast('Hold SPACE to hover — but keep a reserve!', 'good');
      }
    }

    // ---- sustained hover while holding hop in air (reserve protected) ----
    const hoverCap = TANK_LANDING_MIN; // can't hover below the reserve
    if (!this.onGround && hopHeld && this.tank > hoverCap) {
      this.vel.y += 30 * dt;
      this.tank = Math.max(hoverCap, this.tank - TANK_DRAIN_PER_SEC * dt);
      if (Math.random() < 0.5) this.burst(this.vapor, 1, 1.2, 0);
      this.car.setThrusterPower(1);
    } else {
      this.car.setThrusterPower(0);
    }

    // ---- mid-air flip ----
    if (s.flip && !this.onGround && this.tank >= TANK_FLIP_COST && this.flipTimer <= 0) {
      this.tank -= TANK_FLIP_COST;
      this.flipTimer = FLIP_TIME;
      this.flipAxis = steer !== 0 ? Math.sign(steer) : 1;
      this.didFlip = true;
      playThruster(0.35, 0.4);
      this.burst(this.vapor, 4, 1.5, 0);
      if (!this.promptShown.flip) {
        this.promptShown.flip = true;
        this.events.onToast('Nice! Now land it clean', 'good');
      }
    }
    if (this.flipTimer > 0) {
      this.flipTimer -= dt;
      const p = 1 - this.flipTimer / FLIP_TIME;
      this.car.bodyPivot.rotation.x = -p * Math.PI * 2 * this.flipAxis;
      if (this.flipTimer <= 0) this.car.bodyPivot.rotation.x = 0;
    }

    // ---- cushion jets: player-timed landing soften ----
    if (s.cushion && !this.onGround && this.tank >= TANK_CUSHION_COST) {
      this.tank -= TANK_CUSHION_COST;
      // kill most of the downward speed
      this.vel.y = Math.max(this.vel.y, -3.5);
      playThruster(0.4, 0.5);
      this.burst(this.vapor, 8, 1.2, 0);
      this.car.setThrusterPower(1);
      if (!this.promptShown.cushion && this.vel.y < -6) {
        this.promptShown.cushion = true;
        this.events.onToast('Cushion jets! Tap SPACE again just before landing', 'good');
      }
    }

    // ---- gravity ----
    this.vel.y += GRAVITY * dt;

    // ---- integrate ----
    this.pos.addScaledVector(this.vel, dt);

    // ---- world collisions & ground ----
    this.handleWorld(dt);

    // ---- tank refill ----
    if (this.onGround) {
      this.tank = Math.min(TANK_MAX, this.tank + TANK_REFILL_PER_SEC * dt);
    }

    // ---- scoring: distance drip, rings, pads ----
    this.score += this.vel.z > 0 ? this.vel.z * dt * 1.2 : 0;
    this.checkRings();
    this.checkPads();
    this.checkNearMiss();
    this.checkFinish();

    // ---- invulnerability blink ----
    if (this.invuln > 0) {
      this.invuln -= dt;
      this.car.setVisible(Math.floor(this.invuln * 12) % 2 === 0);
      if (this.invuln <= 0) this.car.setVisible(true);
    }

    // ---- visual updates ----
    this.car.group.position.copy(this.pos);
    this.car.group.rotation.y = this.heading;
    this.car.spinWheels(dt, this.vel.z);
    this.car.setSteerVisual(steer);
    this.car.setTailBrake(fwd < 0);
    this.updateParticles(dt);

    engineUpdate(Math.min(1, speed / BOOST_SPEED) * (this.onGround ? 1 : 0.7));

    // ---- stats to UI ----
    this.statsAccum += dt;
    if (this.statsAccum > 0.08) {
      this.statsAccum = 0;
      this.emitStats();
    }
  }

  private handleWorld(dt: number) {
    void dt;
    // ramp surface
    let surfaceY = 0;
    for (const ramp of this.world.ramps) {
      const localZ = this.pos.z - ramp.startZ;
      if (localZ >= -1 && localZ <= ramp.endZ - ramp.startZ + 1 && Math.abs(this.pos.x - ramp.x) < ramp.width / 2 + 1) {
        const t = THREE.MathUtils.clamp(localZ / (ramp.endZ - ramp.startZ), 0, 1);
        surfaceY = t * ramp.height;
      }
    }

    if (this.pos.y <= surfaceY + 0.01 && this.vel.y <= 0) {
      const impact = -this.vel.y;
      this.pos.y = surfaceY;
      this.vel.y = 0;

      if (!this.onGround) {
        const hard = impact > 16;
        const clean = impact <= 12 && this.airTime > 0.35;
        if (clean) {
          this.score += CLEAN_LANDING_SCORE * this.combo;
          this.events.onPopup('STUCK THE LANDING', CLEAN_LANDING_SCORE * this.combo, 'good');
          if (this.didFlip) {
            this.score += FLIP_SCORE * this.combo;
            this.bd.flips++;
            injectCallout(`360° FLIP ×${this.combo}`);
          }
          if (this.airTime > 1.2) {
            this.events.onPopup(`BIG AIR ${this.airTime.toFixed(1)}s`, 0, 'good');
          }
          this.comboChain++;
          this.combo = Math.min(5, 1 + Math.floor(this.comboChain / 2));
          playChime();
          this.burst(this.vapor, 10, 3, 0);
          this.spawnDustRing();
          this.slowmo = this.didFlip ? 0.7 : 0.35;
        } else if (hard) {
          this.timeLeft -= HARD_LANDING_PENALTY_TIME;
          this.combo = 1;
          this.comboChain = 0;
          this.shake = 0.6;
          this.redFlash = 0.8;
          this.bd.hardLandings++;
          playThud(0.8);
          injectCallout(`HARD LANDING −${HARD_LANDING_PENALTY_TIME}s`, 'bad');
          this.invuln = 0.8;
        } else {
          this.comboChain = 0;
          this.combo = 1;
          if (impact > 8) {
            playThud(0.4);
            this.shake = Math.max(this.shake, 0.2);
          }
        }
        this.didFlip = false;
        this.airTime = 0;
      }
      this.onGround = true;
    } else {
      if (this.onGround && this.pos.y > surfaceY + 0.05) this.onGround = false;
      if (!this.onGround) {
        this.airTime += dt;
        this.bd.airtime += dt;
        this.maxAirThisJump = Math.max(this.maxAirThisJump, this.airTime);
      }
    }

    // parked car collisions — once per obstacle, with repositioning and invulnerability
    if (this.invuln <= 0) {
      for (let i = 0; i < this.world.parkedCars.length; i++) {
        const pc = this.world.parkedCars[i];
        if (this.crashedCarIds.has(i)) continue;
        const inX = this.pos.x > pc.box.min.x - 1.1 && this.pos.x < pc.box.max.x + 1.1;
        const inZ = this.pos.z > pc.box.min.z - 2.4 && this.pos.z < pc.box.max.z + 2.4;
        const above = this.pos.y >= pc.box.max.y - 0.1;
        if (inX && inZ && !above) {
          this.crash(pc, i);
          break;
        }
      }
    }

    // bounds
    if (this.pos.x < this.world.bounds.minX) {
      this.pos.x = this.world.bounds.minX;
      this.vel.x *= -0.4;
    }
    if (this.pos.x > this.world.bounds.maxX) {
      this.pos.x = this.world.bounds.maxX;
      this.vel.x *= -0.4;
    }
    if (this.pos.z < this.world.bounds.minZ) {
      this.pos.z = this.world.bounds.minZ;
      this.vel.z = Math.max(0, this.vel.z);
    }
    if (this.pos.z > this.world.bounds.maxZ) {
      this.pos.z = this.world.bounds.maxZ;
      this.vel.z = Math.min(0, this.vel.z);
    }

    this.distance = Math.max(this.distance, Math.floor(this.pos.z - this.startZ));
  }

  private crash(pc: ParkedCar, pcIndex: number) {
    this.timeLeft -= CRASH_PENALTY_TIME;
    this.combo = 1;
    this.comboChain = 0;
    this.shake = 0.9;
    this.redFlash = 1;
    this.bd.crashes++;
    playThud(1);
    playFail();
    injectCallout(`CRASH! −${CRASH_PENALTY_TIME}s`, 'bad');

    // place the car beside the obstacle, moving forward again, protected
    const centerX = (pc.box.min.x + pc.box.max.x) / 2;
    const gap = 2.6;
    this.pos.x = centerX + (this.pos.x >= centerX ? gap : -gap);
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, this.world.bounds.minX + 3, this.world.bounds.maxX - 3);
    this.pos.y = Math.max(this.pos.y, 0);
    this.vel.set(0, 0, 6);
    this.crashedCarIds.add(pcIndex);
    this.invuln = CRASH_INVULN_TIME;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.endRun();
    }
  }

  private checkRings() {
    for (const ring of this.world.rings) {
      if (ring.collected) continue;
      const d = this.pos.distanceTo(ring.mesh.position);
      if (d < ring.radius) {
        ring.collected = true;
        ring.mesh.visible = false;
        const pts = RING_SCORE * this.combo;
        this.score += pts;
        this.timeLeft += RING_TIME_BONUS;
        this.bd.rings++;
        this.comboChain++;
        this.combo = Math.min(5, 1 + Math.floor(this.comboChain / 2));
        this.events.onPopup('RING', pts, 'good');
        playBlip();
      }
    }
  }

  private checkPads() {
    if (!this.onGround) return;
    for (const pad of this.world.pads) {
      if (!pad.active) continue;
      const dx = this.pos.x - pad.position.x;
      const dz = this.pos.z - pad.position.z;
      if (dx * dx + dz * dz < pad.radius * pad.radius) {
        pad.active = false;
        this.world.setPadCollected(pad);
        const pts = PAD_SCORE * this.combo;
        this.score += pts;
        this.timeLeft += PAD_TIME_BONUS;
        this.comboChain++;
        this.combo = Math.min(5, 1 + Math.floor(this.comboChain / 2));
        this.events.onPopup('PAD', pts, 'good');
        playChime();
        if (!this.promptShown.pad) {
          this.promptShown.pad = true;
          this.events.onToast('Pads add +5s — aim for them!', 'good');
        }
      }
    }
  }

  private checkNearMiss() {
    // flying low over a car row without touching it
    if (!this.onGround && this.pos.y < 4.5 && this.pos.y > 1.2) {
      for (let i = 0; i < this.world.parkedCars.length; i++) {
        const cd = this.nearMissCooldown.get(i) ?? 0;
        if (cd > 0) continue;
        const pc = this.world.parkedCars[i];
        const inX = this.pos.x > pc.box.min.x - 1.4 && this.pos.x < pc.box.max.x + 1.4;
        const inZ = this.pos.z > pc.box.min.z - 2.8 && this.pos.z < pc.box.max.z + 2.8;
        if (inX && inZ) {
          this.nearMissCooldown.set(i, 4);
          const pts = 75 * this.combo;
          this.score += pts;
          this.events.onPopup('NEAR MISS', pts, 'good');
          playWhoosh();
        }
      }
    }
    for (const [k, v] of this.nearMissCooldown) {
      if (v > 0) this.nearMissCooldown.set(k, v - 0.016);
    }
  }

  private checkFinish() {
    if (this.pos.z >= COURSE_FINISH && this.running) {
      this.score += 1000;
      this.events.onPopup('FINISH LINE +1000', 0, 'good');
      this.endRun();
    }
  }

  private burst(pool: Trail[], count: number, spread: number, behind: number) {
    let spawned = 0;
    const back = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    for (const v of pool) {
      if (v.life > 0) continue;
      v.life = 0.9 + Math.random() * 0.4;
      v.maxLife = v.life;
      v.sprite.visible = true;
      v.sprite.position
        .copy(this.pos)
        .addScaledVector(back, -behind)
        .add(new THREE.Vector3((Math.random() - 0.5) * spread, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * spread));
      v.sprite.scale.setScalar(1.2 + Math.random());
      (v.sprite.material as THREE.SpriteMaterial).opacity = 0.55;
      if (++spawned >= count) break;
    }
  }

  /** ring of dust on the ground under the car when hopping / hovering */
  private spawnDustRing() {
    let spawned = 0;
    for (const d of this.dust) {
      if (d.life > 0) continue;
      d.life = 0.7 + Math.random() * 0.3;
      d.maxLife = d.life;
      d.sprite.visible = true;
      const angle = Math.random() * Math.PI * 2;
      const r = 1.6 + Math.random() * 0.8;
      d.sprite.position.set(
        this.pos.x + Math.cos(angle) * r,
        Math.max(0.3, this.pos.y - 1.5),
        this.pos.z + Math.sin(angle) * r * 1.6
      );
      d.sprite.scale.setScalar(1.6 + Math.random());
      (d.sprite.material as THREE.SpriteMaterial).opacity = 0.4;
      if (++spawned >= 7) break;
    }
  }

  private updateParticles(dt: number) {
    for (const v of this.vapor) {
      if (v.life <= 0) continue;
      v.life -= dt;
      const m = v.sprite.material as THREE.SpriteMaterial;
      m.opacity = Math.max(0, (v.life / v.maxLife) * 0.55);
      v.sprite.scale.multiplyScalar(1 + 1.6 * dt);
      if (v.life <= 0) v.sprite.visible = false;
    }
    for (const d of this.dust) {
      if (d.life <= 0) continue;
      d.life -= dt;
      const m = d.sprite.material as THREE.SpriteMaterial;
      m.opacity = Math.max(0, (d.life / d.maxLife) * 0.4);
      d.sprite.scale.multiplyScalar(1 + 2.2 * dt);
      if (d.life <= 0) d.sprite.visible = false;
    }
  }

  /** lerp scene fog/sky/lights toward the palette of the stage the car is in */
  private updateStageLighting() {
    const stage = STAGES[this.world.stageAt(this.pos.z)];
    const lerp = 1 - Math.pow(0.2, 0.016);
    lerpColor(this.scene.background as THREE.Color, stage.sky, lerp);
    const fog = this.scene.fog as THREE.Fog;
    lerpColor(fog.color, stage.fog, lerp);
    fog.near += (stage.fogNear - fog.near) * lerp;
    fog.far += (stage.fogFar - fog.far) * lerp;
    lerpColor(this.moonLight.color, stage.sun, lerp);
    this.moonLight.intensity += (stage.sunIntensity - this.moonLight.intensity) * lerp;
    lerpColor(this.hemiLight.color, stage.hemiSky, lerp);
    lerpColor(this.hemiLight.groundColor, stage.hemiGround, lerp);
  }

  private updateCamera(dt: number) {
    const back = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const airbornePull = this.onGround ? 0 : 3.5;
    const targetPos = new THREE.Vector3()
      .copy(this.pos)
      .addScaledVector(back, -13 - airbornePull)
      .add(new THREE.Vector3(0, 5.2 + this.pos.y * 0.35 + airbornePull * 0.4, 0));
    const lerp = 1 - Math.pow(0.0015, dt);
    this.camPos.lerp(targetPos, lerp);
    const lookTarget = new THREE.Vector3().copy(this.pos).addScaledVector(back, 8).add(new THREE.Vector3(0, 1.2, 0));
    this.camLook.lerp(lookTarget, lerp);
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.6);
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.camera.position.z += (Math.random() - 0.5) * this.shake;
    }
    this.camera.lookAt(this.camLook);

    // widen FOV on boost
    const targetFov = this.baseFov + (this.boostTimer > 0 ? 10 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
    }

    this.moonLight.position.set(this.pos.x - 70, 55, this.pos.z - 30);
    this.moonLight.target.position.copy(this.pos);
    this.moonLight.target.updateMatrixWorld();
  }

  private endRun() {
    if (!this.running) return;
    this.running = false;
    engineStop();
    const breakdown: RunBreakdown = { ...this.bd };
    const result: GameOverResult = {
      score: Math.floor(this.score),
      distance: this.distance,
      breakdown,
    };
    this.events.onGameOver(result);
  }
}

function makeVaporTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(230,238,246,0.45)');
  g.addColorStop(1, 'rgba(220,230,240,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function makeDustTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(210,180,140,0.8)');
  g.addColorStop(0.6, 'rgba(190,160,120,0.3)');
  g.addColorStop(1, 'rgba(180,150,110,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
