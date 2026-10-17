import * as THREE from 'three';

const WHEELS = ['FL', 'FR', 'RL', 'RR'] as const;

interface Wheel {
  pivot: THREE.Object3D;
  spin: THREE.Object3D;
  front: boolean;
}

export type ThrusterGroup = 'rear' | 'front' | 'down' | 'side';

/** One cold-gas nozzle: exit point and firing direction in body space, plus its live power. */
export interface Nozzle {
  group: ThrusterGroup;
  /** +1 for the nozzle on the car's +X flank, -1 for -X, 0 on the centreline */
  side: number;
  exit: THREE.Vector3;
  dir: THREE.Vector3;
  power: number;
  plume: THREE.Mesh;
  plumeMat: THREE.ShaderMaterial;
  length: number;
  frost: number;
  mat: THREE.MeshStandardMaterial;
}

export interface CarVisualState {
  speed: number;
  steer: number;
  /** thruster powers 0..1, set by the gameplay each frame */
  rear: number;
  front: number;
  down: number;
  /** lateral attitude pulses on the +X and -X side pods */
  sidePos: number;
  sideNeg: number;
  /** downforce mode: side pods vector upward, fans spin up, wing pitches up */
  grip: number;
  brake: boolean;
  night: number; // 0..1
}

const plumeVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`;
// uv.y is 1 at the nozzle mouth and 0 at the far end of the jet
const plumeFragment = /* glsl */ `
  uniform float uPower;
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    float t = 1.0 - vUv.y;
    float core = exp(-t * 6.0);
    float a1 = vUv.x * 6.2832;
    float turb = 0.5 + 0.5 * sin(a1 * 3.0 + uTime * 9.0 + uSeed) * sin(t * 16.0 - uTime * 42.0 + uSeed * 2.7);
    float streak = 0.5 + 0.5 * sin(a1 * 7.0 + t * 4.0 - uTime * 3.0 + uSeed * 5.1);
    float body = (1.0 - t) * (1.0 - t);
    float a = uPower * pow(vFacing, 1.3) * body * (0.35 + 0.35 * turb + 0.15 * streak + core * 0.9);
    a *= smoothstep(0.0, 0.04, t) * 0.5 + 0.5;
    vec3 col = mix(vec3(0.80, 0.86, 0.93), vec3(1.0), core * 0.8 + turb * 0.2);
    gl_FragColor = vec4(col * (1.0 + core * 0.5), clamp(a, 0.0, 0.9));
  }
`;

const PLUME_LENGTH: Record<ThrusterGroup, number> = { rear: 2.4, front: 1.5, down: 1.9, side: 1.1 };
const PLUME_SPREAD: Record<ThrusterGroup, number> = { rear: 0.42, front: 0.34, down: 0.5, side: 0.26 };
const COPPER = new THREE.Color(0.78, 0.58, 0.34);
const FROST = new THREE.Color(0.9, 0.93, 0.96);

function plumeMaterial(seed: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uPower: { value: 0 }, uTime: { value: 0 }, uSeed: { value: seed } },
    vertexShader: plumeVertex,
    fragmentShader: plumeFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function radialTexture(inner: string, outer: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function plateTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 110;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#eceeea';
  ctx.fillRect(0, 0, 512, 110);
  ctx.strokeStyle = '#2b2e33';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 98);
  ctx.fillStyle = '#1d2026';
  ctx.font = '900 76px Orbitron, Arial Black, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('RDSTR', 256, 60);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // glTF UVs put v = 0 at the top of the image
  t.flipY = false;
  t.anisotropy = 4;
  return t;
}

const DIRS: Record<ThrusterGroup, THREE.Vector3> = {
  rear: new THREE.Vector3(0, 0, -1),
  front: new THREE.Vector3(0, 0, 1),
  down: new THREE.Vector3(0, -1, 0),
  side: new THREE.Vector3(1, 0, 0),
};
const Z = new THREE.Vector3(0, 0, 1);

export class CarRig {
  /** world placement: position + yaw */
  root = new THREE.Group();
  /** pitch / roll / tricks happen here so the root stays upright */
  body = new THREE.Group();
  shadow: THREE.Mesh;
  nozzles: Nozzle[] = [];
  /** 0 = plate up, 1 = fully dropped to expose the rear mains */
  plateDrop = 0;
  private model: THREE.Object3D;
  private wheels: Wheel[] = [];
  private paint: THREE.MeshPhysicalMaterial;
  private lightFront: THREE.MeshStandardMaterial[] = [];
  private lightRear: THREE.MeshStandardMaterial[] = [];
  private wheelGlow: THREE.MeshStandardMaterial[] = [];
  private fans: THREE.Object3D[] = [];
  private plate: THREE.Object3D | null;
  private wing: THREE.Object3D | null;
  private plateHold = 0;
  private wingAngle = 0.08;
  private headlight: THREE.SpotLight;
  private time = 0;
  private tmp = new THREE.Vector3();
  private q = new THREE.Quaternion();

  constructor(source: THREE.Object3D) {
    this.model = source.clone(true);
    this.root.add(this.body);
    this.body.add(this.model);

    this.paint = new THREE.MeshPhysicalMaterial({
      color: 0xd9dce2,
      metalness: 0.75,
      roughness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.2,
    });

    const seen = new Map<THREE.Material, THREE.Material>();
    this.model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      const src = o.material as THREE.MeshStandardMaterial;
      if (o.name.startsWith('Nozzle_')) {
        // each nozzle frosts over on its own while it fires
        o.material = src.clone();
        return;
      }
      let m = seen.get(src);
      if (!m) {
        m = this.adapt(src);
        seen.set(src, m);
      }
      o.material = m;
    });

    for (const key of WHEELS) {
      const pivot = this.model.getObjectByName(`wheel_${key}`);
      const spin = this.model.getObjectByName(`spin_${key}`);
      if (!pivot || !spin) continue;
      this.wheels.push({ pivot, spin, front: key.startsWith('F') });
    }
    for (let i = 0; i < 8; i++) {
      const fan = this.model.getObjectByName(`fan_${i}`);
      if (fan) this.fans.push(fan);
    }
    this.plate = this.model.getObjectByName('plate_hinge') ?? null;
    this.wing = this.model.getObjectByName('wing_pivot') ?? null;

    this.model.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    this.model.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name.startsWith('Nozzle_')) meshes.push(o);
    });
    meshes.sort((a, b) => a.name.localeCompare(b.name));
    meshes.forEach((mesh, i) => {
      const group = mesh.name.split('_')[1] as ThrusterGroup;
      if (!(group in DIRS)) return;
      const box = new THREE.Box3().setFromObject(mesh);
      const c = box.getCenter(new THREE.Vector3());
      const side = Math.abs(c.x) > 0.05 ? Math.sign(c.x) : 0;
      const dir = DIRS[group].clone();
      if (group === 'side') dir.x = side;
      // the exit is the face of the nozzle's bounds that points along the firing direction
      const exit = c.clone();
      if (dir.x) exit.x = dir.x > 0 ? box.max.x : box.min.x;
      if (dir.y) exit.y = dir.y > 0 ? box.max.y : box.min.y;
      if (dir.z) exit.z = dir.z > 0 ? box.max.z : box.min.z;

      const length = PLUME_LENGTH[group];
      // narrow at the mouth, expanding as the gas leaves the bell
      const geo = new THREE.CylinderGeometry(0.05, PLUME_SPREAD[group], 1, 20, 1, true);
      geo.translate(0, -0.5, 0);
      geo.rotateX(-Math.PI / 2);
      const plumeMat = plumeMaterial(i * 1.7);
      const plume = new THREE.Mesh(geo, plumeMat);
      plume.position.copy(exit);
      plume.quaternion.setFromUnitVectors(Z, dir);
      plume.renderOrder = 3;
      plume.visible = false;
      plume.frustumCulled = false;
      this.body.add(plume);
      this.nozzles.push({ group, side, exit, dir, power: 0, plume, plumeMat, length, frost: 0, mat: mesh.material as THREE.MeshStandardMaterial });
    });

    this.headlight = new THREE.SpotLight(0xe8f2ff, 0, 70, 0.55, 0.6, 1.2);
    this.headlight.position.set(0, 0.8, 2.2);
    this.headlight.target.position.set(0, 0, 14);
    this.body.add(this.headlight, this.headlight.target);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 5.6),
      new THREE.MeshBasicMaterial({
        map: radialTexture('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)'),
        transparent: true,
        depthWrite: false,
      })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
  }

  private adapt(src: THREE.MeshStandardMaterial): THREE.Material {
    const name = src.name;
    if (name === 'Paint') return this.paint;
    const m = src.clone();
    if (name === 'Glass') {
      return new THREE.MeshPhysicalMaterial({
        color: 0x05080d,
        metalness: 0.1,
        roughness: 0.04,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        envMapIntensity: 1.6,
      });
    }
    if (name === 'Plate') {
      m.map = plateTexture();
      m.color.setHex(0xffffff);
    }
    if (name === 'LightFront') this.lightFront.push(m);
    if (name === 'LightRear') this.lightRear.push(m);
    if (name === 'WheelGlow' || name === 'Accent') this.wheelGlow.push(m);
    return m;
  }

  setPaint(hex: number) {
    this.paint.color.setHex(hex);
    const dark = this.paint.color.getHSL({ h: 0, s: 0, l: 0 }).l < 0.2;
    this.paint.roughness = dark ? 0.32 : 0.28;
  }

  setVisible(v: boolean) {
    this.body.visible = v;
  }

  /** World-space exit point and firing direction of a nozzle (valid after update()). */
  nozzleWorld(n: Nozzle, pos: THREE.Vector3, dir: THREE.Vector3) {
    pos.copy(n.exit).applyMatrix4(this.body.matrixWorld);
    this.body.getWorldQuaternion(this.q);
    dir.copy(n.dir).applyQuaternion(this.q);
  }

  update(dt: number, s: CarVisualState, groundY: number) {
    this.time += dt;
    for (const w of this.wheels) {
      // wheels keep their driving orientation in the air too; only spin (about the axle) and steer change
      w.spin.rotation.x += (s.speed / 0.36) * dt;
      w.pivot.rotation.set(0, w.front ? -s.steer * 0.42 : 0, 0);
    }

    // drop-down plate: falls fast when the mains light, lifts back a moment after they stop
    if (s.rear > 0.05) this.plateHold = 0.5;
    else this.plateHold = Math.max(0, this.plateHold - dt);
    const plateTarget = this.plateHold > 0 ? 1 : 0;
    this.plateDrop += (plateTarget - this.plateDrop) * Math.min(1, dt * (plateTarget ? 22 : 5));
    if (this.plate) this.plate.rotation.x = -1.95 * this.plateDrop;

    // active wing: airbrake under braking, high downforce in grip mode, flat for top speed
    const wingTarget = s.brake || s.front > 0.3 ? 0.95 : s.grip > 0.2 ? 0.35 + s.grip * 0.15 : s.rear > 0.2 ? -0.02 : 0.08;
    this.wingAngle += (wingTarget - this.wingAngle) * Math.min(1, dt * 7);
    if (this.wing) this.wing.rotation.x = this.wingAngle;

    const fanRate = 6 + Math.abs(s.speed) * 0.5 + s.grip * 70 + s.down * 30;
    this.fans.forEach((f, i) => (f.rotation.z += fanRate * dt * (i % 2 ? 1 : -1)));

    this.root.updateMatrixWorld(true);
    for (const n of this.nozzles) {
      let p = 0;
      if (n.group === 'rear') p = s.rear * this.plateDrop;
      else if (n.group === 'front') p = s.front;
      else if (n.group === 'down') p = s.down;
      else {
        const lateral = n.side > 0 ? s.sidePos : s.sideNeg;
        p = Math.max(lateral, s.grip * 0.8);
        // the side pods swivel: outward for attitude control, upward to press the car down
        const up = lateral > s.grip ? 0 : s.grip;
        n.dir.set(n.side * (1 - up), up, 0).normalize();
        n.plume.quaternion.setFromUnitVectors(Z, n.dir);
      }
      // gas pressure ramps in a few frames and bleeds off a little slower
      n.power += (p - n.power) * Math.min(1, dt * (p > n.power ? 30 : 14));
      n.frost = THREE.MathUtils.clamp(n.frost + (n.power > 0.1 ? dt * 0.6 : -dt * 0.25), 0, 1);
      n.mat.color.copy(COPPER).lerp(FROST, n.frost * 0.85);
      n.mat.roughness = 0.32 + n.frost * 0.5;
      n.mat.metalness = 1 - n.frost * 0.7;

      const on = n.power > 0.02;
      n.plume.visible = on;
      if (!on) continue;
      let len = n.length * (0.55 + n.power * 0.45) * (0.94 + Math.random() * 0.12);
      if (n.group === 'down') {
        // the jet splashes on the road instead of passing through it
        const h = this.tmp.copy(n.exit).applyMatrix4(this.body.matrixWorld).y - groundY;
        len = Math.max(0.25, Math.min(len, h + 0.1));
      }
      const width = 0.85 + n.power * 0.3;
      n.plume.scale.set(width, width, len);
      n.plumeMat.uniforms.uPower.value = n.power;
      n.plumeMat.uniforms.uTime.value = this.time;
    }

    for (const m of this.wheelGlow) m.emissiveIntensity = 0.8 + s.down * 0.6;
    for (const m of this.lightRear) m.emissiveIntensity = s.brake ? 12 : 5;
    for (const m of this.lightFront) m.emissiveIntensity = 5 + s.night * 3;
    this.headlight.intensity = s.night * 60;

    const alt = Math.max(0, this.root.position.y - groundY);
    this.shadow.position.set(this.root.position.x, groundY + 0.06, this.root.position.z);
    this.shadow.rotation.z = this.root.rotation.y;
    const sm = this.shadow.material as THREE.MeshBasicMaterial;
    sm.opacity = THREE.MathUtils.clamp(1 - alt / 30, 0.15, 1);
    this.shadow.scale.setScalar(1 + alt * 0.03);
  }
}