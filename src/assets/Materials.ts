import * as THREE from 'three';
import type { AssetStore } from './Assets';

/**
 * Every surface material in the experience. Albedo/normal/roughness/AO come from the
 * procedurally generated sets (scripts/gen-textures.mjs) plus one ambientCG CC0 set for the
 * crystalline ground of the arrival area. Materials are cached and share GPU textures.
 */

export type MaterialName =
  | 'woodFloor' | 'woodDark' | 'plaster' | 'concrete' | 'concreteDark'
  | 'metalBrushed' | 'metalRust' | 'fabric' | 'carpet' | 'paper' | 'asphalt'
  | 'rubber' | 'tile' | 'ice';

const SETS: Record<MaterialName, string> = {
  woodFloor: 't_wood_floor',
  woodDark: 't_wood_dark',
  plaster: 't_plaster',
  concrete: 't_concrete',
  concreteDark: 't_concrete_dark',
  metalBrushed: 't_metal_brushed',
  metalRust: 't_metal_rust',
  fabric: 't_fabric',
  carpet: 't_carpet',
  paper: 't_paper',
  asphalt: 't_asphalt',
  rubber: 't_rubber',
  tile: 't_tile',
  ice: 'Ice002',
};

interface SetTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  aoMap: THREE.Texture;
}

export interface MaterialOptions {
  color?: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  envMapIntensity?: number;
}

export class MaterialLibrary {
  private sets = new Map<MaterialName, SetTextures>();
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private emissiveTextures = new Map<string, THREE.CanvasTexture>();
  ready = false;

  constructor(private store: AssetStore) {}

  async init(): Promise<void> {
    const names = Object.keys(SETS) as MaterialName[];
    await Promise.all(names.map(async (name) => {
      const base = SETS[name];
      const isAmbientCG = base === 'Ice002';
      const urls = isAmbientCG
        ? {
          map: `assets/textures/${base}_color.jpg`,
          normalMap: `assets/textures/${base}_normal.jpg`,
          roughnessMap: `assets/textures/${base}_roughness.jpg`,
          aoMap: `assets/textures/${base}_roughness.jpg`,
        }
        : {
          map: `assets/textures/${base}_albedo.webp`,
          normalMap: `assets/textures/${base}_normal.webp`,
          roughnessMap: `assets/textures/${base}_rough.webp`,
          aoMap: `assets/textures/${base}_ao.webp`,
        };
      const [map, normalMap, roughnessMap, aoMap] = await Promise.all([
        this.store.loadTexture(urls.map, { srgb: true }),
        this.store.loadTexture(urls.normalMap, { srgb: false }),
        this.store.loadTexture(urls.roughnessMap, { srgb: false }),
        this.store.loadTexture(urls.aoMap, { srgb: false }),
      ]);
      this.sets.set(name, { map, normalMap, roughnessMap, aoMap });
    }));
    this.ready = true;
  }

  /** Material with a uniform world-space texture density (repeat in tiles per metre). */
  get(name: MaterialName, tilesPerMetre = 1, opts: MaterialOptions = {}): THREE.MeshStandardMaterial {
    const key = `${name}|${tilesPerMetre}|${JSON.stringify(opts)}`;
    const cached = this.materials.get(key);
    if (cached) return cached;
    const set = this.sets.get(name);
    if (!set) throw new Error(`material set ${name} not loaded`);
    const rep = tilesPerMetre;
    const clone = (t: THREE.Texture) => {
      const c = t.clone();
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.repeat.set(rep, rep);
      c.needsUpdate = true;
      return c;
    };
    const mat = new THREE.MeshStandardMaterial({
      map: clone(set.map),
      normalMap: clone(set.normalMap),
      roughnessMap: clone(set.roughnessMap),
      aoMap: clone(set.aoMap),
      roughness: opts.roughness ?? 1,
      metalness: opts.metalness ?? 0,
      color: new THREE.Color(opts.color ?? 0xffffff),
      emissive: new THREE.Color(opts.emissive ?? 0x000000),
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      side: opts.side ?? THREE.FrontSide,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      envMapIntensity: opts.envMapIntensity ?? 1,
    });
    mat.normalScale.set(1, 1);
    this.materials.set(key, mat);
    return mat;
  }

  /** Plain physical material for trim pieces (frames, handles, cables). */
  solid(opts: {
    color: THREE.ColorRepresentation;
    roughness?: number;
    metalness?: number;
    emissive?: THREE.ColorRepresentation;
    emissiveIntensity?: number;
    transparent?: boolean;
    opacity?: number;
    map?: THREE.Texture;
  }): THREE.MeshStandardMaterial {
    const key = `solid|${JSON.stringify({ ...opts, map: undefined })}`;
    const cached = this.materials.get(key);
    if (cached) return cached;
    const mat = new THREE.MeshStandardMaterial({
      color: opts.color,
      roughness: opts.roughness ?? 0.65,
      metalness: opts.metalness ?? 0,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      map: opts.map ?? null,
    });
    this.materials.set(key, mat);
    return mat;
  }

  /** Text/label decals rendered into a canvas (posters, error plates, signs). */
  textTexture(key: string, draw: (ctx: CanvasRenderingContext2D, size: number) => void, size = 512): THREE.CanvasTexture {
    const cached = this.emissiveTextures.get(key);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    draw(ctx, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.emissiveTextures.set(key, tex);
    return tex;
  }

  dispose(): void {
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
    for (const t of this.emissiveTextures.values()) t.dispose();
    this.emissiveTextures.clear();
  }
}
