import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** One prop flattened into a single geometry, ready for InstancedMesh. Base sits at y=0, centered on x/z. */
export interface PropAsset {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  size: THREE.Vector3;
}

export interface Assets {
  car: THREE.Group;
  props: Map<string, PropAsset>;
}

const base = import.meta.env.BASE_URL;

function flatten(root: THREE.Object3D): PropAsset | null {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const geos: THREE.BufferGeometry[] = [];
  let material: THREE.Material | null = null;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = (o.geometry as THREE.BufferGeometry).clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    }
    // meshopt quantization leaves normalized integer attributes; merge needs plain floats
    for (const name of ['position', 'normal', 'uv']) {
      const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (a && !(a.array instanceof Float32Array)) {
        const f = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
        g.setAttribute(name, new THREE.BufferAttribute(f, a.itemSize));
      }
    }
    geos.push(g.index ? g.toNonIndexed() : g);
    material ??= Array.isArray(o.material) ? o.material[0] : o.material;
  });
  if (!geos.length || !material) return null;
  const geometry = mergeGeometries(geos, false);
  if (!geometry) return null;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const c = bb.getCenter(new THREE.Vector3());
  geometry.translate(-c.x, -bb.min.y, -c.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  return { geometry, material, size };
}

export async function loadAssets(onProgress?: (p: number) => void): Promise<Assets> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const progress = [0, 0];
  const report = () => onProgress?.((progress[0] + progress[1]) / 2);
  const load = (file: string, i: number) =>
    loader.loadAsync(`${base}models/${file}`, (e) => {
      if (e.total) progress[i] = e.loaded / e.total;
      report();
    });
  const [carGltf, propsGltf] = await Promise.all([load('roadster.glb', 0), load('props.glb', 1)]);

  const props = new Map<string, PropAsset>();
  for (const child of propsGltf.scene.children) {
    const asset = flatten(child);
    if (asset) props.set(child.name, asset);
  }
  for (const p of props.values()) {
    const m = p.material as THREE.MeshStandardMaterial;
    if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
    m.side = THREE.FrontSide;
  }
  return { car: carGltf.scene, props };
}
