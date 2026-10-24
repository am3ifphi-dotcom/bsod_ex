import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Asset registry + material library.
 *
 * Unit policy: 1 unit = 1 metre, Y up, forward = -Z (glTF/three convention). Source assets are
 * authored at real-world scale, so `scale` below is only used where a model's own units differ
 * (BoomBox is modelled in ~2 cm units, the street Lantern in ~25 cm units, SciFiHelmet is a
 * giant helmet, etc). The numbers were measured from the optimised GLBs (see
 * public/assets/assets-report.json) rather than guessed.
 */

export type MaterialTint = 'original' | 'world' | 'world-dark' | 'world-emissive';

export interface ModelSpec {
  id: string;
  url: string;
  scale?: number;
  /** shift applied after scaling so the object's base sits on y = 0 */
  yOffset?: number;
  tint?: MaterialTint;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** custom material tweak, applied on a cloned material per instance */
  tweak?: (mat: THREE.MeshStandardMaterial) => void;
}

export const MODELS: Record<string, ModelSpec> = {
  sheenChair: { id: 'SheenChair', url: 'assets/models/SheenChair.glb', scale: 1.12, tint: 'original', castShadow: true, receiveShadow: true },
  stainedGlassLamp: { id: 'StainedGlassLamp', url: 'assets/models/StainedGlassLamp.glb', scale: 1, tint: 'original', castShadow: true, receiveShadow: true },
  waterBottle: { id: 'WaterBottle', url: 'assets/models/WaterBottle.glb', scale: 1, tint: 'original', castShadow: true, receiveShadow: true },
  boombox: { id: 'BoomBox', url: 'assets/models/BoomBox.glb', scale: 18, tint: 'original', castShadow: true, receiveShadow: true },
  glassVase: { id: 'GlassVaseFlowers', url: 'assets/models/GlassVaseFlowers.glb', scale: 1.35, tint: 'original', castShadow: true, receiveShadow: true },
  teacup: { id: 'DiffuseTransmissionTeacup', url: 'assets/models/DiffuseTransmissionTeacup.glb', scale: 1.25, tint: 'original', castShadow: true, receiveShadow: true },
  toyCar: { id: 'ToyCar', url: 'assets/models/ToyCar.glb', scale: 3.6, tint: 'original', castShadow: true, receiveShadow: true },
  sciFiHelmet: { id: 'SciFiHelmet', url: 'assets/models/SciFiHelmet.glb', scale: 0.62, tint: 'original', castShadow: true, receiveShadow: true },
  flightHelmet: { id: 'FlightHelmet', url: 'assets/models/FlightHelmet.glb', scale: 1.05, tint: 'original', castShadow: true, receiveShadow: true },
  glamSofa: { id: 'GlamVelvetSofa', url: 'assets/models/GlamVelvetSofa.glb', scale: 1, tint: 'original', castShadow: true, receiveShadow: true },
  fridge: { id: 'CommercialRefrigerator', url: 'assets/models/CommercialRefrigerator.glb', scale: 1, tint: 'original', castShadow: true, receiveShadow: true },
  leatherSofa: { id: 'SheenWoodLeatherSofa', url: 'assets/models/SheenWoodLeatherSofa.glb', scale: 1, tint: 'original', castShadow: true, receiveShadow: true },
  streetLantern: { id: 'Lantern', url: 'assets/models/Lantern.glb', scale: 0.115, tint: 'original', castShadow: true, receiveShadow: true },
};

export interface AssetProgress {
  loaded: number;
  total: number;
  label: string;
}

/** Loads models/HDRIs once, hands out cheap clones, and applies the shared look. */
export class AssetStore {
  readonly gltfLoader = new GLTFLoader();
  private modelCache = new Map<string, Promise<THREE.Group>>();
  private hdrCache = new Map<string, Promise<THREE.DataTexture>>();
  private textureLoader = new THREE.TextureLoader();
  private texCache = new Map<string, Promise<THREE.Texture>>();
  private progressHandlers = new Set<(p: AssetProgress) => void>();
  private loaded = 0;
  private total = 0;

  get progress(): AssetProgress {
    return { loaded: this.loaded, total: this.total, label: '' };
  }

  onProgress(fn: (p: AssetProgress) => void): () => void {
    this.progressHandlers.add(fn);
    return () => this.progressHandlers.delete(fn);
  }

  private emit(label: string): void {
    for (const fn of this.progressHandlers) fn({ loaded: this.loaded, total: this.total, label });
  }

  private base(path: string): string {
    // Vite `base: './'` means assets resolve relative to the document.
    return path;
  }

  async preload(ids: (keyof typeof MODELS)[], labels?: string): Promise<void> {
    this.total = ids.length;
    this.loaded = 0;
    this.emit(labels ?? 'loading');
    await Promise.all(ids.map((key) => this.loadModel(key as string).then(() => {
      this.loaded++;
      this.emit(MODELS[key as string]?.id ?? (key as string));
    })));
  }

  loadModel(key: string): Promise<THREE.Group> {
    const spec = MODELS[key];
    if (!spec) return Promise.reject(new Error(`unknown model ${key}`));
    let p = this.modelCache.get(key);
    if (!p) {
      p = new Promise<THREE.Group>((resolve, reject) => {
        this.gltfLoader.load(
          this.base(spec.url),
          (gltf: GLTF) => {
            const root = gltf.scene;
            root.traverse((o) => {
              const mesh = o as THREE.Mesh;
              if (!mesh.isMesh) return;
              mesh.castShadow = spec.castShadow ?? true;
              mesh.receiveShadow = spec.receiveShadow ?? true;
              mesh.frustumCulled = true;
              const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              for (const m of mats) {
                const std = m as THREE.MeshStandardMaterial;
                if (std.map) std.map.anisotropy = 4;
                if (std.normalMap) std.normalMap.anisotropy = 4;
                // glTF assets are authored for a neutral studio; match our exposure
                std.envMapIntensity = 1;
              }
            });
            resolve(root);
          },
          undefined,
          (err) => reject(err),
        );
      });
      this.modelCache.set(key, p);
    }
    return p;
  }

  /**
   * Instantiate a model. Geometry is shared; materials are cloned only when an override is
   * requested so repeated props stay cheap.
   */
  async instantiate(key: string, opts: {
    position?: THREE.Vector3Like;
    rotationY?: number;
    scale?: number;
    tint?: MaterialTint;
    castShadow?: boolean;
    receiveShadow?: boolean;
    tweak?: (mat: THREE.MeshStandardMaterial, mesh: THREE.Mesh) => void;
    name?: string;
  } = {}): Promise<THREE.Group> {
    const spec = MODELS[key];
    const src = await this.loadModel(key);
    const clone = cloneModel(src);
    const scale = opts.scale ?? spec.scale ?? 1;
    clone.scale.setScalar(scale);
    if (spec.yOffset) clone.position.y += spec.yOffset * scale;
    if (opts.position) clone.position.set(opts.position.x, opts.position.y, opts.position.z);
    clone.rotation.y = opts.rotationY ?? 0;
    clone.name = opts.name ?? `${key}-instance`;
    const tint = opts.tint ?? spec.tint ?? 'original';
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (opts.castShadow !== undefined) mesh.castShadow = opts.castShadow;
      if (opts.receiveShadow !== undefined) mesh.receiveShadow = opts.receiveShadow;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const cloned = mats.map((m) => (m as THREE.MeshStandardMaterial).clone());
      cloned.forEach((m) => {
        if (tint !== 'original') applyWorldTint(m, tint);
        opts.tweak?.(m, mesh);
      });
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
    });
    return clone;
  }

  async loadHDR(url: string): Promise<THREE.DataTexture> {
    let p = this.hdrCache.get(url);
    if (!p) {
      p = new Promise<THREE.DataTexture>((resolve, reject) => {
        new RGBELoader().load(this.base(url), (tex) => {
          tex.mapping = THREE.EquirectangularReflectionMapping;
          resolve(tex);
        }, undefined, reject);
      });
      this.hdrCache.set(url, p);
    }
    return p;
  }

  /** PMREM-converted environment for IBL. */
  async makeEnv(url: string, renderer: THREE.WebGLRenderer): Promise<THREE.Texture> {
    const hdr = await this.loadHDR(url);
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const rt = pmrem.fromEquirectangular(hdr);
    pmrem.dispose();
    return rt.texture;
  }

  loadTexture(url: string, opts: { srgb?: boolean; repeat?: [number, number]; wrap?: boolean } = {}): Promise<THREE.Texture> {
    const key = `${url}|${opts.srgb ?? false}|${opts.repeat?.join(',') ?? ''}|${opts.wrap ?? true}`;
    let p = this.texCache.get(key);
    if (!p) {
      p = new Promise<THREE.Texture>((resolve, reject) => {
        this.textureLoader.load(this.base(url), (tex) => {
          tex.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          tex.wrapS = tex.wrapT = opts.wrap === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
          if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
          tex.anisotropy = 8;
          resolve(tex);
        }, undefined, reject);
      });
      this.texCache.set(key, p);
    }
    return p;
  }

  dispose(): void {
    this.modelCache.clear();
    this.hdrCache.clear();
    this.texCache.clear();
  }
}

/** Deep clone that keeps geometry shared but does not share object transforms. */
export function cloneModel(src: THREE.Object3D): THREE.Group {
  return src.clone(true) as THREE.Group;
}

/** Re-tint a PBR material into the BSOD palette: cold, low saturation, faint self-glow. */
export function applyWorldTint(mat: THREE.MeshStandardMaterial, tint: MaterialTint): void {
  mat.userData.worldTint = tint;
  if (tint === 'world' || tint === 'world-dark') {
    const dark = tint === 'world-dark';
    if (mat.map) {
      mat.map = mat.map;
      mat.color.setRGB(dark ? 0.24 : 0.4, dark ? 0.34 : 0.55, dark ? 0.62 : 1.0);
    } else {
      mat.color.setRGB(dark ? 0.09 : 0.16, dark ? 0.13 : 0.22, dark ? 0.26 : 0.42);
    }
    mat.roughness = Math.min(1, (mat.roughness ?? 0.6) * 0.75 + 0.25);
    mat.metalness = (mat.metalness ?? 0) * 0.4 + 0.18;
    mat.emissive = new THREE.Color(dark ? 0x04101f : 0x0a1c33);
    mat.emissiveIntensity = dark ? 0.5 : 0.85;
    mat.envMapIntensity = 0.55;
    mat.transparent = false;
    mat.opacity = 1;
    mat.side = THREE.FrontSide;
    attachCorruptionShader(mat);
  } else if (tint === 'world-emissive') {
    mat.color.setRGB(0.05, 0.1, 0.2);
    mat.emissive = new THREE.Color(0x2d6fd6);
    mat.emissiveIntensity = 2.4;
    mat.roughness = 0.35;
    mat.metalness = 0.1;
    attachCorruptionShader(mat);
  }
  mat.needsUpdate = true;
}

/**
 * Geometry-level corruption: a small vertex displacement keyed to world position + time, plus
 * an emissive "scan band" and edge dithering in the fragment stage. This is deliberately not a
 * post-process — the geometry itself tears apart.
 */
const corruptionUniforms = {
  uGlitchTime: { value: 0 },
  uGlitchAmount: { value: 0.12 },
  uGlitchBand: { value: new THREE.Vector4(0, 1, 0, 0) },
};

export function updateCorruptionUniforms(time: number, amount: number): void {
  corruptionUniforms.uGlitchTime.value = time;
  corruptionUniforms.uGlitchAmount.value = amount;
}

export function attachCorruptionShader(mat: THREE.MeshStandardMaterial): void {
  if (mat.userData.corrupted) return;
  mat.userData.corrupted = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlitchTime = corruptionUniforms.uGlitchTime;
    shader.uniforms.uGlitchAmount = corruptionUniforms.uGlitchAmount;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uGlitchTime;
        uniform float uGlitchAmount;
        float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        float band = step(0.985, hash11(floor(wp.y * 5.0) + floor(uGlitchTime * 6.0)));
        float flick = step(0.4, hash11(floor(uGlitchTime * 3.0) + wp.y * 0.3));
        transformed.x += band * flick * uGlitchAmount * 0.55;
        transformed.z += band * flick * uGlitchAmount * 0.18;
        transformed.x += sin(wp.y * 2.7 + uGlitchTime * 0.8) * uGlitchAmount * 0.05;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uGlitchTime;
        uniform float uGlitchAmount;
        float h11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float scan = step(0.5, fract(vViewPosition.y * 0.22 - uGlitchTime * 0.35));
        gl_FragColor.rgb += vec3(0.02, 0.05, 0.12) * scan * uGlitchAmount * 3.0;
        float noise = h11(floor(vViewPosition.x * 40.0) + floor(uGlitchTime * 12.0));
        if (noise > 1.0 - uGlitchAmount * 0.08) {
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.55, 0.75, 1.0), 0.55);
        }`);
  };
  mat.customProgramCacheKey = () => 'bsod-corrupted-v1';
}

/** Build an instanced mesh from a list of matrices (debris, repeated architecture). */
export function makeInstanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  matrices: THREE.Matrix4[],
  castShadow = false,
): THREE.InstancedMesh {
  const inst = new THREE.InstancedMesh(geometry, material, Math.max(1, matrices.length));
  matrices.forEach((m, i) => inst.setMatrixAt(i, m));
  inst.count = matrices.length;
  inst.instanceMatrix.needsUpdate = true;
  inst.castShadow = castShadow;
  inst.frustumCulled = true;
  return inst;
}

/** Merge an array of {geometry, matrix} into one buffer geometry for cheap static objects. */
export function mergeTransformed(parts: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[]): THREE.BufferGeometry | null {
  if (!parts.length) return null;
  const geos = parts.map(({ geometry, matrix }) => {
    const g = geometry.clone();
    g.applyMatrix4(matrix);
    return g;
  });
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return merged;
}

/**
 * Build a "circuit / trace" texture used for the deep area and the monolith skin: white traces
 * on transparent, so it can be layered as emissive detail. Generated once per size.
 */
export function makeCircuitTexture(size = 512, seed = 1): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = '#cfe6ff';
  ctx.lineWidth = 1;
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < 220; i++) {
    let x = Math.floor(rnd() * size);
    let y = Math.floor(rnd() * size);
    ctx.globalAlpha = 0.25 + rnd() * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 3 + Math.floor(rnd() * 5);
    for (let j = 0; j < steps; j++) {
      if (rnd() < 0.5) x += (rnd() < 0.5 ? -1 : 1) * (8 + Math.floor(rnd() * 30));
      else y += (rnd() < 0.5 ? -1 : 1) * (8 + Math.floor(rnd() * 30));
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (rnd() < 0.35) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#e8f4ff';
      ctx.fillRect(x - 1, y - 1, 3, 3);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
