// Asset loading: glTF (meshopt compressed) + EXR environments.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { RNG, clamp } from './utils';

export interface ManifestEntry {
  name: string; file: string; bytes: number; tris?: number;
  bounds?: { min: number[]; max: number[]; size: number[] } | null;
  licence: string; author: string; lod: boolean; error?: string;
}
interface Manifest { models: ManifestEntry[]; hdr: { name: string; file: string; width: number; height: number }[] }

// Vite injects import.meta.env at build time; fall back for node tooling.
const BASE = String(((import.meta as any).env?.BASE_URL as string | undefined) ?? './').replace(/\/$/, '');

export class AssetLoader {
  manifest!: Manifest;
  private gltf = new GLTFLoader();
  private exr = new EXRLoader();
  private models = new Map<string, THREE.Group>();
  private lodModels = new Map<string, THREE.Group>();
  private hdri = new Map<string, THREE.DataTexture>();
  totalBytes = 0;
  loadedBytes = 0;

  constructor() {
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
    this.exr.setDataType(THREE.HalfFloatType);
  }

  async load(onProgress: (frac: number, label: string) => void) {
    const res = await fetch(`${BASE}/assets/asset-manifest.json`);
    if (!res.ok) throw new Error('asset-manifest.json missing — run `npm run assets:fetch && npm run assets:build`');
    this.manifest = await res.json();

    const jobs: { size: number; run: () => Promise<void>; label: string }[] = [];
    for (const m of this.manifest.models) {
      if (m.error || !m.file) continue;
      jobs.push({
        size: m.bytes, label: m.name,
        run: async () => {
          const g = await this.gltf.loadAsync(`${BASE}/${m.file}`);
          const root = g.scene;
          root.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh) {
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              mesh.frustumCulled = true;
            }
          });
          if (m.lod) this.lodModels.set(m.name, root);
          else this.models.set(m.name, root);
          if (!this.models.has(m.name) && m.lod) this.models.set(m.name, root);
        },
      });
    }
    for (const h of this.manifest.hdr) {
      jobs.push({
        size: 140_000, label: `env ${h.name}`,
        run: async () => {
          const tex = await this.exr.loadAsync(`${BASE}/${h.file}`);
          tex.mapping = THREE.EquirectangularReflectionMapping;
          this.hdri.set(h.name, tex);
        },
      });
    }

    this.totalBytes = jobs.reduce((s, j) => s + j.size, 0) || 1;
    // load in parallel, 4 at a time, keeping the boot screen responsive
    const queue = [...jobs];
    let done = 0;
    const worker = async () => {
      for (;;) {
        const job = queue.shift();
        if (!job) return;
        try {
          await job.run();
        } catch (err) {
          console.warn(`[assets] ${job.label} failed`, err);
        }
        done += job.size;
        this.loadedBytes = done;
        onProgress(clamp(done / this.totalBytes, 0, 1), job.label);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    onProgress(1, 'ready');
  }

  has(name: string) { return this.models.has(name); }

  /** clone with unique materials so callers can retint safely. */
  clone(name: string, ownMaterials = true): THREE.Group {
    const src = this.models.get(name);
    if (!src) {
      console.warn(`[assets] model "${name}" not loaded`);
      const g = new THREE.Group();
      g.name = `missing:${name}`;
      return g;
    }
    const c = src.clone(true);
    if (ownMaterials) {
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) m.material = mat.map((x) => x.clone());
        else if (mat) m.material = mat.clone();
      });
    }
    return c;
  }

  lodTwin(name: string): THREE.Group | null {
    const g = this.lodModels.get(name);
    return g ? g : null;
  }

  env(name: string) { return this.hdri.get(name) ?? null; }

  /**
   * Uniform scale/placement: 1 world unit = 1 metre.  Models are re-scaled so
   * that their largest axis matches `target` metres, origin moved to the
   * bottom-centre so they sit on a floor/surface.
   */
  static fit(object: THREE.Object3D, target: number, axis: 'y' | 'max' = 'y', sitOnGround = true) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const ref = axis === 'y' ? size.y : Math.max(size.x, size.y, size.z);
    const s = ref > 1e-5 ? target / ref : 1;
    object.scale.multiplyScalar(s);
    if (sitOnGround) {
      const box2 = new THREE.Box3().setFromObject(object);
      const c = box2.getCenter(new THREE.Vector3());
      object.position.x -= c.x;
      object.position.z -= c.z;
      object.position.y -= box2.min.y;
    }
    return object;
  }
}

/**
 * Re-materialise a photographed PBR asset into the BSOD palette so that a
 * bright leather chair and a polished car read as "fragments of memory pulled
 * out of the PC": desaturated blue albedo, boosted emissive rim, and a
 * wireframe ghost pass.
 */
export function bsodify(
  root: THREE.Object3D,
  opts: {
    tint?: THREE.ColorRepresentation;
    emissive?: THREE.ColorRepresentation;
    roughness?: number;
    metalness?: number;
    keepMaps?: boolean;
    wire?: boolean;
    wireOpacity?: number;
    transparent?: number;
  } = {},
) {
  const tint = new THREE.Color(opts.tint ?? 0x2d6bd8);
  const emissive = new THREE.Color(opts.emissive ?? 0x0a2a6a);
  const rng = new RNG(4242);
  const wireMat = opts.wire === false ? null : new THREE.MeshBasicMaterial({
    color: 0x9cc8ff, wireframe: true, transparent: true,
    opacity: opts.wireOpacity ?? 0.12, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const extra: THREE.Object3D[] = [];

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const converted = mats.map((m) => {
      const src = m as THREE.MeshStandardMaterial;
      const mat = new THREE.MeshStandardMaterial({
        map: opts.keepMaps ? src.map : null,
        normalMap: opts.keepMaps ? src.normalMap : null,
        roughnessMap: opts.keepMaps ? src.roughnessMap : null,
        metalnessMap: opts.keepMaps ? src.metalnessMap : null,
        aoMap: opts.keepMaps ? src.aoMap : null,
        alphaMap: src.alphaMap,
        transparent: (opts.transparent ?? 0) > 0 || src.transparent,
        opacity: opts.transparent ?? src.opacity,
        side: src.side,
        color: tint.clone().multiplyScalar(0.55 + rng.next() * 0.5),
        roughness: opts.roughness ?? 0.55,
        metalness: opts.metalness ?? 0.25,
        emissive: emissive.clone().multiplyScalar(0.6 + rng.next() * 0.8),
        emissiveIntensity: 1,
        envMapIntensity: 1.1,
      });
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      if (mat.emissiveMap === undefined) mat.emissiveMap = null;
      return mat;
    });
    mesh.material = Array.isArray(mesh.material) ? converted : converted[0];
    if (wireMat) extra.push(mesh);
  });
  // add the wire ghosts *after* traversal (children added during traverse()
  // would be visited again and recurse forever)
  if (wireMat) {
    for (const m of extra) {
      const w = new THREE.Mesh((m as THREE.Mesh).geometry, wireMat);
      w.name = 'wire-ghost';
      w.matrixAutoUpdate = false;
      w.userData.ghost = true;
      (m as THREE.Object3D).add(w);
    }
  }
  return root;
}
