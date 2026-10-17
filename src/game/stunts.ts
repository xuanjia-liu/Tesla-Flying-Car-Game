import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Signature stunt, modelled on Tesla's Oct 2026 Roadster reveal: a ramp that rolls the car a full
 * 180° until it is driving upside down (the "ramp" demo), then launches it over a parked line-up
 * of cars, Cybertrucks and Semis (the "kickflip" demo) into a marked landing zone.
 *
 * The ramp is a half-twist corkscrew around an axis that runs along the course, so the car keeps
 * travelling forward while it rolls inverted.
 */
export interface Stunt {
  x: number;
  z0: number;
  z1: number;
  hw: number;
  radius: number;
  climb: number;
  dir: 1 | -1;
  funnelZ0: number;
  lineupZ0: number;
  lineupZ1: number;
  landZ0: number;
  landZ1: number;
}

export const STUNT_LENGTH = 56;
const RADIUS = 4.2;
const CLIMB = 3;
const HALF_WIDTH = 4.4;
const FUNNEL = 50;

export function makeStunt(z0: number, dir: 1 | -1, x = 0): Stunt {
  const z1 = z0 + STUNT_LENGTH;
  return {
    x,
    z0,
    z1,
    hw: HALF_WIDTH,
    radius: RADIUS,
    climb: CLIMB,
    dir,
    funnelZ0: z0 - FUNNEL,
    lineupZ0: z1 + 12,
    lineupZ1: z1 + 26,
    landZ0: z1 + 36,
    landZ1: z1 + 110,
  };
}

export interface StuntPose {
  pos: THREE.Vector3;
  /** roll about the course axis; ±π is upside down */
  roll: number;
  /** dy/dz of the deck centre line */
  slope: number;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export function stuntPose(s: Stunt, z: number, out: StuntPose): StuntPose {
  const t = THREE.MathUtils.clamp((z - s.z0) / (s.z1 - s.z0), 0, 1);
  const theta = Math.PI * smooth(t) * s.dir;
  const axisY = s.radius + s.climb * t * t;
  out.pos.set(s.x + s.radius * Math.sin(theta), axisY - s.radius * Math.cos(theta), z);
  out.roll = theta;
  const dTheta = Math.PI * 6 * t * (1 - t) * s.dir;
  out.slope = (2 * s.climb * t + s.radius * Math.sin(theta) * dTheta) / (s.z1 - s.z0);
  return out;
}

// ---------- geometry ----------

function deckTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3a3d46';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  ctx.fillStyle = '#ff3fb0';
  ctx.fillRect(0, 0, 14, 256);
  ctx.fillRect(242, 0, 14, 256);
  ctx.fillStyle = '#e8ecf2';
  ctx.beginPath();
  ctx.moveTo(128, 70);
  ctx.lineTo(196, 150);
  ctx.lineTo(166, 150);
  ctx.lineTo(128, 106);
  ctx.lineTo(90, 150);
  ctx.lineTo(60, 150);
  ctx.closePath();
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function landingTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 512);
  ctx.strokeStyle = '#2fe0ff';
  ctx.lineWidth = 10;
  for (const r of [40, 85, 125]) {
    ctx.beginPath();
    ctx.ellipse(128, 300, r, r * 1.6, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#ff3fb0';
  ctx.fillRect(0, 0, 12, 512);
  ctx.fillRect(244, 0, 12, 512);
  for (let y = 0; y < 512; y += 64) {
    ctx.fillRect(12, y, 30, 24);
    ctx.fillRect(214, y, 30, 24);
  }
  ctx.save();
  ctx.translate(128, 70);
  ctx.scale(1, 1.6);
  ctx.font = '900 46px Orbitron, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('LAND', 0, 0);
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Strip that follows the twisting deck: `a`/`b` are lateral offsets (−1…1 of the half width), `depth` is along −normal. */
function deckStrip(s: Stunt, a: number, b: number, depthA: number, depthB: number, segs: number, vScale: number) {
  const pose: StuntPose = { pos: new THREE.Vector3(), roll: 0, slope: 0 };
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const z = s.z0 + (s.z1 - s.z0) * (i / segs);
    stuntPose(s, z, pose);
    const th = pose.roll;
    const ux = Math.cos(th);
    const uy = Math.sin(th);
    const nx = -Math.sin(th);
    const ny = Math.cos(th);
    for (const [off, d] of [
      [a, depthA],
      [b, depthB],
    ]) {
      positions.push(pose.pos.x + ux * off * s.hw - nx * d, pose.pos.y + uy * off * s.hw - ny * d, z);
    }
    const v = ((z - s.z0) / vScale) % 1e6;
    uvs.push(0, v, 1, v);
    if (i < segs) {
      const k = i * 2;
      index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

export interface StuntMeshes {
  group: THREE.Group;
  glowMat: THREE.MeshStandardMaterial;
  deckMat: THREE.MeshStandardMaterial;
}

export function buildRamp(s: Stunt, frameMat: THREE.Material): StuntMeshes {
  const group = new THREE.Group();
  const SEG = 80;
  const T = 0.55;
  const deckMat = new THREE.MeshStandardMaterial({ map: deckTexture(), roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide });
  deckMat.map!.repeat.set(1, 1);
  const top = new THREE.Mesh(deckStrip(s, -1, 1, 0, 0, SEG, 8), deckMat);
  const under = new THREE.Mesh(
    mergeGeometries([deckStrip(s, 1, -1, T, T, SEG, 8), deckStrip(s, -1, -1, 0, T, SEG, 8), deckStrip(s, 1, 1, T, 0, SEG, 8)])!,
    frameMat
  );
  (under.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x062030, emissive: 0x2fd0ff, emissiveIntensity: 2, side: THREE.DoubleSide });
  const glow = new THREE.Mesh(
    mergeGeometries([deckStrip(s, -1.02, -0.97, -0.06, -0.06, SEG, 8), deckStrip(s, 0.97, 1.02, -0.06, -0.06, SEG, 8)])!,
    glowMat
  );
  top.castShadow = under.castShadow = true;
  top.receiveShadow = true;
  group.add(top, under, glow);

  // supports: lattice legs under the side-on section, tall goalpost pylons holding the inverted section
  const pose: StuntPose = { pos: new THREE.Vector3(), roll: 0, slope: 0 };
  const legs: THREE.BufferGeometry[] = [];
  for (let z = s.z0 + 14; z < s.z1 - 1; z += 6.5) {
    stuntPose(s, z, pose);
    const th = Math.abs(pose.roll);
    if (th < 0.7) continue;
    const nx = -Math.sin(pose.roll);
    const ny = Math.cos(pose.roll);
    if (th < 2.2) {
      // column under the outer deck edge
      const ux = Math.cos(pose.roll);
      const uy = Math.sin(pose.roll);
      const side = Math.sign(Math.sin(pose.roll)) || 1;
      const ex = pose.pos.x + ux * s.hw * side - nx * T;
      const ey = Math.min(pose.pos.y + uy * s.hw * side - ny * T, pose.pos.y - uy * s.hw * side - ny * T);
      const h = Math.max(0.2, ey);
      const leg = new THREE.BoxGeometry(0.5, h, 0.5);
      leg.translate(ex + side * 0.3, h / 2, z);
      legs.push(leg);
    } else {
      const deckTop = pose.pos.y + T + 0.6;
      for (const sx of [-1, 1]) {
        const p = new THREE.BoxGeometry(0.7, deckTop, 0.7);
        p.translate(s.x + sx * (s.hw + 1.6), deckTop / 2, z);
        legs.push(p);
      }
      const beam = new THREE.BoxGeometry(2 * (s.hw + 1.6) + 0.7, 0.6, 0.7);
      beam.translate(s.x, deckTop, z);
      legs.push(beam);
    }
  }
  if (legs.length) {
    const m = new THREE.Mesh(mergeGeometries(legs)!, frameMat);
    m.castShadow = true;
    group.add(m);
  }
  return { group, glowMat, deckMat };
}

type Part = { geo: THREE.BufferGeometry; color: number };

function colored(parts: Part[]) {
  const geos = parts.map(({ geo, color }) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return g;
  });
  const merged = mergeGeometries(geos)!;
  merged.computeVertexNormals();
  return merged;
}

function boxAt(w: number, h: number, l: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, l);
  g.translate(x, y, z);
  return g;
}

function wheelsAt(zs: number[], halfTrack: number, r = 0.5, w = 0.4) {
  const out: THREE.BufferGeometry[] = [];
  for (const z of zs)
    for (const s of [-1, 1]) {
      const g = new THREE.CylinderGeometry(r, r, w, 14);
      g.rotateZ(Math.PI / 2);
      g.translate(s * halfTrack, r, z);
      out.push(g);
    }
  return out;
}

/** Long axis along +Z, base at y = 0, centred on the origin. */
export function semiGeometry() {
  const white = 0xeef0f3;
  const dark = 0x15171b;
  const cab: THREE.BufferGeometry[] = [];
  const shape = new THREE.Shape();
  // side profile (z, y) of an aero cab with a raked windscreen
  shape.moveTo(-2.2, 0.7);
  shape.lineTo(2.3, 0.7);
  shape.lineTo(2.5, 1.6);
  shape.lineTo(1.4, 3.6);
  shape.lineTo(-2.2, 3.8);
  shape.closePath();
  const prof = new THREE.ExtrudeGeometry(shape, { depth: 2.5, bevelEnabled: false });
  prof.rotateY(-Math.PI / 2);
  prof.translate(1.25, 0, 0);
  cab.push(prof);
  const parts: Part[] = [
    ...cab.map((geo) => ({ geo: geo.translate(0, 0, 6.6), color: white })),
    { geo: boxAt(2.52, 0.9, 1.0, 0, 3.0, 7.4), color: dark },
    { geo: boxAt(2.6, 4.0, 12.6, 0, 2.55, -1.6), color: 0xdfe3e8 },
    { geo: boxAt(2.62, 0.25, 12.4, 0, 2.2, -1.6), color: 0xd0263a },
    { geo: boxAt(2.0, 0.5, 15.5, 0, 0.75, 0), color: dark },
    ...wheelsAt([8.0, 5.2, -5.0, -6.4], 1.05).map((geo) => ({ geo, color: dark })),
  ];
  return colored(parts);
}

/** Angular stainless pickup. Long axis along +Z, base at y = 0. */
export function cybertruckGeometry() {
  const steel = 0xb7bcc3;
  const dark = 0x121417;
  const shape = new THREE.Shape();
  shape.moveTo(-2.85, 0.55);
  shape.lineTo(2.85, 0.55);
  shape.lineTo(2.9, 1.15);
  shape.lineTo(0.15, 1.95);
  shape.lineTo(-2.85, 1.45);
  shape.closePath();
  const body = new THREE.ExtrudeGeometry(shape, { depth: 2.0, bevelEnabled: false });
  body.rotateY(-Math.PI / 2);
  body.translate(1.0, 0, 0);
  const glass = new THREE.Shape();
  glass.moveTo(1.55, 1.56);
  glass.lineTo(0.15, 1.96);
  glass.lineTo(-1.2, 1.74);
  glass.lineTo(-1.2, 1.5);
  glass.closePath();
  const win = new THREE.ExtrudeGeometry(glass, { depth: 2.04, bevelEnabled: false });
  win.rotateY(-Math.PI / 2);
  win.translate(1.02, 0, 0);
  const parts: Part[] = [
    { geo: body, color: steel },
    { geo: win, color: dark },
    { geo: boxAt(1.9, 0.05, 0.05, 0, 1.1, 2.9), color: 0xffffff },
    { geo: boxAt(1.9, 0.06, 0.05, 0, 1.38, -2.86), color: 0xff2030 },
    ...wheelsAt([1.9, -1.9], 0.9, 0.48, 0.38).map((geo) => ({ geo, color: dark })),
  ];
  return colored(parts);
}
