/** 共通ユーティリティ / 決定論的乱数 / イージング */

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b - a === 0 ? 0 : (v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp(invLerp(a, b, v), 0, 1);
  return t * t * (3 - 2 * t);
};
/** フレームレート非依存の指数補間 */
export const damp = (a: number, b: number, lambda: number, dt: number) =>
  b + (a - b) * Math.exp(-lambda * dt);
export const dampV = <T extends { x: number; y: number; z: number }>(a: T, b: T, lambda: number, dt: number) => {
  const k = Math.exp(-lambda * dt);
  a.x = b.x + (a.x - b.x) * k;
  a.y = b.y + (a.y - b.y) * k;
  a.z = b.z + (a.z - b.z) * k;
  return a;
};
export const TAU = Math.PI * 2;
export const deg = (d: number) => (d * Math.PI) / 180;

/* ------------------------------------------------------------------ */
/* 決定論的乱数 (リプレイ時に完全初期化できるよう、シード固定)          */
/* ------------------------------------------------------------------ */
export class RNG {
  private s: number;
  constructor(seed = 1337) { this.s = seed >>> 0 || 1; }
  /** xorshift32 */
  next() {
    let x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.s = x;
    return x / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  int(a: number, b: number) { return Math.floor(this.range(a, b + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
}

/* 2D バリューノイズ (地形やグリッチ変形に使用) */
const P = new Uint8Array(512);
(() => {
  const r = new RNG(0x9e3779b9);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
})();
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const grad2 = (h: number, x: number, y: number) => {
  switch (h & 7) {
    case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
    case 4: return x; case 5: return -x; case 6: return y; default: return -y;
  }
};
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x), yf = y - Math.floor(y);
  const u = fade(xf), v = fade(yf);
  const aa = P[P[xi] + yi], ab = P[P[xi] + yi + 1];
  const ba = P[P[xi + 1] + yi], bb = P[P[xi + 1] + yi + 1];
  const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
  const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
  return lerp(x1, x2, v);
}
export function fbm2(x: number, y: number, oct = 4, lac = 2.03, gain = 0.5) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); f *= lac; a *= gain; }
  return s;
}

/* ------------------------------------------------------------------ */
export const ease = {
  linear: (t: number) => t,
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  in: (t: number) => t * t * t,
  outQuint: (t: number) => 1 - Math.pow(1 - t, 5),
  inOutQuint: (t: number) => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2),
  outBack: (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2),
  outElastic: (t: number) => {
    if (t <= 0) return 0; if (t >= 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
};

/** 時間ベースの小さな揺らぎ (手ブレ・呼吸) */
export function wobble(t: number, seed = 0) {
  return (
    Math.sin(t * 1.7 + seed * 2.1) * 0.5 +
    Math.sin(t * 2.9 + seed * 5.7) * 0.3 +
    Math.sin(t * 4.7 + seed * 1.3) * 0.2
  );
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
