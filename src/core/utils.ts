import * as THREE from 'three';

/** 汎用ユーティリティ */

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInCubic(t: number): number {
  return t * t * t;
}

export function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

export function easeInOutQuint(t: number): number {
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
}

/** サッケード(急速眼球運動)風イージング: 両端が遅く中間が速い */
export function saccade(t: number): number {
  return t * t * (3 - 2 * t) * t + 0.0;
}

export function randRange(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export function randInt(a: number, b: number): number {
  return Math.floor(randRange(a, b + 1));
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 決定論的シード付き擬似乱数 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** シンプル2D値ノイズ(fBm用) */
const PERM = (() => {
  const rng = mulberry32(1337);
  const p = new Uint8Array(512);
  const src = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [src[i], src[j]] = [src[j], src[i]];
  }
  for (let i = 0; i < 512; i++) p[i] = src[i & 255];
  return p;
})();

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function grad2(hash: number, x: number, y: number): number {
  switch (hash & 7) {
    case 0: return x + y;
    case 1: return x - y;
    case 2: return -x + y;
    case 3: return -x - y;
    case 4: return x;
    case 5: return -x;
    case 6: return y;
    default: return -y;
  }
}

export function valueNoise2(x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);
  const aa = PERM[PERM[xi] + yi];
  const ab = PERM[PERM[xi] + yi + 1];
  const ba = PERM[PERM[xi + 1] + yi];
  const bb = PERM[PERM[xi + 1] + yi + 1];
  const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
  const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
  return lerp(x1, x2, v) * 0.7;
}

export function fbm2(x: number, y: number, octaves = 4, lac = 2.0, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}

/** 高度ノイズ: 小さなフリックを補間(セリフ付き) */
export class SmoothedValue {
  value: number;
  private target: number;
  private speed: number;
  constructor(initial: number, speed = 8) {
    this.value = initial;
    this.target = initial;
    this.speed = speed;
  }
  set(target: number): void {
    this.target = target;
  }
  jump(value: number): void {
    this.value = value;
    this.target = value;
  }
  update(dt: number): number {
    this.value = damp(this.value, this.target, this.speed, dt);
    return this.value;
  }
}

/** キャンバス2Dユーティリティ */
export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

export function canvasTexture(canvas: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** エラーコード風の乱数文字列 */
const HEX = '0123456789ABCDEF';
export function randomHex(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += HEX[Math.floor(Math.random() * 16)];
  return s;
}

export function randomGlitchString(len: number): string {
  const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&@$!?<>/\\|[]{}';
  let s = '';
  for (let i = 0; i < len; i++) s += pool[Math.floor(Math.random() * pool.length)];
  return s;
}

/** 三角形のアスペクト比を保ったスケール正規化 */
export function normalizeModel(root: THREE.Object3D, targetMaxSize: number): THREE.Vector3 {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const max = Math.max(size.x, size.y, size.z) || 1;
  const s = targetMaxSize / max;
  root.scale.multiplyScalar(s);
  return new THREE.Vector3(s, s, s);
}

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (mat) {
      const list = Array.isArray(mat) ? mat : [mat];
      for (const m of list) {
        for (const key of Object.keys(m) as (keyof THREE.Material)[]) {
          const v = (m as unknown as Record<string, unknown>)[key as string];
          if (v && typeof v === 'object' && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
        }
        m.dispose();
      }
    }
  });
}
