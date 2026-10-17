import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { STAGE_LENGTH } from './types';

export interface StageLook {
  sunElevation: number;
  sunAzimuth: number;
  turbidity: number;
  rayleigh: number;
  mie: number;
  mieG: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  sun: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  exposure: number;
  night: number;
  envIntensity: number;
  clouds: number;
}

export const LOOKS: StageLook[] = [
  {
    // desert dawn: low warm sun ahead-right
    sunElevation: 9, sunAzimuth: 118, turbidity: 6, rayleigh: 1.6, mie: 0.006, mieG: 0.86,
    fog: 0xe8b98a, fogNear: 120, fogFar: 900,
    sun: 0xffc48a, sunIntensity: 3.2, hemiSky: 0xffd8b0, hemiGround: 0x8a5a36, hemiIntensity: 1.1,
    exposure: 0.62, night: 0, envIntensity: 1, clouds: 0.3,
  },
  {
    // coastal sunset: sun on the horizon, pink-violet sky
    sunElevation: 1.5, sunAzimuth: -72, turbidity: 9, rayleigh: 3.2, mie: 0.012, mieG: 0.9,
    fog: 0xc9768a, fogNear: 110, fogFar: 820,
    sun: 0xff8a5a, sunIntensity: 2.4, hemiSky: 0xf0a0c0, hemiGround: 0x3a3060, hemiIntensity: 1.0,
    exposure: 0.75, night: 0.25, envIntensity: 0.9, clouds: 0.5,
  },
  {
    // neon night: moonlight + city glow
    sunElevation: -9, sunAzimuth: -40, turbidity: 2, rayleigh: 0.4, mie: 0.002, mieG: 0.7,
    fog: 0x120c2a, fogNear: 70, fogFar: 620,
    sun: 0x8aa0ff, sunIntensity: 0.9, hemiSky: 0x4a3a8a, hemiGround: 0x101018, hemiIntensity: 0.8,
    exposure: 0.95, night: 1, envIntensity: 1, clouds: 0.15,
  },
];

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

function lerpHex(a: number, b: number, t: number) {
  return _c1.setHex(a).lerp(_c2.setHex(b), t).getHex();
}

export function blendLook(a: StageLook, b: StageLook, t: number): StageLook {
  const out = { ...a };
  for (const k of Object.keys(a) as (keyof StageLook)[]) {
    if (['fog', 'sun', 'hemiSky', 'hemiGround'].includes(k)) out[k] = lerpHex(a[k], b[k], t);
    else out[k] = a[k] + (b[k] - a[k]) * t;
  }
  return out;
}

/** Look at a course position, blending across stage boundaries. */
export function lookAt(z: number): { look: StageLook; stage: number; envStage: number } {
  const blendStart = -90;
  const blendEnd = 30;
  for (let i = 0; i < LOOKS.length - 1; i++) {
    const boundary = STAGE_LENGTH * (i + 1);
    if (z < boundary + blendStart) return { look: LOOKS[i], stage: i, envStage: i };
    if (z < boundary + blendEnd) {
      const t = THREE.MathUtils.smoothstep(z, boundary + blendStart, boundary + blendEnd);
      return { look: blendLook(LOOKS[i], LOOKS[i + 1], t), stage: z < boundary ? i : i + 1, envStage: t < 0.5 ? i : i + 1 };
    }
  }
  return { look: LOOKS[LOOKS.length - 1], stage: LOOKS.length - 1, envStage: LOOKS.length - 1 };
}

export class Environment {
  sky = new Sky();
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  private stars: THREE.Points;
  private envMaps: THREE.Texture[] = [];
  private currentEnv = -1;
  private sunDir = new THREE.Vector3();

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {
    this.sky.scale.setScalar(4000);
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.shadow.camera.left = -45;
    this.sun.shadow.camera.right = 45;
    this.sun.shadow.camera.top = 45;
    this.sun.shadow.camera.bottom = -45;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);

    const starGeo = new THREE.BufferGeometry();
    const n = 1400;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(Math.random() * 0.95);
      p[i * 3] = Math.sin(v) * Math.cos(u) * 3000;
      p[i * 3 + 1] = Math.cos(v) * 3000;
      p[i * 3 + 2] = Math.sin(v) * Math.sin(u) * 3000;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false })
    );
    scene.add(this.stars);

    scene.fog = new THREE.Fog(0xffffff, 100, 800);
    this.bakeEnvMaps();
  }

  private bakeEnvMaps() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    for (let i = 0; i < LOOKS.length; i++) {
      const s = new THREE.Scene();
      const sky = new Sky();
      sky.scale.setScalar(1000);
      this.applySky(sky, LOOKS[i]);
      s.add(sky);
      if (LOOKS[i].night > 0.5) {
        // neon city reflections: coloured light panels around the car
        const colors = [0xff2fd0, 0x2fe0ff, 0xff8a30, 0x6a5bff];
        for (let k = 0; k < 10; k++) {
          const panel = new THREE.Mesh(
            new THREE.PlaneGeometry(60 + Math.random() * 80, 20 + Math.random() * 30),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(colors[k % colors.length]).multiplyScalar(2.5), side: THREE.DoubleSide })
          );
          const a = (k / 10) * Math.PI * 2;
          panel.position.set(Math.cos(a) * 300, 30 + Math.random() * 60, Math.sin(a) * 300);
          panel.lookAt(0, 30, 0);
          s.add(panel);
        }
        const street = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshBasicMaterial({ color: 0x0b0a18 }));
        street.rotation.x = -Math.PI / 2;
        street.position.y = -5;
        s.add(street);
      } else {
        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(4000, 4000),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(LOOKS[i].hemiGround).multiplyScalar(0.6) })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -5;
        s.add(ground);
      }
      this.envMaps.push(pmrem.fromScene(s, 0.02).texture);
    }
    pmrem.dispose();
  }

  private applySky(sky: Sky, look: StageLook) {
    const u = sky.material.uniforms;
    u.turbidity.value = look.turbidity;
    u.rayleigh.value = look.rayleigh;
    u.mieCoefficient.value = look.mie;
    u.mieDirectionalG.value = look.mieG;
    u.cloudCoverage.value = look.clouds;
    const phi = THREE.MathUtils.degToRad(90 - look.sunElevation);
    const theta = THREE.MathUtils.degToRad(look.sunAzimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
  }

  setShadows(enabled: boolean, mapSize: number) {
    this.sun.castShadow = enabled;
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  update(z: number, focus: THREE.Vector3, camera: THREE.Camera, time: number) {
    const { look, envStage } = lookAt(z);
    this.applySky(this.sky, look);
    this.sky.material.uniforms.time.value = time;
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    (this.stars.material as THREE.PointsMaterial).opacity = THREE.MathUtils.smoothstep(look.night, 0.4, 1);

    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(look.fog);
    fog.near = look.fogNear;
    fog.far = look.fogFar;

    // keep the light coming from the sun direction, but never from below the horizon
    const lightDir = this.sunDir.clone();
    if (look.night > 0.5) lightDir.set(-0.4, 0.8, 0.45).normalize();
    lightDir.y = Math.max(lightDir.y, 0.28);
    lightDir.normalize();
    this.sun.position.copy(focus).addScaledVector(lightDir, 120);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    this.sun.color.setHex(look.sun);
    this.sun.intensity = look.sunIntensity;
    this.hemi.color.setHex(look.hemiSky);
    this.hemi.groundColor.setHex(look.hemiGround);
    this.hemi.intensity = look.hemiIntensity;
    this.renderer.toneMappingExposure = look.exposure;

    if (envStage !== this.currentEnv) {
      this.currentEnv = envStage;
      this.scene.environment = this.envMaps[envStage];
    }
    this.scene.environmentIntensity = look.envIntensity;
    return look;
  }
}
