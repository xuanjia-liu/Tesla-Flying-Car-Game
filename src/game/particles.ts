import * as THREE from 'three';

const vertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    gl_FragColor = vec4(vColor, a);
  }
`;

export interface EmitOptions {
  count: number;
  pos: THREE.Vector3;
  spread?: number;
  vel?: THREE.Vector3;
  velSpread?: number;
  life?: number;
  size?: number;
  grow?: number;
  color: THREE.ColorRepresentation;
  alpha?: number;
  gravity?: number;
  drag?: number;
  /** fraction of the life spent fading in (soft puffs instead of popping into view) */
  fadeIn?: number;
}

/** Fixed-size particle pool drawn in one call. */
export class ParticlePool {
  points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size0: Float32Array;
  private grow: Float32Array;
  private alpha0: Float32Array;
  private gravity: Float32Array;
  private drag: Float32Array;
  private fadeIn: Float32Array;
  private sizeAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;
  private posAttr: THREE.BufferAttribute;
  private cursor = 0;
  private material: THREE.ShaderMaterial;
  private tmpColor = new THREE.Color();

  constructor(n: number, additive: boolean) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n).fill(1);
    this.size0 = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.alpha0 = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.fadeIn = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setAttribute('aColor', this.colorAttr);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  setViewportHeight(h: number) {
    this.material.uniforms.uScale.value = h * 0.9;
  }

  emit(o: EmitOptions) {
    const spread = o.spread ?? 0.3;
    const vs = o.velSpread ?? 1;
    this.tmpColor.set(o.color);
    for (let k = 0; k < o.count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      const i3 = i * 3;
      this.pos[i3] = o.pos.x + (Math.random() - 0.5) * spread;
      this.pos[i3 + 1] = o.pos.y + (Math.random() - 0.5) * spread;
      this.pos[i3 + 2] = o.pos.z + (Math.random() - 0.5) * spread;
      this.vel[i3] = (o.vel?.x ?? 0) + (Math.random() - 0.5) * vs;
      this.vel[i3 + 1] = (o.vel?.y ?? 0) + (Math.random() - 0.5) * vs;
      this.vel[i3 + 2] = (o.vel?.z ?? 0) + (Math.random() - 0.5) * vs;
      const life = (o.life ?? 0.8) * (0.7 + Math.random() * 0.6);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.size0[i] = (o.size ?? 1) * (0.7 + Math.random() * 0.6);
      this.grow[i] = o.grow ?? 1;
      this.alpha0[i] = o.alpha ?? 1;
      this.gravity[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1;
      this.fadeIn[i] = o.fadeIn ?? 0;
      this.colorAttr.setXYZ(i, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
    }
    this.colorAttr.needsUpdate = true;
  }

  update(dt: number) {
    const sizes = this.sizeAttr.array as Float32Array;
    const alphas = this.alphaAttr.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        alphas[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const i3 = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d + this.gravity[i] * dt;
      this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      sizes[i] = this.size0[i] * (1 + (1 - t) * this.grow[i]);
      const f = this.fadeIn[i];
      alphas[i] = this.alpha0[i] * t * (f > 0 ? Math.min(1, (1 - t) / f) : 1);
    }
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  reset() {
    this.life.fill(0);
  }
}
