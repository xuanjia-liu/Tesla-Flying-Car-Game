import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PropAsset } from './assets';
import type { StageLook } from './environment';
import { bannerTexture, checkerTexture, groundTexture, hazardTexture, roadTextures } from './textures';
import { COURSE_LENGTH, RAIL_X, STAGE_LENGTH } from './types';

export const LANES = [-11.25, -3.75, 3.75, 11.25];
const RING_RADIUS = 3.2;

export interface Ring {
  pos: THREE.Vector3;
  radius: number;
  collected: boolean;
  passed: boolean;
  index: number;
}

export interface Ramp {
  x: number;
  z0: number;
  z1: number;
  halfW: number;
  height: number;
}

export interface BoostPad {
  x: number;
  z: number;
  halfW: number;
  halfL: number;
}

export interface Obstacle {
  box: THREE.Box3;
  kind: 'barrier' | 'gantry';
}

export interface Checkpoint {
  z: number;
  bonus: number;
  passed: boolean;
  finish: boolean;
}

export interface TrafficCar {
  active: boolean;
  model: number;
  slot: number;
  pos: THREE.Vector3;
  speed: number;
  yaw: number;
  half: THREE.Vector3;
  knocked: boolean;
  knockVel: THREE.Vector3;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  knockTime: number;
  passed: boolean;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CHEVRON_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vFog;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFog = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const CHEVRON_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec2 vUv;
  varying float vFog;
  void main() {
    float x = abs(vUv.x - 0.5) * 2.0;
    float v = fract(vUv.y * 4.0 - uTime * 2.5 - x * 0.6);
    float chevron = smoothstep(0.0, 0.08, v) * (1.0 - smoothstep(0.35, 0.45, v));
    float edge = smoothstep(0.9, 1.0, x);
    float a = max(chevron * 0.9, edge) * 0.95;
    vec3 col = mix(uColor * 0.25, uColor * 2.2, max(chevron, edge));
    float f = smoothstep(uFogNear, uFogFar, vFog);
    gl_FragColor = vec4(mix(col, uFogColor, f), mix(max(a, 0.35), 0.0, f));
  }
`;

type Spec = { z0: number; count: number; spacing: number; x: number; xAmp?: number; y0: number; arc: number };

const STAGE_CONTENT = {
  ramps: [
    { x: 0, z: 150 },
    { x: -7.5, z: 360 },
    { x: 7.5, z: 690 },
    { x: -7.5, z: 820 },
    { x: 0, z: 1120 },
    { x: -7.5, z: 1320 },
  ],
  pads: [
    { x: 0, z: 90 },
    { x: -11.25, z: 300 },
    { x: 7.5, z: 440 },
    { x: 0, z: 540 },
    { x: -11.25, z: 740 },
    { x: 11.25, z: 870 },
    { x: 0, z: 1040 },
    { x: -11.25, z: 1240 },
    { x: 11.25, z: 1420 },
  ],
  barriers: [
    { z: 590, x: -7.5, w: 15 },
    { z: 640, x: 7.5, w: 15 },
    { z: 765, x: 0, w: 22 },
    { z: 930, x: 0, w: 30 },
  ],
  gantries: [1080, 1180, 1280, 1380, 1460],
  chains: [
    { z0: 185, count: 5, spacing: 15, x: 0, y0: 5.5, arc: 2.5 },
    { z0: 265, count: 5, spacing: 14, x: 10, xAmp: 2, y0: 6, arc: 5 },
    { z0: 395, count: 5, spacing: 15, x: -7.5, y0: 5.5, arc: 2.5 },
    { z0: 600, count: 5, spacing: 13, x: 0, y0: 8, arc: 4 },
    { z0: 725, count: 5, spacing: 15, x: 7.5, y0: 5.5, arc: 2.5 },
    { z0: 752, count: 3, spacing: 11, x: -1, y0: 5, arc: 1 },
    { z0: 855, count: 5, spacing: 15, x: -7.5, y0: 5.5, arc: 2.5 },
    { z0: 922, count: 3, spacing: 9, x: 0, y0: 4.5, arc: 1.5 },
    { z0: 1050, count: 4, spacing: 12, x: 3.75, y0: 2.6, arc: 0 },
    { z0: 1150, count: 5, spacing: 14, x: 0, y0: 7, arc: 5 },
    { z0: 1225, count: 5, spacing: 12, x: 11.25, xAmp: 3, y0: 3, arc: 3 },
    { z0: 1352, count: 5, spacing: 14, x: -7.5, y0: 7, arc: 4.5 },
    { z0: 1430, count: 5, spacing: 13, x: 0, xAmp: 4, y0: 3, arc: 2.5 },
  ] as Spec[],
};

export class World {
  group = new THREE.Group();
  rings: Ring[] = [];
  ramps: Ramp[] = [];
  pads: BoostPad[] = [];
  obstacles: Obstacle[] = [];
  checkpoints: Checkpoint[] = [];
  traffic: TrafficCar[] = [];

  private ringMesh!: THREE.InstancedMesh;
  private ringMat!: THREE.MeshStandardMaterial;
  private padMat!: THREE.ShaderMaterial;
  private nightMats: { mat: THREE.MeshStandardMaterial; day: number; night: number }[] = [];
  private roadMat!: THREE.MeshStandardMaterial;
  private water?: { mat: THREE.MeshStandardMaterial; normal: THREE.Texture };
  private trafficMeshes: THREE.InstancedMesh[] = [];
  private trafficModels: { name: string; asset: PropAsset; scale: number }[] = [];
  private trafficLights!: THREE.InstancedMesh;
  private nextSpawnZ = 80;
  private rng = mulberry32(7);
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v3 = new THREE.Vector3();
  private s3 = new THREE.Vector3();

  constructor(private props: Map<string, PropAsset>, private maxAnisotropy: number) {
    this.buildRoad();
    this.buildDesert();
    this.buildCoast();
    this.buildCity();
    this.buildRails();
    this.buildRamps();
    this.buildPads();
    this.buildBarriers();
    this.buildGantries();
    this.buildGates();
    this.buildRings();
    this.buildTrafficPool();
  }

  private trackNight(mat: THREE.MeshStandardMaterial, day: number, night: number) {
    this.nightMats.push({ mat, day, night });
  }

  private add<T extends THREE.Object3D>(o: T, shadows: 'cast' | 'receive' | 'both' | 'none' = 'none'): T {
    o.traverse((c) => {
      if (c instanceof THREE.Mesh) {
        c.castShadow = shadows === 'cast' || shadows === 'both';
        c.receiveShadow = shadows === 'receive' || shadows === 'both';
      }
    });
    this.group.add(o);
    return o;
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, transforms: THREE.Matrix4[], shadows: 'cast' | 'none' | 'both' = 'none') {
    const mesh = new THREE.InstancedMesh(geo, mat, transforms.length);
    transforms.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return this.add(mesh, shadows);
  }

  private tf(x: number, y: number, z: number, sx = 1, sy = sx, sz = sx, ry = 0) {
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry),
      new THREE.Vector3(sx, sy, sz)
    );
  }

  // ---------- road ----------
  private buildRoad() {
    const { map, emissive } = roadTextures();
    const len = COURSE_LENGTH + 400;
    for (const t of [map, emissive]) {
      t.repeat.set(1, len / 32);
      t.anisotropy = this.maxAnisotropy;
    }
    this.roadMat = new THREE.MeshStandardMaterial({
      map,
      emissiveMap: emissive,
      emissive: 0xffffff,
      emissiveIntensity: 0.1,
      roughness: 0.82,
      metalness: 0.05,
    });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(64, len), this.roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, len / 2 - 120);
    this.add(road, 'receive');

    // start grid line
    const start = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 1.2),
      new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.7 })
    );
    start.rotation.x = -Math.PI / 2;
    start.position.set(0, 0.02, 4);
    this.add(start, 'receive');
  }

  // ---------- stage 1: desert ----------
  private buildDesert() {
    const z0 = -400;
    const z1 = STAGE_LENGTH + 40;
    const sand = groundTexture('#d6a26b', 255, 120);
    sand.repeat.set(60, (z1 - z0) / 30);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, z1 - z0),
      new THREE.MeshStandardMaterial({ map: sand, color: 0xffffff, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.05, (z0 + z1) / 2);
    this.add(ground, 'receive');

    const rnd = mulberry32(11);
    const side = () => (rnd() < 0.5 ? -1 : 1);

    // mesas on the horizon
    const mesaGeo = new THREE.CylinderGeometry(1, 1.25, 1, 7, 3);
    const pos = mesaGeo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > -0.5 && pos.getY(i) < 0.5) {
        pos.setX(i, pos.getX(i) * (0.9 + rnd() * 0.2));
        pos.setZ(i, pos.getZ(i) * (0.9 + rnd() * 0.2));
      }
    }
    mesaGeo.translate(0, 0.5, 0);
    mesaGeo.computeVertexNormals();
    const mesaMat = new THREE.MeshStandardMaterial({ color: 0xb4643c, roughness: 1, flatShading: true });
    const mesas: THREE.Matrix4[] = [];
    for (let i = 0; i < 26; i++) {
      const r = 30 + rnd() * 70;
      mesas.push(this.tf(side() * (160 + rnd() * 500), 0, -200 + rnd() * (z1 + 500), r, 25 + rnd() * 70, r * (0.6 + rnd() * 0.8), rnd() * 6));
    }
    this.instanced(mesaGeo, mesaMat, mesas);

    // boulders
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x9a6a46, roughness: 1, flatShading: true });
    const rocks: THREE.Matrix4[] = [];
    for (let i = 0; i < 160; i++) {
      const s = 0.6 + rnd() ** 2 * 5;
      const m = this.tf(side() * (RAIL_X + 6 + rnd() * 160), s * 0.3, -60 + rnd() * (z1 + 60), s, s * (0.5 + rnd() * 0.5), s);
      m.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)));
      rocks.push(m);
    }
    this.instanced(rockGeo, rockMat, rocks, 'cast');

    // saguaro cacti
    const trunk = new THREE.CapsuleGeometry(0.35, 4, 4, 8);
    trunk.translate(0, 2.3, 0);
    const armL = new THREE.CapsuleGeometry(0.25, 1.6, 4, 8);
    armL.translate(-0.9, 2.8, 0);
    const armLb = new THREE.CapsuleGeometry(0.22, 0.6, 4, 8);
    armLb.rotateZ(Math.PI / 2);
    armLb.translate(-0.55, 2.0, 0);
    const armR = new THREE.CapsuleGeometry(0.22, 1.2, 4, 8);
    armR.translate(0.85, 3.4, 0);
    const armRb = new THREE.CapsuleGeometry(0.2, 0.5, 4, 8);
    armRb.rotateZ(Math.PI / 2);
    armRb.translate(0.5, 2.8, 0);
    const cactusGeo = mergeGeometries([trunk, armL, armLb, armR, armRb].map((g) => g.toNonIndexed()));
    const cactusMat = new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 0.9 });
    const cacti: THREE.Matrix4[] = [];
    for (let i = 0; i < 90; i++) {
      const s = 0.8 + rnd() * 0.7;
      cacti.push(this.tf(side() * (RAIL_X + 8 + rnd() * 120), 0, -40 + rnd() * (z1 + 40), s, s, s, rnd() * 6));
    }
    this.instanced(cactusGeo, cactusMat, cacti, 'cast');
  }

  // ---------- stage 2: coastal causeway ----------
  private buildCoast() {
    const z0 = STAGE_LENGTH - 20;
    const z1 = STAGE_LENGTH * 2 + 30;
    const normal = waterNormalTexture();
    normal.repeat.set(80, 40);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x123a5a,
      roughness: 0.08,
      metalness: 0.4,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      envMapIntensity: 1.3,
    });
    this.water = { mat: waterMat, normal };
    const water = new THREE.Mesh(new THREE.PlaneGeometry(3000, z1 - z0 + 1200), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -2.6, (z0 + z1) / 2 + 200);
    this.add(water);

    // causeway deck edges + planters
    const deckMat = new THREE.MeshStandardMaterial({ color: 0xbfb6a8, roughness: 0.9 });
    const planterMat = new THREE.MeshStandardMaterial({ map: groundTexture('#d9c290', 255, 140, 6000), roughness: 1 });
    (planterMat.map as THREE.Texture).repeat.set(2, (z1 - z0) / 10);
    for (const s of [-1, 1]) {
      const deck = new THREE.Mesh(new THREE.BoxGeometry(12, 2.8, z1 - z0), deckMat);
      deck.position.set(s * (RAIL_X + 6), -1.45, (z0 + z1) / 2);
      this.add(deck, 'receive');
      const planter = new THREE.Mesh(new THREE.PlaneGeometry(10, z1 - z0), planterMat);
      planter.rotation.x = -Math.PI / 2;
      planter.position.set(s * (RAIL_X + 6), 0.02, (z0 + z1) / 2);
      this.add(planter, 'receive');
    }
    // the desert ground must not show through under the deck in this stage
    const under = new THREE.Mesh(new THREE.BoxGeometry(2 * RAIL_X + 2, 2.6, z1 - z0), deckMat);
    under.position.set(0, -1.35, (z0 + z1) / 2);
    this.add(under);

    // causeway piers marching out over the water
    const pierGeo = new THREE.BoxGeometry(3, 10, 3);
    const piers: THREE.Matrix4[] = [];
    for (let z = z0; z < z1; z += 30) for (const s of [-1, 1]) piers.push(this.tf(s * (RAIL_X + 10), -7.5, z));
    this.instanced(pierGeo, deckMat, piers);

    // palms on the planters
    const rnd = mulberry32(23);
    const trunkParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.CylinderGeometry(0.22 - i * 0.015, 0.26 - i * 0.015, 1.4, 7);
      seg.translate(i * i * 0.05, 0.7 + i * 1.3, 0);
      trunkParts.push(seg.toNonIndexed());
    }
    const palmTrunk = mergeGeometries(trunkParts);
    const leafParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.PlaneGeometry(0.9, 4.2, 1, 4);
      const p = leaf.getAttribute('position');
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k) + 2.1;
        p.setY(k, y);
        p.setZ(k, -0.09 * y * y);
      }
      leaf.rotateX(-Math.PI / 2 + 0.5);
      leaf.rotateY((i / 7) * Math.PI * 2);
      leaf.translate(1.25, 8.1, 0);
      leafParts.push(leaf.toNonIndexed());
    }
    const palmLeaves = mergeGeometries(leafParts);
    palmLeaves.computeVertexNormals();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3c, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7f3a, roughness: 0.85, side: THREE.DoubleSide });
    const palms: THREE.Matrix4[] = [];
    for (let z = z0 + 10; z < z1; z += 22 + rnd() * 14) {
      for (const s of [-1, 1]) {
        const k = 0.85 + rnd() * 0.35;
        palms.push(this.tf(s * (RAIL_X + 4 + rnd() * 5), 0, z + rnd() * 8, k, k, k, rnd() * 6));
      }
    }
    this.instanced(palmTrunk, trunkMat, palms, 'cast');
    this.instanced(palmLeaves, leafMat, palms, 'cast');

    // distant islands
    const islandGeo = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const islandMat = new THREE.MeshStandardMaterial({ color: 0x3e5a3a, roughness: 1, flatShading: true });
    const islands: THREE.Matrix4[] = [];
    for (let i = 0; i < 9; i++) {
      const r = 60 + rnd() * 120;
      islands.push(this.tf((rnd() < 0.5 ? -1 : 1) * (250 + rnd() * 500), -3, z0 + rnd() * 900, r, 18 + rnd() * 40, r * 0.7));
    }
    this.instanced(islandGeo, islandMat, islands);
  }

  // ---------- stage 3: neon city ----------
  private buildCity() {
    const z0 = STAGE_LENGTH * 2 + 20;
    const z1 = COURSE_LENGTH + 300;
    const asphalt = groundTexture('#24242c', 120, 0, 8000);
    asphalt.repeat.set(80, (z1 - z0) / 25);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, z1 - z0),
      new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.55, metalness: 0.1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.04, (z0 + z1) / 2);
    this.add(ground, 'receive');

    const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x3a3a44, roughness: 0.8 });
    for (const s of [-1, 1]) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(14, 0.3, z1 - z0), sidewalkMat);
      walk.position.set(s * (RAIL_X + 8), 0.15, (z0 + z1) / 2);
      this.add(walk, 'receive');
    }

    const rnd = mulberry32(41);
    const names = [...this.props.keys()].filter((n) => n.startsWith('bld_'));
    const groups = new Map<string, THREE.Matrix4[]>();
    const place = (x: number, z: number, minW: number, maxW: number, tall: boolean) => {
      const pool = names.filter((n) => n.includes('skyscraper') === tall);
      const name = pool[Math.floor(rnd() * pool.length)];
      const asset = this.props.get(name);
      if (!asset) return 0;
      const w = minW + rnd() * (maxW - minW);
      const s = w / Math.max(asset.size.x, asset.size.z);
      const yaw = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      const heightBoost = tall ? 1 + rnd() * 0.8 : 1 + rnd() * 1.5;
      const list = groups.get(name) ?? [];
      list.push(this.tf(x, 0, z, s, s * heightBoost, s, yaw));
      groups.set(name, list);
      return asset.size.x * s;
    };
    for (const s of [-1, 1]) {
      for (let z = z0; z < z1; ) {
        const w = place(s * (RAIL_X + 26 + rnd() * 6), z, 16, 24, rnd() < 0.35);
        z += Math.max(w, 14) + 4 + rnd() * 6;
      }
      for (let z = z0 - 40; z < z1 + 200; ) {
        const w = place(s * (RAIL_X + 75 + rnd() * 60), z, 26, 40, true);
        z += Math.max(w, 20) + 10 + rnd() * 20;
      }
    }
    const windowMasks = new Map<THREE.Texture | null, THREE.Texture | null>();
    for (const [name, list] of groups) {
      const asset = this.props.get(name)!;
      const mat = (asset.material as THREE.MeshStandardMaterial).clone();
      if (!windowMasks.has(mat.map)) windowMasks.set(mat.map, windowEmissiveMap(mat.map));
      mat.emissiveMap = windowMasks.get(mat.map) ?? null;
      mat.emissive = new THREE.Color(0xffd29a);
      mat.color.setHex(0x9aa0b8);
      mat.envMapIntensity = 0.35;
      this.trackNight(mat, 0, 1.4);
      this.instanced(asset.geometry, mat, list, 'cast');
    }

    // neon trims on facades
    const neonColors = [0xff2fd0, 0x2fe0ff, 0xff8a30, 0x8a5bff];
    neonColors.forEach((col, ci) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: 3 });
      this.trackNight(mat, 0.6, 4);
      const list: THREE.Matrix4[] = [];
      for (let i = 0; i < 40; i++) {
        const s = rnd() < 0.5 ? -1 : 1;
        const vertical = rnd() < 0.4;
        list.push(
          this.tf(
            s * (RAIL_X + 15.5 + rnd() * 2),
            3 + rnd() * 30,
            z0 + rnd() * (z1 - z0),
            0.3,
            vertical ? 8 + rnd() * 14 : 0.35,
            vertical ? 0.35 : 6 + rnd() * 10
          )
        );
      }
      void ci;
      this.instanced(new THREE.BoxGeometry(1, 1, 1), mat, list);
    });

    // billboard screens
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: billboardTexture(), emissiveIntensity: 1.6 });
    this.trackNight(boardMat, 0.8, 2.2);
    const boards: THREE.Matrix4[] = [];
    for (let i = 0; i < 14; i++) {
      const s = i % 2 ? -1 : 1;
      boards.push(this.tf(s * (RAIL_X + 15), 12 + rnd() * 18, z0 + 40 + i * 34, 0.4, 7, 12));
    }
    this.instanced(new THREE.BoxGeometry(1, 1, 1), boardMat, boards);
  }

  // ---------- rails, lamps ----------
  private buildRails() {
    const z0 = -80;
    const z1 = COURSE_LENGTH + 260;
    const railMat = new THREE.MeshStandardMaterial({ color: 0xa8adb5, metalness: 0.8, roughness: 0.35 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x062030, emissive: 0x2fd0ff, emissiveIntensity: 0.6 });
    this.trackNight(glowMat, 0.5, 3);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, z1 - z0), railMat);
      rail.position.set(s * (RAIL_X + 0.5), 0.75, (z0 + z1) / 2);
      this.add(rail, 'cast');
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, z1 - z0), glowMat);
      glow.position.set(s * (RAIL_X + 0.35), 0.95, (z0 + z1) / 2);
      this.add(glow);
    }
    const posts: THREE.Matrix4[] = [];
    for (let z = z0; z < z1; z += 5) for (const s of [-1, 1]) posts.push(this.tf(s * (RAIL_X + 0.6), 0.45, z));
    this.instanced(new THREE.BoxGeometry(0.18, 0.9, 0.18), railMat, posts);

    // street lamps: emissive heads, no real lights
    const poleGeo = new THREE.CylinderGeometry(0.14, 0.2, 9, 6);
    poleGeo.translate(0, 4.5, 0);
    const armGeo = new THREE.BoxGeometry(3, 0.18, 0.25);
    armGeo.translate(-1.4, 9, 0);
    const pole = mergeGeometries([poleGeo.toNonIndexed(), armGeo.toNonIndexed()]);
    const headGeo = new THREE.BoxGeometry(1.4, 0.18, 0.5);
    headGeo.translate(-2.5, 8.86, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a4e56, metalness: 0.6, roughness: 0.5 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd7a0, emissiveIntensity: 0.4 });
    this.trackNight(headMat, 0.3, 5);
    const lamps: THREE.Matrix4[] = [];
    for (let z = 20; z < z1; z += 45) {
      if (z > STAGE_LENGTH - 30 && z < STAGE_LENGTH * 2 + 20) {
        for (const s of [-1, 1]) lamps.push(this.tf(s * (RAIL_X + 2), 0, z, 1, 1, 1, s < 0 ? Math.PI : 0));
      } else if (z >= STAGE_LENGTH * 2) {
        for (const s of [-1, 1]) lamps.push(this.tf(s * (RAIL_X + 2), 0, z + 22, 1, 1, 1, s < 0 ? Math.PI : 0));
      } else lamps.push(this.tf(RAIL_X + 2, 0, z, 1, 1, 1, 0));
    }
    this.instanced(pole, poleMat, lamps);
    this.instanced(headGeo, headMat, lamps);
  }

  // ---------- gameplay pieces ----------
  private buildRamps() {
    const L = 22;
    const H = 4.2;
    const W = 12;
    const geo = new THREE.BufferGeometry();
    const hw = W / 2;
    // triangular prism: front edge on the ground, back edge raised
    const v = [
      [-hw, 0, 0], [hw, 0, 0], [hw, H, L], [-hw, H, L], // top slope
      [-hw, 0, L], [hw, 0, L], // back bottom
    ];
    const tri = (a: number, b: number, c: number) => [...v[a], ...v[b], ...v[c]];
    const positions = new Float32Array([
      ...tri(0, 2, 1), ...tri(0, 3, 2), // slope
      ...tri(4, 2, 3), ...tri(4, 5, 2), // back
      ...tri(0, 4, 3), // left side
      ...tri(1, 2, 5), // right side
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const uvs = new Float32Array([0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 0]);
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    const hazard = hazardTexture();
    hazard.repeat.set(3, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.6, roughness: 0.4, map: hazard });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x062030, emissive: 0x2fd0ff, emissiveIntensity: 2 });
    this.trackNight(edgeMat, 1.5, 4);
    for (const r of STAGE_CONTENT.ramps) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(r.x, 0, r.z);
      this.add(mesh, 'both');
      for (const s of [-1, 1]) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, Math.hypot(L, H)), edgeMat);
        edge.position.set(r.x + s * (hw - 0.1), H / 2 + 0.08, r.z + L / 2);
        edge.rotation.x = -Math.atan2(H, L);
        this.add(edge);
      }
      this.ramps.push({ x: r.x, z0: r.z, z1: r.z + L, halfW: hw, height: H });
    }
  }

  private buildPads() {
    this.padMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xff3fb0) },
        uFogColor: { value: new THREE.Color() },
        uFogNear: { value: 100 },
        uFogFar: { value: 800 },
      },
      vertexShader: CHEVRON_VERT,
      fragmentShader: CHEVRON_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    for (const p of STAGE_CONTENT.pads) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 12), this.padMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(p.x, 0.03, p.z);
      this.add(mesh);
      this.pads.push({ x: p.x, z: p.z, halfW: 3, halfL: 6 });
    }
  }

  private buildBarriers() {
    const hazard = hazardTexture();
    const mat = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.6 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2a3a, emissiveIntensity: 2 });
    this.trackNight(topMat, 1.6, 4);
    for (const b of STAGE_CONTENT.barriers) {
      const tex = hazard.clone();
      tex.repeat.set(b.w / 4, 1);
      tex.needsUpdate = true;
      const m = mat.clone();
      m.map = tex;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, 2, 1.2), m);
      mesh.position.set(b.x, 1, b.z);
      this.add(mesh, 'both');
      const top = new THREE.Mesh(new THREE.BoxGeometry(b.w, 0.12, 0.3), topMat);
      top.position.set(b.x, 2.06, b.z);
      this.add(top);
      this.obstacles.push({
        kind: 'barrier',
        box: new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, 0, b.z - 0.6), new THREE.Vector3(b.x + b.w / 2, 2.1, b.z + 0.6)),
      });
    }
  }

  private buildGantries() {
    const frame = new THREE.MeshStandardMaterial({ color: 0x30343c, metalness: 0.7, roughness: 0.4 });
    const signs = ['SKYWAY ▲', 'CITY CENTER', 'EXIT 2026', 'AIR LANE ▲', 'FINISH ▸'];
    STAGE_CONTENT.gantries.forEach((z, i) => {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * RAIL_X + 4, 1.6, 1.4), frame);
      beam.position.set(0, 8.6, z);
      this.add(beam, 'both');
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 9.4, 0.9), frame);
        leg.position.set(s * (RAIL_X + 1.6), 4.7, z);
        this.add(leg, 'cast');
      }
      const signMat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xffffff,
        emissiveMap: bannerTexture(signs[i % signs.length], '', i % 2 ? '#ff3fb0' : '#2fe0ff'),
        emissiveIntensity: 1.6,
      });
      for (const side of [-1, 1]) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 2), signMat);
        sign.position.set(0, 8.6, z - side * 0.72);
        if (side < 0) sign.rotation.y = Math.PI;
        this.add(sign);
      }
      this.obstacles.push({
        kind: 'gantry',
        box: new THREE.Box3(new THREE.Vector3(-RAIL_X - 3, 7.8, z - 0.7), new THREE.Vector3(RAIL_X + 3, 9.4, z + 0.7)),
      });
    });
  }

  private buildGates() {
    const frame = new THREE.MeshStandardMaterial({ color: 0xe8ebf0, metalness: 0.5, roughness: 0.35 });
    const specs = [
      { z: STAGE_LENGTH, text: 'CHECKPOINT', sub: '+12 SECONDS', color: '#2fe0ff', bonus: 12, finish: false },
      { z: STAGE_LENGTH * 2, text: 'CHECKPOINT', sub: '+12 SECONDS', color: '#2fe0ff', bonus: 12, finish: false },
      { z: COURSE_LENGTH, text: 'FINISH', sub: 'ROADSTER THRUSTER TRIAL', color: '#ff3fb0', bonus: 0, finish: true },
    ];
    for (const g of specs) {
      for (const s of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 17, 1.6), frame);
        pillar.position.set(s * (RAIL_X + 3), 8.5, g.z);
        this.add(pillar, 'cast');
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(2 * RAIL_X + 8, 2.6, 1.2), frame);
      top.position.set(0, 16.4, g.z);
      this.add(top, 'cast');
      const bannerMat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xffffff,
        emissiveMap: bannerTexture(g.text, g.sub, g.color),
        emissiveIntensity: 1.8,
      });
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(2 * RAIL_X + 6, (2 * RAIL_X + 6) / 8), bannerMat);
      banner.position.set(0, 16.4, g.z - 0.62);
      banner.rotation.y = Math.PI;
      this.add(banner);
      // light curtain across the gate
      const curtain = new THREE.Mesh(
        new THREE.PlaneGeometry(2 * RAIL_X + 4, 15),
        new THREE.MeshBasicMaterial({ color: g.color, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      curtain.position.set(0, 7.5, g.z);
      this.add(curtain);
      if (g.finish) {
        const tex = checkerTexture();
        tex.repeat.set(2, 1);
        const line = new THREE.Mesh(new THREE.PlaneGeometry(2 * RAIL_X, 3), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
        line.rotation.x = -Math.PI / 2;
        line.position.set(0, 0.025, g.z);
        this.add(line, 'receive');
      }
      this.checkpoints.push({ z: g.z, bonus: g.bonus, passed: false, finish: g.finish });
    }
  }

  private buildRings() {
    const specs = STAGE_CONTENT.chains;
    const positions: THREE.Vector3[] = [];
    for (const c of specs) {
      for (let i = 0; i < c.count; i++) {
        const t = c.count > 1 ? i / (c.count - 1) : 0;
        positions.push(
          new THREE.Vector3(c.x + (c.xAmp ?? 0) * Math.sin(i * 0.9), c.y0 + c.arc * Math.sin(Math.PI * t), c.z0 + i * c.spacing)
        );
      }
    }
    this.ringMat = new THREE.MeshStandardMaterial({ color: 0x06202c, emissive: 0x1fb8ff, emissiveIntensity: 1.4, metalness: 0.3, roughness: 0.3 });
    this.ringMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(RING_RADIUS, 0.2, 10, 48), this.ringMat, positions.length);
    this.ringMesh.frustumCulled = false;
    positions.forEach((p, i) => this.rings.push({ pos: p, radius: RING_RADIUS, collected: false, passed: false, index: i }));
    this.add(this.ringMesh);
    this.updateRings(0);
  }

  private updateRings(t: number) {
    for (const r of this.rings) {
      const s = r.collected ? 0 : 1;
      this.q.setFromAxisAngle(this.v3.set(0, 0, 1), t * 0.8 + r.index);
      this.m4.compose(this.s3.copy(r.pos).setY(r.pos.y + Math.sin(t * 2 + r.index) * 0.12), this.q, this.v3.set(s, s, s));
      this.ringMesh.setMatrixAt(r.index, this.m4);
    }
    this.ringMesh.instanceMatrix.needsUpdate = true;
  }

  collectRing(r: Ring) {
    r.collected = true;
  }

  // ---------- traffic ----------
  private buildTrafficPool() {
    const names = ['car_sedan', 'car_taxi', 'car_van', 'car_suv', 'car_truck', 'car_delivery', 'car_hatchback-sports', 'car_sedan-sports', 'car_police'];
    const PER_MODEL = 5;
    for (const name of names) {
      const asset = this.props.get(name);
      if (!asset) continue;
      const length = Math.max(asset.size.x, asset.size.z);
      const target = name.includes('truck') || name.includes('delivery') ? 6.2 : 4.6;
      const scale = target / length;
      const model = this.trafficModels.length;
      this.trafficModels.push({ name, asset, scale });
      const mesh = new THREE.InstancedMesh(asset.geometry, asset.material, PER_MODEL);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      for (let i = 0; i < PER_MODEL; i++) {
        mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
        const sx = asset.size.x * scale;
        const sy = asset.size.y * scale;
        const sz = asset.size.z * scale;
        this.traffic.push({
          active: false,
          model,
          slot: i,
          pos: new THREE.Vector3(),
          speed: 0,
          yaw: 0,
          half: new THREE.Vector3(sx / 2, sy, sz / 2),
          knocked: false,
          knockVel: new THREE.Vector3(),
          spin: new THREE.Vector3(),
          rot: new THREE.Euler(),
          knockTime: 0,
          passed: false,
        });
      }
      this.trafficMeshes.push(mesh);
      this.add(mesh);
    }
    this.trafficLights = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.5, 0.16, 0.05),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2030).multiplyScalar(4), toneMapped: false }),
      this.traffic.length * 2
    );
    this.trafficLights.frustumCulled = false;
    this.add(this.trafficLights);
  }

  private stageOf(z: number) {
    return Math.min(2, Math.max(0, Math.floor(z / STAGE_LENGTH)));
  }

  private laneBlocked(x: number, z: number) {
    for (const r of this.ramps) if (Math.abs(r.x - x) < r.halfW + 2 && r.z0 > z - 40 && r.z0 < z + 260) return true;
    for (const o of this.obstacles) {
      if (o.kind !== 'barrier') continue;
      if (x > o.box.min.x - 2 && x < o.box.max.x + 2 && o.box.min.z > z - 20 && o.box.min.z < z + 300) return true;
    }
    return false;
  }

  private spawnTraffic(z: number) {
    const stage = this.stageOf(z);
    const free = LANES.filter((x) => !this.laneBlocked(x, z));
    if (!free.length) return;
    const pool = this.traffic.filter((t) => !t.active);
    if (!pool.length) return;
    const wantPolice = stage === 2 && this.rng() < 0.3;
    const candidates = pool.filter((t) => (this.trafficModels[t.model].name === 'car_police') === wantPolice);
    const car = (candidates.length ? candidates : pool)[Math.floor(this.rng() * (candidates.length || pool.length))];
    car.active = true;
    car.knocked = false;
    car.passed = false;
    car.pos.set(free[Math.floor(this.rng() * free.length)] + (this.rng() - 0.5) * 0.8, 0, z);
    car.speed = 11 + this.rng() * 8 + stage * 2;
    car.yaw = 0;
    car.rot.set(0, 0, 0);
  }

  knock(car: TrafficCar, push: THREE.Vector3) {
    car.knocked = true;
    car.knockTime = 0;
    car.knockVel.copy(push).setY(9 + Math.random() * 4);
    car.spin.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 8);
  }

  private updateTraffic(dt: number, playerZ: number) {
    while (this.nextSpawnZ < playerZ + 380 && this.nextSpawnZ < COURSE_LENGTH - 30) {
      const stage = this.stageOf(this.nextSpawnZ);
      const gap = [46, 36, 27][stage];
      if (this.nextSpawnZ > playerZ + 60) this.spawnTraffic(this.nextSpawnZ);
      this.nextSpawnZ += gap * (0.6 + this.rng() * 0.8);
    }
    let li = 0;
    for (const car of this.traffic) {
      const mesh = this.trafficMeshes[car.model];
      const scale = this.trafficModels[car.model].scale;
      if (car.active && (car.pos.z < playerZ - 80 || car.pos.z > COURSE_LENGTH + 120)) car.active = false;
      if (car.active && car.knocked) {
        car.knockTime += dt;
        car.knockVel.y -= 22 * dt;
        car.pos.addScaledVector(car.knockVel, dt);
        if (car.pos.y < 0) {
          car.pos.y = 0;
          car.knockVel.multiplyScalar(0.4);
          car.knockVel.y = Math.abs(car.knockVel.y) * 0.3;
          car.spin.multiplyScalar(0.5);
        }
        car.rot.x += car.spin.x * dt;
        car.rot.y += car.spin.y * dt;
        car.rot.z += car.spin.z * dt;
        if (car.knockTime > 4) car.active = false;
      } else if (car.active) {
        car.pos.z += car.speed * dt;
        car.pos.y = this.groundHeight(car.pos.x, car.pos.z);
      }
      if (!car.active) {
        mesh.setMatrixAt(car.slot, this.m4.makeScale(0, 0, 0));
        continue;
      }
      this.q.setFromEuler(car.rot);
      this.m4.compose(car.pos, this.q, this.s3.set(scale, scale, scale));
      mesh.setMatrixAt(car.slot, this.m4);
      if (!car.knocked) {
        for (const s of [-1, 1]) {
          this.v3.set(car.pos.x + s * car.half.x * 0.62, car.pos.y + car.half.y * 0.42, car.pos.z - car.half.z - 0.02);
          this.trafficLights.setMatrixAt(li++, this.m4.makeTranslation(this.v3.x, this.v3.y, this.v3.z));
        }
      }
    }
    for (let i = li; i < this.trafficLights.count; i++) this.trafficLights.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
    this.trafficLights.instanceMatrix.needsUpdate = true;
    for (const m of this.trafficMeshes) m.instanceMatrix.needsUpdate = true;
  }

  // ---------- queries ----------
  groundHeight(x: number, z: number): number {
    for (const r of this.ramps) {
      if (z >= r.z0 && z <= r.z1 && Math.abs(x - r.x) <= r.halfW) return ((z - r.z0) / (r.z1 - r.z0)) * r.height;
    }
    return 0;
  }

  update(dt: number, t: number, playerZ: number, look: StageLook, fog: THREE.Fog, simulate: boolean) {
    this.updateRings(t);
    this.padMat.uniforms.uTime.value = t;
    this.padMat.uniforms.uFogColor.value.copy(fog.color);
    this.padMat.uniforms.uFogNear.value = fog.near;
    this.padMat.uniforms.uFogFar.value = fog.far;
    if (this.water) {
      this.water.normal.offset.set(t * 0.01, t * 0.02);
    }
    const n = look.night;
    for (const { mat, day, night } of this.nightMats) mat.emissiveIntensity = day + (night - day) * n;
    this.roadMat.emissiveIntensity = 0.06 + n * 0.9;
    this.roadMat.roughness = 0.82 - n * 0.4;
    this.ringMat.emissiveIntensity = 1.4 + n * 0.8;
    if (simulate) this.updateTraffic(dt, playerZ);
  }

  reset() {
    for (const r of this.rings) {
      r.collected = false;
      r.passed = false;
    }
    for (const c of this.checkpoints) c.passed = false;
    for (const car of this.traffic) car.active = false;
    this.nextSpawnZ = 80;
    this.rng = mulberry32(7);
    this.updateTraffic(0, 0);
  }
}

function waterNormalTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const h = (x: number, y: number) => {
    const u = (x / S) * Math.PI * 2;
    const v = (y / S) * Math.PI * 2;
    return Math.sin(u * 3 + Math.sin(v * 2) * 1.5) * 0.5 + Math.sin(v * 5 + u * 2) * 0.3 + Math.sin(u * 9 - v * 7) * 0.15;
  };
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const n = new THREE.Vector3(-dx * 4, -dy * 4, 1).normalize();
      const i = (y * S + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function billboardTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#ff2fd0');
  g.addColorStop(1, '#2f6bff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 512);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < 512; y += 6) ctx.fillRect(0, y, 256, 2);
  ctx.save();
  ctx.translate(128, 256);
  ctx.rotate(-Math.PI / 2);
  ctx.font = '900 64px Orbitron, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText('FLY 2026', 0, 0);
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Keeps only the glass-blue texels of the Kenney palette so just the windows light up at night. */
function windowEmissiveMap(map: THREE.Texture | null): THREE.Texture | null {
  const img = map?.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!img?.width) return null;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const b = d[i + 2];
    const glass = b > r + 45 && b > 120;
    const v = glass ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = map!.flipY;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
