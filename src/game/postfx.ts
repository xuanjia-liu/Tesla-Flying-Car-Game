import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const SpeedVignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSpeed01: { value: 0 },
    uRedFlash: { value: 0 },
    uAspect: { value: 1 },
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
    uniform float uSpeed01;
    uniform float uRedFlash;
    uniform float uAspect;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      vec2 centered = (uv - 0.5) * vec2(uAspect, 1.0);
      float r = length(centered);

      vec4 col = texture2D(tDiffuse, uv);

      // radial speed lines on boost
      if (uSpeed01 > 0.02) {
        float strength = (uSpeed01 - 0.02) * 1.1;
        vec2 dir = normalize(centered + vec2(1e-4));
        float ang = atan(centered.y, centered.x);
        float lane = floor((ang / 6.2831 + 0.5) * 36.0);
        float gate = step(0.72, hash(vec2(lane, 7.0)));
        float line = 0.0;
        for (int i = 1; i <= 4; i++) {
          float t = float(i) * 0.014 * (0.7 + strength * 0.8);
          line += texture2D(tDiffuse, uv - dir * t).g * 0.22;
        }
        col.rgb += vec3(0.9, 0.95, 1.0) * line * gate * strength * smoothstep(0.22, 0.7, r);
      }

      // light vignette
      float vig = smoothstep(0.98, 0.35, r);
      col.rgb *= mix(0.74, 1.0, vig);

      // red screen-edge flash on crash
      float edge = smoothstep(0.3, 0.78, r);
      col.rgb = mix(col.rgb, vec3(0.95, 0.1, 0.1), edge * uRedFlash * 0.55);

      gl_FragColor = col;
    }
  `,
};

export class PostFX {
  composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private speedPass: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.22, 0.4, 1.05);
    this.composer.addPass(this.bloom);

    this.speedPass = new ShaderPass(SpeedVignetteShader);
    this.composer.addPass(this.speedPass);

    this.composer.addPass(new OutputPass());
    this.composer.setSize(width, height);
  }

  update(speed01: number, redFlash: number, aspect: number) {
    this.speedPass.uniforms.uSpeed01.value = speed01;
    this.speedPass.uniforms.uRedFlash.value = redFlash;
    this.speedPass.uniforms.uAspect.value = aspect;
  }

  setSize(width: number, height: number) {
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
  }
}
