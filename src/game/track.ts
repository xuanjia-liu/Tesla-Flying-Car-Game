import * as THREE from 'three';

export type Piece =
  | { k: 'straight'; len: number; boost?: boolean }
  | { k: 'slope'; len: number; dy: number }
  | { k: 'turn'; radius: number; angle: number; bank: number }
  | { k: 'loop'; radius: number }
  | { k: 'wall'; len: number; side: 1 | -1 }
  | { k: 'gap'; len: number }
  | { k: 'checkpoint' }
  | { k: 'finish' };

export interface TrackFrame {
  s: number;
  p: THREE.Vector3;
  t: THREE.Vector3;
  n: THREE.Vector3;
  b: THREE.Vector3;
  width: number;
  curv: number;
  wall: boolean;
  boost: boolean;
  gap: boolean;
  checkpoint: boolean;
  finish: boolean;
}

const STEP = 2;
const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

interface Pose {
  p: THREE.Vector3;
  t: THREE.Vector3;
  n: THREE.Vector3;
}

function capture(pose: Pose, s: number, width: number, extra: Partial<TrackFrame>): TrackFrame {
  const t = pose.t.clone().normalize();
  const n = pose.n.clone().addScaledVector(t, -pose.n.dot(t)).normalize();
  const b = n.clone().cross(t).normalize();
  return {
    s,
    p: pose.p.clone(),
    t,
    n,
    b,
    width,
    curv: 0,
    wall: false,
    boost: false,
    gap: false,
    checkpoint: false,
    finish: false,
    ...extra,
  };
}

function rollAroundTangent(pose: Pose, ang: number) {
  _q.setFromAxisAngle(pose.t, ang);
  pose.n.applyQuaternion(_q);
}

export interface BuiltTrack {
  frames: TrackFrame[];
  length: number;
  width: number;
  group: THREE.Group;
  rings: { p: THREE.Vector3; t: THREE.Vector3; n: THREE.Vector3 }[];
  spawn: THREE.Vector3;
}

export function buildTrack(pieces: Piece[], opt: { width: number; y: number; accent: number; edge: number; night: boolean }): BuiltTrack {
  const width = opt.width;
  const pose: Pose = {
    p: new THREE.Vector3(0, opt.y, 8),
    t: new THREE.Vector3(0, 0, 1),
    n: new THREE.Vector3(0, 1, 0),
  };
  const frames: TrackFrame[] = [];
  let s = 0;
  frames.push(capture(pose, s, width, {}));

  const run = (len: number, each: (ds: number, u: number) => void, extra: Partial<TrackFrame>) => {
    const n = Math.max(1, Math.round(len / STEP));
    for (let i = 1; i <= n; i++) {
      const ds = len / n;
      each(ds, i / n);
      s += ds;
      frames.push(capture(pose, s, width, extra));
    }
  };

  for (const piece of pieces) {
    if (piece.k === 'checkpoint') {
      frames[frames.length - 1].checkpoint = true;
      continue;
    }
    if (piece.k === 'finish') {
      frames[frames.length - 1].finish = true;
      continue;
    }
    if (piece.k === 'straight') {
      run(piece.len, (ds) => pose.p.addScaledVector(pose.t, ds), { boost: !!piece.boost });
    } else if (piece.k === 'slope') {
      const start = pose.p.clone();
      const forward = new THREE.Vector3(pose.t.x, 0, pose.t.z);
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
      forward.normalize();
      const len = piece.len;
      const steps = Math.max(1, Math.round(len / STEP));
      const tangent = forward.clone().multiplyScalar(len);
      tangent.y = piece.dy;
      tangent.normalize();
      for (let i = 1; i <= steps; i++) {
        const u = i / steps;
        pose.p.copy(start).addScaledVector(forward, len * u);
        pose.p.y = start.y + piece.dy * u;
        pose.t.copy(tangent);
        pose.n.set(0, 1, 0).addScaledVector(pose.t, -pose.t.y).normalize();
        s += Math.hypot(len / steps, piece.dy / steps);
        frames.push(capture(pose, s, width, {}));
      }
      const next = pieces[pieces.indexOf(piece) + 1];
      if (!next || next.k !== 'gap') {
        pose.t.copy(forward);
        pose.n.copy(UP);
      }
    } else if (piece.k === 'gap') {
      run(piece.len, (ds) => pose.p.addScaledVector(pose.t, ds), { gap: true });
    } else if (piece.k === 'turn') {
      const len = Math.abs(piece.angle) * piece.radius;
      const curv = 1 / piece.radius;
      run(len, (ds, u) => {
        const dAng = piece.angle * (ds / len);
        _q.setFromAxisAngle(UP, dAng);
        pose.t.applyQuaternion(_q).normalize();
        const bank = Math.sin(Math.PI * Math.min(1, u)) * piece.bank * Math.sign(piece.angle || 1);
        pose.n.copy(UP);
        rollAroundTangent(pose, -bank);
        pose.p.addScaledVector(pose.t, ds);
      }, { curv });
      pose.n.copy(UP);
    } else if (piece.k === 'loop') {
      const R = piece.radius;
      const axis = pose.n.clone().cross(pose.t).normalize();
      const center = pose.p.clone().addScaledVector(pose.n, R);
      const len = Math.PI * 2 * R;
      run(len, (ds) => {
        const dAng = ds / R;
        _q.setFromAxisAngle(axis, -dAng);
        pose.t.applyQuaternion(_q).normalize();
        pose.n.applyQuaternion(_q).normalize();
        pose.p.copy(center).addScaledVector(pose.n, -R);
      }, { curv: 1 / R });
    } else if (piece.k === 'wall') {
      const target = piece.side > 0 ? -Math.PI / 2 : Math.PI / 2;
      run(piece.len, (ds, u) => {
        const env = u < 0.22 ? u / 0.22 : u > 0.78 ? (1 - u) / 0.22 : 1;
        pose.n.copy(UP);
        rollAroundTangent(pose, target * env);
        pose.p.addScaledVector(pose.t, ds);
      }, {});
      // tag wall frames from this piece
      const s1 = s;
      const s0 = s - piece.len;
      for (const f of frames) {
        if (f.s > s0 + piece.len * 0.22 && f.s < s1 - piece.len * 0.18) f.wall = true;
      }
      pose.n.copy(UP);
    }
  }

  const group = meshFor(frames, opt);
  const rings: BuiltTrack['rings'] = [];
  for (let i = 6; i < frames.length; i += 16) {
    const f = frames[i];
    if (f.gap || f.finish || f.wall) continue;
    rings.push({ p: f.p.clone().addScaledVector(f.n, 2.5), t: f.t.clone(), n: f.n.clone() });
  }
  return { frames, length: s, width, group, rings, spawn: frames[0].p.clone().add(new THREE.Vector3(0, 0.05, 0)) };
}

function meshFor(frames: TrackFrame[], opt: { night: boolean; edge: number }): THREE.Group {
  const group = new THREE.Group();
  const deck = new THREE.Mesh(
    ribbon(frames, 1, 0.04, false),
    new THREE.MeshStandardMaterial({
      color: opt.night ? 0x161826 : 0xd5cfc3,
      roughness: opt.night ? 0.42 : 0.7,
      metalness: opt.night ? 0.4 : 0.06,
      emissive: opt.night ? 0x140818 : 0x000000,
      emissiveIntensity: opt.night ? 0.45 : 0,
      side: THREE.DoubleSide,
    })
  );
  deck.receiveShadow = true;
  group.add(deck);

  const lip = new THREE.Mesh(
    ribbon(frames, 1, 0.45, true),
    new THREE.MeshStandardMaterial({
      color: opt.edge,
      emissive: opt.edge,
      emissiveIntensity: opt.night ? 2.6 : 1.15,
      roughness: 0.32,
      side: THREE.DoubleSide,
    })
  );
  group.add(lip);

  const boostFrames = frames.map((f) => (f.boost ? f : { ...f, gap: true }));
  if (frames.some((f) => f.boost)) {
    const band = new THREE.Mesh(
      ribbon(boostFrames, 0.45, 0.08, false),
      new THREE.MeshStandardMaterial({
        color: 0xff4ad8,
        emissive: 0xff4ad8,
        emissiveIntensity: 2.4,
        roughness: 0.25,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      })
    );
    group.add(band);
  }

  const pillarGeo = new THREE.CylinderGeometry(0.45, 0.7, 1, 6);
  const pillarMat = new THREE.MeshStandardMaterial({ color: opt.night ? 0x241c38 : 0xb7b0a4, roughness: 0.85 });
  const mats: THREE.Matrix4[] = [];
  for (let i = 0; i < frames.length; i += 7) {
    const f = frames[i];
    if (f.gap || f.p.y < 3.5 || f.wall) continue;
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(f.p.x, f.p.y * 0.5, f.p.z), new THREE.Quaternion(), new THREE.Vector3(1, f.p.y, 1)));
  }
  if (mats.length) {
    const mesh = new THREE.InstancedMesh(pillarGeo, pillarMat, mats.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    group.add(mesh);
  }
  return group;
}

function ribbon(frames: TrackFrame[], widthScale: number, lift: number, edgesOnly: boolean) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    if (a.gap || b.gap) continue;
    if (b.s - a.s > STEP * 2.5) continue;
    const addQuad = (a0: THREE.Vector3, a1: THREE.Vector3, b0: THREE.Vector3, b1: THREE.Vector3) => {
      const base = pos.length / 3;
      for (const v of [a0, a1, b0, b1]) pos.push(v.x, v.y, v.z);
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    };
    const wA = a.width * 0.5 * widthScale;
    const wB = b.width * 0.5 * widthScale;
    if (edgesOnly) {
      addQuad(
        a.p.clone().addScaledVector(a.b, wA),
        a.p.clone().addScaledVector(a.b, wA).addScaledVector(a.n, lift),
        b.p.clone().addScaledVector(b.b, wB),
        b.p.clone().addScaledVector(b.b, wB).addScaledVector(b.n, lift)
      );
      addQuad(
        a.p.clone().addScaledVector(a.b, -wA).addScaledVector(a.n, lift),
        a.p.clone().addScaledVector(a.b, -wA),
        b.p.clone().addScaledVector(b.b, -wB).addScaledVector(b.n, lift),
        b.p.clone().addScaledVector(b.b, -wB)
      );
    } else {
      addQuad(
        a.p.clone().addScaledVector(a.b, -wA).addScaledVector(a.n, lift),
        a.p.clone().addScaledVector(a.b, wA).addScaledVector(a.n, lift),
        b.p.clone().addScaledVector(b.b, -wB).addScaledVector(b.n, lift),
        b.p.clone().addScaledVector(b.b, wB).addScaledVector(b.n, lift)
      );
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (idx.length) geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function sampleTrack(frames: TrackFrame[], s: number): TrackFrame {
  const max = frames[frames.length - 1].s;
  const c = THREE.MathUtils.clamp(s, 0, max);
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].s < c) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[Math.min(frames.length - 1, lo + 1)];
  const u = THREE.MathUtils.clamp((c - a.s) / Math.max(0.0001, b.s - a.s), 0, 1);
  const t = a.t.clone().lerp(b.t, u).normalize();
  const n = a.n.clone().lerp(b.n, u);
  n.addScaledVector(t, -n.dot(t)).normalize();
  return {
    s: c,
    p: a.p.clone().lerp(b.p, u),
    t,
    n,
    b: n.clone().cross(t).normalize(),
    width: THREE.MathUtils.lerp(a.width, b.width, u),
    curv: THREE.MathUtils.lerp(a.curv, b.curv, u),
    wall: a.wall || b.wall,
    boost: a.boost || b.boost,
    gap: a.gap && b.gap,
    checkpoint: b.checkpoint && u > 0.5,
    finish: b.finish && u > 0.5,
  };
}
