import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type TexSet = { albedo: THREE.Texture | null; normal: THREE.Texture | null; orm: THREE.Texture | null };

type ModelInfo = {
  file?: string;
  source?: string;
  bytes?: number;
  triangles?: number;
  bounds: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] };
};

type Manifest = {
  generated: string;
  models: Record<string, ModelInfo>;
  textures: Record<string, { bytes?: number; license?: string; source?: string; url?: string; files?: string[] }>;
  audio: { footsteps: { files: string[]; license?: string; credit?: string; source?: string; url?: string } };
};

const BASE = import.meta.env.BASE_URL;

/**
 * ローカルに同梱した変換済みアセット (public/assets) を読む。
 * 変換の経緯とライセンスは CREDITS.md / src/data/credits.ts を参照。
 */
export class Assets {
  manifest!: Manifest;
  gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  texLoader = new THREE.TextureLoader();

  private modelCache = new Map<string, Promise<THREE.Group>>();
  private texCache = new Map<string, Promise<TexSet>>();
  private failCount = 0;
  /** 読み込み完了数 / 総数 (ローディング表示用) */
  loaded = 0;
  total = 0;

  constructor(private renderer: THREE.WebGLRenderer) {}

  get progress() { return this.total === 0 ? 0 : this.loaded / this.total; }
  get failures() { return this.failCount; }

  async init() {
    const res = await fetch(`${BASE}assets/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`manifest.json の読み込みに失敗 (${res.status})`);
    this.manifest = (await res.json()) as Manifest;
    this.total = Object.keys(this.manifest.models).length + Object.keys(this.manifest.textures).length;

    // 起動時に主要アセットを並列で温める (最初の部屋で待たされないように)
    const jobs: Promise<unknown>[] = [];
    for (const key of Object.keys(this.manifest.models)) jobs.push(this.model(key).catch((e) => { this.failCount++; console.warn('[assets] model', key, e); }));
    for (const key of Object.keys(this.manifest.textures)) jobs.push(this.texSet(key).catch((e) => { this.failCount++; console.warn('[assets] tex', key, e); }));
    await Promise.all(jobs);
    if (this.failCount > 0) throw new Error(`${this.failCount} 個のアセットを読み込めませんでした`);
  }

  /* ---------------- テクスチャ ---------------- */
  private loadTexSet(key: string): Promise<TexSet> {
    const info = this.manifest.textures[key];
    if (!info) return Promise.reject(new Error(`unknown texture set: ${key}`));
    const dir = `${BASE}assets/tex/${key}`;
    const load = (file: string, srgb: boolean) => new Promise<THREE.Texture | null>((resolve) => {
      this.texLoader.load(
        `${dir}/${file}`,
        (t) => {
          t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
          resolve(t);
        },
        undefined,
        () => resolve(null),
      );
    });
    const p = Promise.all([load('albedo.webp', true), load('normal.webp', false), load('orm.webp', false)])
      .then(([albedo, normal, orm]) => {
        this.loaded++;
        if (!albedo) this.failCount++;
        return { albedo, normal, orm };
      });
    this.texCache.set(key, p);
    return p;
  }

  texSet(key: string) {
    return this.texCache.get(key) ?? this.loadTexSet(key);
  }

  /* ---------------- モデル ---------------- */
  private loadModel(key: string): Promise<THREE.Group> {
    const info = this.manifest.models[key];
    if (!info) return Promise.reject(new Error(`unknown model: ${key}`));
    const p = new Promise<THREE.Group>((resolve, reject) => {
      this.gltfLoader.load(
        `${BASE}assets/models/${info.file ?? key + '.glb'}`,
        (gltf) => {
          this.loaded++;
          const root = gltf.scene;
          root.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.castShadow = true;
              m.receiveShadow = true;
              m.frustumCulled = true;
              const mats = Array.isArray(m.material) ? m.material : [m.material];
              for (const mat of mats) {
                const std = mat as THREE.MeshStandardMaterial;
                if (std.isMeshStandardMaterial) {
                  std.envMapIntensity = 0.85;
                  std.shadowSide = THREE.FrontSide;
                }
              }
            }
          });
          resolve(root);
        },
        undefined,
        (err) => { this.failCount++; reject(err); },
      );
    });
    this.modelCache.set(key, p);
    return p;
  }

  model(key: string) {
    return this.modelCache.get(key) ?? this.loadModel(key);
  }

  /** targetHeight (m) に収めるための倍率 */
  scaleFor(key: string, targetHeight: number) {
    const b = this.manifest.models[key]?.bounds.size;
    if (!b) return 1;
    const cur = Math.max(b[0], b[1], b[2]);
    return cur > 0 ? targetHeight / cur : 1;
  }

  /** 反射プローブ用の環境マップ (部屋 / 異世界で別のものを生成) */
  makeEnvMap(kind: 'room' | 'void' = 'room') {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    let env: THREE.Scene;
    if (kind === 'room') {
      env = new RoomEnvironment();
      const rt = pmrem.fromScene(env, 0.05);
      pmrem.dispose();
      return rt.texture;
    }
    // 異世界: 暗い青の地平 + 発光する破片から反射を拾う
    env = new THREE.Scene();
    env.background = new THREE.Color(0x04101f);
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(60, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x0a2a4d, side: THREE.BackSide }),
    );
    env.add(shell);
    const mat = new THREE.MeshBasicMaterial({ color: 0x9fd6ff });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 2 + (i % 3) * 3), mat);
      m.position.set(Math.cos(a) * 28, (i % 4) * 6 - 6, Math.sin(a) * 28);
      m.lookAt(0, 2, 0);
      env.add(m);
    }
    const rt = pmrem.fromScene(env, 0.02);
    pmrem.dispose();
    shell.geometry.dispose();
    (shell.material as THREE.Material).dispose();
    mat.dispose();
    return rt.texture;
  }

  /** 高さ h (m) に正規化した複製を返す。ライセンス上も安全なよう毎回 clone する。 */
  async instance(key: string, opts: { scale?: number | [number, number, number]; rotateY?: number; targetHeight?: number } = {}) {
    const src = await this.model(key);
    const root = src.clone(true);
    let s: [number, number, number] = [1, 1, 1];
    if (opts.targetHeight) {
      const b = this.manifest.models[key].bounds.size;
      const cur = Math.max(b[0], b[1], b[2]) > 0 ? Math.max(b[0], b[1], b[2]) : 1;
      const k = opts.targetHeight / cur;
      s = [k, k, k];
    }
    if (opts.scale !== undefined) {
      if (typeof opts.scale === 'number') s = [opts.scale, opts.scale, opts.scale];
      else s = opts.scale;
    }
    root.scale.set(s[0], s[1], s[2]);
    if (opts.rotateY) root.rotation.y = opts.rotateY;
    return root;
  }
}
