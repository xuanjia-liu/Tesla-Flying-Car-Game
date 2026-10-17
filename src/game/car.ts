import * as THREE from 'three';

const WHEELS = ['FL', 'FR', 'RL', 'RR'] as const;

interface Wheel {
  pivot: THREE.Object3D;
  spin: THREE.Object3D;
  side: number; // -1 left (+X is left in this game's camera), 1 right
  front: boolean;
  restY: number;
}

export interface CarVisualState {
  speed: number;
  steer: number;
  hover: number; // 0 wheels down, 1 wheels flat as hover fans
  thrust: number; // 0..1 vertical thrusters
  boost: number; // 0..1 rear thrusters
  brake: boolean;
  night: number; // 0..1
}

const plumeVertex = /* glsl */ `
  varying float vT;
  void main() {
    vT = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const plumeFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uPower;
  uniform float uTime;
  varying float vT;
  void main() {
    float flicker = 0.85 + 0.15 * sin(uTime * 60.0 + vT * 20.0);
    float a = pow(vT, 1.6) * uPower * flicker;
    gl_FragColor = vec4(uColor * (1.0 + vT * 2.0), a);
  }
`;

function plumeMaterial(color: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: 0 }, uTime: { value: 0 } },
    vertexShader: plumeVertex,
    fragmentShader: plumeFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
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

export class CarRig {
  /** world placement: position + yaw */
  root = new THREE.Group();
  /** pitch / roll / tricks happen here so the root stays upright */
  body = new THREE.Group();
  shadow: THREE.Mesh;
  private model: THREE.Object3D;
  private wheels: Wheel[] = [];
  private paint: THREE.MeshPhysicalMaterial;
  private lightFront: THREE.MeshStandardMaterial[] = [];
  private lightRear: THREE.MeshStandardMaterial[] = [];
  private wheelGlow: THREE.MeshStandardMaterial[] = [];
  private thrusterGlow: THREE.MeshStandardMaterial[] = [];
  private rearPlumes: THREE.ShaderMaterial[] = [];
  private rearPlumeMeshes: THREE.Mesh[] = [];
  private fanGlows: THREE.Mesh[] = [];
  private headlight: THREE.SpotLight;
  private time = 0;

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
      this.wheels.push({
        pivot,
        spin,
        side: pivot.position.x > 0 ? -1 : 1,
        front: key.startsWith('F'),
        restY: pivot.position.y,
      });
      const fan = new THREE.Mesh(
        new THREE.CircleGeometry(0.62, 32),
        new THREE.MeshBasicMaterial({
          map: radialTexture('rgba(170,230,255,1)', 'rgba(40,140,255,0)'),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          opacity: 0,
        })
      );
      fan.rotation.x = Math.PI / 2;
      fan.position.copy(pivot.position).setY(0.05);
      fan.renderOrder = 2;
      this.body.add(fan);
      this.fanGlows.push(fan);
    }

    const nozzles: THREE.Object3D[] = [];
    this.model.traverse((o) => {
      if (o.name.startsWith('Nozzle_')) nozzles.push(o);
    });
    for (const nozzle of nozzles) {
      const box = new THREE.Box3().setFromObject(nozzle);
      const center = box.getCenter(new THREE.Vector3());
      const geo = new THREE.ConeGeometry(0.12, 2.4, 16, 1, true);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, 0, -1.2);
      // remap uv.y so 1 = nozzle mouth, 0 = flame tip
      const uv = geo.getAttribute('uv');
      const pos = geo.getAttribute('position');
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 + pos.getZ(i) / 2.4);
      const mat = plumeMaterial(0x7cc8ff);
      const plume = new THREE.Mesh(geo, mat);
      plume.position.set(center.x, center.y, box.min.z + 0.02);
      plume.renderOrder = 3;
      this.body.add(plume);
      this.rearPlumes.push(mat);
      this.rearPlumeMeshes.push(plume);
    }

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
      const glass = new THREE.MeshPhysicalMaterial({
        color: 0x05080d,
        metalness: 0.1,
        roughness: 0.04,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        envMapIntensity: 1.6,
      });
      return glass;
    }
    if (name === 'LightFront') this.lightFront.push(m);
    if (name === 'LightRear') this.lightRear.push(m);
    if (name === 'WheelGlow' || name === 'Accent') this.wheelGlow.push(m);
    if (name === 'ThrusterGlow') this.thrusterGlow.push(m);
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

  update(dt: number, s: CarVisualState, groundY: number) {
    this.time += dt;
    for (const w of this.wheels) {
      w.spin.rotation.x += (s.speed / 0.36) * dt * (1 - s.hover * 0.7);
      w.pivot.rotation.set(0, w.front ? -s.steer * 0.42 * (1 - s.hover) : 0, w.side * s.hover * (Math.PI / 2));
      w.pivot.position.y = w.restY + s.hover * 0.06;
    }
    for (const f of this.fanGlows) {
      const mat = f.material as THREE.MeshBasicMaterial;
      mat.opacity = s.hover * (0.35 + s.thrust * 0.65) * (0.9 + Math.sin(this.time * 40) * 0.1);
      f.scale.setScalar(0.8 + s.thrust * 0.5);
    }
    for (const m of this.wheelGlow) m.emissiveIntensity = 2 + s.hover * 3 + s.thrust * 4;
    for (const m of this.thrusterGlow) m.emissiveIntensity = 1.5 + s.boost * 10 + s.thrust * 3;
    for (const m of this.lightRear) m.emissiveIntensity = s.brake ? 12 : 5;
    for (const m of this.lightFront) m.emissiveIntensity = 5 + s.night * 3;
    const rearPower = Math.max(s.boost, s.thrust * 0.35);
    for (const m of this.rearPlumes) {
      m.uniforms.uPower.value = rearPower;
      m.uniforms.uTime.value = this.time;
    }
    for (const p of this.rearPlumeMeshes) {
      p.visible = rearPower > 0.01;
      p.scale.set(1, 1, 0.3 + rearPower * (0.9 + Math.random() * 0.2));
    }
    this.headlight.intensity = s.night * 60;

    const alt = Math.max(0, this.root.position.y - groundY);
    this.shadow.position.set(this.root.position.x, groundY + 0.06, this.root.position.z);
    this.shadow.rotation.z = this.root.rotation.y;
    const sm = this.shadow.material as THREE.MeshBasicMaterial;
    sm.opacity = THREE.MathUtils.clamp(1 - alt / 30, 0.15, 1);
    this.shadow.scale.setScalar(1 + alt * 0.03);
  }
}
