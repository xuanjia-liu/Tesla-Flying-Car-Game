import * as THREE from 'three';
import { COURSE_FINISH } from './types';

export interface RingTarget {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  radius: number;
  collected: boolean;
  bobPhase: number;
}

export interface ParkedCar {
  box: THREE.Box3;
  mesh: THREE.Group;
  beacons: THREE.MeshStandardMaterial[];
}

export interface Ramp {
  mesh: THREE.Mesh;
  angle: number;
  startZ: number;
  endZ: number;
  x: number;
  width: number;
  height: number;
}

export interface LandingPad {
  mesh: THREE.Group;
  position: THREE.Vector3;
  radius: number;
  active: boolean;
}

/** lighting palette per stage; engine lerps scene fog/bg/lights to these */
export interface StagePalette {
  sky: number;
  fog: number;
  sun: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  fogNear: number;
  fogFar: number;
}

export const STAGE_LENGTH = 300;
export const STAGES: StagePalette[] = [
  // 1. desert dawn
  { sky: 0xf2d3a0, fog: 0xf2d3a0, sun: 0xffc27a, sunIntensity: 1.6, hemiSky: 0xffd9a0, hemiGround: 0x6b4a2b, fogNear: 90, fogFar: 480 },
  // 2. coastal midday
  { sky: 0x7db8e8, fog: 0xa8cbe8, sun: 0xfff4dd, sunIntensity: 1.8, hemiSky: 0xbcd9f2, hemiGround: 0x5a6a58, fogNear: 120, fogFar: 600 },
  // 3. night city
  { sky: 0x0a0d14, fog: 0x0e1118, sun: 0x8fa3c8, sunIntensity: 0.5, hemiSky: 0x2a3448, hemiGround: 0x0a0c10, fogNear: 70, fogFar: 380 },
];

const COURSE_LENGTH = COURSE_FINISH;

export class World {
  group = new THREE.Group();
  rings: RingTarget[] = [];
  parkedCars: ParkedCar[] = [];
  ramps: Ramp[] = [];
  pads: LandingPad[] = [];
  bounds = { minX: -55, maxX: 55, minZ: -30, maxZ: COURSE_FINISH + 80 };
  private beaconLights: THREE.PointLight[] = [];
  private strobeMats: THREE.MeshStandardMaterial[] = [];

  constructor() {
    this.buildGround();
    this.buildRunway();
    this.buildRamp();
    this.buildParkedCarRows();
    this.buildRings();
    this.buildLandingPads();
    this.buildStageScenery();
    this.buildFinishGate();
  }

  stageAt(z: number): number {
    return Math.min(2, Math.max(0, Math.floor(z / STAGE_LENGTH)));
  }

  private buildGround() {
    // three floor bands matching the stage zones
    const bands: { z0: number; z1: number; color: number }[] = [
      { z0: -100, z1: STAGE_LENGTH, color: 0xd9b77e }, // desert sand
      { z0: STAGE_LENGTH, z1: STAGE_LENGTH * 2, color: 0x7a9a6a }, // coastal grass/land
      { z0: STAGE_LENGTH * 2, z1: COURSE_FINISH + 200, color: 0x1c2028 }, // night asphalt city
    ];
    for (const b of bands) {
      const len = b.z1 - b.z0;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(1600, len),
        new THREE.MeshStandardMaterial({ color: b.color, roughness: 1, metalness: 0 })
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(0, 0, (b.z0 + b.z1) / 2);
      plane.receiveShadow = true;
      this.group.add(plane);
    }

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 1 });
    for (let i = 0; i < 60; i++) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + Math.random() * 2.4, 0), rockMat);
      const side = Math.random() > 0.5 ? 1 : -1;
      rock.position.set(side * (65 + Math.random() * 130), 0.3, Math.random() * STAGE_LENGTH - 20);
      rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.group.add(rock);
    }
  }

  private buildRunway() {
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.95 });
    const runway = new THREE.Mesh(new THREE.BoxGeometry(70, 0.2, COURSE_LENGTH + 160), asphalt);
    runway.position.set(0, 0.05, 420);
    runway.receiveShadow = true;
    this.group.add(runway);

    const lineMat = new THREE.MeshStandardMaterial({ color: 0xf5c400, emissive: 0x8a7218, emissiveIntensity: 0.5 });
    for (let z = -20; z < COURSE_FINISH + 80; z += 8) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 4), lineMat);
      dash.position.set(0, 0.17, z);
      this.group.add(dash);
    }
    for (const x of [-34, 34]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, COURSE_LENGTH + 160), lineMat);
      edge.position.set(x, 0.17, 420);
      this.group.add(edge);
    }
  }

  private buildRamp() {
    // coastal mega-ramp: elevated launch over the second stage
    const angle = 0.42;
    const length = 26;
    const height = Math.sin(angle) * length;
    const run = Math.cos(angle) * length;
    const x = 0;
    const startZ = STAGE_LENGTH + 90;
    const ramp = new THREE.Mesh(
      new THREE.BoxGeometry(16, 1.4, length + 2),
      new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.2, roughness: 0.7 })
    );
    ramp.position.set(x, height / 2, startZ + run / 2);
    ramp.rotation.x = -angle;
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    this.group.add(ramp);
    this.ramps.push({ mesh: ramp, angle, startZ, endZ: startZ + run, x, width: 16, height });

    // support pillars make it read as elevated
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xb0b4ba, roughness: 0.8 });
    for (const z of [startZ + 4, startZ + run - 4]) {
      for (const px of [-6, 6]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, Math.max(1, height * 0.5), 1.4), pillarMat);
        pillar.position.set(px, Math.max(0.5, height * 0.25), z);
        this.group.add(pillar);
      }
    }
    this.addHazardStripes(x, startZ - 3, 16, 2.4);
  }

  private addHazardStripes(x: number, z: number, width: number, depth: number) {
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf5c400, roughness: 0.7 });
    const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
    const n = Math.floor(width / 1.5);
    for (let i = 0; i < n; i++) {
      const mat = i % 2 === 0 ? yellow : black;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, depth), mat);
      stripe.position.set(x - width / 2 + 0.75 + i * 1.5, 0.16, z);
      this.group.add(stripe);
    }
  }

  private makeObstacleCar(bodyColor: number, police: boolean): { group: THREE.Group; beacons: THREE.MeshStandardMaterial[] } {
    const beacons: THREE.MeshStandardMaterial[] = [];
    const car = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.55, roughness: 0.5 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x141820, metalness: 0.8, roughness: 0.2 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.9 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 4.4), bodyMat);
    body.position.y = 0.6;
    car.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.4, 2.0), glassMat);
    cab.position.set(0, 1.05, -0.2);
    car.add(cab);
    for (const wx of [-1.0, 1.0]) {
      for (const wz of [-1.4, 1.4]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 10), wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, 0.35, wz);
        car.add(w);
      }
    }
    const tl = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.07, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x7a1010, emissive: 0xe02020, emissiveIntensity: 1.6 })
    );
    tl.position.set(0, 0.7, 2.22);
    car.add(tl);

    // yellow/black roof hazard stripe on all obstacles
    const roofStripe = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.03, 3.6),
      new THREE.MeshStandardMaterial({ color: 0xf5c400, emissive: 0x8a7218, emissiveIntensity: 0.6 })
    );
    roofStripe.position.set(0, 1.28, -0.1);
    car.add(roofStripe);

    if (police) {
      // red/blue strobe bar
      for (const [sx, col] of [
        [-0.4, 0xff2d3a],
        [0.4, 0x2d7bff],
      ] as [number, number][]) {
        const strobe = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.2 });
        beacons.push(strobe);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.3), strobe);
        lamp.position.set(sx, 1.38, -0.2);
        car.add(lamp);
      }
    } else {
      const beacon = new THREE.MeshStandardMaterial({ color: 0xff8830, emissive: 0xff6a10, emissiveIntensity: 1.2 });
      beacons.push(beacon);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.3), beacon);
      lamp.position.set(0, 1.38, -0.2);
      car.add(lamp);
    }
    return { group: car, beacons };
  }

  private buildParkedCarRows() {
    const rows: { z: number; count: number; from: number; color: number; police?: boolean }[] = [
      { z: 210, count: 3, from: -9, color: 0xcfd3da },
      { z: 300, count: 4, from: -13.5, color: 0xd8b06a },
      { z: 430, count: 5, from: -18, color: 0xcfd3da },
      { z: 560, count: 6, from: -22.5, color: 0x9ab5c8 },
      { z: 680, count: 6, from: -22.5, color: 0x2a2e36, police: true }, // police line in the city
      { z: 810, count: 7, from: -27, color: 0x3a3f48 },
    ];
    for (const spot of rows) {
      this.addWarningSigns(spot.z, spot.count);
      this.addHazardStripes(0, spot.z - 8, spot.count * 9, 2);

      // blinking beacon pole at the row
      const beaconLight = new THREE.PointLight(0xff7722, 2, 34, 2);
      beaconLight.position.set(0, 4.5, spot.z - 6);
      this.group.add(beaconLight);
      this.beaconLights.push(beaconLight);
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 4.5, 6),
        new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.6, roughness: 0.5 })
      );
      pole.position.set(0, 2.25, spot.z - 6);
      this.group.add(pole);

      for (let i = 0; i < spot.count; i++) {
        const { group: car, beacons } = this.makeObstacleCar(spot.color, !!spot.police);
        const x = spot.from + i * 9;
        car.position.set(x, 0, spot.z);
        car.traverse((o) => {
          if (o instanceof THREE.Mesh) o.castShadow = true;
        });
        this.group.add(car);
        const box = new THREE.Box3().setFromObject(car);
        box.expandByScalar(0.15);
        this.parkedCars.push({ box, mesh: car, beacons });
        for (const b of beacons) this.strobeMats.push(b);
      }
    }
  }

  private addWarningSigns(z: number, count: number) {
    const boardMat = new THREE.MeshStandardMaterial({ color: 0xff8a1e, emissive: 0xb35408, emissiveIntensity: 0.9 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2c2f35, roughness: 0.8 });
    const halfWidth = (count * 9) / 2 + 4;
    for (const x of [-halfWidth, halfWidth]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 0.15), boardMat);
      board.position.set(x, 2.2, z - 40);
      this.group.add(board);
      const chevron = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.2), new THREE.MeshStandardMaterial({ color: 0x111111 }));
      chevron.position.set(x, 2.2, z - 39.9);
      chevron.rotation.z = x < 0 ? 0.5 : -0.5;
      this.group.add(chevron);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 6), postMat);
      post.position.set(x, 1.0, z - 40);
      this.group.add(post);
    }
  }

  private buildRings() {
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x7fd4ff,
      emissive: 0x2a8ac8,
      emissiveIntensity: 2,
      metalness: 0.6,
      roughness: 0.3,
    });
    const specs: { x: number; y: number; z: number; r: number }[] = [
      { x: 0, y: 6, z: 165, r: 4.5 },
      { x: -10, y: 7, z: 265, r: 4.5 },
      { x: 0, y: 11, z: 375, r: 5 }, // over the ramp
      { x: 10, y: 8, z: 495, r: 5 },
      { x: -12, y: 9, z: 620, r: 5 },
      { x: 12, y: 10, z: 745, r: 5 },
      { x: 0, y: 12, z: 850, r: 6 },
    ];
    for (const s of specs) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(s.r, 0.4, 12, 40), ringMat.clone());
      ring.position.set(s.x, s.y, s.z);
      this.group.add(ring);
      this.rings.push({
        mesh: ring,
        position: new THREE.Vector3(s.x, s.y, s.z),
        radius: s.r - 0.4,
        collected: false,
        bobPhase: Math.random() * Math.PI * 2,
      });
    }
  }

  private buildLandingPads() {
    const specs: [number, number][] = [
      [-18, 250],
      [18, 360],
      [-18, 500],
      [18, 620],
      [-18, 750],
      [0, 880],
    ];
    for (const [x, z] of specs) {
      const r = 7;
      const padGroup = new THREE.Group();
      padGroup.position.set(x, 0, z);
      const inner = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.08, 28),
        new THREE.MeshStandardMaterial({ color: 0x12351f, emissive: 0x32e37a, emissiveIntensity: 1.6 })
      );
      inner.position.y = 0.13;
      padGroup.add(inner);
      const segments = 16;
      for (let i = 0; i < segments; i++) {
        const mat =
          i % 2 === 0
            ? new THREE.MeshStandardMaterial({ color: 0xf5c400, roughness: 0.6 })
            : new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 });
        const seg = new THREE.Mesh(
          new THREE.CylinderGeometry(r, r, 0.06, 28, 1, false, (i / segments) * Math.PI * 2, (Math.PI * 2) / segments),
          mat
        );
        seg.position.y = 0.1;
        padGroup.add(seg);
      }
      this.group.add(padGroup);
      this.pads.push({ mesh: padGroup, position: new THREE.Vector3(x, 0, z), radius: r, active: true });
    }
  }

  private buildStageScenery() {
    // desert: market awning stalls (stage 1)
    const awningMat = new THREE.MeshStandardMaterial({ color: 0xc85a3a, roughness: 0.8 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 1 });
    for (let i = 0; i < 8; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = 40 + i * 34;
      for (const x of [side * 45, side * 48]) {
        const awning = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 4), awningMat);
        awning.position.set(x, 2.6, z);
        awning.rotation.z = side * 0.1;
        this.group.add(awning);
      }
      for (const px of [side * 42.5, side * 50.5]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.8, 6), poleMat);
        pole.position.set(px, 1.4, z);
        this.group.add(pole);
      }
    }

    // coastal: sea plane to the sides + palms (stage 2)
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(900, STAGE_LENGTH),
      new THREE.MeshStandardMaterial({ color: 0x2f6fa3, metalness: 0.4, roughness: 0.25 })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -0.4, STAGE_LENGTH * 1.5);
    this.group.add(sea);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a5136, roughness: 1 });
    const frondMat = new THREE.MeshStandardMaterial({ color: 0x3e7a3a, roughness: 0.9 });
    for (let i = 0; i < 14; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = STAGE_LENGTH + 30 + Math.random() * STAGE_LENGTH;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 6 + Math.random() * 3, 6), trunkMat);
      trunk.position.set(side * (42 + Math.random() * 8), 3.5, z);
      trunk.rotation.z = side * 0.06;
      this.group.add(trunk);
      for (let f = 0; f < 5; f++) {
        const frond = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 2.6), frondMat);
        frond.position.set(trunk.position.x + side * 0.3, 7 + Math.random() * 2, z + (Math.random() - 0.5) * 1.6);
        frond.rotation.x = (Math.random() - 0.5) * 0.9;
        frond.rotation.y = Math.random() * Math.PI;
        this.group.add(frond);
      }
    }

    // night city: low buildings + sodium streetlights (stage 3)
    const bldMat = new THREE.MeshStandardMaterial({ color: 0x232833, roughness: 0.9 });
    const windowMat = new THREE.MeshStandardMaterial({ color: 0xffb45a, emissive: 0xffb45a, emissiveIntensity: 1.4 });
    for (let i = 0; i < 16; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = STAGE_LENGTH * 2 + 20 + Math.random() * (COURSE_FINISH - STAGE_LENGTH * 2 - 40);
      const h = 8 + Math.random() * 18;
      const w = 8 + Math.random() * 10;
      const bld = new THREE.Mesh(new THREE.BoxGeometry(w, h, 10 + Math.random() * 8), bldMat);
      bld.position.set(side * (52 + Math.random() * 16), h / 2, z);
      this.group.add(bld);
      const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, h * 0.5, 0.2), windowMat);
      win.position.set(bld.position.x * 0.96, h * 0.55, z - (10 + Math.random() * 8) / 2 - 0.1);
      this.group.add(win);
    }
    for (let z = STAGE_LENGTH * 2; z < COURSE_FINISH + 40; z += 40) {
      for (const x of [-40, 40]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 14, 8), poleMat);
        pole.position.set(x, 7, z);
        this.group.add(pole);
        const lampMat = new THREE.MeshStandardMaterial({ color: 0xffb45a, emissive: 0xffb45a, emissiveIntensity: 1.1 });
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.8), lampMat);
        lamp.position.set(x * 0.93, 14, z);
        this.group.add(lamp);
        const light = new THREE.PointLight(0xffb45a, 0.7, 55, 2);
        light.position.set(x * 0.93, 13, z);
        this.group.add(light);
      }
    }
  }

  private buildFinishGate() {
    const gateMat = new THREE.MeshStandardMaterial({
      color: 0xf2f4f8,
      emissive: 0x8899aa,
      emissiveIntensity: 0.3,
      metalness: 0.5,
      roughness: 0.4,
    });
    for (const x of [-10, 10]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 12, 1.2), gateMat);
      pillar.position.set(x, 6, COURSE_FINISH);
      pillar.castShadow = true;
      this.group.add(pillar);
    }
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(21, 2.4, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x101216, emissive: 0x2a8ac8, emissiveIntensity: 0.6 })
    );
    banner.position.set(0, 11, COURSE_FINISH);
    this.group.add(banner);
    this.addHazardStripes(0, COURSE_FINISH - 4, 24, 2.4);
  }

  setPadCollected(pad: LandingPad) {
    pad.active = false;
    pad.mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.MeshStandardMaterial;
        if (m.emissive) m.emissiveIntensity = 0.1;
      }
    });
  }

  update(t: number, animate: boolean) {
    for (const r of this.rings) {
      if (r.collected) {
        r.mesh.visible = false;
        continue;
      }
      if (!animate) continue;
      r.mesh.rotation.z = t * 0.6;
      r.mesh.position.y = r.position.y + Math.sin(t * 1.4 + r.bobPhase) * 0.25;
    }
    if (animate) {
      // beacons blink in alternating phases
      let i = 0;
      for (const pc of this.parkedCars) {
        for (const b of pc.beacons) {
          b.emissiveIntensity = Math.max(0.5, 0.9 + Math.sin(t * 7 + i * 1.3) * 0.7);
        }
        i++;
      }
      const flash = 1.5 + Math.sin(t * 6) * 1.3;
      for (const l of this.beaconLights) l.intensity = Math.max(0.2, flash * 0.9);
    }
  }

  reset() {
    for (const r of this.rings) {
      r.collected = false;
      r.mesh.visible = true;
    }
    for (const p of this.pads) {
      p.active = true;
      p.mesh.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const m = o.material as THREE.MeshStandardMaterial;
          if (m.emissive && m.color.getHex() === 0x12351f) m.emissiveIntensity = 1.6;
        }
      });
    }
  }
}
