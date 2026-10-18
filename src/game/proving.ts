import * as THREE from 'three';

interface Checkpoint {
  z: number;
  bonus: number;
  passed: boolean;
  finish: boolean;
}
interface Obstacle {
  box: THREE.Box3;
  kind: 'barrier';
}
interface BoostPad {
  x: number;
  z: number;
  halfW: number;
  halfL: number;
}

export interface Zone {
  z: number;
  text: string;
}

export interface Dynamics {
  courseLength: number;
  update(dt: number, pos: THREE.Vector3, speed: number): void;
  /** Highest drivable surface at or just below fromY, or null if there is nothing to land on. */
  support(x: number, z: number, fromY: number): number | null;
  /** World delta to add when the car is standing on a moving deck. */
  carry(x: number, z: number, fromY: number): THREE.Vector3 | null;
  wind(z: number): number;
  lowG(z: number): boolean;
}

export interface Proving {
  group: THREE.Group;
  rings: THREE.Vector3[];
  checkpoints: Checkpoint[];
  obstacles: Obstacle[];
  pads: BoostPad[];
  zones: Zone[];
  dynamics: Dynamics;
}

const ROAD_W = 28;

export function buildProving(): Proving {
  const group = new THREE.Group();
  const rings: THREE.Vector3[] = [];
  const checkpoints: Checkpoint[] = [];
  const obstacles: Obstacle[] = [];
  const pads: BoostPad[] = [];
  const zones: Zone[] = [];
  const LEN = 1760;

  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, LEN + 400),
    new THREE.MeshStandardMaterial({ color: 0xd6a26b, roughness: 1 })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, -0.08, LEN / 2);
  sand.receiveShadow = true;
  group.add(sand);

  const asphalt = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.86, metalness: 0.04 });
  const paintMat = new THREE.MeshBasicMaterial({ color: 0x9ff6ff });
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.6 });
  const layRoad = (z0: number, z1: number, y = 0) => {
    const len = z1 - z0;
    if (len < 1) return;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, len), asphalt);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, y, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    group.add(mesh);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.16, len), paintMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, y + 0.03, (z0 + z1) / 2);
    group.add(line);
    for (const s of [-1, 1]) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, len), curbMat);
      curb.position.set(s * (ROAD_W / 2), y + 0.08, (z0 + z1) / 2);
      group.add(curb);
    }
  };
  const slopeDeck = (z0: number, z1: number, y0: number, y1: number) => {
    const run = z1 - z0;
    const len = Math.hypot(run, y1 - y0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W, 0.3, len), asphalt);
    mesh.rotation.x = -Math.atan2(y1 - y0, run);
    mesh.position.set(0, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
  };
  const pit = (z0: number, z1: number, y: number, color: number) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(64, Math.max(1, z1 - z0)),
      new THREE.MeshStandardMaterial({ color, roughness: 1 })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, y, (z0 + z1) / 2);
    group.add(mesh);
  };

  // mesas
  const mesaMat = new THREE.MeshStandardMaterial({ color: 0xc47848, roughness: 1, flatShading: true });
  const mesaGeo = new THREE.CylinderGeometry(1, 1.15, 1, 6);
  const mesas: THREE.Matrix4[] = [];
  for (let i = 0; i < 18; i++) {
    const side = i % 2 ? 1 : -1;
    const r = 28 + (i % 5) * 14;
    const h = 30 + (i % 4) * 18;
    mesas.push(new THREE.Matrix4().compose(
      new THREE.Vector3(side * (80 + (i % 3) * 30), h / 2 - 2, -40 + i * 100),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i),
      new THREE.Vector3(r, h, r * 0.75)
    ));
  }
  const mesaMesh = new THREE.InstancedMesh(mesaGeo, mesaMat, mesas.length);
  mesas.forEach((m, i) => mesaMesh.setMatrixAt(i, m));
  group.add(mesaMesh);

  const addBox = (x: number, y: number, z: number, w: number, h: number, d: number, color: number, obstacle = false) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    let box: THREE.Box3 | null = null;
    if (obstacle) {
      box = new THREE.Box3(
        new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
        new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2)
      );
      obstacles.push({ box, kind: 'barrier' });
    }
    return { mesh, box };
  };

  const sign = (text: string, z: number, color: string) => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(8,10,16,0.82)';
    g.fillRect(0, 0, 512, 128);
    g.strokeStyle = color;
    g.lineWidth = 8;
    g.strokeRect(6, 6, 500, 116);
    g.fillStyle = color;
    g.font = '700 64px Orbitron, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 68);
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    m.position.set(0, 4.2, z);
    group.add(m);
    zones.push({ z: z - 18, text });
  };

  const cp = (z: number, finish = false) => {
    checkpoints.push({ z, bonus: finish ? 0 : 8, passed: false, finish });
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(7, 0.18, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0x06202c, emissive: finish ? 0xff4ad8 : 0x7dffe1, emissiveIntensity: 1.6 })
    );
    arch.position.set(0, 4, z);
    group.add(arch);
  };

  const ring = (x: number, y: number, z: number) => rings.push(new THREE.Vector3(x, y, z));
  for (let z = 40; z < 120; z += 18) ring(0, 2.2, z);

  // 1. closing blast door — rear boost
  sign('BOOST THE DOOR', 150, '#ff4ad8');
  const door = addBox(0, 9, 188, 26, 16, 1.2, 0x241820, true);
  door.mesh.position.y = 14; // parked open above the road; dynamics lowers it
  if (door.box) door.box.translate(new THREE.Vector3(0, 20, 0));
  ring(0, 2.4, 170);

  // 2. grip chicane — side pods / downforce
  sign('GRIP THE CHICANE', 250, '#ffd27a');
  addBox(-2, 1.1, 290, 16, 2.2, 2.2, 0xf0c14a, true);
  addBox(2, 1.1, 325, 16, 2.2, 2.2, 0xf0c14a, true);
  addBox(-1, 1.1, 360, 14, 2.2, 2.2, 0xf0c14a, true);
  ring(-6, 2.2, 300);
  ring(6, 2.2, 340);

  // 3. sudden roadblock — front thrusters
  sign('BRAKE — GATE CLOSED', 430, '#ff5a7a');
  const block = addBox(0, 8, 490, 26, 16, 1.4, 0x3a1020, true);
  cp(410);
  ring(0, 2.2, 450);

  // 4. broken bridge — hop
  sign('HOP THE GAP', 540, '#9ff6ff');
  const bridge = { z0: 575, z1: 593 };
  ring(0, 3.2, 584);
  cp(545);

  // 5. cliff — fly the drop, cushion the landing
  sign('CLIFF — CUSHION IT', 650, '#9ff6ff');
  const cliff = { z0: 690, z1: 710 };
  const floor = { z0: 710, z1: 770, y: -8 };
  const recover = { z0: 770, z1: 812 };
  ring(0, -5.6, 744);
  cp(640);

  // 6. train — hop over
  sign('HOP THE TRAIN', 860, '#9ff6ff');
  const trainCars: { mesh: THREE.Mesh; box: THREE.Box3 }[] = [];
  for (let i = 0; i < 5; i++) {
    const car = addBox(-40 - i * 7, 0.75, 910, 2.4, 1.5, 6.2, i % 2 ? 0xd0d4dc : 0xb7c4d6, true);
    trainCars.push({ mesh: car.mesh, box: car.box! });
  }
  ring(0, 3.4, 910);
  cp(840);

  // 7. river — hold hover
  sign('HOVER THE RIVER', 990, '#9ff6ff');
  const river = { z0: 1040, z1: 1078 };
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 48),
    new THREE.MeshStandardMaterial({ color: 0x1d6a8a, roughness: 0.15, metalness: 0.45, emissive: 0x083040, emissiveIntensity: 0.4 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -1.2, 1059);
  group.add(water);
  ring(0, 3.6, 1059);
  cp(980);

  // 8. short landing pad — front brake in the air
  sign('BRAKE ONTO THE PAD', 1140, '#ff5a7a');
  const lip = { z0: 1188, z1: 1204, h: 6 };
  const pad = { z0: 1216, z1: 1234, y: 4.2 };
  const padMesh = addBox(0, 2.1, 1225, 8, 4.2, 18, 0x243044);
  padMesh.mesh.material = new THREE.MeshStandardMaterial({ color: 0x9ff6ff, emissive: 0x1fb8ff, emissiveIntensity: 0.8, roughness: 0.35 });
  const drop = { z0: 1234, z1: 1262 };
  ring(0, 6.2, 1231);
  cp(1130);

  // 9. rooftops — hop up
  sign('HOP THE ROOFS', 1320, '#9ff6ff');
  const roofs = [
    { x: 0, z: 1360, y: 1.6, w: 10, d: 12 },
    { x: 0, z: 1384, y: 3.2, w: 9, d: 10 },
    { x: 0, z: 1406, y: 2.2, w: 10, d: 12 },
  ];
  for (const r of roofs) {
    addBox(r.x, r.y / 2, r.z, r.w, r.y, r.d, 0x8d6a4a);
    ring(r.x, r.y + 2.2, r.z);
  }
  cp(1305);

  // 10. canyon slalom — lateral thrust in the air
  sign('SLALOM — STEER IN THE AIR', 1460, '#c8b6ff');
  const slalom: { z: number; x: number }[] = [
    { z: 1500, x: -6 },
    { z: 1530, x: 6 },
    { z: 1560, x: -5 },
    { z: 1590, x: 5 },
  ];
  for (const s of slalom) {
    addBox(s.x, 1.2, s.z, 14, 2.4, 1.6, 0x6a5ac4, true);
    addBox(0, 0.7, s.z - 12, 8, 1.4, 8, 0x3a4048);
    ring(s.x > 0 ? -4 : 4, 3.2, s.z - 6);
  }
  cp(1450);

  // 11. wind — counter with steering / side pods
  sign('WIND — HOLD YOUR LINE', 1640, '#c8b6ff');
  const wind = { z0: 1675, z1: 1760 };
  for (let z = wind.z0; z < wind.z1; z += 16) {
    const vane = addBox(-16, 2, z, 0.4, 4, 6, 0xd0fff8);
    vane.mesh.rotation.y = 0.5;
  }
  ring(0, 2.4, 1710);
  cp(1630);

  // 12. low-g bounce
  sign('LOW GRAVITY', 1805, '#ffe08a');
  pads.push({ x: 0, z: 1848, halfW: 6, halfL: 6 });
  const padVis = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffb020, emissiveIntensity: 1.4, roughness: 0.4 })
  );
  padVis.rotation.x = -Math.PI / 2;
  padVis.position.set(0, 0.05, 1848);
  group.add(padVis);
  const lowG = { z0: 1840, z1: 1930 };
  ring(0, 6, 1875);
  cp(1795);

  // 13. collapsing road — boost across
  sign('BOOST — FLOOR IS GOING', 1960, '#ff4ad8');
  const tiles: { z: number; mesh: THREE.Mesh; born: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const z = 2008 + i * 9;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(ROAD_W - 2, 0.35, 8),
      new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.8 })
    );
    mesh.position.set(0, 0.15, z);
    group.add(mesh);
    tiles.push({ z, mesh, born: -1 });
    if (i % 2 === 0) ring(0, 2.4, z);
  }
  cp(1950);

  // 14. moving ferry — hop on
  sign('HOP THE FERRY', 2100, '#9ff6ff');
  const ferryGap = { z0: 2140, z1: 2230 };
  const ferry = addBox(0, 0.5, 2148, 10, 1, 16, 0x205060);
  ferry.mesh.material = new THREE.MeshStandardMaterial({ color: 0x9fd0e0, roughness: 0.45, metalness: 0.2 });
  ring(0, 2.8, 2180);
  cp(2090);

  cp(2280, true);
  sign('FINISH', 2262, '#ff4ad8');

  layRoad(0, bridge.z0);
  pit(bridge.z0, bridge.z1, -6, 0x2a1c14);
  layRoad(bridge.z1, cliff.z0);
  pit(cliff.z0, floor.z0, -16, 0x1a120e);
  layRoad(floor.z0, floor.z1, floor.y);
  slopeDeck(recover.z0, recover.z1, floor.y, 0);
  layRoad(recover.z1, river.z0);
  layRoad(river.z1, lip.z0);
  slopeDeck(lip.z0, lip.z1, 0, lip.h);
  pit(lip.z1, pad.z0, -4, 0x141820);
  slopeDeck(drop.z0, drop.z1, pad.y, 0);
  layRoad(drop.z1, 2004);
  pit(2004, 2070, -5, 0x241810);
  layRoad(2070, ferryGap.z0);
  pit(ferryGap.z0, ferryGap.z1, -3, 0x0e242c);
  layRoad(ferryGap.z1, LEN);

  let doorT = 0; // 0 open (up), 1 closed
  let doorArmed = false;
  let blockT = 0; // 0 closed, 1 open
  let blockSlow = 0;
  let trainX = -36;
  let ferryZ = 2152;
  let ferryV = 16;
  const ferryDelta = new THREE.Vector3();

  const dynamics: Dynamics = {
    courseLength: 2300,
    update(dt, pos, speed) {
      ferryDelta.set(0, 0, ferryV);
      // closing door
      if (!doorArmed && pos.z > 120 && pos.z < 188) doorArmed = true;
      if (doorArmed && pos.z < 188) doorT = Math.min(1, doorT + dt / 1.7);
      const doorY = THREE.MathUtils.lerp(18, 8, doorT);
      door.mesh.position.y = doorY;
      if (door.box) {
        door.box.min.set(-13, doorY - 8, 188 - 0.6);
        door.box.max.set(13, doorY + 8, 188 + 0.6);
        if (doorT < 0.35) {
          door.box.min.y = 40;
          door.box.max.y = 41;
        }
      }
      // brake gate
      if (pos.z > 455 && pos.z < 488 && speed < 9) blockSlow += dt;
      else blockSlow = Math.max(0, blockSlow - dt);
      if (blockSlow > 0.28) blockT = Math.min(1, blockT + dt * 0.7);
      const blockY = THREE.MathUtils.lerp(8, 20, blockT);
      block.mesh.position.y = blockY;
      if (block.box) {
        block.box.min.set(-13, blockY - 8, 490 - 0.7);
        block.box.max.set(13, blockY + 8, 490 + 0.7);
        if (blockT > 0.75) {
          block.box.min.y = 40;
          block.box.max.y = 41;
        }
      }
      // train
      trainX += dt * 14;
      if (trainX > 48) trainX = -48;
      trainCars.forEach((car, i) => {
        const x = trainX - i * 7;
        car.mesh.position.x = x;
        car.box.min.set(x - 1.2, 0, 910 - 3.1);
        car.box.max.set(x + 1.2, 1.5, 910 + 3.1);
      });
      // tiles
      for (const tile of tiles) {
        const on = Math.abs(pos.x) < ROAD_W / 2 && Math.abs(pos.z - tile.z) < 4.2 && pos.y < 1.2;
        if (on && tile.born < 0) tile.born = 0;
        if (tile.born >= 0) {
          tile.born += dt;
          if (tile.born > 0.62) tile.mesh.position.y = Math.max(-12, tile.mesh.position.y - dt * 10);
        }
      }
      // ferry
      ferryZ += ferryV * dt;
      if (ferryZ > 2216) ferryV = -Math.abs(ferryV);
      if (ferryZ < 2152) ferryV = Math.abs(ferryV);
      ferry.mesh.position.z = ferryZ;
      ferryDelta.set(0, 0, ferryV);
    },
    support(x, z, fromY) {
      const inRoad = Math.abs(x) < ROAD_W / 2 + 1;
      const consider = (h: number, ok: boolean) => (ok && h <= fromY + 0.45 ? h : null);
      let best: number | null = null;
      const take = (h: number | null) => {
        if (h != null && (best == null || h > best)) best = h;
      };
      // gaps where the asphalt is gone
      const voided =
        (z > bridge.z0 && z < bridge.z1) ||
        (z > cliff.z0 && z < floor.z0) ||
        (z > river.z0 && z < river.z1) ||
        (z > lip.z1 && z < pad.z0) ||
        (z > ferryGap.z0 && z < ferryGap.z1) ||
        tiles.some((tile) => Math.abs(z - tile.z) < 4.2 && tile.born > 0.62);
      if (inRoad && !voided) {
        let h = 0;
        if (z >= floor.z0 && z <= floor.z1) h = floor.y;
        else if (z >= recover.z0 && z <= recover.z1) h = floor.y * (1 - (z - recover.z0) / (recover.z1 - recover.z0));
        else if (z >= lip.z0 && z <= lip.z1) h = lip.h * ((z - lip.z0) / (lip.z1 - lip.z0));
        else if (z >= drop.z0 && z <= drop.z1) h = pad.y * (1 - (z - drop.z0) / (drop.z1 - drop.z0));
        else if (z >= 1488 && z <= 1600) {
          // little ramps before each slalom gate
          for (const s of slalom) {
            const rz0 = s.z - 16;
            const rz1 = s.z - 8;
            if (z >= rz0 && z <= rz1) h = Math.max(h, 1.6 * ((z - rz0) / (rz1 - rz0)));
          }
        }
        take(consider(h, true));
      }
      if (z >= pad.z0 && z <= pad.z1 && Math.abs(x) < 4) take(consider(pad.y, true));
      for (const r of roofs) {
        if (Math.abs(x - r.x) < r.w / 2 && Math.abs(z - r.z) < r.d / 2) take(consider(r.y, true));
      }
      if (Math.abs(x) < 5 && Math.abs(z - ferryZ) < 8) take(consider(1.05, true));
      return best;
    },
    carry(x, z, fromY) {
      if (Math.abs(x) < 5 && Math.abs(z - ferryZ) < 8 && fromY < 2.2) return ferryDelta;
      return null;
    },
    wind(z) {
      return z > wind.z0 && z < wind.z1 ? 16 : 0;
    },
    lowG(z) {
      return z > lowG.z0 && z < lowG.z1;
    },
  };

  return { group, rings, checkpoints, obstacles, pads, zones, dynamics };
}
