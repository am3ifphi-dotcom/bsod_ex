import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FontLoader, type Font } from 'three/addons/loaders/FontLoader.js';
import { glitchify } from './glitch';

export type MaterialOptions = {
  repeat?: number | [number, number];
  color?: number;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  emissive?: number;
  emissiveIntensity?: number;
  aoIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  glitch?: number;
  depthWrite?: boolean;
  alphaTest?: number;
  map?: 'color' | 'normal' | 'rough' | null;
};

export const TEX_SETS = {
  woodfloor: { color: 'woodfloor_color.webp', normal: 'woodfloor_normal.webp', rough: 'woodfloor_rough.webp', ao: 'woodfloor_ao.webp' },
  wood: { color: 'wood_color.webp', normal: 'wood_normal.webp', rough: 'wood_rough.webp' },
  fabric: { color: 'fabric_color.webp', normal: 'fabric_normal.webp', rough: 'fabric_rough.webp' },
  metal: { color: 'metal_color.webp', normal: 'metal_normal.webp', rough: 'metal_rough.webp', metal: 'metal_metal.webp' },
  metal_dark: { color: 'metal_dark_color.webp', normal: 'metal_dark_normal.webp', rough: 'metal_dark_rough.webp', metal: 'metal_dark_metal.webp' },
  plastic: { color: 'plastic_color.webp', normal: 'plastic_normal.webp', rough: 'plastic_rough.webp' },
  rock: { color: 'rock_color.webp', normal: 'rock_normal.webp', rough: 'rock_rough.webp', ao: 'rock_ao.webp' },
  sandstone: { color: 'sandstone_color.webp', normal: 'sandstone_normal.webp', rough: 'sandstone_rough.webp', ao: 'sandstone_ao.webp' },
  snow: { color: 'snow_color.webp', normal: 'snow_normal.webp', rough: 'snow_rough.webp' },
  planks: { color: 'planks_color.webp', normal: 'planks_normal.webp', rough: 'planks_rough.webp', ao: 'planks_ao.webp' },
} as const;

export type TexSetName = keyof typeof TEX_SETS;
type TexMap = 'color' | 'normal' | 'rough' | 'ao' | 'metal';

const BASE = `${import.meta.env.BASE_URL}assets/`;
const MODEL_NAMES = ['sheen_chair', 'lantern', 'sofa', 'helmet', 'column', 'pillar', 'rock', 'stone'] as const;
const EXR_NAMES = ['night', 'apartment', 'city', 'warehouse', 'hall', 'lab'] as const;
const HDR_NAMES = ['dikhololo_night', 'large_corridor'] as const;

export class Assets {
  renderer: THREE.WebGLRenderer;
  pmrem: THREE.PMREMGenerator;
  sets: Partial<Record<TexSetName, Partial<Record<TexMap, THREE.Texture>>>> = {};
  models: Partial<Record<(typeof MODEL_NAMES)[number], THREE.Group>> = {};
  envs: Partial<Record<string, THREE.Texture>> = {};
  skyHdri?: THREE.Texture;
  font?: Font;
  manifest: any = null;
  loaded = 0;
  total = 1;

  private texCache = new Map<string, THREE.Texture>();

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
    const textureCount = Object.values(TEX_SETS).reduce((n, set) => n + Object.keys(set).length, 0);
    this.total = textureCount + MODEL_NAMES.length + EXR_NAMES.length + HDR_NAMES.length + 1;
  }

  private async loadTexture(url: string, srgb: boolean) {
    if (this.texCache.has(url)) return this.texCache.get(url)!;
    const tex = await new THREE.TextureLoader().loadAsync(BASE + url);
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.texCache.set(url, tex);
    return tex;
  }

  async load(progress: (loaded: number, total: number) => void) {
    const tick = () => {
      this.loaded++;
      progress(this.loaded, this.total);
    };
    const tasks: Promise<void>[] = [];

    for (const [setName, maps] of Object.entries(TEX_SETS)) {
      const set: Partial<Record<TexMap, THREE.Texture>> = {};
      this.sets[setName as TexSetName] = set;
      for (const [mapName, file] of Object.entries(maps)) {
        tasks.push(
          this.loadTexture(`textures/${file}`, mapName === 'color').then((t) => {
            set[mapName as TexMap] = t;
            tick();
          }),
        );
      }
    }

    const gltfLoader = new GLTFLoader();
    for (const name of MODEL_NAMES) {
      tasks.push(
        gltfLoader
          .loadAsync(`${BASE}models/${name}.glb`)
          .then((gltf) => {
            const group = gltf.scene;
            group.traverse((o) => {
              const mesh = o as THREE.Mesh;
              if (mesh.isMesh) {
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                for (const m of mats) {
                  const std = m as THREE.MeshStandardMaterial;
                  if (std.isMeshStandardMaterial) {
                    std.envMapIntensity = 0.7;
                    glitchify(std, 0.55);
                  }
                }
              }
            });
            this.models[name] = group;
            tick();
          })
          .catch((e) => {
            console.error(`failed to load model ${name}`, e);
            tick();
          }),
      );
    }

    for (const name of EXR_NAMES) {
      tasks.push(
        new EXRLoader()
          .loadAsync(`${BASE}hdri/${name}.exr`)
          .then((tex) => {
            tex.mapping = THREE.EquirectangularReflectionMapping;
            this.envs[name] = this.pmrem.fromEquirectangular(tex).texture;
            tex.dispose();
            tick();
          })
          .catch((e) => {
            console.error(`failed to load EXR ${name}`, e);
            tick();
          }),
      );
    }

    for (const name of HDR_NAMES) {
      tasks.push(
        new RGBELoader()
          .loadAsync(`${BASE}hdri/${name}.hdr`)
          .then((tex) => {
            tex.mapping = THREE.EquirectangularReflectionMapping;
            if (name === 'dikhololo_night') this.skyHdri = tex;
            this.envs[name] = this.pmrem.fromEquirectangular(tex).texture;
            tick();
          })
          .catch((e) => {
            console.error(`failed to load HDR ${name}`, e);
            tick();
          }),
      );
    }

    tasks.push(
      new FontLoader()
        .loadAsync(`${BASE}fonts/inter_bold.json`)
        .then((font) => {
          this.font = font;
          tick();
        })
        .catch((e) => {
          console.error('failed to load font', e);
          tick();
        }),
    );

    tasks.push(
      fetch(`${BASE}manifest.json`)
        .then((r) => r.json())
        .then((json) => {
          this.manifest = json;
        })
        .catch(() => {
          this.manifest = null;
        }),
    );

    await Promise.all(tasks);
    progress(this.total, this.total);
  }

  tex(set: TexSetName, map: TexMap, repeat: number | [number, number] = 1): THREE.Texture | undefined {
    const base = this.sets[set]?.[map];
    if (!base) return undefined;
    const [rx, ry] = typeof repeat === 'number' ? [repeat, repeat] : repeat;
    if (rx === 1 && ry === 1) return base;
    const key = `${base.uuid}_${rx}_${ry}`;
    let clone = this.texCache.get(key);
    if (!clone) {
      clone = base.clone();
      clone.needsUpdate = true;
      clone.wrapS = clone.wrapT = THREE.RepeatWrapping;
      clone.repeat.set(rx, ry);
      clone.anisotropy = base.anisotropy;
      this.texCache.set(key, clone);
    }
    return clone;
  }

  material(set: TexSetName, opts: MaterialOptions = {}): THREE.MeshStandardMaterial {
    const repeat = opts.repeat ?? 1;
    const params: THREE.MeshStandardMaterialParameters = {
      color: opts.color ?? 0xffffff,
      roughness: opts.roughness ?? 1,
      metalness: opts.metalness ?? 0,
      emissive: new THREE.Color(opts.emissive ?? 0x000000),
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide,
      depthWrite: opts.depthWrite ?? true,
      alphaTest: opts.alphaTest ?? 0,
    };
    const normal = this.tex(set, 'normal', repeat);
    const rough = this.tex(set, 'rough', repeat);
    const ao = this.tex(set, 'ao', repeat);
    const metal = this.tex(set, 'metal', repeat);
    const color = opts.map === null ? undefined : this.tex(set, 'color', repeat);
    if (normal) params.normalMap = normal;
    if (rough) params.roughnessMap = rough;
    if (ao) params.aoMap = ao;
    if (metal) params.metalnessMap = metal;
    if (color) params.map = color;
    const mat = new THREE.MeshStandardMaterial(params);
    if (mat.normalMap) mat.normalScale.setScalar(opts.normalScale ?? 1);
    mat.aoMapIntensity = opts.aoIntensity ?? 1;
    mat.envMapIntensity = 0.85;
    if (opts.glitch !== 0) glitchify(mat, opts.glitch ?? 1);
    return mat;
  }

  /** simple untextured PBR with the glitch injection (still gets env reflections) */
  plain(color: number, opts: MaterialOptions = {}): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.8,
      metalness: opts.metalness ?? 0,
      emissive: new THREE.Color(opts.emissive ?? 0x000000),
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide,
      depthWrite: opts.depthWrite ?? true,
    });
    mat.envMapIntensity = 0.9;
    if (opts.glitch !== 0) glitchify(mat, opts.glitch ?? 1);
    return mat;
  }

  emissive(color: number, intensity = 1): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 1 });
  }

  env(name: string): THREE.Texture | undefined {
    return this.envs[name];
  }
}
