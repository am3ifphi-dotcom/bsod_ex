/**
 * Small math / random helpers shared by every system. No dependencies so this module can be
 * unit tested in plain Node.
 */

export const TAU = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (a === b ? 0 : (v - a) / (b - a));
export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01(invLerp(edge0, edge1, x));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01(invLerp(edge0, edge1, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Frame-rate independent exponential smoothing toward a target. */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/** Same, but wraps angles correctly. */
export const dampAngle = (current: number, target: number, lambda: number, dt: number): number => {
  let delta = ((target - current + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return current + delta * (1 - Math.exp(-lambda * dt));
};

export const wrapAngle = (a: number): number => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;

export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;
export const easeInOutCubic = (t: number): number => {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInCubic = (t: number): number => Math.pow(clamp01(t), 3);
export const easeOutExpo = (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(t)));
export const easeInExpo = (t: number): number => (t <= 0 ? 0 : Math.pow(2, 10 * clamp01(t) - 10));

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;
  constructor(seed = 1337) { this.next = mulberry32(seed); }
  float(min = 0, max = 1): number { return min + (max - min) * this.next(); }
  int(min: number, max: number): number { return Math.floor(this.float(min, max + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))]; }
  bool(p = 0.5): boolean { return this.next() < p; }
  sign(): number { return this.next() < 0.5 ? -1 : 1; }
  gauss(mean = 0, sd = 1): number {
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
}

/** Cheap 1D value noise used for procedural camera sway / shake. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453123;
    return s - Math.floor(s);
  };
  const a = h(i);
  const b = h(i + 1);
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

export function fbm1(x: number, octaves = 3, seed = 0): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise1(x * freq, seed + i * 7) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum / norm;
}

/**
 * A soft impulse generator (spring-damper) used for physical camera kicks: the camera should
 * not snap back linearly after an impact, it should overshoot and settle like a neck does.
 */
export class Spring {
  value = 0;
  velocity = 0;
  constructor(private k = 120, private d = 14) {}
  impulse(v: number): void { this.velocity += v; }
  update(dt: number): number {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -this.k * this.value - this.d * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  reset(): void { this.value = 0; this.velocity = 0; }
}

/** Formatting helpers for UI (durations, file sizes). */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}
