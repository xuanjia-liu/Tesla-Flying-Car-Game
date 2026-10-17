import * as THREE from 'three';
import { PALETTE } from './types';

export interface ThrusterFlash {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
}

const PAINT = 0xe6e8ec;

export class CarModel {
  group = new THREE.Group();
  bodyPivot = new THREE.Group();
  wheels: THREE.Mesh[] = [];
  private steerPivots: THREE.Group[] = [];
  private thrusterFlashes: ThrusterFlash[] = [];
  private nozzleRings: THREE.MeshStandardMaterial[] = [];
  private tailMat: THREE.MeshStandardMaterial;
  private headMat: THREE.MeshStandardMaterial;
  private bodyGroup = new THREE.Group();

  constructor() {
    const pivot = this.bodyPivot;
    this.group.add(pivot);
    pivot.add(this.bodyGroup);

    const paint = new THREE.MeshStandardMaterial({
      color: PAINT,
      metalness: 0.6,
      roughness: 0.22,
    });
    const dark = new THREE.MeshStandardMaterial({ color: PALETTE.bodyDark, metalness: 0.4, roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x0b0e14,
      metalness: 0.9,
      roughness: 0.08,
    });
    const tail = new THREE.MeshStandardMaterial({
      color: PALETTE.tailBar,
      emissive: PALETTE.tailBar,
      emissiveIntensity: 1.4,
    });
    const head = new THREE.MeshStandardMaterial({
      color: 0xf4f8ff,
      emissive: 0xf4f8ff,
      emissiveIntensity: 1.5,
    });
    this.tailMat = tail;
    this.headMat = head;

    // ---- smooth lofted wedge body: side profile extruded across the width ----
    const profile = new THREE.Shape();
    profile.moveTo(-2.3, 0.32);
    profile.lineTo(2.3, 0.32);
    profile.lineTo(2.42, 0.5);
    profile.lineTo(1.15, 0.74);
    profile.lineTo(0.3, 1.1);
    profile.lineTo(-1.25, 1.14);
    profile.lineTo(-2.1, 0.86);
    profile.lineTo(-2.32, 0.66);
    profile.closePath();

    const bodyGeo = new THREE.ExtrudeGeometry(profile, {
      depth: 1.62,
      bevelEnabled: true,
      bevelThickness: 0.14,
      bevelSize: 0.13,
      bevelSegments: 4,
      steps: 1,
    });
    bodyGeo.translate(0, 0, -0.81);
    const body = new THREE.Mesh(bodyGeo, paint);
    body.rotation.y = -Math.PI / 2; // extrusion depth becomes car width; profile x becomes forward
    body.scale.z = 1.12; // widen to full track
    this.bodyGroup.add(body);

    // ---- dark tinted canopy, rounded ----
    const canopyShape = new THREE.Shape();
    canopyShape.moveTo(-1.05, 0);
    canopyShape.lineTo(0.9, 0);
    canopyShape.lineTo(0.5, 0.42);
    canopyShape.lineTo(-0.75, 0.44);
    canopyShape.closePath();
    const canopyGeo = new THREE.ExtrudeGeometry(canopyShape, {
      depth: 1.1,
      bevelEnabled: true,
      bevelThickness: 0.1,
      bevelSize: 0.1,
      bevelSegments: 3,
      steps: 1,
    });
    canopyGeo.translate(0, 0, -0.55);
    const canopy = new THREE.Mesh(canopyGeo, glass);
    canopy.rotation.y = -Math.PI / 2;
    canopy.scale.z = 1.2;
    canopy.position.set(0, 1.08, -0.2);
    this.bodyGroup.add(canopy);

    // ---- full-width glowing light bars: the car's signature ----
    const headBar = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.06, 0.07), head);
    headBar.position.set(0, 0.52, 2.4);
    this.bodyGroup.add(headBar);
    const headGlow = new THREE.PointLight(0xf4f8ff, 1.2, 14);
    headGlow.position.set(0, 0.55, 2.9);
    this.bodyGroup.add(headGlow);

    const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.07, 0.07), tail);
    tailBar.position.set(0, 0.68, -2.32);
    this.bodyGroup.add(tailBar);
    const tailGlow = new THREE.PointLight(0xff2035, 0.9, 7);
    tailGlow.position.set(0, 0.7, -2.7);
    this.bodyGroup.add(tailGlow);

    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.26, 0.24), dark);
    diffuser.position.set(0, 0.34, -2.28);
    this.bodyGroup.add(diffuser);

    // ---- wheels tucked into the body ----
    // cylinder's natural axis is Y; bake a Z-rotation into the geometry so the
    // axle lies along X. Then roll = rotation.x, steer = pivot rotation.y.
    const tireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 22);
    tireGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.85 });
    const coverGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.28, 6);
    coverGeo.rotateZ(Math.PI / 2);
    const coverMat = new THREE.MeshStandardMaterial({ color: 0x3a3e46, metalness: 0.7, roughness: 0.35 });
    const wheelPos: [number, number, number][] = [
      [-0.86, 0.34, 1.5],
      [0.86, 0.34, 1.5],
      [-0.86, 0.34, -1.5],
      [0.86, 0.34, -1.5],
    ];
    for (const [x, y, z] of wheelPos) {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      const wheel = new THREE.Mesh(tireGeo, tireMat);
      const cover = new THREE.Mesh(coverGeo, coverMat);
      wheel.add(cover);
      pivot.add(wheel);
      this.wheels.push(wheel);
      this.steerPivots.push(pivot);
    }

    // ---- underside nozzle rings: glow blue-white when firing ----
    const ringGeo = new THREE.TorusGeometry(0.15, 0.05, 10, 20);
    const nozzlePos: [number, number][] = [
      [-0.68, 1.1],
      [0.68, 1.1],
      [-0.68, -1.1],
      [0.68, -1.1],
    ];
    for (const [x, z] of nozzlePos) {
      const ringMat = new THREE.MeshStandardMaterial({
        color: 0x181b20,
        metalness: 0.85,
        roughness: 0.35,
        emissive: 0xcfe6ff,
        emissiveIntensity: 0.15,
      });
      this.nozzleRings.push(ringMat);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, 0.16, z);
      pivot.add(ring);
    }

    // rear plume anchors (for the boost stretch and hover vapor)
    for (const x of [-0.68, 0.68]) {
      const nz = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.13, 0.3, 12),
        new THREE.MeshStandardMaterial({ color: 0x181b20, metalness: 0.9, roughness: 0.3 })
      );
      nz.rotation.x = Math.PI / 2;
      nz.position.set(x, 0.4, -2.35);
      pivot.add(nz);
      this.addFlash(nz, -0.26);
    }

    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
  }

  private addFlash(anchor: THREE.Mesh, zOffset: number) {
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xd8ecff, transparent: true, opacity: 0 })
    );
    flash.position.z = zOffset;
    anchor.add(flash);
    const light = new THREE.PointLight(0xbfdcff, 0, 8);
    light.position.z = zOffset * 1.5;
    anchor.add(light);
    this.thrusterFlashes.push({ mesh: flash, light });
  }

  setThrusterPower(power: number) {
    for (const f of this.thrusterFlashes) {
      const mat = f.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.min(1, power) * 0.95;
      f.light.intensity = power * 16;
      f.mesh.scale.setScalar(0.5 + power * 1.8);
    }
    for (const m of this.nozzleRings) m.emissiveIntensity = 0.15 + power * 1.6;
  }

  setTailBrake(on: boolean) {
    this.tailMat.emissiveIntensity = on ? 2.4 : 1.4;
  }

  setVisible(v: boolean) {
    this.bodyGroup.visible = v;
  }

  spinWheels(delta: number, speed: number) {
    const rot = (speed / 0.36) * delta;
    for (const w of this.wheels) w.rotation.x += rot;
  }

  setSteerVisual(steer: number) {
    // front-wheel pivots yaw; the rolling mesh inside is unaffected
    for (const p of this.steerPivots.slice(0, 2)) {
      p.rotation.y = steer * 0.45;
    }
  }
}
