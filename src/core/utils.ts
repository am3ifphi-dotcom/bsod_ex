// Shared math / procedural-texture helpers.
import * as THREE from 'three';

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeIn = (t: number) => t * t * t;
export const easeOutBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
export const DEG = Math.PI / 180;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  private f: () => number;
  constructor(seed = 1337) { this.f = mulberry32(seed); }
  next() { return this.f(); }
  range(a: number, b: number) { return a + (b - a) * this.f(); }
  int(a: number, b: number) { return Math.floor(this.range(a, b + 1)); }
  pick<T>(arr: T[]): T { return arr[Math.floor(this.f() * arr.length) % arr.length]; }
  sign() { return this.f() < 0.5 ? -1 : 1; }
  gauss() { return (this.f() + this.f() + this.f() + this.f() - 2) * 0.7; }
}

// --------------------------------------------------------------- value noise
const PERM = new Uint8Array(512);
(() => {
  const rng = mulberry32(20240517);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** 2D value noise in [-1,1] */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x), yf = y - Math.floor(y);
  const u = fade(xf), v = fade(yf);
  const aa = PERM[PERM[xi] + yi] / 255, ab = PERM[PERM[xi] + yi + 1] / 255;
  const ba = PERM[PERM[xi + 1] + yi] / 255, bb = PERM[PERM[xi + 1] + yi + 1] / 255;
  return (lerp(lerp(aa, ba, u), lerp(ab, bb, u), v) * 2 - 1);
}

export function fbm(x: number, y: number, octaves = 4, lac = 2.03, gain = 0.5): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq + i * 31.7, y * freq - i * 17.3) * amp;
    norm += amp; amp *= gain; freq *= lac;
  }
  return sum / norm;
}

export function ridged(x: number, y: number, octaves = 4): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += (1 - Math.abs(noise2(x * freq, y * freq))) * amp;
    norm += amp; amp *= 0.5; freq *= 2.07;
  }
  return sum / norm;
}

// --------------------------------------------------------------- canvases
export function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return { c, ctx };
}

export function canvasTexture(c: HTMLCanvasElement, opts: {
  repeat?: [number, number]; srgb?: boolean; aniso?: number; wrap?: THREE.Wrapping;
} = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = opts.wrap ?? THREE.RepeatWrapping;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso ?? 4;
  t.needsUpdate = true;
  return t;
}

/** Sobel height-map -> normal map canvas. */
export function normalFromHeight(src: HTMLCanvasElement, strength = 2.2): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const sctx = src.getContext('2d')!;
  const sd = sctx.getImageData(0, 0, w, h).data;
  const { c, ctx } = makeCanvas(w, h);
  const out = ctx.createImageData(w, h);
  const lum = (x: number, y: number) => {
    const xx = ((x % w) + w) % w, yy = ((y % h) + h) % h;
    const i = (yy * w + xx) * 4;
    return (sd[i] * 0.299 + sd[i + 1] * 0.587 + sd[i + 2] * 0.114) / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (lum(x - 1, y - 1) + 2 * lum(x - 1, y) + lum(x - 1, y + 1))
               - (lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1));
      const dy = (lum(x - 1, y - 1) + 2 * lum(x, y - 1) + lum(x + 1, y - 1))
               - (lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1));
      let nx = dx * strength, ny = dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      out.data[i] = (nx * 0.5 + 0.5) * 255;
      out.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      out.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

/** Multiplies a greyscale detail noise over a fill colour, used for albedo bases. */
export function noiseFill(ctx: CanvasRenderingContext2D, w: number, h: number, base: string, amt: number, scale = 26) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const { c: nc, ctx: nctx } = makeCanvas(w, h);
  const img = nctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm((x / w) * scale, (y / h) * scale, 4) * 0.5 + 0.5;
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = n * 255;
      img.data[i + 3] = 255;
    }
  }
  nctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = amt;
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(nc, 0, 0);
  ctx.restore();
}

/** Draw a paragraph of text into a canvas texture (used for in-world UI). */
export function textTexture(text: string, opts: {
  w?: number; h?: number; size?: number; color?: string; bg?: string; font?: string;
  align?: CanvasTextAlign; lineHeight?: number; padding?: number; glow?: string;
} = {}) {
  const w = opts.w ?? 1024, h = opts.h ?? 512;
  const { c, ctx } = makeCanvas(w, h);
  if (opts.bg) { ctx.fillStyle = opts.bg; ctx.fillRect(0, 0, w, h); }
  const size = opts.size ?? 48;
  ctx.font = `${opts.font ?? `600 ${size}px ${'ui-monospace, Consolas, monospace'}`}`;
  ctx.fillStyle = opts.color ?? '#ffffff';
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = 'top';
  if (opts.glow) { ctx.shadowColor = opts.glow; ctx.shadowBlur = size * 0.7; }
  const pad = opts.padding ?? size * 0.4;
  const lh = opts.lineHeight ?? size * 1.28;
  const lines = text.split('\n');
  lines.forEach((line, i) => ctx.fillText(line, opts.align === 'center' ? w / 2 : pad, pad + i * lh));
  return canvasTexture(c, { srgb: true });
}

export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
