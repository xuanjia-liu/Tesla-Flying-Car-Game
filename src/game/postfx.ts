import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSpeed: { value: 0 },
    uFlash: { value: 0 },
    uAspect: { value: 1 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSpeed;
    uniform float uFlash;
    uniform float uAspect;
    uniform float uTime;
    varying vec2 vUv;

    float hash(float n) { return fract(sin(n) * 43758.5453); }

    void main() {
      vec2 c = (vUv - 0.5) * vec2(uAspect, 1.0);
      float r = length(c);
      // subtle chromatic offset that grows with speed
      vec2 dir = normalize(c + 1e-5);
      float ca = 0.0015 + uSpeed * 0.004;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + dir * ca * r).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - dir * ca * r).b;

      // streaking speed lines at the edges
      if (uSpeed > 0.01) {
        float ang = atan(c.y, c.x);
        float lane = floor((ang / 6.2831 + 0.5) * 90.0);
        float h = hash(lane * 1.7 + floor(uTime * 14.0 + hash(lane) * 10.0));
        float line = step(0.82, h) * smoothstep(0.32, 0.85, r);
        col += vec3(0.85, 0.92, 1.0) * line * uSpeed * 0.35;
      }

      float vig = smoothstep(1.05, 0.35, r);
      col *= mix(0.62, 1.0, vig);
      col = mix(col, vec3(1.0, 0.12, 0.15), smoothstep(0.25, 0.85, r) * uFlash * 0.6);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private final: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.5, 0.45, 2.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.setSize(w, h);
  }

  setBloom(enabled: boolean) {
    this.bloom.enabled = enabled;
  }

  update(speed: number, flash: number, aspect: number, time: number, bloomStrength: number) {
    const u = this.final.uniforms;
    u.uSpeed.value = speed;
    u.uFlash.value = flash;
    u.uAspect.value = aspect;
    u.uTime.value = time;
    this.bloom.strength = bloomStrength;
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
  }

  render() {
    this.composer.render();
  }
}
